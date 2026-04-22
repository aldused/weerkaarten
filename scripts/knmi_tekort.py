#!/usr/bin/env python3
"""
knmi_tekort.py — Neerslagtekort P13 (landelijk + per station).

Tekort_t = cumsum( EV24 - RH )  vanaf startdag, gefloord op 0 (KNMI-methodiek).
Start: elk jaar opnieuw 1 januari (alt) óf 1 april (standaard KNMI groeiseizoen).

Input:
  p13_cache/neerslag_{stn}.csv   (13 P13 neerslagstations, RH)
  ev24_cache/ev24_{stn}.csv      (12 AWS stations, EV24)

Output:
  tekort_data.json               (alle reeksen + ranking + top-10)
  tekort_data.js                 (const TEKORT_DATA = {...})
"""

import os
import json
from datetime import datetime, date
import pandas as pd
import numpy as np

SCRIPT_DIR  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P13_CACHE   = os.path.join(SCRIPT_DIR, "p13_cache")
EV24_CACHE  = os.path.join(SCRIPT_DIR, "ev24_cache")
OUTPUT_JSON = os.path.join(SCRIPT_DIR, "tekort_data.json")
OUTPUT_JS   = os.path.join(SCRIPT_DIR, "tekort_data.js")

P13_STATIONS = {
    "011": "West-Terschelling", "025": "De Kooy", "139": "Groningen",
    "144": "Ter Apel",          "222": "Hoorn",   "328": "Heerde",
    "438": "Hoofddorp",         "550": "De Bilt", "666": "Winterswijk",
    "737": "Kerkwerve",         "770": "Westdorpe","828": "Oudenbosch",
    "961": "Roermond",
}

P13_TO_AWS = {
    "011": 251, "025": 235, "139": 280, "144": 280, "222": 249,
    "328": 278, "438": 240, "550": 260, "666": 283, "737": 310,
    "770": 319, "828": 350, "961": 377,
}

TEKORT_START_DOY = 91  # 1 april (DOY 91 in niet-schrikkeljaar). Ook 1 jan leveren.


# ── CSV laders ────────────────────────────────────────────────────────────────

def laad_neerslag(stn: str) -> pd.Series:
    path = os.path.join(P13_CACHE, f"neerslag_{stn}.csv")
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("STN"):
                continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 3 or not parts[2]:
                continue
            try:
                d = datetime.strptime(parts[1], "%Y%m%d").date()
                rh = max(int(parts[2]), 0) / 10.0
                rows.append((d, rh))
            except (ValueError, IndexError):
                continue
    s = pd.Series(dict(rows), name=f"rh_{stn}")
    s.index = pd.to_datetime(s.index)
    return s.sort_index()


def laad_ev24(aws: int) -> pd.Series:
    path = os.path.join(EV24_CACHE, f"ev24_{aws}.csv")
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("STN"):
                continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 3 or not parts[2]:
                continue
            try:
                d  = datetime.strptime(parts[1], "%Y%m%d").date()
                ev = max(int(parts[2]), 0) / 10.0
                rows.append((d, ev))
            except (ValueError, IndexError):
                continue
    s = pd.Series(dict(rows), name=f"ev_{aws}")
    s.index = pd.to_datetime(s.index)
    return s.sort_index()


# ── Tekort-berekening ────────────────────────────────────────────────────────

def tekort_per_jaar(rh: pd.Series, ev: pd.Series, start_maand: int, start_dag: int) -> pd.DataFrame:
    """
    Geeft DataFrame met index=datum, kolommen=['tekort','jaar','doy_start'].
    Tekort = cumsum(EV-RH) per jaar vanaf (start_maand, start_dag), gefloord op 0.
    """
    df = pd.DataFrame({"rh": rh, "ev": ev}).dropna()
    df["diff"] = df["ev"] - df["rh"]
    df["jaar"] = df.index.year

    pieces = []
    for jaar, grp in df.groupby("jaar"):
        start = pd.Timestamp(jaar, start_maand, start_dag)
        sel = grp[grp.index >= start]
        if sel.empty:
            continue
        cum = 0.0
        waarden = []
        for _, row in sel.iterrows():
            cum = max(0.0, cum + row["diff"])
            waarden.append(cum)
        piece = pd.DataFrame({"tekort": waarden, "jaar": jaar}, index=sel.index)
        pieces.append(piece)

    if not pieces:
        return pd.DataFrame()
    return pd.concat(pieces)


def per_jaar_op_doy(tekort_df: pd.DataFrame, jaar_start_maand: int, jaar_start_dag: int) -> dict:
    """
    Reorganiseert naar { jaar: {doy_sinds_start: tekort} }.
    doy_sinds_start = 0 op startdag, 1 op dag erna, enz.
    """
    out = {}
    for jaar, grp in tekort_df.groupby("jaar"):
        start = pd.Timestamp(jaar, jaar_start_maand, jaar_start_dag)
        dagen = (grp.index - start).days.astype(int)
        out[int(jaar)] = {int(d): round(float(v), 1) for d, v in zip(dagen, grp["tekort"])}
    return out


def statistieken_per_doy(per_jaar: dict, vandaag_doy: int, excl_jaar: int | None = None) -> list:
    """
    Per dag-offset (0..N) geef min/max/mean/median/p5/p95 over alle jaren.
    Altijd volledig jaar (doy 0..365).
    excl_jaar (huidig jaar) telt niet mee in klimatologie.
    """
    max_doy = 365
    result = []
    for doy in range(0, max_doy + 1):
        waarden = []
        for jr, d in per_jaar.items():
            if excl_jaar is not None and jr == excl_jaar:
                continue
            if doy in d:
                waarden.append(d[doy])
        if not waarden:
            continue
        arr = np.array(waarden)
        result.append({
            "doy":    doy,
            "n":      len(waarden),
            "mean":   round(float(arr.mean()), 1),
            "median": round(float(np.median(arr)), 1),
            "p5":     round(float(np.percentile(arr, 5)), 1),   # 5% droogste = 95e percentiel (hoog tekort)
            "p95":    round(float(np.percentile(arr, 95)), 1),  # 5% natste (laag tekort)
            "max":    round(float(arr.max()), 1),
            "min":    round(float(arr.min()), 1),
        })
    return result


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("knmi_tekort.py — Neerslagtekort P13")
    print("=" * 60)

    print("\nLaden neerslag + verdamping …")
    rh_per_stn = {}
    ev_per_stn = {}
    skipped = []
    for stn in sorted(P13_STATIONS.keys()):
        rh = laad_neerslag(stn)
        aws = P13_TO_AWS[stn]
        ev = laad_ev24(aws)
        if rh.empty or ev.empty:
            print(f"  {stn} {P13_STATIONS[stn]:20s} — OVERGESLAGEN (rh={len(rh)}, ev={len(ev)})")
            skipped.append(stn)
            continue
        rh_per_stn[stn] = rh
        ev_per_stn[stn] = ev
        print(f"  {stn} {P13_STATIONS[stn]:20s} ← AWS {aws}  "
              f"RH:{rh.index[0].date()}–{rh.index[-1].date()}  "
              f"EV:{ev.index[0].date()}–{ev.index[-1].date()}")
    actieve_stations = [s for s in sorted(P13_STATIONS.keys()) if s not in skipped]

    huidig_jaar = datetime.now().year

    # Twee varianten
    stations_data = {}
    landelijk_dfs_apr = []
    landelijk_dfs_jan = []

    for stn in actieve_stations:
        rh = rh_per_stn[stn]
        ev = ev_per_stn[stn]

        tek_apr = tekort_per_jaar(rh, ev, 4, 1)
        tek_jan = tekort_per_jaar(rh, ev, 1, 1)

        per_apr = per_jaar_op_doy(tek_apr, 4, 1)
        per_jan = per_jaar_op_doy(tek_jan, 1, 1)

        stations_data[stn] = {
            "naam":    P13_STATIONS[stn],
            "aws":     P13_TO_AWS[stn],
            "per_apr": per_apr,
            "per_jan": per_jan,
        }
        landelijk_dfs_apr.append(tek_apr.rename(columns={"tekort": stn}).drop(columns=["jaar"]))
        landelijk_dfs_jan.append(tek_jan.rename(columns={"tekort": stn}).drop(columns=["jaar"]))

    # Landelijk gemiddelde: per dag het gemiddelde over alle 13 stations (waar beschikbaar)
    print("\nLandelijk gemiddelde berekenen …")
    all_apr = pd.concat(landelijk_dfs_apr, axis=1)
    all_jan = pd.concat(landelijk_dfs_jan, axis=1)
    land_apr_series = all_apr.mean(axis=1, skipna=True).dropna()
    land_jan_series = all_jan.mean(axis=1, skipna=True).dropna()

    def serie_naar_per_jaar(s: pd.Series, start_maand: int, start_dag: int) -> dict:
        out = {}
        for jaar, grp in s.groupby(s.index.year):
            start = pd.Timestamp(jaar, start_maand, start_dag)
            dagen = (grp.index - start).days.astype(int)
            dagen = dagen[dagen >= 0]
            vals  = grp.loc[grp.index >= start]
            out[int(jaar)] = {int(d): round(float(v), 1) for d, v in zip(dagen, vals)}
        return out

    land_per_apr = serie_naar_per_jaar(land_apr_series, 4, 1)
    land_per_jan = serie_naar_per_jaar(land_jan_series, 1, 1)

    # Huidig tekort op vandaag
    vandaag = datetime.now().date()
    huidig_jaar_data_jan = land_per_jan.get(huidig_jaar, {})
    huidig_jaar_data_apr = land_per_apr.get(huidig_jaar, {})
    vandaag_doy_jan = (datetime.now().date() - date(huidig_jaar, 1, 1)).days
    vandaag_doy_apr = (datetime.now().date() - date(huidig_jaar, 4, 1)).days

    # Peil-doy: laatste beschikbare doy in huidig jaar (P13-data loopt achter)
    def peil_doy(per_jaar_huidig: dict, fallback: int) -> int:
        if not per_jaar_huidig:
            return fallback
        return max(per_jaar_huidig.keys())

    peil_doy_jan = peil_doy(huidig_jaar_data_jan, vandaag_doy_jan)
    peil_doy_apr = peil_doy(huidig_jaar_data_apr, vandaag_doy_apr)

    # Ranking: hoe staat huidig jaar t.o.v. alle jaren op dezelfde doy?
    def ranking_op_doy(per_jaar: dict, doy: int, huidig: int) -> list:
        lijst = []
        for jr, d in per_jaar.items():
            if doy in d:
                lijst.append({"jaar": int(jr), "tekort": d[doy]})
        lijst.sort(key=lambda x: -x["tekort"])  # hoogste tekort eerst
        for i, e in enumerate(lijst, start=1):
            e["rang"] = i
            e["is_huidig"] = (e["jaar"] == huidig)
        return lijst

    ranking_jan = ranking_op_doy(land_per_jan, peil_doy_jan, huidig_jaar)
    ranking_apr = ranking_op_doy(land_per_apr, peil_doy_apr, huidig_jaar) if peil_doy_apr >= 0 else []

    # Top-10 droogste stations op dit moment (in huidig jaar, vanaf 1 jan)
    top10 = []
    for stn, info in stations_data.items():
        cur = info["per_jan"].get(huidig_jaar, {})
        if not cur:
            continue
        # Neem laatst beschikbare doy t/m peildatum
        beschikbaar = [d for d in cur if d <= peil_doy_jan]
        if not beschikbaar:
            continue
        laatste = max(beschikbaar)
        top10.append({
            "stn":  stn,
            "naam": info["naam"],
            "tekort": cur[laatste],
            "doy":   int(laatste),
        })
    top10.sort(key=lambda x: -x["tekort"])

    # Klimatologie-envelope voor hoofdgrafiek
    print("Klimatologie-envelope berekenen …")
    klimaat_apr = statistieken_per_doy(land_per_apr, vandaag_doy_apr if vandaag_doy_apr >= 0 else 0, huidig_jaar)
    klimaat_jan = statistieken_per_doy(land_per_jan, vandaag_doy_jan, huidig_jaar)

    output = {
        "meta": {
            "stations": P13_STATIONS,
            "p13_to_aws": P13_TO_AWS,
            "huidig_jaar": huidig_jaar,
            "vandaag": vandaag.strftime("%Y-%m-%d"),
            "vandaag_doy_jan": vandaag_doy_jan,
            "vandaag_doy_apr": vandaag_doy_apr,
            "peil_doy_jan":    peil_doy_jan,
            "peil_doy_apr":    peil_doy_apr,
            "gegenereerd": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "periode_jaren": [int(min(land_per_jan.keys())), int(max(land_per_jan.keys()))],
        },
        "landelijk": {
            "per_jaar_apr": land_per_apr,
            "per_jaar_jan": land_per_jan,
            "klimaat_apr":  klimaat_apr,
            "klimaat_jan":  klimaat_jan,
            "ranking_apr":  ranking_apr,
            "ranking_jan":  ranking_jan,
        },
        "stations": stations_data,
        "top10_nu": top10,
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n✓ JSON: {OUTPUT_JSON}  ({os.path.getsize(OUTPUT_JSON)/1024:.0f} kB)")

    with open(OUTPUT_JS, "w", encoding="utf-8") as f:
        f.write("const TEKORT_DATA = ")
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"✓ JS:   {OUTPUT_JS}  ({os.path.getsize(OUTPUT_JS)/1024:.0f} kB)")

    print(f"\n── Huidig jaar {huidig_jaar} op {vandaag} ──")
    if vandaag_doy_jan in huidig_jaar_data_jan:
        print(f"  Landelijk tekort (sinds 1 jan): {huidig_jaar_data_jan[vandaag_doy_jan]:.1f} mm")
    if vandaag_doy_apr >= 0 and vandaag_doy_apr in huidig_jaar_data_apr:
        print(f"  Landelijk tekort (sinds 1 apr): {huidig_jaar_data_apr[vandaag_doy_apr]:.1f} mm")

    print("\n── Top-10 droogste stations nu ──")
    for i, e in enumerate(top10[:10], 1):
        print(f"  {i:2d}. {e['naam']:20s} {e['tekort']:6.1f} mm")

    print("\n── Landelijk ranking (vanaf 1 jan) — top 10 + huidig ──")
    for e in ranking_jan[:10]:
        mark = " ← NU" if e["is_huidig"] else ""
        print(f"  #{e['rang']:3d} {e['jaar']}:  {e['tekort']:6.1f} mm{mark}")
    for e in ranking_jan:
        if e["is_huidig"]:
            print(f"  #{e['rang']:3d} {e['jaar']}:  {e['tekort']:6.1f} mm  ← huidig jaar")
            break


if __name__ == "__main__":
    main()
