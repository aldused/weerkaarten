#!/usr/bin/env python3
"""
fetch_mosmix.py — Download DWD MOSMIX-L voor NL-stations, schrijf JSON.

Output (relatief aan scripts/../data/):
  mosmix_STATION.json  — uurdata per station (48 uur)
  mosmix_stations.json — station-index voor nearest-station lookup in browser

Run: via launchd elke 3 uur (MOSMIX-L update: 03/09/15/21 UTC, ~30 min na run)
"""

import os, sys, json, zipfile, math, tempfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from urllib.request import urlretrieve, urlopen
import urllib.error

# ── Stations ──────────────────────────────────────────────────────────────────
STATIONS = [
    {"id": "06235", "naam": "Den Helder",  "lat": 52.92, "lon": 4.78},
    {"id": "06240", "naam": "Schiphol",    "lat": 52.31, "lon": 4.79},
    {"id": "06260", "naam": "De Bilt",     "lat": 52.10, "lon": 5.18},
    {"id": "06270", "naam": "Leeuwarden", "lat": 53.23, "lon": 5.75},
    {"id": "06280", "naam": "Eelde",       "lat": 53.13, "lon": 6.58},
    {"id": "06290", "naam": "Twente",      "lat": 52.27, "lon": 6.90},
    {"id": "06310", "naam": "Vlissingen",  "lat": 51.44, "lon": 3.60},
    {"id": "06344", "naam": "Rotterdam",   "lat": 51.95, "lon": 4.45},
    {"id": "06350", "naam": "Gilze-Rijen", "lat": 51.57, "lon": 4.93},
    {"id": "06370", "naam": "Eindhoven",   "lat": 51.45, "lon": 5.38},
    {"id": "06380", "naam": "Maastricht",  "lat": 50.91, "lon": 5.76},
]

BASE_URL  = "https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations"
NS_DWD    = "https://opendata.dwd.de/weather/lib/pointforecast_dwd_extension_V1_0.xsd"
NS_KML    = "http://www.opengis.net/kml/2.2"
NS        = {'kml': NS_KML, 'dwd': NS_DWD}

# Parameters te extraheren
WANTED = {'TTT', 'DD', 'FF', 'FX1', 'RR1c', 'R101', 'wwTd', 'N', 'SunD1'}

# ── Hulpfuncties ──────────────────────────────────────────────────────────────

def parse_vals(text):
    out = []
    for v in text.split():
        try:
            out.append(float(v))
        except ValueError:
            out.append(None)
    return out


def fetch_station_tree(station_id):
    url = f"{BASE_URL}/{station_id}/kml/MOSMIX_L_LATEST_{station_id}.kmz"
    with tempfile.NamedTemporaryFile(suffix='.kmz', delete=False) as f:
        tmp = f.name
    try:
        urlretrieve(url, tmp)
        with zipfile.ZipFile(tmp) as z:
            kml_name = next(n for n in z.namelist() if n.endswith('.kml'))
            with z.open(kml_name) as f:
                return ET.parse(f)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def extract_station(tree):
    root = tree.getroot()

    # Tijdstappen
    ts_el = root.find('.//dwd:ForecastTimeSteps', NS)
    times = [t.text for t in ts_el.findall('dwd:TimeStep', NS)]

    # Run-tijd
    issue_el = root.find('.//dwd:IssueTime', NS)
    run = issue_el.text if issue_el is not None else None

    # Parameters
    placemark = root.find('.//kml:Placemark', NS)
    ext = placemark.find('kml:ExtendedData', NS)
    params = {}
    for fc in ext.findall('dwd:Forecast', NS):
        p = fc.get(f'{{{NS_DWD}}}elementName')
        if p in WANTED:
            params[p] = parse_vals(fc.find('dwd:value', NS).text)

    return times, run, params


def build_station_json(meta, times, run, params):
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(hours=48)

    out = {
        "station_id":  meta["id"],
        "naam":        meta["naam"],
        "lat":         meta["lat"],
        "lon":         meta["lon"],
        "run":         run,
        "gegenereerd": now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        "tijden":      [],
        "temp":        [],   # °C
        "wind_dir":    [],   # ° (meteorologisch, van)
        "wind_ms":     [],   # m/s (10m hoogte)
        "gust_ms":     [],   # m/s (FX1, max laatste uur)
        "gust_kmh":    [],   # km/u
        "regen":       [],   # mm (RR1c)
        "kans_regen":  [],   # %
        "kans_onweer": [],   # %
        "zon":         [],   # % (100 - N)
    }

    def g(param, i):
        """Veilig parameter[i] ophalen."""
        arr = params.get(param)
        if arr is None or i >= len(arr):
            return None
        return arr[i]

    for i, t in enumerate(times):
        dt = datetime.strptime(t, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=timezone.utc)
        if dt < now - timedelta(hours=1):
            continue
        if dt > cutoff:
            break

        out["tijden"].append(t)

        ttt = g('TTT', i)
        out["temp"].append(round(ttt - 273.15, 1) if ttt is not None else None)

        dd = g('DD', i)
        out["wind_dir"].append(round(dd, 0) if dd is not None else None)

        ff = g('FF', i)
        out["wind_ms"].append(round(ff, 1) if ff is not None else None)

        fx1 = g('FX1', i)
        out["gust_ms"].append(round(fx1, 1) if fx1 is not None else None)
        out["gust_kmh"].append(round(fx1 * 3.6, 0) if fx1 is not None else None)

        rr = g('RR1c', i)
        out["regen"].append(round(rr, 2) if rr is not None else 0.0)

        # Kans op regen: gebruik R101 indien beschikbaar, anders drempel op RR1c
        r101 = g('R101', i)
        if r101 is not None:
            out["kans_regen"].append(round(r101 * 100, 0))
        elif rr is not None:
            out["kans_regen"].append(100 if rr > 0.5 else 70 if rr > 0.1 else 30 if rr > 0.02 else 0)
        else:
            out["kans_regen"].append(0)

        # Kans op onweer: wwTd = fractie (0-1) → %
        wwtd = g('wwTd', i)
        out["kans_onweer"].append(round(wwtd * 100, 0) if wwtd is not None else 0)

        # Zon/helder: 100 - bewolking%
        n = g('N', i)
        out["zon"].append(round(100 - n, 0) if n is not None else None)

    out["n_uren"] = len(out["tijden"])
    return out


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.abspath(os.path.join(script_dir, '..', 'data'))
    os.makedirs(out_dir, exist_ok=True)

    station_index = []
    ok = 0

    for st in STATIONS:
        sid = st["id"]
        print(f"[mosmix] {sid} {st['naam']}…", end=' ', flush=True)
        try:
            tree = fetch_station_tree(sid)
            times, run, params = extract_station(tree)
            data = build_station_json(st, times, run, params)

            out_path = os.path.join(out_dir, f"mosmix_{sid}.json")
            with open(out_path, 'w') as f:
                json.dump(data, f, separators=(',', ':'))

            station_index.append({
                "id":    sid,
                "naam":  st["naam"],
                "lat":   st["lat"],
                "lon":   st["lon"],
                "run":   run,
                "n_uren": data["n_uren"],
            })
            print(f"ok ({data['n_uren']} uur, run {run[:16] if run else '?'})")
            ok += 1

        except Exception as e:
            print(f"FOUT: {e}", file=sys.stderr)

    # Station-index (voor nearest-station lookup)
    idx = {
        "gegenereerd": datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        "stations": station_index,
    }
    with open(os.path.join(out_dir, 'mosmix_stations.json'), 'w') as f:
        json.dump(idx, f, indent=2)

    print(f"[mosmix] klaar — {ok}/{len(STATIONS)} stations")
    return 0 if ok > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
