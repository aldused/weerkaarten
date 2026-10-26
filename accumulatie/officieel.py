"""
officieel.py — Vergelijking met officiële KNMI-accumulatieproducten.

De klimatologische KNMI-radardataset (RAD_NL25_RAC_MFBS, v2.0) levert naast
5-minutensommen ook officiële 1-uurs- en 24-uurssommen. Tellen wij de
5-minutenvelden van dát product op over exact hetzelfde tijdvak, dan moet de
uitkomst binnen de numerieke precisie gelijk zijn aan het officiële 24-uursveld.
Dat toetst de engine (tijdgrenzen, schaal, nodata, dubbele telling) tegen een
onafhankelijke KNMI-berekening.

De jaarbestanden zijn zips van 0,1–1,4 GB. We lezen ze op afstand met HTTP
Range-verzoeken (zipfile op een zoekbaar bestandsobject), dus alleen de
centrale directory en de benodigde leden worden gedownload.

  python3 -m accumulatie.officieel --dag 2026-08-15 [--dag ...]
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import h5py
import numpy as np
import requests

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER.parent / "scripts"))
sys.path.insert(0, str(HIER.parent))
from knmi_api import knmi_get  # noqa: E402

from accumulatie import bron, raster  # noqa: E402

API = "https://api.dataplatform.knmi.nl/open-data/v1/datasets"


class OpAfstand(io.RawIOBase):
    """Zoekbaar, alleen-lezen bestand via HTTP Range met blokcache (1 MB)."""

    BLOK = 1 << 20

    def __init__(self, dataset, versie, naam):
        self.dataset, self.versie, self.naam = dataset, versie, naam
        self._url = None
        self.pos = 0
        self.cache = {}
        self.gelezen = 0
        r = self._get(0, 0)
        self.grootte = int(r.headers["Content-Range"].split("/")[1])

    def _vers_url(self):
        r = knmi_get(f"{API}/{self.dataset}/versions/{self.versie}/files/{self.naam}/url", timeout=30)
        r.raise_for_status()
        self._url = r.json()["temporaryDownloadUrl"]

    def _get(self, a, b):
        for poging in range(4):
            if self._url is None or poging:
                self._vers_url()
            try:
                r = requests.get(self._url, headers={"Range": f"bytes={a}-{b}"}, timeout=120)
            except requests.RequestException:
                continue
            if r.status_code == 206:
                self.gelezen += len(r.content)
                return r
        raise IOError(f"Range-verzoek mislukt voor {self.naam}")

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.grootte + off
        return self.pos

    def _blok(self, i):
        if i not in self.cache:
            a = i * self.BLOK
            b = min(self.grootte, a + self.BLOK) - 1
            self.cache[i] = self._get(a, b).content
            if len(self.cache) > 64:
                self.cache.pop(next(iter(self.cache)))
        return self.cache[i]

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.grootte - self.pos
        n = max(0, min(n, self.grootte - self.pos))
        uit = bytearray()
        while n:
            i, o = divmod(self.pos, self.BLOK)
            stuk = self._blok(i)[o:o + n]
            uit += stuk
            self.pos += len(stuk)
            n -= len(stuk)
        return bytes(uit)

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)


def jaarzip(soort: str, dag: date):
    """('5min'|'01h'|'24h', dag) → (dataset, bestandsnaam) van het jaarbestand dat dag dekt."""
    ds = {"5min": "rad_nl25_rac_mfbs_5min", "01h": "rad_nl25_rac_mfbs_01h", "24h": "rad_nl25_rac_mfbs_24h"}[soort]
    r = knmi_get(f"{API}/{ds}/versions/2.0/files", params={"maxKeys": 50}, timeout=30)
    r.raise_for_status()
    for f in r.json()["files"]:
        m = re.search(r"_(\d{8})T\d{6}_(\d{8})T\d{6}_", f["filename"])
        if m:
            b = datetime.strptime(m.group(1), "%Y%m%d").date()
            e = datetime.strptime(m.group(2), "%Y%m%d").date()
            if b < dag < e:
                return ds, f["filename"]
    raise KeyError(f"geen {soort}-jaarbestand voor {dag}")


def lees_mfbs(h5bytes: bytes):
    """MFBS-HDF5 → (start, eind, uint16-uitsnede of float, kalibratie)."""
    with h5py.File(io.BytesIO(h5bytes), "r") as f:
        ov = f["overview"].attrs
        start = bron._knmi_tijd(bron._tekst(ov["product_datetime_start"]))
        eind = bron._knmi_tijd(bron._tekst(ov["product_datetime_end"]))
        raster.controleer_geo(dict(f["geographic"].attrs),
                              f["geographic/map_projection"].attrs["projection_proj4_params"])
        img = f["image1"]
        kal = bron._tekst(img["calibration"].attrs["calibration_formulas"])
        m = bron._KAL_RE.search(kal)
        gain, off = float(m.group(1)), float(m.group(2))
        miss = int(np.asarray(img["calibration"].attrs["calibration_missing_data"]).ravel()[0])
        out = int(np.asarray(img["calibration"].attrs["calibration_out_of_image"]).ravel()[0])
        d = img["image_data"][raster.R0:raster.R1, raster.K0:raster.K1]
    return start, eind, d, gain, off, miss, out


def vergelijk_dag(d: date, log=print):
    """24-uursveld (officieel) vs som van 288 5-minutenvelden, zelfde product."""
    ds24, n24 = jaarzip("24h", d)
    ds5, n5 = jaarzip("5min", d)
    z24 = zipfile.ZipFile(OpAfstand(ds24, "2.0", n24))
    z5 = zipfile.ZipFile(OpAfstand(ds5, "2.0", n5))
    eind = datetime(d.year, d.month, d.day, 8, tzinfo=timezone.utc)
    # 24h-product met eindtijd 08 UTC
    sleutel24 = eind.strftime("%Y%m%d%H%M")
    lid24 = [n for n in z24.namelist() if sleutel24 in n]
    if not lid24:
        raise KeyError(f"geen 24h-veld voor {sleutel24}")
    s24, e24, d24, g24, o24, m24, x24 = lees_mfbs(z24.read(lid24[0]))
    if (s24, e24) != (eind - timedelta(days=1), eind):
        raise ValueError(f"24h-veld dekt {s24}..{e24}")
    namen5 = {}
    for n in z5.namelist():
        m = re.search(r"(\d{12})", n.rsplit("/", 1)[-1])
        if m:
            namen5[m.group(1)] = n
    som = np.zeros(d24.shape, np.int64)
    tel = np.zeros(d24.shape, np.int32)
    ontbreekt = []
    t = eind - timedelta(days=1) + timedelta(minutes=5)
    gain5 = None
    while t <= eind:
        n = namen5.get(t.strftime("%Y%m%d%H%M"))
        if n is None:
            ontbreekt.append(t)
        else:
            s, e, dd, g, o, mi, ox = lees_mfbs(z5.read(n))
            if e != t:
                raise ValueError(f"{n}: eindtijd {e} ≠ {t}")
            gain5 = g
            ok = (dd != mi) & (dd != ox)
            som += np.where(ok, dd, 0)
            tel += ok
        t += timedelta(minutes=5)
    ok24 = (d24 != m24) & (d24 != x24)
    ref = d24.astype(np.float64) * g24 + o24
    eigen = som * gain5
    geldig = ok24 & (tel == 288)
    verschil = eigen[geldig] - ref[geldig]
    res = {
        "dag": d.isoformat(), "tijdvak": f"{s24:%Y-%m-%dT%H:%MZ}/{e24:%Y-%m-%dT%H:%MZ}",
        "kalibratie_24h": f"GEO={g24}*PV+{o24}", "kalibratie_5min": f"GEO={gain5}*PV",
        "cellen": int(geldig.sum()), "ontbrekende_frames": len(ontbreekt),
        "max_officieel_mm": float(ref[geldig].max()) if geldig.any() else None,
        "max_eigen_mm": float(eigen[geldig].max()) if geldig.any() else None,
        "max_abs_verschil_mm": float(np.abs(verschil).max()) if verschil.size else None,
        "gem_verschil_mm": float(verschil.mean()) if verschil.size else None,
        "binnen_kwantisatie": bool(np.abs(verschil).max() <= g24 / 2 + 1e-9) if verschil.size else None,
        "cellen_identiek": int((np.abs(verschil) < 1e-9).sum()),
        "natte_cellen": int((geldig & (ref >= 5)).sum()),
        "gem_verschil_nat_mm": float((eigen - ref)[geldig & (ref >= 5)].mean()) if (geldig & (ref >= 5)).any() else None,
        "rel_verschil_nat": float((eigen - ref)[geldig & (ref >= 5)].sum() / ref[geldig & (ref >= 5)].sum())
        if (geldig & (ref >= 5)).any() else None,
        "verwachte_afrondingsruis_mm": float(np.sqrt(288) * g24 / np.sqrt(12)),
    }
    log(json.dumps(res))
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dag", action="append", required=True)
    ap.add_argument("--uit")
    a = ap.parse_args()
    uit = [vergelijk_dag(date.fromisoformat(d)) for d in a.dag]
    if a.uit:
        Path(a.uit).write_text(json.dumps(uit, indent=1))
