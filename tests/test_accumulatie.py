"""Tests neerslagaccumulatie (accumulatie/*).

  python3 -m unittest tests.test_accumulatie -v

Synthetische HDF5-bestanden in het KNMI-formaat + een tijdelijk archief, zodat
elke regel van de rekenweg controleerbaar is. Optionele regressie op het echte
archief (overgeslagen als dat er niet is).
"""
import io
import os
import random
import sys
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import h5py
import numpy as np

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from accumulatie import bron, formaat, periode, raster  # noqa: E402
from accumulatie.opslag import Archief  # noqa: E402

UTC = timezone.utc


def knmi_h5(eind, data_vol=None, *, start=None, gain="0.010000", miss=65534, out=65535,
            par="PRECIP_[MM]", row_off=3650.0, px=1.0, py=-1.0,
            proj="+proj=stere +lat_0=90 +lon_0=0 +lat_ts=60 +a=6378137 +b=6356752 +x_0=0 +y_0=0 +units=km"):
    """Maak een HDF5-bestand (bytes) zoals KNMI RTCOR/RFCOR."""
    start = start or eind - timedelta(minutes=5)
    if data_vol is None:
        data_vol = np.zeros((765, 700), np.uint16)
    f = lambda dt: dt.strftime("%d-%b-%Y;%H:%M:%S.000").upper()  # noqa: E731
    buf = io.BytesIO()
    with h5py.File(buf, "w") as h:
        ov = h.create_group("overview")
        ov.attrs["product_datetime_start"] = np.bytes_(f(start))
        ov.attrs["product_datetime_end"] = np.bytes_(f(eind))
        g = h.create_group("geographic")
        g.attrs["geo_number_rows"] = np.array([765], np.int32)
        g.attrs["geo_number_columns"] = np.array([700], np.int32)
        g.attrs["geo_pixel_size_x"] = np.array([px], np.float32)
        g.attrs["geo_pixel_size_y"] = np.array([py], np.float32)
        g.attrs["geo_column_offset"] = np.array([0.0], np.float32)
        g.attrs["geo_row_offset"] = np.array([row_off], np.float32)
        g.attrs["geo_pixel_def"] = np.bytes_("LU")
        mp = g.create_group("map_projection")
        mp.attrs["projection_proj4_params"] = np.bytes_(proj)
        i1 = h.create_group("image1")
        i1.attrs["image_geo_parameter"] = np.bytes_(par)
        i1.create_dataset("image_data", data=data_vol)
        c = i1.create_group("calibration")
        c.attrs["calibration_formulas"] = np.bytes_(f"GEO={gain}*PV+0.000000")
        c.attrs["calibration_missing_data"] = np.array([miss], np.int32)
        c.attrs["calibration_out_of_image"] = np.array([out], np.int32)
        r = h.create_group("radar1")
        r.attrs["radar_name"] = np.bytes_("Herwijnen")
        r.attrs["radar_operational"] = np.array([1], np.int32)
    return buf.getvalue()


def frame(eind, waarde_uitsnede, bron_code="rt"):
    """Frame direct (zonder HDF5) met een uitsnede-array."""
    naam = f"RAD_NL25_RAC_{'RT' if bron_code == 'rt' else 'RF'}_{eind:%Y%m%d%H%M}.h5"
    return bron.Frame(eind=eind, data=np.asarray(waarde_uitsnede, np.uint16), bron=bron_code, bestand=naam)


class TestRaster(unittest.TestCase):
    def test_vooruit_gelijk_aan_pyproj(self):
        from pyproj import Proj
        p = Proj(raster.PROJ4)
        rnd = random.Random(1)
        for _ in range(200):
            lon, lat = rnd.uniform(0, 11), rnd.uniform(48.5, 56)
            x, y = raster.vooruit(lon, lat)
            xp, yp = p(lon, lat)
            self.assertAlmostEqual(float(x), xp, places=6)
            self.assertAlmostEqual(float(y), yp, places=6)
            lo2, la2 = raster.terug(x, y)
            self.assertAlmostEqual(float(lo2), lon, places=9)
            self.assertAlmostEqual(float(la2), lat, places=9)

    def test_hoekpunten_vallen_op_rasterranden(self):
        # geo_product_corners uit een echt RTCOR-bestand (oktober 2026)
        for lon, lat, rij, kol in [(0, 49.362064, 765, 0), (0, 55.973602, 0, 0),
                                   (10.856453, 55.388973, 0, 700), (9.0093, 48.8953, 765, 700)]:
            x, y = raster.vooruit(lon, lat)
            r, k = raster.xy_naar_index_vol(x, y)
            self.assertAlmostEqual(float(r), rij, delta=0.01)
            self.assertAlmostEqual(float(k), kol, delta=0.01)

    def test_cel_koppeling_is_floor(self):
        # punt net binnen de linkerbovenhoek van uitsnede-cel (10, 20)
        x = (raster.K0 + 20 + 0.001) * raster.PX
        y = -(raster.ROW_OFF + raster.R0 + 10 + 0.001)
        lon, lat = raster.terug(x, y)
        r, k = raster.cel_van_lonlat(lon, lat)
        self.assertEqual((int(r), int(k)), (10, 20))
        x = (raster.K0 + 20 + 0.999)
        lon, lat = raster.terug(x, y)
        self.assertEqual(int(raster.cel_van_lonlat(lon, lat)[1]), 20)
        lon, lat = raster.celcentrum_lonlat(10, 20)
        self.assertEqual(tuple(int(v) for v in raster.cel_van_lonlat(lon, lat)), (10, 20))

    def test_buiten_uitsnede(self):
        self.assertEqual(tuple(int(v) for v in raster.cel_van_lonlat(0.5, 49.0)), (-1, -1))

    def test_schaalfactor(self):
        self.assertAlmostEqual(float(raster.schaalfactor_k(60)), 1.0, places=6)
        self.assertAlmostEqual(float(raster.schaalfactor_k(52)), 1.044, delta=0.002)


class TestBron(unittest.TestCase):
    def setUp(self):
        self.t = datetime(2026, 10, 24, 12, 5, tzinfo=UTC)

    def test_lees_geldig_bestand(self):
        d = np.zeros((765, 700), np.uint16)
        d[raster.R0 + 1, raster.K0 + 2] = 123
        d[raster.R0 + 3, raster.K0 + 4] = 65534
        fr = bron.lees_h5(io.BytesIO(knmi_h5(self.t, d)), "RAD_NL25_RAC_RT_202610241205.h5")
        self.assertEqual(fr.eind, self.t)
        self.assertEqual(fr.data.shape, (raster.NRIJ, raster.NKOL))
        self.assertEqual(int(fr.data[1, 2]), 123)
        self.assertEqual(int(fr.data[3, 4]), bron.ONTBREKEND)
        self.assertEqual(fr.radars, ["Herwijnen"])

    def test_weigert_andere_kalibratie(self):
        with self.assertRaises(ValueError):
            bron.lees_h5(io.BytesIO(knmi_h5(self.t, gain="0.1")), "RAD_NL25_RAC_RT_202610241205.h5")

    def test_weigert_ander_raster(self):
        with self.assertRaises(ValueError):
            bron.lees_h5(io.BytesIO(knmi_h5(self.t, row_off=3640.0)), "RAD_NL25_RAC_RT_202610241205.h5")

    def test_oud_raster_binnen_meters_geaccepteerd(self):
        fr = bron.lees_h5(io.BytesIO(knmi_h5(self.t, row_off=3649.979248, px=1.0000013, py=-1.0000055,
                                             proj="+proj=stere +lat_0=90 +lon_0=0 +lat_ts=60 +a=6378.14 +b=6356.75 +x_0=0 +y_0=0")),
                          "RAD_NL25_RAC_RT_202610241205.h5")
        self.assertEqual(fr.eind, self.t)

    def test_tijdvak_moet_5_minuten_zijn(self):
        with self.assertRaises(ValueError):
            bron.lees_h5(io.BytesIO(knmi_h5(self.t, start=self.t - timedelta(minutes=10))),
                         "RAD_NL25_RAC_RT_202610241205.h5")

    def test_scan_eindtijd_oud_bestand_met_naam(self):
        b = knmi_h5(self.t + timedelta(minutes=3), start=self.t - timedelta(minutes=5))
        fr = bron.lees_h5(io.BytesIO(b), "RAD_NL25_RAC_RT_202610241205.h5")
        self.assertEqual(fr.eind, self.t)
        with self.assertRaises(ValueError):    # naam bevestigt het vak niet
            bron.lees_h5(io.BytesIO(b), "RAD_NL25_RAC_RT_202610241210.h5")

    def test_naam_en_attribuut_moeten_kloppen(self):
        with self.assertRaises(ValueError):
            bron.lees_h5(io.BytesIO(knmi_h5(self.t)), "RAD_NL25_RAC_RT_202610241210.h5")

    def test_oude_missing_nul_is_geen_ontbrekend(self):
        d = np.zeros((765, 700), np.uint16)
        d[raster.R0, raster.K0] = 50
        fr = bron.lees_h5(io.BytesIO(knmi_h5(self.t, d, miss=0)), "RAD_NL25_RAC_RT_202610241205.h5")
        self.assertEqual(int((fr.data == bron.ONTBREKEND).sum()), 0)
        self.assertEqual(int(fr.data[0, 0]), 50)

    def test_parameternaam_varianten(self):
        for par in ("PRECIP_[MM]", "ACCUMULATION_[MM]"):
            bron.lees_h5(io.BytesIO(knmi_h5(self.t, par=par)), "RAD_NL25_RAC_RT_202610241205.h5")
        with self.assertRaises(ValueError):
            bron.lees_h5(io.BytesIO(knmi_h5(self.t, par="QUALITY_[-]")), "RAD_NL25_RAC_RT_202610241205.h5")


class TestFormaat(unittest.TestCase):
    def test_veld_rondreis(self):
        rnd = np.random.default_rng(3)
        for maxw in (500, 70000):
            som = rnd.integers(0, maxw, (raster.NRIJ, raster.NKOL)).astype(np.uint32)
            tel = np.full(som.shape, 288, np.uint16)
            tel[5, 5] = 280
            tel[6, 6] = 0
            som[6, 6] = 0
            v = formaat.Veld(som, tel, 1000, 1000 + 288 * 5, 288, 100, 188)
            w = formaat.lees_veld(formaat.schrijf_veld(v))
            self.assertTrue(np.array_equal(w.som, som))
            self.assertTrue(np.array_equal(w.telling, tel))
            self.assertEqual((w.begin, w.eind, w.aanwezig, w.n_rf, w.n_rt, w.verwacht), (1000, 2440, 288, 100, 188, 288))

    def test_veld_zonder_tellingen(self):
        som = np.arange(raster.NRIJ * raster.NKOL, dtype=np.uint32).reshape(raster.NRIJ, raster.NKOL) % 300
        v = formaat.Veld(som, np.full(som.shape, 12, np.uint16), 0, 60, 12, 0, 12)
        blob = formaat.schrijf_veld(v)
        raw = __import__("gzip").decompress(blob)
        self.assertEqual(raw[6] & 1, 0)          # geen tellingen nodig
        self.assertTrue(np.array_equal(formaat.lees_veld(blob).telling, v.telling))

    def test_optellen_alleen_aansluitend(self):
        a = formaat.leeg_veld(0, (2, 2))
        b = formaat.Veld(np.ones((2, 2), np.uint32), np.ones((2, 2), np.uint16), 0, 5, 1)
        self.assertEqual((a + b).eind, 5)
        with self.assertRaises(ValueError):
            b + b

    def test_reeks_rondreis(self):
        som = np.random.default_rng(1).integers(0, 900, (24, 32, 32)).astype(np.uint32)
        tel = np.full((24, 32, 32), 12, np.uint8)
        tel[3] = 0
        r = formaat.lees_reeks(formaat.schrijf_reeks(som, tel, 2, 3, 5000, 5000 + 1440))
        self.assertTrue(np.array_equal(r["som"], som))
        self.assertTrue(np.array_equal(r["telling"], tel))
        self.assertEqual((r["tegelrij"], r["tegelkol"], r["begin"], r["geldig_tm"]), (2, 3, 5000, 6440))


class TestPeriode(unittest.TestCase):
    def test_gisteren_wintertijd_25_uur(self):
        laatste = datetime(2026, 10, 26, 5, 5, tzinfo=UTC)
        b, e = periode.preset_tijdvak("gisteren", laatste)
        self.assertEqual(b, datetime(2026, 10, 24, 22, tzinfo=UTC))
        self.assertEqual(e, datetime(2026, 10, 25, 23, tzinfo=UTC))
        self.assertEqual((e - b) / timedelta(hours=1), 25)

    def test_zomertijd_dag_23_uur(self):
        b, e = periode.lokdag_grenzen(date(2026, 3, 29))
        self.assertEqual((e - b) / timedelta(hours=1), 23)
        self.assertEqual(b, datetime(2026, 3, 28, 23, tzinfo=UTC))

    def test_vandaag_week_maand(self):
        laatste = datetime(2026, 10, 26, 5, 5, tzinfo=UTC)   # maandag 06:05 CET
        self.assertEqual(periode.preset_tijdvak("vandaag", laatste)[0], datetime(2026, 10, 25, 23, tzinfo=UTC))
        self.assertEqual(periode.preset_tijdvak("week", laatste)[0], datetime(2026, 10, 25, 23, tzinfo=UTC))
        self.assertEqual(periode.preset_tijdvak("maand", laatste)[0], datetime(2026, 9, 30, 22, tzinfo=UTC))
        b, e = periode.preset_tijdvak("vorigemaand", laatste)
        self.assertEqual((b, e), (datetime(2026, 8, 31, 22, tzinfo=UTC), datetime(2026, 9, 30, 22, tzinfo=UTC)))

    def test_etmaal_presets(self):
        laatste = datetime(2026, 10, 26, 5, 5, tzinfo=UTC)
        self.assertEqual(periode.preset_tijdvak("etmaal", laatste), (datetime(2026, 10, 25, 8, tzinfo=UTC), laatste))
        self.assertEqual(periode.preset_tijdvak("vorigetmaal", laatste),
                         (datetime(2026, 10, 24, 8, tzinfo=UTC), datetime(2026, 10, 25, 8, tzinfo=UTC)))
        laatste = datetime(2026, 10, 26, 8, 0, tzinfo=UTC)
        self.assertEqual(periode.preset_tijdvak("vorigetmaal", laatste)[1], laatste)

    def test_uren_presets_exact(self):
        laatste = datetime(2026, 10, 26, 5, 5, tzinfo=UTC)
        for pid, uren in (("1u", 1), ("72u", 72), ("7d", 168), ("30d", 720)):
            b, e = periode.preset_tijdvak(pid, laatste)
            self.assertEqual(((e - b) / timedelta(hours=1), e), (uren, laatste))

    def test_opdeling_sluit_exact_aan(self):
        rnd = random.Random(7)
        for _ in range(300):
            b = datetime(2026, 9, 1, tzinfo=UTC) + timedelta(minutes=5 * rnd.randrange(0, 12000))
            e = b + timedelta(minutes=5 * rnd.randrange(1, 12000))
            blokken = periode.deel_op(b, e)
            self.assertEqual(blokken[0].begin, b)
            self.assertEqual(blokken[-1].eind, e)
            for x, y in zip(blokken, blokken[1:]):
                self.assertEqual(x.eind, y.begin)

    def test_opdeling_kiest_grote_blokken(self):
        b = datetime(2026, 10, 22, 22, tzinfo=UTC)   # vr 23 okt 00:00 lokaal
        e = datetime(2026, 10, 26, 5, tzinfo=UTC)
        soorten = [x.soort for x in periode.deel_op(b, e, frames_toegestaan=False)]
        self.assertEqual(soorten.count("lokdag") + soorten.count("dag") + soorten.count("etmaal"), 3)
        self.assertLessEqual(len(soorten), 10)


class TestArchief(unittest.TestCase):
    """Synthetisch archief: elke som is met de hand na te rekenen."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.arch = Archief(Path(self.tmp.name))
        self.shape = (raster.NRIJ, raster.NKOL)

    def tearDown(self):
        self.tmp.cleanup()

    def vul(self, van, tot, waarde, bron_code="rt", herkomst="tar", overslaan=()):
        frames = []
        t = van + timedelta(minutes=5)
        while t <= tot:
            if t not in overslaan:
                frames.append(frame(t, np.full(self.shape, waarde(t), np.uint16), bron_code))
            t += timedelta(minutes=5)
        return self.arch.voeg_frames_toe(frames, herkomst)

    def bouw(self, dagen, laatste):
        for d in sorted(dagen):
            self.arch.bouw_dag(d, laatste)
        for d in sorted(dagen):
            self.arch.bouw_afgeleid(d, laatste)

    def test_droge_periode_nul_en_volledig(self):
        van, tot = datetime(2026, 7, 1, tzinfo=UTC), datetime(2026, 7, 3, tzinfo=UTC)
        dagen, _ = self.vul(van, tot, lambda t: 0)
        self.bouw(dagen, tot)
        v = self.arch.som_periode(van, tot)
        self.assertEqual(int(v.som.max()), 0)
        self.assertEqual((v.aanwezig, v.verwacht), (576, 576))
        self.assertTrue((v.telling == 576).all())

    def test_grote_som_exact_en_blokken_gelijk_aan_frames(self):
        van, tot = datetime(2026, 10, 22, tzinfo=UTC), datetime(2026, 10, 27, tzinfo=UTC)
        # 0,05–0,60 mm per 5 min, wisselend: > 50 mm totaal
        dagen, _ = self.vul(van, tot, lambda t: 5 + (t.minute // 5) * 5)
        self.bouw(dagen, tot)
        b, e = datetime(2026, 10, 22, 22, tzinfo=UTC), datetime(2026, 10, 26, 5, 15, tzinfo=UTC)
        v = self.arch.som_periode(b, e)
        w = self.arch.som_periode(b, e, alleen_frames=True)
        self.assertTrue(np.array_equal(v.som, w.som))
        verwacht = 0
        t = b + timedelta(minutes=5)
        while t <= e:
            verwacht += 5 + (t.minute // 5) * 5
            t += timedelta(minutes=5)
        self.assertEqual(int(v.som[0, 0]), verwacht)
        self.assertGreater(verwacht / 100, 50)
        # samengestelde blokken gebruikt (niet alles uit frames)
        soorten = {x.soort for x in periode.deel_op(b, e, self.arch.heeft_blok)}
        self.assertTrue(soorten & {"lokdag", "dag", "etmaal"})

    def test_ontbrekend_frame_telt_niet_als_nul(self):
        van, tot = datetime(2026, 7, 1, tzinfo=UTC), datetime(2026, 7, 2, tzinfo=UTC)
        weg = {datetime(2026, 7, 1, 12, 5, tzinfo=UTC), datetime(2026, 7, 1, 12, 10, tzinfo=UTC)}
        dagen, _ = self.vul(van, tot, lambda t: 10, overslaan=weg)
        self.bouw(dagen, tot)
        v = self.arch.som_periode(van, tot)
        self.assertEqual((v.aanwezig, v.verwacht), (286, 288))
        self.assertEqual(int(v.som[0, 0]), 2860)
        uur = self.arch.lees_blok(periode.uurblok(datetime(2026, 7, 1, 12, tzinfo=UTC)))
        self.assertEqual((uur.aanwezig, uur.verwacht), (10, 12))
        idx_info = self.arch.bouw_dag(date(2026, 7, 1), tot)
        self.assertEqual(idx_info["uren_onvolledig"], [12])

    def test_ontbrekende_cellen_per_cel_geteld(self):
        t = datetime(2026, 7, 1, 0, 5, tzinfo=UTC)
        d = np.full(self.shape, 20, np.uint16)
        d[7, 8] = bron.ONTBREKEND
        self.arch.voeg_frames_toe([frame(t, d), frame(t + timedelta(minutes=5), np.full(self.shape, 20, np.uint16))], "tar")
        v = self.arch.som_periode(t - timedelta(minutes=5), t + timedelta(minutes=5))
        self.assertEqual((int(v.telling[7, 8]), int(v.som[7, 8])), (1, 20))
        self.assertEqual((int(v.telling[0, 0]), int(v.som[0, 0])), (2, 40))
        w = formaat.lees_veld(formaat.schrijf_veld(v))
        self.assertEqual(int(w.telling[7, 8]), 1)

    def test_dubbele_bestanden_niet_dubbel_geteld(self):
        van, tot = datetime(2026, 7, 1, tzinfo=UTC), datetime(2026, 7, 1, 1, tzinfo=UTC)
        self.vul(van, tot, lambda t: 10, herkomst="live")
        self.vul(van, tot, lambda t: 10, herkomst="live")
        self.vul(van, tot, lambda t: 10, herkomst="tar")
        v = self.arch.som_periode(van, tot, alleen_frames=True)
        self.assertEqual((v.aanwezig, int(v.som[0, 0])), (12, 120))

    def test_finaal_vervangt_realtime_en_revisie_wijzigt(self):
        van, tot = datetime(2026, 7, 1, tzinfo=UTC), datetime(2026, 7, 2, tzinfo=UTC)
        dagen, _ = self.vul(van, tot, lambda t: 10)
        info_rt = self.arch.bouw_dag(date(2026, 7, 1), tot)
        dagen2, _ = self.vul(van, tot, lambda t: 13, bron_code="rf", herkomst="rf")
        info_rf = self.arch.bouw_dag(date(2026, 7, 1), tot)
        self.assertNotEqual(info_rt["rev"], info_rf["rev"])
        v = self.arch.lees_blok(periode.dagblok(date(2026, 7, 1)))
        self.assertEqual((v.n_rf, v.n_rt, int(v.som[0, 0])), (288, 0, 288 * 13))
        # een laat binnenkomend live-bestand verdringt het finale niet
        self.arch.voeg_frames_toe([frame(datetime(2026, 7, 1, 6, tzinfo=UTC), np.full(self.shape, 99, np.uint16))], "live")
        self.assertEqual(int(self.arch.som_periode(van, tot, alleen_frames=True).som[0, 0]), 288 * 13)

    def test_klokwissel_lokdag(self):
        van, tot = datetime(2026, 10, 24, tzinfo=UTC), datetime(2026, 10, 27, tzinfo=UTC)
        dagen, _ = self.vul(van, tot, lambda t: 1)
        self.bouw(dagen, tot)
        v = self.arch.lees_blok(periode.lokdagblok(date(2026, 10, 25)))
        self.assertEqual((v.verwacht, v.aanwezig, int(v.som[0, 0])), (300, 300, 300))
        v = self.arch.lees_blok(periode.etmaalblok(date(2026, 10, 26)))
        self.assertEqual(v.verwacht, 288)

    def test_lokale_bui(self):
        van, tot = datetime(2026, 7, 1, tzinfo=UTC), datetime(2026, 7, 2, tzinfo=UTC)
        frames = []
        t = van + timedelta(minutes=5)
        while t <= tot:
            d = np.zeros(self.shape, np.uint16)
            if datetime(2026, 7, 1, 15, tzinfo=UTC) < t <= datetime(2026, 7, 1, 16, tzinfo=UTC):
                d[200:203, 150:153] = 350           # 3,5 mm per 5 min → 42 mm in een uur
            frames.append(frame(t, d))
            t += timedelta(minutes=5)
        dagen, _ = self.arch.voeg_frames_toe(frames, "tar")
        self.bouw(dagen, tot)
        v = self.arch.som_periode(van, tot)
        self.assertEqual(int(v.som[201, 151]), 4200)
        self.assertEqual(int(v.som[199, 151]), 0)          # geen uitsmeren naar buurcellen
        reeks = formaat.lees_reeks((self.arch.pub / "reeks/20260701/06_04.bin.gz").read_bytes())
        self.assertEqual(int(reeks["som"][15, 200 - 192, 151 - 128]), 4200)
        self.assertEqual(int(reeks["som"][14, 200 - 192, 151 - 128]), 0)


@unittest.skipUnless((Path.home() / "Library/Application Support/weerlab/accumulatie/pub/index.json").exists(),
                     "geen lokaal archief")
class TestEchtArchief(unittest.TestCase):
    def test_etmaal_blok_gelijk_aan_frames(self):
        a = Archief()
        d = date(2026, 10, 25)
        b = periode.etmaalblok(d)
        if not a.heeft_blok(b):
            self.skipTest("etmaal niet in archief")
        v = a.lees_blok(b)
        w = a.som_periode(b.begin, b.eind, alleen_frames=True)
        self.assertTrue(np.array_equal(v.som, w.som))
        self.assertTrue(np.array_equal(v.telling, w.telling))


if __name__ == "__main__":
    unittest.main()


class TestBijstellen(unittest.TestCase):
    """Laag 'radar bijgesteld met regenmeters' (accumulatie/bijstellen.py)."""

    def setUp(self):
        from accumulatie import bijstellen as BS
        self.BS = BS
        rnd = random.Random(3)
        self.paren = []
        for i in range(120):
            lon, lat = rnd.uniform(3.6, 7.0), rnd.uniform(50.9, 53.4)
            R = rnd.uniform(2, 30)
            self.paren.append({"id": f"h{i}", "net": "handmatig", "lon": lon, "lat": lat, "R": R, "G": 1.25 * R})

    def test_gebiedsfactor_overal_gelijk(self):
        m = self.BS.pas_toe(self.paren)
        self.assertAlmostEqual(m.F, 1.25, places=6)
        f = self.BS.factorveld(m)
        self.assertLess(float(np.abs(f[100:300, 50:300] - 1.25).max()), 0.05)

    def test_lokale_correctie_dooft_uit(self):
        paren = [dict(q) for q in self.paren]
        for q in paren:
            q["G"] = q["R"]
        paren.append({"id": "lok", "net": "handmatig", "lon": 5.9, "lat": 52.0, "R": 20.0, "G": 30.0})
        m = self.BS.pas_toe(paren, qc=False)
        x, y = self.BS.km(5.9, 52.0)
        dichtbij = float(m.factor_op(x, y))
        x2, y2 = self.BS.km(5.9 + 0.6, 52.0)          # ~41 km oost
        self.assertGreater(dichtbij, 1.2)
        self.assertLess(abs(float(m.factor_op(x2, y2)) - m.F), 0.03)

    def test_uitschieter_valt_af(self):
        paren = [dict(q) for q in self.paren] + [{"id": "fout", "net": "handmatig", "lon": 5.2, "lat": 52.1, "R": 25.0, "G": 0.0}]
        paren += [{"id": f"b{i}", "net": "handmatig", "lon": 5.2 + 0.03 * i, "lat": 52.1 + 0.02, "R": 25.0, "G": 31.0} for i in range(4)]
        m = self.BS.pas_toe(paren)
        self.assertIn("fout", m.afgewezen)

    def test_leave_one_out_gebruikt_station_zelf_niet(self):
        paren = [dict(q) for q in self.paren[:40]]
        paren[0]["G"] = paren[0]["R"] * 3      # alleen dit station wijkt af
        loo = self.BS.leave_one_out(paren)
        eerste = [q for q in loo if q["id"] == "h0"][0]
        self.assertLess(eerste["factor"], 1.6)          # zonder zichzelf geen factor ~3
        volledig = self.BS.pas_toe(paren, qc=False)
        x, y = self.BS.km(paren[0]["lon"], paren[0]["lat"])
        self.assertGreater(float(volledig.factor_op(x, y)), eerste["factor"])

    def test_te_weinig_natte_paren_geen_factor(self):
        paren = [{"id": "a", "net": "handmatig", "lon": 5, "lat": 52, "R": 0.1, "G": 0.0}] * 3
        self.assertEqual(self.BS.pas_toe(paren).F, 1.0)


class TestBijgesteldArchief(unittest.TestCase):
    def test_radar_nul_blijft_nul_en_finaal_ongewijzigd(self):
        from accumulatie import bijgesteld
        with tempfile.TemporaryDirectory() as t:
            ruw, adj = Archief(Path(t) / "ruw"), Archief(Path(t) / "adj")
            shape = (raster.NRIJ, raster.NKOL)
            fr = []
            tt = datetime(2026, 7, 1, 8, 5, tzinfo=UTC)
            while tt <= datetime(2026, 7, 2, 8, tzinfo=UTC):
                d = np.zeros(shape, np.uint16)
                d[100:110, 100:110] = 10
                if tt.hour == 12 and tt.minute == 0:
                    d[5, 5] = bron.ONTBREKEND           # één ontbrekende waarneming
                fr.append(frame(tt, d))
                tt += timedelta(minutes=5)
            ruw.voeg_frames_toe(fr, "tar")
            f = np.full(shape, 1.5, np.float32)
            bijgesteld._pas_frames_toe(ruw, adj, date(2026, 7, 2), f)
            v = adj.som_periode(datetime(2026, 7, 1, 8, tzinfo=UTC), datetime(2026, 7, 2, 8, tzinfo=UTC), alleen_frames=True)
            self.assertEqual(int(v.som[105, 105]), 288 * 15)
            self.assertEqual(int(v.som[200, 200]), 0)
            self.assertEqual(int(v.telling[5, 5]), 287)        # ontbrekend blijft ontbrekend
            bijgesteld._pas_frames_toe(ruw, adj, date(2026, 7, 2), None)   # finaal: f = 1
            v = adj.som_periode(datetime(2026, 7, 1, 8, tzinfo=UTC), datetime(2026, 7, 2, 8, tzinfo=UTC), alleen_frames=True)
            self.assertEqual(int(v.som[105, 105]), 288 * 10)
