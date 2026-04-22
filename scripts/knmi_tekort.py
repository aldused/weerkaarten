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
FORECAST    = os.path.join(SCRIPT_DIR, "tekort_forecast.json")
OUTPUT_JSON = os.path.join(SCRIPT_DIR, "tekort_data.json")
OUTPUT_JS   = os.path.join(SCRIPT_DIR, "tekort_data.js")

# FAO-ET0 (Penman-Monteith) → Makkink-EV24 schaalfactor
FAO_TO_MAKKINK = 0.80

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

# Bij benadering (P13-neerslagstation locatie, niet AWS-koppeling)
P13_COORDS = {
    "011": (5.38, 53.36),   # West-Terschelling
    "025": (4.78, 52.93),   # De Kooy
    "139": (6.58, 53.12),   # Groningen
    "144": (7.06, 52.88),   # Ter Apel
    "222": (5.06, 52.65),   # Hoorn NH
    "328": (6.03, 52.39),   # Heerde
    "438": (4.66, 52.30),   # Hoofddorp
    "550": (5.18, 52.10),   # De Bilt
    "666": (6.72, 51.97),   # Winterswijk
    "737": (3.97, 51.68),   # Kerkwerve
    "770": (3.87, 51.23),   # Westdorpe
    "828": (4.54, 51.59),   # Oudenbosch
    "961": (5.99, 51.19),   # Roermond
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


def laad_aws(aws: int) -> pd.DataFrame:
    """
    Returnt DataFrame met kolommen rh, ev van één AWS-station.
    CSV-kolommen: STN, YYYYMMDD, RH, EV24 (in 0.1 mm).
    """
    path = os.path.join(EV24_CACHE, f"ev24_{aws}.csv")
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("STN"):
                continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 4:
                continue
            try:
                d  = datetime.strptime(parts[1], "%Y%m%d").date()
                rh_raw = parts[2]
                ev_raw = parts[3]
                rh = max(int(rh_raw), 0) / 10.0 if rh_raw else None  # -1 (spoor) -> 0
                ev = max(int(ev_raw), 0) / 10.0 if ev_raw else None
                rows.append((d, rh, ev))
            except (ValueError, IndexError):
                continue
    df = pd.DataFrame(rows, columns=["datum", "rh", "ev"])
    df["datum"] = pd.to_datetime(df["datum"])
    return df.set_index("datum").sort_index()


def laad_ev24(aws: int) -> pd.Series:
    return laad_aws(aws)["ev"].dropna()


def laad_rh_aws(aws: int) -> pd.Series:
    return laad_aws(aws)["rh"].dropna()


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


def bereken_ensemble_waaier(forecast_ensemble: dict, actieve_stations: list,
                             p13_to_aws: dict, per_jaar_huidig: dict,
                             peil_doy_val: int, huidig_jaar: int,
                             start_maand: int, start_dag: int) -> list:
    """
    Bouwt 51 ensemble-trajectories voor landelijk tekort, startend op peil_doy.
    Returnt per dag: {doy, date, p10, p25, p50, p75, p90, mean}.
    """
    if not forecast_ensemble:
        return []

    # Start-tekort per station: laatst bekende waarde in huidig jaar (landelijk gemiddelde)
    start_tekort = per_jaar_huidig.get(peil_doy_val, 0.0) if per_jaar_huidig else 0.0

    # Verzamel ensemble-data: per station, per dag, lijst van (precip, et0) per member
    # Pak 1 station voor datum-index (alle stations hebben dezelfde datums via Open-Meteo)
    eerste_aws = None
    for stn in actieve_stations:
        aws = p13_to_aws[stn]
        if aws in forecast_ensemble:
            eerste_aws = aws
            break
    if eerste_aws is None:
        return []

    dates = [pd.Timestamp(d["date"]) for d in forecast_ensemble[eerste_aws]]
    n_dagen = len(dates)
    start_ts = pd.Timestamp(huidig_jaar, start_maand, start_dag)

    # Per member over 12 stations: bereken dagelijks landelijk gemiddelde (precip, et0)
    # Geeft matrix shape: (n_members, n_dagen) voor precip en et0
    aws_lijst = [p13_to_aws[stn] for stn in actieve_stations if p13_to_aws[stn] in forecast_ensemble]
    if not aws_lijst:
        return []

    # Members detecteren (aantal kan per station iets variëren; gebruik minimum)
    n_members = min(len(forecast_ensemble[aws][0]["precip"]) for aws in aws_lijst)
    precip_mat = np.zeros((n_members, n_dagen))
    et0_mat    = np.zeros((n_members, n_dagen))
    counts     = np.zeros((n_members, n_dagen))

    for aws in aws_lijst:
        ens = forecast_ensemble[aws]
        for dag_idx in range(min(n_dagen, len(ens))):
            ppreds = ens[dag_idx]["precip"][:n_members]
            eepreds = ens[dag_idx]["et0"][:n_members]
            for m in range(min(n_members, len(ppreds), len(eepreds))):
                p = ppreds[m]
                e = eepreds[m]
                if p is not None and e is not None:
                    precip_mat[m, dag_idx] += p
                    et0_mat[m, dag_idx]    += e * FAO_TO_MAKKINK
                    counts[m, dag_idx]     += 1

    # Gemiddelde over stations (waar beschikbaar)
    valid = counts > 0
    precip_land = np.where(valid, precip_mat / np.where(valid, counts, 1), 0.0)
    et0_land    = np.where(valid, et0_mat    / np.where(valid, counts, 1), 0.0)

    # Cumulatief tekort per member vanaf start_tekort (floor op 0)
    cum = np.full(n_members, start_tekort, dtype=float)
    traj = np.zeros((n_members, n_dagen))
    for dag_idx in range(n_dagen):
        diff = et0_land[:, dag_idx] - precip_land[:, dag_idx]
        cum = np.maximum(0.0, cum + diff)
        traj[:, dag_idx] = cum

    # Percentielen per dag
    out = []
    for dag_idx in range(n_dagen):
        datum = dates[dag_idx]
        doy = (datum - start_ts).days
        if doy < 0:
            continue
        arr = traj[:, dag_idx]
        out.append({
            "doy":  int(doy),
            "date": datum.strftime("%Y-%m-%d"),
            "p10":  round(float(np.percentile(arr, 10)), 1),
            "p25":  round(float(np.percentile(arr, 25)), 1),
            "p50":  round(float(np.percentile(arr, 50)), 1),
            "p75":  round(float(np.percentile(arr, 75)), 1),
            "p90":  round(float(np.percentile(arr, 90)), 1),
            "mean": round(float(arr.mean()), 1),
        })
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
    rh_per_stn = {}      # P13-RH (handmatig, ~6 wk achter)
    rh_aws_per_stn = {}  # AWS-RH (near-real-time, gekoppeld AWS)
    ev_per_stn = {}
    cutoff_p13 = {}      # laatste datum met P13-data
    skipped = []
    for stn in sorted(P13_STATIONS.keys()):
        aws = P13_TO_AWS[stn]
        rh_p13 = laad_neerslag(stn)
        aws_df = laad_aws(aws)
        rh_aws = aws_df["rh"].dropna()
        ev     = aws_df["ev"].dropna()

        # Als P13 leeg is, gebruik AWS-RH voor hele reeks (fallback)
        if rh_p13.empty and not rh_aws.empty:
            print(f"  {stn} {P13_STATIONS[stn]:20s} ← AWS {aws}  (P13 leeg, AWS-RH vervangt volledig)")
            rh_per_stn[stn] = rh_aws.copy()
        elif rh_p13.empty or ev.empty:
            print(f"  {stn} {P13_STATIONS[stn]:20s} — OVERGESLAGEN (rh={len(rh_p13)}, ev={len(ev)})")
            skipped.append(stn)
            continue
        else:
            rh_per_stn[stn] = rh_p13

        rh_aws_per_stn[stn] = rh_aws
        ev_per_stn[stn] = ev
        cutoff_p13[stn] = rh_p13.index[-1] if not rh_p13.empty else None
        laatste_p13 = cutoff_p13[stn].date() if cutoff_p13[stn] is not None else "n.v.t."
        print(f"  {stn} {P13_STATIONS[stn]:20s} ← AWS {aws}  "
              f"P13:{laatste_p13}  AWS-RH:{rh_aws.index[-1].date()}  "
              f"EV:{ev.index[0].date()}–{ev.index[-1].date()}")
    actieve_stations = [s for s in sorted(P13_STATIONS.keys()) if s not in skipped]

    # Merge P13 + AWS-fill: voor dagen na cutoff, gebruik AWS-RH
    print("\nNear-real-time AWS-RH gebruiken voor dagen na P13-cutoff …")
    for stn in actieve_stations:
        if stn not in cutoff_p13 or cutoff_p13[stn] is None:
            continue
        cutoff = cutoff_p13[stn]
        aws_recent = rh_aws_per_stn[stn]
        aanvulling = aws_recent[aws_recent.index > cutoff]
        if not aanvulling.empty:
            rh_per_stn[stn] = pd.concat([rh_per_stn[stn], aanvulling]).sort_index()
            print(f"  {stn} {P13_STATIONS[stn]:20s}: +{len(aanvulling)} dagen AWS-fill "
                  f"({aanvulling.index[0].date()}–{aanvulling.index[-1].date()})")

    # Open-Meteo forecast toevoegen (RH + EV24 voor komende ~15 dagen)
    print("\nForecast-data laden (Open-Meteo) …")
    forecast_aws = {}
    forecast_ensemble = {}  # { aws: [ {date, precip:[51], et0:[51]}, … ] }
    if os.path.exists(FORECAST):
        with open(FORECAST, encoding="utf-8") as f:
            fcdata = json.load(f)
        for aws_str, info in fcdata.get("stations", {}).items():
            aws = int(aws_str)
            rows = [(pd.Timestamp(d["date"]),
                     float(d["precip"] or 0.0),
                     float((d["et0"] or 0.0) * FAO_TO_MAKKINK))
                    for d in info["daily"]]
            forecast_aws[aws] = pd.DataFrame(rows, columns=["datum", "rh_fc", "ev_fc"]).set_index("datum")
            if info.get("ensemble"):
                forecast_ensemble[aws] = info["ensemble"]
        print(f"  {len(forecast_aws)} stations, ensemble voor {len(forecast_ensemble)}")
        if forecast_aws:
            periode = list(forecast_aws.values())[0]
            print(f"  Periode: {periode.index[0].date()}–{periode.index[-1].date()}")
    else:
        print(f"  (geen forecast-bestand — sla over)")

    forecast_start_date = None
    # Voeg forecast toe aan rh en ev van elke station vanaf vandaag
    vandaag_ts = pd.Timestamp(datetime.now().date())
    for stn in actieve_stations:
        aws = P13_TO_AWS[stn]
        if aws not in forecast_aws:
            continue
        fc = forecast_aws[aws]
        fc_add = fc[fc.index >= vandaag_ts]
        if fc_add.empty:
            continue
        # Alleen dagen die nog niet in rh_per_stn zitten toevoegen
        rh_bestaand = rh_per_stn[stn]
        fc_toevoegen = fc_add[~fc_add.index.isin(rh_bestaand.index)]
        if not fc_toevoegen.empty:
            rh_per_stn[stn] = pd.concat([rh_bestaand, fc_toevoegen["rh_fc"].rename(None)]).sort_index()
            ev_per_stn[stn] = pd.concat([ev_per_stn[stn], fc_toevoegen["ev_fc"].rename(None)]).sort_index()
            if forecast_start_date is None or fc_toevoegen.index[0] < forecast_start_date:
                forecast_start_date = fc_toevoegen.index[0]
    if forecast_start_date is not None:
        print(f"  Forecast-extensie geactiveerd vanaf {forecast_start_date.date()}")

    # Bepaal globale cutoff-dates (voor dashed styling in de grafiek)
    global_p13_cutoff = min([c for c in cutoff_p13.values() if c is not None], default=None)

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

        coords = P13_COORDS.get(stn, (None, None))
        stations_data[stn] = {
            "naam":    P13_STATIONS[stn],
            "aws":     P13_TO_AWS[stn],
            "lon":     coords[0],
            "lat":     coords[1],
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

    # Peil-doy: laatste waarneming-doy in huidig jaar (excl. forecast).
    # Mag niet voorbij vandaag; forecast-dagen tellen niet mee in "rang op nu".
    def peil_doy(per_jaar_huidig: dict, vandaag_doy: int) -> int:
        if not per_jaar_huidig:
            return vandaag_doy
        beschikbaar = [d for d in per_jaar_huidig.keys() if d <= vandaag_doy]
        return max(beschikbaar) if beschikbaar else vandaag_doy

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
    # + rang per station op peil_doy
    top10 = []
    for stn, info in stations_data.items():
        per_jan = info["per_jan"]
        cur = per_jan.get(huidig_jaar, {})
        if not cur:
            continue
        beschikbaar = [d for d in cur if d <= peil_doy_jan]
        if not beschikbaar:
            continue
        laatste = max(beschikbaar)
        huidig_v = cur[laatste]

        # Rang van huidig jaar t.o.v. alle historische jaren op dezelfde doy (tolerantie ±3 dagen)
        vergelijk = []
        for jr, d in per_jan.items():
            if jr == huidig_jaar:
                continue
            # Kies dichtstbijzijnde doy binnen ±3 dagen
            kandidaten = [k for k in d.keys() if abs(k - laatste) <= 3]
            if kandidaten:
                doy_ref = min(kandidaten, key=lambda k: abs(k - laatste))
                vergelijk.append(d[doy_ref])
        vergelijk.sort(reverse=True)
        rang = next((i + 1 for i, v in enumerate(vergelijk) if huidig_v >= v), len(vergelijk) + 1)
        n_totaal = len(vergelijk) + 1

        entry = {
            "stn":       stn,
            "naam":      info["naam"],
            "tekort":    huidig_v,
            "doy":       int(laatste),
            "rang":      rang,
            "n_jaren":   n_totaal,
            "pct":       round(100.0 * rang / n_totaal, 1) if n_totaal else None,
        }
        top10.append(entry)
        # Ranking-veld in het station-object zetten
        info["rang_nu"]     = rang
        info["n_jaren_nu"]  = n_totaal
        info["tekort_nu"]   = huidig_v

        # Top-5 historische droogste jaren op deze doy voor dit station
        hist = sorted(
            [(jr, d[min([k for k in d.keys() if abs(k - laatste) <= 3],
                         key=lambda k: abs(k - laatste))])
             for jr, d in per_jan.items()
             if jr != huidig_jaar and any(abs(k - laatste) <= 3 for k in d.keys())],
            key=lambda t: -t[1]
        )[:5]
        info["top5_historisch"] = [
            {"jaar": int(jr), "tekort": round(float(v), 1)} for jr, v in hist
        ]
    top10.sort(key=lambda x: -x["tekort"])

    # Klimatologie-envelope voor hoofdgrafiek
    print("Klimatologie-envelope berekenen …")
    klimaat_apr = statistieken_per_doy(land_per_apr, vandaag_doy_apr if vandaag_doy_apr >= 0 else 0, huidig_jaar)
    klimaat_jan = statistieken_per_doy(land_per_jan, vandaag_doy_jan, huidig_jaar)

    # Ensemble-waaier (ECMWF 51 leden) vanaf peil-datum
    print("Ensemble-waaier berekenen …")
    # Droogte-categorie: waar zit huidig jaar in de historische verdeling op peil_doy?
    def bepaal_categorie(huidig_v: float, klimaat: list, peil_doy: int) -> dict:
        if huidig_v is None:
            return {"label": "onbekend", "kleur": "#94a3b8", "percentiel": None}
        # Zoek klimaat-entry voor peil_doy
        klim_row = next((k for k in klimaat if k["doy"] == peil_doy), None)
        if not klim_row:
            return {"label": "onbekend", "kleur": "#94a3b8", "percentiel": None}
        # Percentiel kan benaderd worden via p5/p50/p95 — precies is via alle data
        # Hier schat: tussen welke percentielen zit huidig_v?
        if huidig_v <= klim_row["p5"]:         pct = 5
        elif huidig_v <= klim_row["median"]:   pct = 5 + 45 * (huidig_v - klim_row["p5"])   / max(klim_row["median"] - klim_row["p5"], 0.01)
        elif huidig_v <= klim_row["p95"]:      pct = 50 + 45 * (huidig_v - klim_row["median"]) / max(klim_row["p95"] - klim_row["median"], 0.01)
        elif huidig_v <= klim_row["max"]:      pct = 95 + 5 * (huidig_v - klim_row["p95"])  / max(klim_row["max"] - klim_row["p95"], 0.01)
        else:                                  pct = 100
        pct = max(0, min(100, pct))

        if   pct < 10:   lab, kl = "zeer nat",       "#0369a1"
        elif pct < 25:   lab, kl = "nat",            "#0ea5e9"
        elif pct < 50:   lab, kl = "normaal-nat",    "#60a5fa"
        elif pct < 75:   lab, kl = "normaal-droog",  "#fbbf24"
        elif pct < 90:   lab, kl = "droog",          "#f97316"
        elif pct < 95:   lab, kl = "zeer droog",     "#dc2626"
        else:            lab, kl = "extreem droog",  "#7c2d12"
        return {"label": lab, "kleur": kl, "percentiel": round(pct, 1)}

    categorie_jan = bepaal_categorie(
        huidig_jaar_data_jan.get(peil_doy_jan), klimaat_jan, peil_doy_jan
    )
    categorie_apr = bepaal_categorie(
        huidig_jaar_data_apr.get(peil_doy_apr), klimaat_apr, peil_doy_apr
    ) if peil_doy_apr >= 0 else {"label": "voor 1 apr", "kleur": "#94a3b8", "percentiel": None}

    ensemble_jan = bereken_ensemble_waaier(
        forecast_ensemble, actieve_stations, P13_TO_AWS,
        huidig_jaar_data_jan, peil_doy_jan, huidig_jaar, 1, 1
    )
    ensemble_apr = bereken_ensemble_waaier(
        forecast_ensemble, actieve_stations, P13_TO_AWS,
        huidig_jaar_data_apr, peil_doy_apr, huidig_jaar, 4, 1
    )

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
            "voorlopig_vanaf_doy_jan": (
                (global_p13_cutoff + pd.Timedelta(days=1) - pd.Timestamp(huidig_jaar, 1, 1)).days
                if global_p13_cutoff is not None and global_p13_cutoff.year == huidig_jaar else None
            ),
            "voorlopig_vanaf_doy_apr": (
                (global_p13_cutoff + pd.Timedelta(days=1) - pd.Timestamp(huidig_jaar, 4, 1)).days
                if global_p13_cutoff is not None and global_p13_cutoff.year == huidig_jaar else None
            ),
            "forecast_vanaf_doy_jan": (
                (forecast_start_date - pd.Timestamp(huidig_jaar, 1, 1)).days
                if forecast_start_date is not None else None
            ),
            "forecast_vanaf_doy_apr": (
                (forecast_start_date - pd.Timestamp(huidig_jaar, 4, 1)).days
                if forecast_start_date is not None else None
            ),
            "forecast_tm": (forecast_start_date + pd.Timedelta(days=15)).strftime("%Y-%m-%d") if forecast_start_date is not None else None,
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
            "ensemble_jan": ensemble_jan,
            "ensemble_apr": ensemble_apr,
            "categorie_jan": categorie_jan,
            "categorie_apr": categorie_apr,
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
