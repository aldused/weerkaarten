"""
bron.py — KNMI-radarbestanden (HDF5) lezen en valideren.

Producten (KNMI Data Platform, CC BY 4.0):
  rt  nl_rdr_data_rtcor_5m v1.0      realtime, gecorrigeerd met automatische
      nl_rdr_data_rtcor_5m_tar v1.0  KNMI-stations (+ waterschappen sinds
                                     18-11-2024); per bestand / per dag-tar
  rf  nl_rdr_data_rfcor_5m v1.0      finale heranalyse: daarnaast de
                                     gevalideerde dagsommen van het handmatige
                                     neerslagnet (Barnes-analyse); ~2 weken later

Elk bestand bevat één 5-minuutsom in image1 (PRECIP_[MM]). We lezen alles uit
de attributen en vertrouwen de bestandsnaam niet voor de tijd: de naamgeving
van de dag-tars is in de loop der jaren veranderd (begin- vs eindtijd).

  tijdvak     overview/product_datetime_start .. product_datetime_end
              (moet exact 5 minuten zijn; het eindtijdstip is de sleutel)
  kalibratie  image1/calibration/calibration_formulas 'GEO=0.010000*PV+0.000000'
              → PV is een geheel aantal honderdsten mm. We rekenen daarom
              exact in gehele getallen (0,01 mm) en verliezen nooit precisie.
  ontbrekend  calibration_missing_data (65534) — tellen NOOIT als 0 mm
  buiten      calibration_out_of_image (65535)
"""
from __future__ import annotations

import io
import re
import tarfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import h5py
import numpy as np

from . import raster

ONTBREKEND = 65534
BUITEN = 65535
STAP = timedelta(minutes=5)

_KAL_RE = re.compile(r"GEO\s*=\s*([-+0-9.eE]+)\s*\*\s*PV\s*\+\s*([-+0-9.eE]+)")


@dataclass
class Frame:
    eind: datetime                 # eind van het 5-minutenvak (UTC)
    data: np.ndarray               # uint16 (NRIJ, NKOL), 0,01 mm; 65534/65535 = geen data
    bron: str                      # 'rt' of 'rf'
    bestand: str
    radars: list = field(default_factory=list)   # operationele radars in dit frame

    @property
    def sleutel(self) -> int:
        """Eindtijd in unix-minuten: unieke sleutel, voorkomt dubbele telling."""
        return int(self.eind.timestamp() // 60)


def _tekst(v):
    if isinstance(v, bytes):
        return v.decode("ascii", "replace")
    if isinstance(v, np.ndarray):
        v = v.ravel()[0]
        return v.decode("ascii", "replace") if isinstance(v, bytes) else str(v)
    return str(v)


def _knmi_tijd(s: str) -> datetime:
    """'26-OCT-2026;04:45:00.000' → datetime UTC."""
    s = s.strip().split(".")[0]
    return datetime.strptime(s.title(), "%d-%b-%Y;%H:%M:%S").replace(tzinfo=timezone.utc)


def bron_van_naam(naam: str) -> str:
    if "_RAC_RF_" in naam:
        return "rf"
    if "_RAC_RT_" in naam:
        return "rt"
    raise ValueError(f"Onbekend radarproduct: {naam}")


def lees_h5(bron_bestand, naam: str) -> Frame:
    """Lees één KNMI 5-minuten HDF5-bestand (pad of file-object) → Frame (uitsnede)."""
    with h5py.File(bron_bestand, "r") as f:
        ov = f["overview"].attrs
        start = _knmi_tijd(_tekst(ov["product_datetime_start"]))
        eind_attr = _knmi_tijd(_tekst(ov["product_datetime_end"]))
        m = re.search(r"_(\d{12})(?:_NL)?\.h5$", naam)
        t_naam = datetime.strptime(m.group(1), "%Y%m%d%H%M").replace(tzinfo=timezone.utc) if m else None
        if eind_attr - start == STAP and not (start.minute % 5 or start.second):
            eind = eind_attr
            if t_naam is not None and t_naam != eind:
                raise ValueError(f"{naam}: bestandsnaam ≠ attribuut-eindtijd {eind}")
        else:
            # Oudere RTCOR/RFCOR-bestanden (o.a. 2021) noteren soms de radarscan
            # i.p.v. het nominale vak (bv. 08:00–08:08, 08:30–08:34, 12:04–12:10).
            # Het blijft de 5-minutensom die KNMI onder die naam publiceert; we
            # nemen het nominale vak uit de bestandsnaam, maar alleen als de
            # attributen er binnen een minuut (begin) en enkele minuten (eind)
            # bij aansluiten. Anders weigeren → telt als ontbrekend.
            if t_naam is None or t_naam.minute % 5:
                raise ValueError(f"{naam}: tijdvak {start}..{eind_attr} is geen 5 minuten")
            nom = t_naam - STAP
            if abs(start - nom) > timedelta(minutes=1) or \
                    not (nom + timedelta(minutes=3) <= eind_attr <= nom + 2 * STAP):
                raise ValueError(f"{naam}: tijdvak {start}..{eind_attr} past niet bij {nom}..{t_naam}")
            eind = t_naam

        raster.controleer_geo(dict(f["geographic"].attrs),
                              f["geographic/map_projection"].attrs["projection_proj4_params"])

        img = f["image1"]
        par = _tekst(img.attrs.get("image_geo_parameter", b""))
        # 'PRECIP_[MM]' (nu), 'ACCUMULATION_[MM]' (o.a. voorjaar 2026), 'ACCUMULATED_PRECIPITATION_[MM]' (MFBS)
        if not (par.upper().startswith("PRECIP") or par.upper().startswith("ACCUMULAT")):
            raise ValueError(f"{naam}: image1 is {par!r}, geen neerslag")
        kal = img["calibration"].attrs
        m = _KAL_RE.search(_tekst(kal["calibration_formulas"]))
        if not m:
            raise ValueError(f"{naam}: onleesbare kalibratie {kal['calibration_formulas']!r}")
        gain, offset = float(m.group(1)), float(m.group(2))
        if abs(gain - 0.01) > 1e-9 or abs(offset) > 1e-9:
            # Een andere schaal vraagt een andere (float) rekenweg; liever luid falen.
            raise ValueError(f"{naam}: onverwachte kalibratie GEO={gain}*PV+{offset}")
        miss = int(np.asarray(kal["calibration_missing_data"]).ravel()[0])
        out = int(np.asarray(kal["calibration_out_of_image"]).ravel()[0])

        d = img["image_data"][raster.R0:raster.R1, raster.K0:raster.K1]
        if d.dtype != np.uint16:
            raise ValueError(f"{naam}: image_data dtype {d.dtype}")
        d = np.array(d, dtype=np.uint16, copy=True)
        if miss == 0:
            # Oudere bestanden (o.a. 2021) declareren calibration_missing_data = 0,
            # terwijl 0 daar de waarde "geen neerslag" is (>98% van de cellen bij
            # droog weer). Een apart ontbrekend-kenmerk bestaat dan niet; alleen
            # out_of_image markeert cellen zonder data.
            miss = None
        if (miss is not None and miss != ONTBREKEND) or out != BUITEN:
            # Normaliseer naar onze vaste sentinels.
            m_miss = d == miss if miss is not None else np.zeros(d.shape, bool)
            m_out = d == out
            if (d[~(m_miss | m_out)] >= ONTBREKEND).any():
                raise ValueError(f"{naam}: geldige waarde botst met sentinel")
            d[m_miss] = ONTBREKEND
            d[m_out] = BUITEN

        radars = []
        for k in f.keys():
            if k.startswith("radar"):
                a = f[k].attrs
                if int(np.asarray(a.get("radar_operational", [0])).ravel()[0]) == 1:
                    radars.append(_tekst(a.get("radar_name", k)))
    return Frame(eind=eind, data=d, bron=bron_van_naam(naam), bestand=naam, radars=radars)


def lees_tar(pad_of_bytes):
    """Alle frames uit een KNMI dag-tar (RTCOR of RFCOR). Generator van Frames.

    Een kapot lid wordt overgeslagen en gemeld (ValueError in de lijst fouten),
    zodat één corrupt bestand niet de hele dag blokkeert — het ontbreekt dan
    gewoon en wordt als ontbrekend gerapporteerd."""
    fouten = []
    if isinstance(pad_of_bytes, (bytes, bytearray)):
        tf = tarfile.open(fileobj=io.BytesIO(pad_of_bytes), mode="r:")
    else:
        tf = tarfile.open(pad_of_bytes, mode="r:")
    frames = []
    with tf:
        for lid in tf.getmembers():
            if not lid.isfile() or not lid.name.endswith(".h5"):
                continue
            naam = lid.name.rsplit("/", 1)[-1]
            try:
                buf = io.BytesIO(tf.extractfile(lid).read())
                frames.append(lees_h5(buf, naam))
            except Exception as e:  # noqa: BLE001 — per bestand rapporteren
                fouten.append(f"{naam}: {e}")
    return frames, fouten
