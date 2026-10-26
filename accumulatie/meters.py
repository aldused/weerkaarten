"""
meters.py — Regenmeterdata per neerslagetmaal (08–08 UTC) voor de bijstelling.

  handmatig    KNMI-neerslagnet (~320 stations, dagsom 08–08 UTC). Gevalideerd
               (MONV) als beschikbaar, anders voorlopig (regensom, ~18:37 UT op
               de einddag). Bron: cache van scripts/neerslagstations_update.py.
  automatisch  KNMI-AWS (~35 stations). Voor oudere etmalen de gevalideerde
               uurgegevens, voor recente de 10-minutenwaarden (EDR, 'rg' =
               gemiddelde intensiteit mm/u per 10 min → som = Σ rg/6). Een
               station telt alleen mee als het venster volledig is.

Uitvoer: lijst dicts {id, net, naam, lat, lon, mm, status}.
"""
from __future__ import annotations

import json
import math
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER.parent / "scripts"))
from knmi_api import knmi_get  # noqa: E402

import neerslagstations_update as NS  # noqa: E402

UTC = timezone.utc
EDR = "https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations"
BBOX = "3.0,50.6,7.4,53.7"
_ST = None
_BL = None


def _stations():
    global _ST, _BL
    if _ST is None:
        _ST = {c: s for c, s in NS.laad_stationslijst().items() if s["lat"] is not None}
        _BL = NS.lees_blacklist()
    return _ST, _BL


def handmatig(d: date, cache_map: Path):
    """Etmaal met label d (08 UTC d-1 → 08 UTC d)."""
    from . import valideer
    st, bl = _stations()
    ds = d.strftime("%Y%m%d")
    uit = []
    for (code, dag), (mm, status) in valideer.handmatig(d, d, cache_map).items():
        if dag != ds or code not in st or NS.uitgesloten(bl, code, ds):
            continue
        s = st[code]
        uit.append({"id": f"h{code}", "net": "handmatig", "naam": s["naam"], "lat": s["lat"],
                    "lon": s["lon"], "mm": mm, "status": status})
    return uit


def _uurgegevens(b: datetime, e: datetime, cache_map: Path):
    pad = cache_map / f"uur_{b:%Y%m%d%H}_{e:%Y%m%d%H}.csv"
    if not pad.exists():
        a = b + timedelta(hours=1)
        start = f"{a:%Y%m%d}{a.hour:02d}" if a.hour else f"{a - timedelta(days=1):%Y%m%d}24"
        eind = f"{e:%Y%m%d}{e.hour:02d}" if e.hour else f"{e - timedelta(days=1):%Y%m%d}24"
        r = requests.post("https://www.daggegevens.knmi.nl/klimatologie/uurgegevens",
                          data={"start": start, "end": eind, "vars": "RH", "stns": "ALL", "fmt": "csv"}, timeout=300)
        r.raise_for_status()
        if "# STN,YYYYMMDD,HH" not in r.text:
            raise RuntimeError("geen uurgegevens")
        pad.parent.mkdir(parents=True, exist_ok=True)
        pad.write_text(r.text)
    st, som, n = {}, {}, {}
    for regel in pad.read_text().splitlines():
        m = re.match(r"#\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+[-\d.]+\s+(.+?)\s*$", regel)
        if m:
            st[int(m.group(1))] = (float(m.group(3)), float(m.group(2)), m.group(4))
            continue
        x = [v.strip() for v in regel.split(",")]
        if len(x) == 4 and x[0].isdigit() and x[3] != "":
            t = datetime.strptime(x[1], "%Y%m%d").replace(tzinfo=UTC) + timedelta(hours=int(x[2]))
            if b < t <= e:
                k = int(x[0])
                som[k] = som.get(k, 0.0) + max(int(x[3]), 0) / 10.0
                n[k] = n.get(k, 0) + 1
    uren = int((e - b) / timedelta(hours=1))
    return [{"id": f"a{k}", "net": "automatisch", "naam": st[k][2], "lat": st[k][0], "lon": st[k][1],
             "mm": round(som[k], 2), "status": "gevalideerd"} for k in som if n[k] == uren and k in st]


def _edr(b: datetime, e: datetime, cache_map: Path):
    klaar = e <= datetime.now(UTC) - timedelta(minutes=30)
    pad = cache_map / f"edr_{b:%Y%m%d%H%M}_{e:%Y%m%d%H%M}.json"
    if klaar and pad.exists():
        return json.loads(pad.read_text())
    params = {"bbox": BBOX, "datetime": f"{b + timedelta(minutes=10):%Y-%m-%dT%H:%M:%SZ}/{e:%Y-%m-%dT%H:%M:%SZ}",
              "parameter-name": "rg"}
    r = knmi_get(f"{EDR}/cube", params=params, timeout=120)
    r.raise_for_status()
    js = r.json()
    if any(x.get("rel") == "next" for x in js.get("links", [])):
        raise RuntimeError("EDR-cube gepagineerd (onvolledig)")
    verwacht = int((e - b) / timedelta(minutes=10))
    uit = []
    for cov in js.get("coverages", []):
        wid = cov.get("eumetnet:locationId", "")
        ts = cov["domain"]["axes"]["t"]["values"]
        vals = cov.get("ranges", {}).get("rg", {}).get("values", [])
        geldig = [v for t, v in zip(ts, vals) if v is not None and math.isfinite(v)]
        if len(geldig) != verwacht or len(set(ts)) != verwacht:
            continue
        lon = cov["domain"]["axes"]["x"]["values"][0]
        lat = cov["domain"]["axes"]["y"]["values"][0]
        uit.append({"id": "a" + wid.rsplit("-", 1)[-1].lstrip("0"), "net": "automatisch",
                    "naam": cov.get("eumetnet:locationName", wid), "lat": lat, "lon": lon,
                    "mm": round(sum(max(v, 0) for v in geldig) / 6.0, 2), "status": "voorlopig"})
    if klaar:
        pad.parent.mkdir(parents=True, exist_ok=True)
        pad.write_text(json.dumps(uit))
    return uit


def automatisch(b: datetime, e: datetime, cache_map: Path):
    """AWS-sommen over (b, e]; gevalideerde uurgegevens als die er al zijn."""
    if e <= datetime.now(UTC) - timedelta(days=3):
        try:
            res = _uurgegevens(b, e, cache_map)
            if res:
                return res
        except Exception:  # noqa: BLE001
            pass
    try:
        return _edr(b, e, cache_map)
    except Exception:  # noqa: BLE001
        return []
