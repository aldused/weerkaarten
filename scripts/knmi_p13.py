#!/usr/bin/env python3
"""
knmi_p13.py — Landelijk neerslaggemiddelde P13
Berekent records op basis van de 13 KNMI-neerslagstations van de P13-reeks
(vanaf 1 januari 1906, zoals het KNMI).

P13 bestaat uit 13 handmatige neerslagstations (MONV-nummers, ANDERS dan de
synop-nummers van de automatische weerstations):
  De Bilt            550
  De Kooy            025   (t/m 1971: Den Helder 009)
  Groningen          139
  Heerde             328
  Hoofddorp          438
  Hoorn              222
  Kerkwerve          737
  Oudenbosch         828
  Roermond           961
  Ter Apel           144
  West-Terschelling  011
  Westdorpe          770   (t/m 1995: Axel 745)
  Winterswijk        666

Definitie: knmi.nl/kennis-en-datacentrum/achtergrond/
veelgestelde-vragen-over-landelijk-gemiddelden
Daggemiddelde = gemiddelde over de 13 slots, met per slot het station dat op
die datum geldt (zelfde als berekenP13/P13_SLOTS in beta_neerslagstations.html).

Data: daggegevens.knmi.nl/klimatologie/monv/reeksen
Kolom RD: 24-uur neerslagsom in tiende mm, 08:00 UTC vorigedag – 08:00 UTC huidig.

Output: p13_records.json
"""

import os
import subprocess
import json
import urllib.request
import urllib.parse
import pandas as pd
from climate_periods import complete_days
from datetime import datetime

# ── Configuratie ──────────────────────────────────────────────────────────────

# De 13 P13-slots: per slot de MONV-stations met hun geldigheid (van/tot incl.).
P13_SLOTS = [
    ("De Bilt",           [("550", None, None)]),
    ("De Kooy",           [("009", None, "1971-12-31"), ("025", "1972-01-01", None)]),
    ("Groningen",         [("139", None, None)]),
    ("Heerde",            [("328", None, None)]),
    ("Hoofddorp",         [("438", None, None)]),
    ("Hoorn",             [("222", None, None)]),
    ("Kerkwerve",         [("737", None, None)]),
    ("Oudenbosch",        [("828", None, None)]),
    ("Roermond",          [("961", None, None)]),
    ("Ter Apel",          [("144", None, None)]),
    ("West-Terschelling", [("011", None, None)]),
    ("Westdorpe",         [("745", None, "1995-12-31"), ("770", "1996-01-01", None)]),
    ("Winterswijk",       [("666", None, None)]),
]

# Huidige P13-stations (meta.stations, stationslijst op de pagina)
P13_STATIONS = {
    "011": "West-Terschelling",
    "025": "De Kooy",
    "144": "Ter Apel",
    "139": "Groningen",
    "222": "Hoorn",
    "328": "Heerde",
    "438": "Hoofddorp",
    "550": "De Bilt",
    "666": "Winterswijk",
    "737": "Kerkwerve",
    "770": "Westdorpe",
    "828": "Oudenbosch",
    "961": "Roermond",
}
STATION_NAMEN = {**P13_STATIONS, "009": "Den Helder", "745": "Axel"}

BASE_URL     = "https://daggegevens.knmi.nl/klimatologie/monv/reeksen"
START_DATE   = "19060101"   # begin officiële P13-reeks
SCRIPT_DIR   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR    = os.path.join(SCRIPT_DIR, "p13_cache")
OUTPUT_JSON  = os.path.join(SCRIPT_DIR, "p13_records.json")

MIN_STATIONS = 10
TOP_N        = 25

SEIZOENEN = {
    "Winter": [12, 1, 2],
    "Lente":  [3, 4, 5],
    "Zomer":  [6, 7, 8],
    "Herfst": [9, 10, 11],
}

MAANDEN_NL = ["", "januari", "februari", "maart", "april", "mei", "juni",
               "juli", "augustus", "september", "oktober", "november", "december"]

# ── Data laden ────────────────────────────────────────────────────────────────

def download_station(nr: str) -> pd.DataFrame:
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(CACHE_DIR, f"neerslag_{nr}.csv")
    vandaag    = datetime.now().strftime("%Y%m%d")

    cache_geldig = False
    if os.path.exists(cache_path):
        leeftijd     = (datetime.now() - datetime.fromtimestamp(os.path.getmtime(cache_path))).days
        cache_geldig = leeftijd < 3

    if not cache_geldig:
        params = urllib.parse.urlencode({
            "stns": nr, "start": START_DATE, "end": vandaag, "fmt": "csv",
        })
        url = f"{BASE_URL}?{params}"
        print(f"  Downloaden: stn {nr} ({STATION_NAMEN[nr]})")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                tekst = resp.read().decode("utf-8", errors="replace")
            with open(cache_path, "w", encoding="utf-8") as f:
                f.write(tekst)
        except Exception as e:
            print(f"  FOUT bij downloaden station {nr}: {e}")
            if not os.path.exists(cache_path):
                return pd.DataFrame()
            # Oude cache is beter dan een P13 met een station te weinig.
            print(f"  Verouderde cache gebruikt voor stn {nr}")
            with open(cache_path, "r", encoding="utf-8") as f:
                tekst = f.read()
    else:
        print(f"  Cache: stn {nr} ({STATION_NAMEN[nr]})")
        with open(cache_path, "r", encoding="utf-8") as f:
            tekst = f.read()

    return parse_neerslag_csv(tekst, nr)


def parse_neerslag_csv(tekst: str, nr: str) -> pd.DataFrame:
    rows = []
    for line in tekst.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3:
            continue
        try:
            datum_str = parts[1]
            rd_raw    = parts[2]
            if not datum_str or not rd_raw:
                continue
            datum    = datetime.strptime(datum_str, "%Y%m%d").date()
            rd_tiende = int(rd_raw)
            rh_mm    = max(rd_tiende, 0) / 10.0   # -1 (spoor) → 0.0
            rows.append({"datum": datum, "rh_mm": rh_mm})
        except (ValueError, IndexError):
            continue

    if not rows:
        print(f"  WAARSCHUWING: geen geldige regels voor station {nr}")
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["datum"] = pd.to_datetime(df["datum"])
    return df.set_index("datum").sort_index()


def laad_alle_stations() -> pd.DataFrame:
    """Eén kolom per P13-slot, met per datum het station dat dan meetelt."""
    print("P13 stations laden...")
    codes  = sorted({code for _, reeks in P13_SLOTS for code, _, _ in reeks})
    frames = {}
    for nr in codes:
        df = download_station(nr)
        if df.empty:
            # Zonder dit station zou P13 stilletjes over 12 stations middelen.
            raise RuntimeError(
                f"Station {nr} ({STATION_NAMEN[nr]}) niet geladen; P13 niet berekend.\n"
                "Controleer of https://daggegevens.knmi.nl bereikbaar is."
            )
        frames[nr] = df["rh_mm"]

    slots = {naam: pd.concat([frames[code].loc[van:tot] for code, van, tot in reeks])
             for naam, reeks in P13_SLOTS}
    combined = pd.DataFrame(slots).sort_index().loc[pd.Timestamp(START_DATE):]
    print(f"  Geladen: {len(codes)} stations in 13 slots, "
          f"{combined.index[0].year}–{combined.index[-1].year}, "
          f"{len(combined)} dagen")
    return combined


# ── Daggemiddelde P13 ─────────────────────────────────────────────────────────

def bereken_daggemiddelde(combined: pd.DataFrame) -> pd.DataFrame:
    count     = combined.notna().sum(axis=1)
    # Afronden haalt float-ruis weg (0,99999… i.p.v. 1,0) bij de drempels ≥1,0 en <0,1 mm
    gemiddeld = combined.mean(axis=1).round(6)
    return pd.DataFrame({"rh_mm": gemiddeld, "n_stations": count})[count >= MIN_STATIONS]


# ── Hulpfuncties ──────────────────────────────────────────────────────────────

def decade_label(maand: int, dag: int) -> str:
    suffix = "I" if dag <= 10 else ("II" if dag <= 20 else "III")
    return f"{MAANDEN_NL[maand][:3]} {suffix}"

def seizoen_van(maand: int) -> str:
    for naam, maanden in SEIZOENEN.items():
        if maand in maanden:
            return naam
    return "?"

def seizoen_jaar(ts: pd.Timestamp) -> str:
    s = seizoen_van(ts.month)
    y = ts.year + 1 if (s == "Winter" and ts.month == 12) else ts.year
    return f"{s} {y}"

def top_n(series: pd.Series, n: int = TOP_N, ascending: bool = False) -> list:
    s = series.dropna().sort_values(ascending=ascending)
    return [{"label": str(lbl), "waarde": round(float(v), 1)} for lbl, v in s.head(n).items()]


# ── Record-berekeningen ───────────────────────────────────────────────────────

def dag_records(dag: pd.DataFrame) -> dict:
    s = dag["rh_mm"].copy()
    s.index = s.index.strftime("%d %b %Y")
    return {"natste_dag": top_n(s)}

def decade_records(dag: pd.DataFrame) -> dict:
    dag = dag.loc[complete_days(dag["rh_mm"], "decade").index]
    labels = dag.index.to_series().apply(lambda d: f"{decade_label(d.month, d.day)} {d.year}")
    return {"natste_decade": top_n(dag["rh_mm"].groupby(labels).sum())}

def maand_records(dag: pd.DataFrame) -> dict:
    dag = dag.loc[complete_days(dag["rh_mm"], "month").index]
    maand = dag["rh_mm"].groupby(dag.index.to_period("M")).sum()
    maand.index = [f"{MAANDEN_NL[p.month]} {p.year}" for p in maand.index]
    return {
        "natste_maand":   top_n(maand),
        "droogste_maand": top_n(maand, ascending=True),
    }

def seizoen_records(dag: pd.DataFrame) -> dict:
    dag = dag.loc[complete_days(dag["rh_mm"], "season").index]
    labels     = dag.index.to_series().apply(seizoen_jaar)
    sei_som    = dag["rh_mm"].groupby(labels).sum()
    sei_counts = dag["rh_mm"].groupby(labels).count()
    sei_som    = sei_som[sei_counts >= 70]
    result     = {}
    for naam in SEIZOENEN:
        subset = sei_som[[s for s in sei_som.index if s.startswith(naam)]]
        result[f"natste_{naam.lower()}"]   = top_n(subset)
        result[f"droogste_{naam.lower()}"] = top_n(subset, ascending=True)
    return result

def jaar_records(dag: pd.DataFrame) -> dict:
    dag = dag.loc[complete_days(dag["rh_mm"], "year").index]
    som    = dag["rh_mm"].groupby(dag.index.year).sum()
    counts = dag["rh_mm"].groupby(dag.index.year).count()
    som    = som[counts >= 300]
    som.index = som.index.astype(str)
    return {"natste_jaar": top_n(som), "droogste_jaar": top_n(som, ascending=True)}

def droge_natte_periodes(dag: pd.DataFrame, top: int = 10) -> dict:
    def vind_reeksen(mask: pd.Series) -> list:
        reeksen = []
        start = prev = None
        for datum, val in mask.items():
            # Breek reeks als er een dag ontbreekt in de tijdreeks
            if prev is not None and (datum - prev).days > 1:
                if start is not None:
                    reeksen.append({"start": start.strftime("%d %b %Y"),
                                    "eind":  prev.strftime("%d %b %Y"),
                                    "dagen": (prev - start).days + 1})
                start = None
            if val:
                if start is None:
                    start = datum
            else:
                if start is not None:
                    reeksen.append({"start": start.strftime("%d %b %Y"),
                                    "eind":  prev.strftime("%d %b %Y"),
                                    "dagen": (prev - start).days + 1})
                    start = None
            prev = datum
        if start is not None:
            eind = dag.index[-1]
            reeksen.append({"start": start.strftime("%d %b %Y"),
                             "eind":  eind.strftime("%d %b %Y"),
                             "dagen": (eind - start).days + 1})
        return sorted(reeksen, key=lambda x: -x["dagen"])[:top]

    rh = dag["rh_mm"]
    return {
        "langste_droge_periode": vind_reeksen(rh < 0.1),
        "langste_natte_periode": vind_reeksen(rh >= 1.0),
    }

def jaar_statistieken(dag: pd.DataFrame) -> list:
    huidig_jaar = dag.index[-1].year
    result = []
    for jaar, grp in dag.groupby(dag.index.year):
        n_dagen = grp["rh_mm"].count()
        # Volledige jaren: minstens 300 dagen vereist
        # Lopend jaar: altijd opnemen (markeren als onvolledig)
        if n_dagen < 300 and jaar != huidig_jaar:
            continue
        entry = {
            "jaar":          int(jaar),
            "jaarsom":       round(float(grp["rh_mm"].sum()), 1),
            "max_dag":       round(float(grp["rh_mm"].max()), 1),
            "max_dag_datum": grp["rh_mm"].idxmax().strftime("%d %b"),
            "neerslagdagen": int((grp["rh_mm"] >= 1.0).sum()),
        }
        if n_dagen < (366 if pd.Timestamp(int(jaar), 1, 1).is_leap_year else 365):
            entry["onvolledig"] = True
            entry["dagen"] = int(n_dagen)
            entry["tm_datum"] = grp.index[-1].strftime("%d %b")
        result.append(entry)
    return result


def maand_statistieken(dag: pd.DataFrame) -> dict:
    """Per jaar een lijst van 12 maanden met som, max dag, neerslagdagen."""
    result = {}
    for (jaar, maand), grp in dag.groupby([dag.index.year, dag.index.month]):
        key = str(jaar)
        if key not in result:
            result[key] = []
        dagwaarden = [{"dag": int(d.day), "mm": round(float(v), 1)}
                      for d, v in grp["rh_mm"].items()]
        result[key].append({
            "maand":         int(maand),
            "naam":          MAANDEN_NL[maand][:3],
            "som":           round(float(grp["rh_mm"].sum()), 1),
            "max_dag":       round(float(grp["rh_mm"].max()), 1),
            "max_dag_datum": grp["rh_mm"].idxmax().strftime("%d"),
            "neerslagdagen": int((grp["rh_mm"] >= 1.0).sum()),
            "dagen":         int(grp["rh_mm"].count()),
            "dagwaarden":    dagwaarden,
        })
    return result


# ── Hoofdprogramma ────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("knmi_p13.py — Landelijk neerslaggemiddelde P13")
    print("=" * 60)

    combined = laad_alle_stations()

    print("\nDaggemiddelde P13 berekenen...")
    dag = bereken_daggemiddelde(combined)
    print(f"  Geldige dagen : {len(dag)}")
    print(f"  Periode       : {dag.index[0].date()} – {dag.index[-1].date()}")
    print(f"  Gem. stations : {dag['n_stations'].mean():.1f}/13 per dag")

    print("\nRecords berekenen...")
    records = {}
    records.update(dag_records(dag))
    records.update(decade_records(dag))
    records.update(maand_records(dag))
    records.update(seizoen_records(dag))
    records.update(jaar_records(dag))
    records.update(droge_natte_periodes(dag))

    print("Jaaroverzicht berekenen...")
    jaaroverzicht = jaar_statistieken(dag)

    print("Maandoverzicht berekenen...")
    maandoverzicht = maand_statistieken(dag)

    output = {
        "meta": {
            "stations":      P13_STATIONS,
            "stationswissels": [
                {"slot": naam, "stn": code, "naam": STATION_NAMEN[code], "van": van, "tot": tot}
                for naam, reeks in P13_SLOTS if len(reeks) > 1
                for code, van, tot in reeks
            ],
            "periode_start": dag.index[0].strftime("%Y-%m-%d"),
            "periode_eind":  dag.index[-1].strftime("%Y-%m-%d"),
            "min_stations":  MIN_STATIONS,
            "top_n":         TOP_N,
            "gegenereerd":   datetime.now().strftime("%Y-%m-%d %H:%M"),
        },
        "records":       records,
        "jaaroverzicht": jaaroverzicht,
        "maandoverzicht": maandoverzicht,
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n✓ Geschreven naar: {OUTPUT_JSON}")

    # Schrijf ook als JS-variabele (voor lokaal openen zonder webserver)
    output_js = os.path.join(SCRIPT_DIR, "p13_records.js")
    with open(output_js, "w", encoding="utf-8") as f:
        f.write("const P13_DATA = ")
        json.dump(output, f, ensure_ascii=False, indent=2)
        f.write(";\n")
    print(f"✓ Geschreven naar: {output_js}")

    print("\n── Top-5 natste jaren ──")
    for r in records["natste_jaar"][:5]:
        print(f"  {r['label']}: {r['waarde']} mm")
    print("\n── Top-5 droogste jaren ──")
    for r in records["droogste_jaar"][:5]:
        print(f"  {r['label']}: {r['waarde']} mm")
    print("\n── Top-5 natste dagen ──")
    for r in records["natste_dag"][:5]:
        print(f"  {r['label']}: {r['waarde']} mm")
    print("\n── Langste droge periodes ──")
    for r in records["langste_droge_periode"][:3]:
        print(f"  {r['start']} – {r['eind']}: {r['dagen']} dagen")


if __name__ == "__main__":
    main()
    # The pages read these feeds from R2; every scheduled export must publish.
    subprocess.run(["bash", os.path.join(SCRIPT_DIR, "shell", "r2_publish.sh"), OUTPUT_JSON], check=True)
