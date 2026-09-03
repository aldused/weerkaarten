#!/usr/bin/env python3
"""Kalibreer de zonneschijnafleiding per model op gemeten zonneschijn.

Bron van de waarheid: KNMI 10-minutenwaarnemingen, parameter `ss` (minuten
zon per 10 minuten) op alle AWS-stations met een zonneschijnsensor. Bron van
de modelwaarden: Open-Meteo `direct_radiation` met `past_days`, per model,
op dezelfde stationsposities.

Per model wordt de relatie bepaald tussen

    k = uurgemiddelde directe straling / heldere-hemel-waarde (Meinel)

en de gemeten zonfractie (ss / minuten dat de zon hoog genoeg staat voor de
WMO-grens van 120 W/m² DNI). De curve is stuksgewijs lineair door de
klassegemiddelden (kwantielklassen), isotoon gladgestreken. Zonder kalibratie
is de afleiding fractie = k; die onderschat hi-res modellen met 8-12 min/uur
(dunne bewolking dempt de bundel zonder de zon te blokkeren) en verschilt per
model naargelang hoe de directe straling tot stand komt (ECMWF: door Open-Meteo
afgeleid uit de globale straling; ICON: eigen modeluitvoer).

Uitvoer: scripts/zonuren_curves.json — per Open-Meteo-modelslug een curve,
plus een gepoolde hi-res- en globale curve als terugval. zonuren.py leest dat
bestand bij het starten.

Gebruik:
    python3 scripts/zonuren_kalibratie.py            # 14 dagen, schrijf json
    python3 scripts/zonuren_kalibratie.py --dagen 21 --droog   # alleen rapport
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from knmi_api import knmi_get                      # noqa: E402
from lopend_patch import EDR_10, _edr_floats, _wigos  # noqa: E402
from zonuren import heldere_hemel_uur              # noqa: E402

UIT = SCRIPT_DIR / "zonuren_curves.json"
DELTAS = (0, 10, 20, 30)          # geteste verschuivingen modeluur → meetvenster, minuten

# AWS-stations met zonneschijnsensor (KNMI-nummer). 210/340/391 geven 404 in EDR.
STATIONS = [235, 240, 249, 251, 257, 260, 267, 269, 270, 273, 275, 277, 278, 279,
            280, 283, 286, 290, 310, 319, 323, 330, 344, 348, 350, 356, 370, 375, 377, 380]

# Open-Meteo-slug → groep voor de gepoolde terugvalcurve.
MODELLEN = {
    "ecmwf_ifs025": "globaal",
    "gfs_seamless": "globaal",
    "icon_global": "globaal",
    "ukmo_global_deterministic_10km": "globaal",
    "knmi_harmonie_arome_netherlands": "hires",
    "icon_d2": "hires",
    "ukmo_uk_deterministic_2km": "hires",
    "meteofrance_arome_france_hd": "hires",     # levert geen past_days; valt terug op hires-pool
    "dmi_harmonie_arome_europe": "hires",
}


def haal_gemeten(dagen: int) -> dict:
    nu = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = nu - timedelta(days=dagen)
    rng = f"{start:%Y-%m-%dT%H:%M:%SZ}/{nu:%Y-%m-%dT%H:%M:%SZ}"
    uit = {}
    for nr in STATIONS:
        try:
            r = knmi_get(f"{EDR_10}/locations/{_wigos(nr)}",
                         params={"datetime": rng, "parameter-name": "ss"}, timeout=40)
            if r.status_code != 200:
                print(f"  station {nr}: HTTP {r.status_code}")
                continue
            cov = (r.json().get("coverages") or [None])[0]
            if not cov:
                continue
            ax = cov["domain"]["axes"]
            # Ruwe 10-minuutwaarden (label = einde van het 10-minuutvak), zodat
            # een meetvenster op elke 10 minuten kan beginnen: nodig om de
            # tijdverschuiving δ per model te bepalen.
            reeks = {}
            for t, v in zip(ax["t"]["values"], _edr_floats(cov["ranges"]["ss"]["values"])):
                if v is not None:
                    reeks[datetime.fromisoformat(t.replace("Z", "+00:00"))] = v
            uit[str(nr)] = {"lat": ax["y"]["values"][0], "lon": ax["x"]["values"][0], "reeks": reeks}
        except Exception as exc:
            print(f"  station {nr}: {exc}")
    print(f"gemeten: {len(uit)} stations, {sum(len(s['reeks']) for s in uit.values())} 10-minuutwaarden")
    return uit


def haal_model(slug: str, ss: dict, dagen: int) -> dict | None:
    key = (Path.home() / ".open_meteo_key").read_text().strip()
    st = sorted(ss)
    payload = {
        "latitude": [ss[s]["lat"] for s in st], "longitude": [ss[s]["lon"] for s in st],
        "hourly": ["direct_radiation"], "models": [slug],
        "past_days": dagen, "forecast_days": 1, "timezone": ["UTC"],
        "cell_selection": "nearest", "apikey": key,
    }
    req = urllib.request.Request("https://customer-api.open-meteo.com/v1/forecast",
                                 data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=180))
    except Exception as exc:
        print(f"  {slug}: {str(exc)[:120]}")
        return None
    if not isinstance(d, list):
        d = [d]
    return {st[i]: d[i]["hourly"] for i in range(len(d))}


def meetvenster(reeks: dict, eind) -> float | None:
    """Gemeten zonminuten in het uurvenster dat op `eind` eindigt (zes 10-minuutvakken)."""
    tot = 0.0
    for k in range(6):
        v = reeks.get(eind - timedelta(minutes=10 * k))
        if v is None:
            return None
        tot += v
    return tot


def paren(slug: str, per_st: dict, ss: dict, cache: dict, delta_min: int) -> np.ndarray:
    """Rijen (k, gemeten fractie, zonminuten, dag) voor één model.

    Het modeluur met label T wordt gekoppeld aan het meetvenster dat eindigt op
    T + δ; de heldere-hemel-referentie schuift mee. Welke δ het best past
    verschilt per model (hoe Open-Meteo het uurgemiddelde labelt).
    """
    R = []
    for stnr, h in per_st.items():
        lat, lon = ss[stnr]["lat"], ss[stnr]["lon"]
        reeks = ss[stnr]["reeks"]
        for i, t in enumerate(h["time"]):
            dr = h["direct_radiation"][i]
            if dr is None:
                continue
            eind = datetime.fromisoformat(t).replace(tzinfo=timezone.utc) + timedelta(minutes=delta_min)
            g = meetvenster(reeks, eind)
            if g is None:
                continue
            sleutel = (stnr, eind)
            if sleutel not in cache:
                cache[sleutel] = heldere_hemel_uur(eind, lat, lon)
            helder, zonmin = cache[sleutel]
            if zonmin == 0 or helder < 1.0:
                continue
            R.append((dr / helder, g / zonmin, zonmin, (eind - timedelta(hours=1)).toordinal()))
    return np.array(R, dtype=float).reshape(-1, 4)


def curve(x: np.ndarray, y: np.ndarray, n_bins: int = 16) -> tuple[list, list]:
    """Stuksgewijs-lineaire, isotone curve door kwantielklasse-gemiddelden."""
    q = np.unique(np.quantile(x, np.linspace(0, 1, n_bins + 1)))
    xs, ys = [], []
    for lo, hi in zip(q[:-1], q[1:]):
        m = (x >= lo) & (x <= hi)
        if m.sum() < 10:
            continue
        xs.append(float(x[m].mean()))
        ys.append(float(y[m].mean()))
    ys = np.array(ys)
    i = 0
    while i < len(ys) - 1:                      # pool-adjacent-violators
        if ys[i] > ys[i + 1]:
            ys[i] = ys[i + 1] = (ys[i] + ys[i + 1]) / 2
            i = max(i - 1, 0)
        else:
            i += 1
    return [round(v, 4) for v in xs], [round(float(v), 4) for v in ys]


def toets(R: np.ndarray) -> dict:
    """2-voudige cross-validatie op dagpariteit: fout in min/uur, ongekalibreerd vs gekalibreerd."""
    k, frac, zm, dag = R.T
    meet = frac * zm
    raw = np.clip(k, 0, 1) * zm
    pred = np.zeros_like(meet)
    for fold in (0, 1):
        tr = (dag % 2) != fold
        xs, ys = curve(k[tr], frac[tr])
        pred[~tr] = np.interp(k[~tr], xs, ys) * zm[~tr]
    e0, e1 = raw - meet, pred - meet
    return {"n": int(len(R)),
            "raw_bias": round(float(e0.mean()), 2), "raw_abs": round(float(np.abs(e0).mean()), 2),
            "kal_bias": round(float(e1.mean()), 2), "kal_abs": round(float(np.abs(e1).mean()), 2),
            "kal_rmse": round(float(np.sqrt((e1 ** 2).mean())), 2)}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dagen", type=int, default=14)
    p.add_argument("--droog", action="store_true", help="alleen rapporteren, json niet schrijven")
    args = p.parse_args()

    t0 = time.time()
    ss = haal_gemeten(args.dagen)
    if len(ss) < 10:
        print("te weinig stations; kalibratie overgeslagen")
        return 1

    cache: dict = {}
    curves, rapport, per_groep = {}, {}, {"hires": [], "globaal": []}
    for slug, groep in MODELLEN.items():
        per_st = haal_model(slug, ss, args.dagen)
        if not per_st:
            continue
        # Tijdverschuiving: kies de δ met de kleinste rmse na kalibratie.
        beste = None
        for delta in DELTAS:
            R = paren(slug, per_st, ss, cache, delta)
            if len(R) < 500:
                continue
            r = toets(R)
            if beste is None or r["kal_rmse"] < beste[1]["kal_rmse"]:
                beste = (delta, r, R)
        if beste is None:
            print(f"  {slug}: te weinig paren — terugval op groepscurve")
            continue
        delta, r, R = beste
        xs, ys = curve(R[:, 0], R[:, 1])
        curves[slug] = {"x": xs, "y": ys, "delta_min": delta}
        r["delta_min"] = delta
        rapport[slug] = r
        per_groep[groep].append(R)
        print(f"  {slug:34s} n={r['n']:5d} δ={delta:2d}  ongekalibreerd {r['raw_bias']:+5.1f}/{r['raw_abs']:4.1f}  "
              f"gekalibreerd {r['kal_bias']:+5.1f}/{r['kal_abs']:4.1f}  rmse {r['kal_rmse']:4.1f}")

    pool = {}
    for groep, lijst in per_groep.items():
        if lijst:
            R = np.vstack(lijst)
            xs, ys = curve(R[:, 0], R[:, 1])
            pool[groep] = {"x": xs, "y": ys}
    if per_groep["hires"] or per_groep["globaal"]:
        R = np.vstack(per_groep["hires"] + per_groep["globaal"])
        xs, ys = curve(R[:, 0], R[:, 1])
        pool["alle"] = {"x": xs, "y": ys}

    uit = {
        "bijgewerkt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "dagen": args.dagen, "stations": len(ss),
        "curves": curves, "pool": pool, "groep": MODELLEN, "toets": rapport,
    }
    if args.droog:
        print("droog: json niet geschreven")
    else:
        tmp = UIT.with_suffix(".tmp")
        tmp.write_text(json.dumps(uit, indent=1))
        tmp.replace(UIT)
        print(f"geschreven: {UIT.name}")
    print(f"klaar in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
