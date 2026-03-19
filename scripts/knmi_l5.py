#!/usr/bin/env python3
"""
knmi_l5.py — L5 gemiddelde klimaatrecords
Berekent records op basis van 5 hoofdstations (gemiddelde = Landelijk L5).

Stations:
  De Bilt       260
  Den Helder    235
  Eelde         280
  Vlissingen    310
  Maastricht    380

Parameters: TX, TN, TG (in 0.1°C → °C), RH (in 0.1mm → mm)
Data: etmgeg_{NR}.zip via cdn.knmi.nl

Output: l5_records.json
"""

import os
import json
import zipfile
import urllib.request
import numpy as np
import pandas as pd
from datetime import datetime, date, timedelta

# ── Configuratie ──────────────────────────────────────────────────────────────

L5_STATIONS = {
    235: "Den Helder",
    260: "De Bilt",
    280: "Eelde",
    310: "Vlissingen",
    380: "Maastricht",
}

PARAMS = ["TX", "TN", "TG", "RH"]

BASE_URL   = "https://cdn.knmi.nl/knmi/map/page/klimatologie/gegevens/daggegevens/etmgeg_{nr}.zip"
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # projectroot
CACHE_DIR  = os.path.join(SCRIPT_DIR, "l5_cache")
OUTPUT_JSON = os.path.join(SCRIPT_DIR, "l5_records.json")

TOP_N = 25

SEIZOENEN = {
    "Winter": [12, 1, 2],
    "Lente":  [3, 4, 5],
    "Zomer":  [6, 7, 8],
    "Herfst": [9, 10, 11],
}

MAANDEN_NL = ["", "januari", "februari", "maart", "april", "mei", "juni",
               "juli", "augustus", "september", "oktober", "november", "december"]

PARAM_LABELS = {
    "TX": "Max temperatuur (TX)",
    "TN": "Min temperatuur (TN)",
    "TG": "Gem temperatuur (TG)",
    "RH": "Neerslag (RH)",
}

PARAM_EENHEID = {
    "TX": "°C",
    "TN": "°C",
    "TG": "°C",
    "RH": "mm",
}

# ── Download & parse ──────────────────────────────────────────────────────────

def download_station(nr: int) -> pd.DataFrame:
    """Download etmgeg_{nr}.zip en retourneer DataFrame met TX/TN/TG/RH per dag."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(CACHE_DIR, f"etmgeg_{nr}.zip")

    cache_geldig = False
    if os.path.exists(cache_path):
        leeftijd = (datetime.now() - datetime.fromtimestamp(os.path.getmtime(cache_path))).days
        cache_geldig = leeftijd < 3

    if not cache_geldig:
        url = BASE_URL.format(nr=nr)
        print(f"  Downloaden: [{nr}] {L5_STATIONS[nr]}")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            with open(cache_path, "wb") as f:
                f.write(data)
        except Exception as e:
            print(f"  FOUT: {e}")
            return pd.DataFrame()
    else:
        print(f"  Cache: [{nr}] {L5_STATIONS[nr]}")

    try:
        with zipfile.ZipFile(cache_path) as zf:
            txt_files = [n for n in zf.namelist() if n.lower().endswith(".txt")]
            if not txt_files:
                txt_files = zf.namelist()
            raw = zf.read(txt_files[0]).decode("latin-1")
    except Exception as e:
        print(f"  FOUT bij lezen ZIP: {e}")
        if os.path.exists(cache_path):
            os.remove(cache_path)
        return pd.DataFrame()

    return parse_daggegevens(raw)


def parse_daggegevens(tekst: str) -> pd.DataFrame:
    """Parse KNMI daggegevens CSV. Retourneert DataFrame met datum + TX/TN/TG/RH."""
    kolomnamen = None
    rows = []

    for regel in tekst.splitlines():
        stripped = regel.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            if "STN" in stripped and "YYYYMMDD" in stripped:
                kolomnamen = [k.strip() for k in stripped.lstrip("#").split(",")]
            continue
        if kolomnamen is None:
            continue
        delen = [d.strip() for d in stripped.split(",")]
        if len(delen) < 4:
            continue

        def get(naam):
            try:
                idx = kolomnamen.index(naam)
                v = delen[idx].strip()
                if v == "" or v == "9":
                    return None
                f = float(v)
                if naam == "RH":
                    return 0.0 if f < 0 else f / 10.0
                return f / 10.0  # TX/TN/TG: 0.1°C → °C
            except (ValueError, IndexError):
                return None

        try:
            datum = datetime.strptime(delen[1].strip(), "%Y%m%d").date()
        except (ValueError, IndexError):
            continue

        row = {"datum": datum}
        for p in PARAMS:
            row[p] = get(p)
        rows.append(row)

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["datum"] = pd.to_datetime(df["datum"])
    return df.set_index("datum").sort_index()


def laad_alle_stations() -> dict:
    """Laad alle L5 stations. Retourneert dict {param: DataFrame met kolom per station}."""
    print("L5 stations laden...")
    station_dfs = {}
    for nr in sorted(L5_STATIONS.keys()):
        df = download_station(nr)
        if not df.empty:
            station_dfs[nr] = df

    if not station_dfs:
        raise RuntimeError("Geen stations geladen!")

    # Combineer per parameter
    result = {}
    for param in PARAMS:
        frames = {}
        for nr, df in station_dfs.items():
            if param in df.columns:
                frames[nr] = df[param].rename(nr)
        if frames:
            combined = pd.DataFrame(frames).sort_index()
            result[param] = combined
            print(f"  {param}: {len(combined)} dagen, {combined.index[0].year}–{combined.index[-1].year}")

    return result


# ── L5 gemiddelde ─────────────────────────────────────────────────────────────

def bereken_l5(combined: pd.DataFrame, min_stations: int = 3) -> pd.Series:
    """Gemiddelde van beschikbare stations per dag (min. min_stations geldig)."""
    count = combined.notna().sum(axis=1)
    gemiddeld = combined.mean(axis=1)
    return gemiddeld[count >= min_stations].round(1)


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


# ── Records per parameter ─────────────────────────────────────────────────────

def bereken_records(dag: pd.Series, param: str) -> dict:
    """Berekent alle records voor één parameter-reeks."""
    ascending_params = {"TN", "RH_droog"}  # niet gebruikt hier maar goed om te noteren
    is_temp = param in ("TX", "TN", "TG")
    is_neerslag = param == "RH"

    records = {}

    # Dag records
    s = dag.copy()
    s.index = s.index.strftime("%d %b %Y")
    records["hoogste_dag"] = top_n(s, TOP_N, ascending=False)
    if is_temp:
        records["laagste_dag"] = top_n(s, TOP_N, ascending=True)

    # Decade (gemiddelde per decade voor temp, som voor neerslag)
    labels = dag.index.to_series().apply(lambda d: f"{decade_label(d.month, d.day)} {d.year}")
    if is_neerslag:
        deca = dag.groupby(labels).sum()
        records["hoogste_decade"] = top_n(deca, TOP_N, ascending=False)
    else:
        deca = dag.groupby(labels).mean().round(1)
        records["hoogste_decade"] = top_n(deca, TOP_N, ascending=False)
        records["laagste_decade"] = top_n(deca, TOP_N, ascending=True)

    # Maand
    if is_neerslag:
        maand = dag.groupby(dag.index.to_period("M")).sum()
    else:
        maand = dag.groupby(dag.index.to_period("M")).mean().round(1)
    maand.index = [f"{MAANDEN_NL[p.month]} {p.year}" for p in maand.index]
    records["hoogste_maand"] = top_n(maand, TOP_N, ascending=False)
    if is_temp:
        records["laagste_maand"] = top_n(maand, TOP_N, ascending=True)
    elif is_neerslag:
        records["laagste_maand"] = top_n(maand, TOP_N, ascending=True)

    # Seizoen
    sei_labels = dag.index.to_series().apply(seizoen_jaar)
    if is_neerslag:
        sei = dag.groupby(sei_labels).sum()
    else:
        sei = dag.groupby(sei_labels).mean().round(1)
    sei_counts = dag.groupby(sei_labels).count()
    sei = sei[sei_counts >= 70]

    for naam in SEIZOENEN:
        subset = sei[[s for s in sei.index if s.startswith(naam)]]
        records[f"hoogste_{naam.lower()}"] = top_n(subset, TOP_N, ascending=False)
        records[f"laagste_{naam.lower()}"] = top_n(subset, TOP_N, ascending=True)

    # Jaar
    if is_neerslag:
        jaar = dag.groupby(dag.index.year).sum()
    else:
        jaar = dag.groupby(dag.index.year).mean().round(1)
    jaar_counts = dag.groupby(dag.index.year).count()
    jaar = jaar[jaar_counts >= 300]
    jaar.index = jaar.index.astype(str)
    records["hoogste_jaar"] = top_n(jaar, TOP_N, ascending=False)
    records["laagste_jaar"] = top_n(jaar, TOP_N, ascending=True)

    return records


def jaar_statistieken(param_series: dict) -> list:
    """Per jaar: TX gem, TN gem, TG gem, RH som, warme dagen, ijsdagen, zomerse dagen."""
    # Gebruik TX als referentie voor jaren
    ref = param_series.get("TX") if "TX" in param_series else param_series.get("TG")
    if ref is None:
        return []

    result = []
    for jaar, _ in ref.groupby(ref.index.year):
        row = {"jaar": int(jaar)}
        for param, s in param_series.items():
            grp = s[s.index.year == jaar]
            if grp.count() < 300:
                continue
            if param == "RH":
                row["rh_som"] = round(float(grp.sum()), 1)
                row["neerslagdagen"] = int((grp >= 1.0).sum())
            elif param == "TX":
                row["tx_gem"] = round(float(grp.mean()), 1)
                row["warme_dagen"] = int((grp >= 20.0).sum())
                row["zomerse_dagen"] = int((grp >= 25.0).sum())
                row["tropische_dagen"] = int((grp >= 30.0).sum())
            elif param == "TN":
                row["tn_gem"] = round(float(grp.mean()), 1)
                row["vorst_dagen"] = int((grp < 0.0).sum())
                row["ijs_dagen"] = int((grp < -10.0).sum())
            elif param == "TG":
                row["tg_gem"] = round(float(grp.mean()), 1)
        if len(row) > 1:
            result.append(row)

    return sorted(result, key=lambda x: x["jaar"])


# ── Hoofdprogramma ────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("knmi_l5.py — L5 Landelijk klimaatgemiddelde")
    print("=" * 60)

    # 1. Data laden
    station_data = laad_alle_stations()

    # 2. L5 gemiddelde per parameter
    print("\nL5 gemiddelden berekenen...")
    param_series = {}
    for param, combined in station_data.items():
        s = bereken_l5(combined)
        param_series[param] = s
        print(f"  {param}: {len(s)} geldige dagen, {s.index[0].year}–{s.index[-1].year}")

    # 3. Records per parameter
    print("\nRecords berekenen...")
    alle_records = {}
    for param, s in param_series.items():
        print(f"  {param}...")
        alle_records[param] = bereken_records(s, param)

    # 4. Jaaroverzicht
    print("Jaaroverzicht berekenen...")
    jaaroverzicht = jaar_statistieken(param_series)

    # 5. Metadata
    meta = {
        "stations": {str(nr): naam for nr, naam in L5_STATIONS.items()},
        "params": PARAMS,
        "param_labels": PARAM_LABELS,
        "param_eenheid": PARAM_EENHEID,
        "gegenereerd": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    for param, s in param_series.items():
        meta[f"periode_{param}_start"] = s.index[0].strftime("%Y-%m-%d")
        meta[f"periode_{param}_eind"]  = s.index[-1].strftime("%Y-%m-%d")

    # 6. Output
    output = {
        "meta": meta,
        "records": alle_records,
        "jaaroverzicht": jaaroverzicht,
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\n✓ Geschreven naar: {OUTPUT_JSON}")

    # Samenvatting
    print("\n── Top-5 warmste jaren (TX) ──")
    for r in alle_records["TX"]["hoogste_jaar"][:5]:
        print(f"  {r['label']}: {r['waarde']} °C")
    print("\n── Top-5 koudste jaren (TN) ──")
    for r in alle_records["TN"]["laagste_jaar"][:5]:
        print(f"  {r['label']}: {r['waarde']} °C")
    print("\n── Top-5 natste jaren (RH) ──")
    for r in alle_records["RH"]["hoogste_jaar"][:5]:
        print(f"  {r['label']}: {r['waarde']} mm")


if __name__ == "__main__":
    main()
