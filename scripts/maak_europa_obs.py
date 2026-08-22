"""
maak_europa_obs.py

Actuele waarnemingen Europa, 2 bronnen samengevoegd:
  1. METAR via aviationweather.gov  (vooral luchthavens, T/Td/wind/QNH/zicht/wx)
  2. DWD POI synoptische CSV's      (~615 EU stations, T/Td/wind/druk/RR1h/RR3h/RR6h/RR24h/wx)

Coördinaten voor DWD-stations komen uit weerlab/data/wmo_stations_eu.json
(NOAA ISD-history subset).

Output: weerlab/data/europa_obs.json
"""

import os, json, time, sys, traceback, re
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT  = os.path.join(ROOT, "data", "europa_obs.json")
WMO_META = os.path.join(ROOT, "data", "wmo_stations_eu.json")

UA = {"User-Agent": "weerlab.nl europa-obs (ed@aldus.nl)"}

# ───────────────────────────────────────────────────────────── METAR
METAR_BBOXES = [
    (28,-30,45,  0), (28,  0,45, 15), (28, 15,45, 35), (28, 35,45, 50),
    (45,-30,60,  0), (45,  0,60, 15), (45, 15,60, 30), (45, 30,60, 50),
    (60,-30,72, 15), (60, 15,72, 50),
]

def fetch_metar_bbox(bb, retries=2):
    url = (f"https://aviationweather.gov/api/data/metar"
           f"?bbox={bb[0]},{bb[1]},{bb[2]},{bb[3]}&format=json&hours=2")
    for i in range(retries+1):
        try:
            r = requests.get(url, headers=UA, timeout=25)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if i == retries:
                print(f"  FAIL bbox {bb}: {e}", file=sys.stderr)
                return []
            time.sleep(2)

def collect_metar():
    obs = {}
    for bb in METAR_BBOXES:
        for m in fetch_metar_bbox(bb):
            k = m.get("icaoId")
            if not k: continue
            if k in obs and obs[k].get("obsTime",0) >= m.get("obsTime",0):
                continue
            obs[k] = m
        time.sleep(0.3)

    out = []
    for m in obs.values():
        if m.get("temp") is None or m.get("lat") is None or m.get("lon") is None:
            continue
        out.append({
            "id":     m["icaoId"],
            "naam":   shorten_name(m.get("name","")),
            "lat":    round(m["lat"], 3),
            "lon":    round(m["lon"], 3),
            "t":      _f(m.get("temp")),
            "td":     _f(m.get("dewp")),
            "wdir":   m["wdir"] if isinstance(m.get("wdir"),(int,float)) else None,
            "wkn":    m.get("wspd"),
            "p":      _f(m.get("altim")),
            "rr1":    None, "rr3": None, "rr6": None, "rr24": None,
            "vis":    m.get("visib"),
            "wx":     m.get("wxString") or "",
            "ts":     datetime.fromtimestamp(m["obsTime"], tz=timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "src":    "METAR",
        })
    return out

def shorten_name(raw):
    if not raw: return ""
    s = raw.split(",")[0]
    for kill in (" Airport", " Arpt", " Intl", " Air Base", " AB"):
        s = s.replace(kill, "")
    return s.strip()

def _f(x):
    try: return None if x is None else round(float(x), 1)
    except: return None

# ───────────────────────────────────────────────────────────── DWD POI
DWD_INDEX = "https://opendata.dwd.de/weather/weather_reports/poi/"
DWD_FILE  = DWD_INDEX + "{}-BEOB.csv"

# Kolomvolgorde POI CSV (geverifieerd op 10637-BEOB):
#  0 Datum, 1 Uhrzeit UTC, 2 cloud_cover, 5 Td_2m, 9 T_2m, 14 visibility_km,
# 22 wind_dir, 23 wind_speed_kmh,
# 30 RR_24h, 31 RR_3h, 32 RR_6h, 33 RR_1h, 34 RR_12h,
# 35 present_weather, 36 pressure_msl_hPa, 37 RH_pct

def fetch_poi(wmo_id, meta):
    """Return latest valid hourly observation as dict, or None."""
    try:
        r = requests.get(DWD_FILE.format(wmo_id), headers=UA, timeout=15)
        if r.status_code != 200: return None
        lines = r.text.splitlines()
        if len(lines) < 5: return None
        # Eerste 3 regels = header (params/units/labels), daarna data nieuwste eerst
        for row in lines[3:]:
            cols = row.split(";")
            if len(cols) < 35: continue
            t = parse_num(cols[9])
            if t is None: continue
            try:
                # "29.04.26;14:00"
                d, hh = cols[0], cols[1]
                dd, mm, yy = d.split(".")
                year = 2000 + int(yy) if int(yy) < 70 else 1900 + int(yy)
                h, mi = hh.split(":")
                ts = datetime(year, int(mm), int(dd), int(h), int(mi), tzinfo=timezone.utc)
            except Exception:
                continue
            wdir = parse_num(cols[22])
            wkmh = parse_num(cols[23])
            wkn  = round(wkmh / 1.852, 0) if wkmh is not None else None
            vis_km = parse_num(cols[14])
            return {
                "id":   "WMO" + wmo_id,
                "naam": meta["name"].title(),
                "lat":  round(meta["lat"], 3),
                "lon":  round(meta["lon"], 3),
                "t":    t,
                "td":   parse_num(cols[5]),
                "wdir": int(wdir) if wdir is not None else None,
                "wkn":  int(wkn)  if wkn  is not None else None,
                "p":    parse_num(cols[36]),
                "rr1":  parse_num(cols[33]),
                "rr3":  parse_num(cols[31]),
                "rr6":  parse_num(cols[32]),
                "rr24": parse_num(cols[30]),
                "vis":  f"{vis_km:.0f} km" if vis_km is not None else None,
                "wx":   cols[35] if cols[35] != "---" else "",
                "ts":   ts.strftime("%Y-%m-%dT%H:%MZ"),
                "src":  "SYNOP",
            }
        return None
    except Exception:
        return None

def parse_num(s):
    if s is None: return None
    s = s.strip()
    if not s or s == "---": return None
    try:
        return round(float(s.replace(",", ".")), 1)
    except:
        return None

def collect_dwd_poi(meta_lookup):
    """Fetch index, parallel-fetch each station that has WMO metadata."""
    try:
        idx = requests.get(DWD_INDEX, headers=UA, timeout=20).text
    except Exception as e:
        print(f"  POI index fail: {e}", file=sys.stderr)
        return []
    files = re.findall(r'href="(\d+)-BEOB\.csv"', idx)
    targets = [(wid, meta_lookup[wid]) for wid in files if wid in meta_lookup]
    print(f"  POI: {len(files)} files, {len(targets)} met EU-coords")
    out = []
    with ThreadPoolExecutor(max_workers=24) as ex:
        futs = {ex.submit(fetch_poi, wid, m): wid for wid, m in targets}
        for f in as_completed(futs):
            r = f.result()
            if r: out.append(r)
    return out

# ───────────────────────────────────────────────────────────── Merge
def merge(metar, synop):
    """METAR heeft voorrang voor luchthavens; SYNOP vult de rest aan.
    Dedup op coord-rasters van ~10 km."""
    out = list(metar)
    occupied = {(round(s["lat"]*10), round(s["lon"]*10)) for s in metar}
    for s in synop:
        key = (round(s["lat"]*10), round(s["lon"]*10))
        if key in occupied: continue
        out.append(s)
        occupied.add(key)
    return out

# ───────────────────────────────────────────────────────────── Main
def main():
    print("→ METAR ophalen…")
    metar = collect_metar()
    print(f"  {len(metar)} METAR stations")

    print("→ DWD POI metadata laden…")
    meta_list = json.load(open(WMO_META))
    meta_lookup = {m["wmo"]: m for m in meta_list}

    print("→ DWD POI ophalen (parallel)…")
    t0 = time.time()
    synop = collect_dwd_poi(meta_lookup)
    print(f"  {len(synop)} SYNOP stations in {time.time()-t0:.1f}s")

    merged = merge(metar, synop)
    merged.sort(key=lambda x: x["id"])

    payload = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sources":   ["aviationweather.gov METAR", "DWD opendata POI SYNOP"],
        "count":     len(merged),
        "count_metar": len(metar),
        "count_synop": len(synop),
        "stations":  merged,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f, separators=(",",":"))
    os.replace(tmp, OUT)
    print(f"OK  {len(merged)} stations totaal → {OUT}")

if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
