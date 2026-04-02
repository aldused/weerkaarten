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


SEIZOEN_NAMEN = {"winter": "winter", "lente": "lente", "zomer": "zomer", "herfst": "herfst"}

def seizoen_van_maand(mnd):
    if mnd in (12, 1, 2):  return "winter"
    if mnd in (3, 4, 5):   return "lente"
    if mnd in (6, 7, 8):   return "zomer"
    return "herfst"

def seizoen_label(seizoen, jaar, mnd):
    if seizoen == "winter":
        if mnd == 12:
            return f"winter {jaar}/{jaar+1}"
        else:
            return f"winter {jaar-1}/{jaar}"
    return f"{seizoen} {jaar}"

def seizoen_key(seizoen, jaar, mnd):
    """Geeft een unieke sleutel voor een meteorologisch seizoen."""
    if seizoen == "winter":
        if mnd == 12:
            return (seizoen, jaar)
        else:
            return (seizoen, jaar - 1)
    return (seizoen, jaar)


def bereken_records(data):
    dag_data  = {}
    dec_data  = defaultdict(float)
    mnd_data  = defaultdict(float)
    seizoen_data = defaultdict(float)
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
        sz   = seizoen_van_maand(mnd)
        sz_key = seizoen_key(sz, jaar, mnd)

        dag_data[d]              = dag_data.get(d, 0) + rd_mm
        dec_data[(jaar,mnd,dec)] += rd_mm
        mnd_data[(jaar,mnd)]     += rd_mm
        seizoen_data[sz_key]     += rd_mm
        jaar_data[jaar]          += rd_mm

    dag_alle = sorted(
        [{"waarde": round(v,1), "datum": f"{k[:4]}-{k[4:6]}-{k[6:8]}"}
         for k,v in dag_data.items()],
        key=lambda x: -x["waarde"]
    )

    dec_alle = sorted([
        {"waarde": round(v,1),
         "label": f"{NL_MND[k[1]]} decade {k[2]}, {k[0]}",
         "jaar": k[0], "mnd": k[1], "dec": k[2]}
        for k,v in dec_data.items()
    ], key=lambda x: -x["waarde"])

    mnd_alle = sorted([
        {"waarde": round(v,1),
         "label": f"{NL_MND_LANG[k[1]]} {k[0]}",
         "jaar": k[0], "mnd": k[1]}
        for k,v in mnd_data.items()
    ], key=lambda x: -x["waarde"])

    seizoen_alle = sorted([
        {"waarde": round(v,1),
         "label": f"{k[0]} {k[1]}" + (f"/{k[1]+1}" if k[0] == "winter" else ""),
         "seizoen": k[0], "jaar": k[1]}
        for k,v in seizoen_data.items()
    ], key=lambda x: -x["waarde"])

    jaar_alle = sorted([
        {"waarde": round(v,1), "jaar": k}
        for k,v in jaar_data.items()
    ], key=lambda x: -x["waarde"])

    sneeuw_alle = sorted([
        {"waarde": rij["sx"], "datum": f"{rij['d'][:4]}-{rij['d'][4:6]}-{rij['d'][6:8]}"}
        for rij in data if rij.get("sx") and 0 < rij["sx"] <= 200
    ], key=lambda x: -x["waarde"])

    # Jaarsommen voor grafiek (gesorteerd op jaar)
    jaar_reeks = sorted([
        {"jaar": k, "mm": round(v, 1)}
        for k, v in jaar_data.items()
    ], key=lambda x: x["jaar"])

    return {
        "dag": dag_alle[:TOP_N], "decade": dec_alle[:TOP_N],
        "maand": mnd_alle[:TOP_N], "seizoen": seizoen_alle[:TOP_N],
        "jaar": jaar_alle[:TOP_N], "sneeuw": sneeuw_alle[:TOP_N],
        "jaar_reeks": jaar_reeks,
        "_dag": dag_alle, "_decade": dec_alle,
        "_maand": mnd_alle, "_seizoen": seizoen_alle,
        "_jaar": jaar_alle, "_sneeuw": sneeuw_alle,
    }


def bereken_landelijk(alle_records, stations):
    dag_alle = []; dec_alle = []; mnd_alle = []
    seizoen_alle = []; jaar_alle = []; sneeuw_alle = []

    for nr_str, rec in alle_records.items():
        info = stations.get(nr_str, {})
        naam = info.get("naam", f"Station {nr_str}")
        for r in rec.get("_dag",     rec.get("dag", [])):     dag_alle.append({**r,     "station": nr_str, "naam": naam})
        for r in rec.get("_decade",  rec.get("decade", [])):  dec_alle.append({**r,     "station": nr_str, "naam": naam})
        for r in rec.get("_maand",   rec.get("maand", [])):   mnd_alle.append({**r,     "station": nr_str, "naam": naam})
        for r in rec.get("_seizoen", rec.get("seizoen", [])): seizoen_alle.append({**r, "station": nr_str, "naam": naam})
        for r in rec.get("_jaar",    rec.get("jaar", [])):    jaar_alle.append({**r,    "station": nr_str, "naam": naam})
        for r in rec.get("_sneeuw",  rec.get("sneeuw", [])):  sneeuw_alle.append({**r,  "station": nr_str, "naam": naam})

    # Per unieke periode alleen de top 3 stations bewaren (beheersbare grootte)
    def top_per_groep(items, sleutel_fn, n=3):
        groepen = defaultdict(list)
        for r in items:
            groepen[sleutel_fn(r)].append(r)
        resultaat = []
        for vals in groepen.values():
            vals.sort(key=lambda x: -x["waarde"])
            resultaat.extend(vals[:n])
        resultaat.sort(key=lambda x: -x["waarde"])
        return resultaat

    return {
        "dag":     top_per_groep(dag_alle,     lambda r: r["datum"][:7], n=10),  # top 10 per maand
        "decade":  top_per_groep(dec_alle,     lambda r: (r["jaar"], r["mnd"], r["dec"]), n=10),
        "maand":   top_per_groep(mnd_alle,     lambda r: (r["jaar"], r["mnd"]), n=10),
        "seizoen": top_per_groep(seizoen_alle, lambda r: (r["jaar"], r["seizoen"]), n=10),
        "jaar":    top_per_groep(jaar_alle,    lambda r: r["jaar"], n=10),
        "sneeuw":  top_per_groep(sneeuw_alle,  lambda r: r["datum"][:7], n=10),
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

    alle_records = {}  # Forceer herberekening van alle stations

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

    # Verwijder volledige data (_keys) uit per-station output (alleen top N behouden)
    stations_export = {
        nr: {k: v for k, v in rec.items() if not k.startswith("_")}
        for nr, rec in alle_records.items()
    }

    output = {
        "stations": stations_export,
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
