#!/usr/bin/env python3
"""
knmi_neerslag_records.py
Records voor KNMI neerslagstations via ZIP bestanden.
ZIP URL: cdn.knmi.nl/knmi/map/page/klimatologie/gegevens/monv_reeksen/neerslaggeg_NAAM_NR.zip
Output: neerslag_records.json
Verwerkt max 10 stations per run (caching).
"""

import os, json, time, re, requests, zipfile, io
from datetime import date, datetime
from collections import defaultdict

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

CACHE_DIR      = "neerslag_cache"
OUTPUT_JSON    = "neerslag_records.json"
STATIONS_CACHE = "neerslag_cache/stations_lijst.json"
ZIP_BASE       = "https://cdn.knmi.nl/knmi/map/page/klimatologie/gegevens/monv_reeksen/"
PAGINA_URL     = "https://www.knmi.nl/nederland-nu/klimatologie/monv/reeksen"
TOP_N          = 25
MAX_PER_RUN    = 200

os.makedirs(CACHE_DIR, exist_ok=True)

NL_MND = ["","jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"]
NL_MND_LANG = ["","januari","februari","maart","april","mei","juni","juli",
               "augustus","september","oktober","november","december"]

def haal_stations_van_pagina():
    if os.path.exists(STATIONS_CACHE):
        mtime = os.path.getmtime(STATIONS_CACHE)
        if (time.time() - mtime) < 86400 * 7:
            with open(STATIONS_CACHE) as f:
                return json.load(f)

    print("Stationslijst ophalen van KNMI pagina...")
    r = requests.get(PAGINA_URL, timeout=60)
    html = r.text
    pattern = r'neerslaggeg_([A-Z0-9\-]+)_(\d+)\.zip'
    matches = re.findall(pattern, html)

    stations = {}
    for naam_raw, nr in matches:
        nr_int = int(nr)
        naam = naam_raw.replace("-", " ").title()
        stations[str(nr_int)] = {
            "nr": nr_int,
            "naam": naam,
            "zip_naam": naam_raw,
            "zip_nr": nr.zfill(3)
        }

    print(f"  {len(stations)} stations gevonden")
    with open(STATIONS_CACHE, "w") as f:
        json.dump(stations, f, ensure_ascii=False)
    return stations


def haal_station_data(stn_info):
    nr     = stn_info["nr"]
    naam   = stn_info["zip_naam"]
    zip_nr = stn_info["zip_nr"]
    cache_file = os.path.join(CACHE_DIR, f"nrs_{nr}.json")

    if os.path.exists(cache_file):
        mtime = os.path.getmtime(cache_file)
        if (time.time() - mtime) < 86400 * 30:
            with open(cache_file) as f:
                return json.load(f)

    url = f"{ZIP_BASE}neerslaggeg_{naam}_{zip_nr}.zip"
    try:
        r = requests.get(url, timeout=60)
        if r.status_code != 200:
            return None
        z = zipfile.ZipFile(io.BytesIO(r.content))
        txtfile = next((n for n in z.namelist() if n.endswith(".txt")), None)
        if not txtfile:
            return None
        tekst = z.read(txtfile).decode("latin-1")
        return parse_neerslag_txt(tekst, cache_file)
    except Exception as e:
        print(f"    Fout {nr} {naam}: {e}")
        return None


def parse_neerslag_txt(tekst, cache_file):
    data = []
    for regel in tekst.splitlines():
        regel = regel.strip()
        if not regel or regel.startswith("#") or regel.startswith("STN"):
            continue
        delen = [d.strip() for d in regel.split(",")]
        if len(delen) < 3:
            continue
        try:
            datum = delen[1]
            if len(datum) != 8:
                continue
            rd_raw = delen[2]
            sx_raw = delen[3] if len(delen) > 3 else ""
            rd = int(rd_raw) if rd_raw else None
            sx = int(sx_raw) if sx_raw else None
            if rd is not None and rd >= 0:
                data.append({"d": datum, "rd": rd, "sx": sx})
        except:
            continue
    with open(cache_file, "w") as f:
        json.dump(data, f)
    return data


def bereken_records(data):
    dag_data  = {}
    dec_data  = defaultdict(float)
    mnd_data  = defaultdict(float)
    jaar_data = defaultdict(float)

    for rij in data:
        rd = rij["rd"]
        if rd is None or rd < 0:
            continue
        rd_mm = rd / 10.0
        d    = rij["d"]
        jaar = int(d[:4])
        mnd  = int(d[4:6])
        dag  = int(d[6:8])
        dec  = 1 if dag <= 10 else (2 if dag <= 20 else 3)

        dag_data[d]              = dag_data.get(d, 0) + rd_mm
        dec_data[(jaar,mnd,dec)] += rd_mm
        mnd_data[(jaar,mnd)]     += rd_mm
        jaar_data[jaar]          += rd_mm

    dag_top = sorted(
        [{"waarde": round(v,1), "datum": f"{k[:4]}-{k[4:6]}-{k[6:8]}"}
         for k,v in dag_data.items()],
        key=lambda x: -x["waarde"]
    )[:TOP_N]

    dec_top = sorted([
        {"waarde": round(v,1),
         "label": f"{NL_MND[k[1]]} decade {k[2]}, {k[0]}",
         "jaar": k[0], "mnd": k[1], "dec": k[2]}
        for k,v in dec_data.items()
    ], key=lambda x: -x["waarde"])[:TOP_N]

    mnd_top = sorted([
        {"waarde": round(v,1),
         "label": f"{NL_MND_LANG[k[1]]} {k[0]}",
         "jaar": k[0], "mnd": k[1]}
        for k,v in mnd_data.items()
    ], key=lambda x: -x["waarde"])[:TOP_N]

    jaar_top = sorted([
        {"waarde": round(v,1), "jaar": k}
        for k,v in jaar_data.items()
    ], key=lambda x: -x["waarde"])[:TOP_N]

    sneeuw_top = sorted([
        {"waarde": rij["sx"], "datum": f"{rij['d'][:4]}-{rij['d'][4:6]}-{rij['d'][6:8]}"}
        for rij in data if rij.get("sx") and 0 < rij["sx"] <= 200
    ], key=lambda x: -x["waarde"])[:TOP_N]

    # Jaarsommen voor grafiek (gesorteerd op jaar)
    jaar_reeks = sorted([
        {"jaar": k, "mm": round(v, 1)}
        for k, v in jaar_data.items()
    ], key=lambda x: x["jaar"])

    return {
        "dag": dag_top, "decade": dec_top,
        "maand": mnd_top, "jaar": jaar_top,
        "sneeuw": sneeuw_top,
        "jaar_reeks": jaar_reeks
    }


def bereken_landelijk(alle_records, stations):
    dag_alle = []; dec_alle = []; mnd_alle = []
    jaar_alle = []; sneeuw_alle = []

    for nr_str, rec in alle_records.items():
        info = stations.get(nr_str, {})
        naam = info.get("naam", f"Station {nr_str}")
        for r in rec.get("dag",    []): dag_alle.append({**r,    "station": nr_str, "naam": naam})
        for r in rec.get("decade", []): dec_alle.append({**r,    "station": nr_str, "naam": naam})
        for r in rec.get("maand",  []): mnd_alle.append({**r,    "station": nr_str, "naam": naam})
        for r in rec.get("jaar",   []): jaar_alle.append({**r,   "station": nr_str, "naam": naam})
        for r in rec.get("sneeuw", []): sneeuw_alle.append({**r, "station": nr_str, "naam": naam})

    return {
        "dag":    sorted(dag_alle,    key=lambda x: -x["waarde"])[:TOP_N],
        "decade": sorted(dec_alle,    key=lambda x: -x["waarde"])[:TOP_N],
        "maand":  sorted(mnd_alle,    key=lambda x: -x["waarde"])[:TOP_N],
        "jaar":   sorted(jaar_alle,   key=lambda x: -x["waarde"])[:TOP_N],
        "sneeuw": sorted(sneeuw_alle, key=lambda x: -x["waarde"])[:TOP_N],
    }


def main():
    t0 = time.time()
    print(f"=== KNMI Neerslag Records === {datetime.now():%Y-%m-%d %H:%M}")

    stations = haal_stations_van_pagina()

    if os.path.exists(OUTPUT_JSON):
        with open(OUTPUT_JSON) as f:
            output = json.load(f)
    else:
        output = {"stations": {}, "landelijk": {}, "bijgewerkt": ""}

    alle_records = output.get("stations", {})

    verwerkt = 0
    for nr_str, info in sorted(stations.items(), key=lambda x: int(x[0])):
        cache_file = os.path.join(CACHE_DIR, f"nrs_{info['nr']}.json")
        if os.path.exists(cache_file):
            mtime = os.path.getmtime(cache_file)
            if (time.time() - mtime) < 86400 * 30:
                # Cache is geldig — laad alsnog in alle_records als nog niet aanwezig
                if nr_str not in alle_records:
                    with open(cache_file) as cf:
                        cached = json.load(cf)
                    if cached:
                        alle_records[nr_str] = bereken_records(cached)
                continue

        print(f"  [{verwerkt+1}/{MAX_PER_RUN}] Stn {info['nr']}: {info['naam']}...")
        data = haal_station_data(info)
        if data:
            alle_records[nr_str] = bereken_records(data)
            verwerkt += 1
        else:
            open(cache_file, "w").write("[]")

        if verwerkt >= MAX_PER_RUN:
            break

    print(f"Landelijke records berekenen over {len(alle_records)} stations...")
    landelijk = bereken_landelijk(alle_records, stations)

    stationsnamen = {k: v["naam"] for k, v in stations.items()}

    output = {
        "stations": alle_records,
        "landelijk": landelijk,
        "stationsnamen": stationsnamen,
        "bijgewerkt": datetime.now().isoformat(),
        "n_stations": len(alle_records),
        "n_totaal": len(stations)
    }
    with open(OUTPUT_JSON, "w") as f:
        json.dump(output, f, ensure_ascii=False)

    print(f"Klaar! {verwerkt} nieuw, {len(alle_records)} totaal van {len(stations)}.")
    print(f"Tijd: {time.time()-t0:.0f}s")

if __name__ == "__main__":
    main()
