#!/usr/bin/env python3
"""
mosmix_json.py
Haalt alle MOSMIX data op van DWD en schrijft mosmix_nl.json + mosmix_be.json.
Vervangt ~30 afzonderlijke PNG-generatiescripts door 1 snel JSON-script.

Parameters: TX, TN, RR, FF, FX, DD, SQ, TTD, Neff, gevoels
Output: ~200KB JSON i.p.v. ~73MB PNG's, ~10s i.p.v. ~3min.
"""

import os, json, re, math, requests, zipfile, io
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from collections import defaultdict

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

# ── Stationslijsten ──────────────────────────────────────────────────────────

STATIONS_NL = [
    ("06280","Eelde"),("06250","Terschelling"),("06242","Vlieland"),
    ("06270","Leeuwarden"),("06235","Den Helder"),("06240","Amsterdam"),
    ("06260","De Bilt"),("06275","Deelen"),("06279","Hoogeveen"),
    ("06290","Enschede"),("06310","Vlissingen"),("06330","Hoek van Holland"),
    ("06344","Rotterdam Airport"),("06350","Gilze Rijen"),("06370","Eindhoven"),
    ("06380","Maastricht"),("06431","Gent"),("06450","Antwerpen"),
    ("K1176","Kleve"),("06451","Brussel"),("06479","Kleine Brogel"),
    ("E207","Dollart"),("P0122","Wielen"),("10405","Weeze"),
    ("06210","Valkenburg"),("06375","Volkel"),("10406","Bocholt"),
    ("H512","Nettetal"),("E5305","IJsselmeer"),("K1083","Borkum"),
    ("10500","Geilenkirchen"),
]

COORDS_NL = {
    "Eelde":[6.586,53.123],"Terschelling":[5.350,53.392],"Vlieland":[4.920,53.250],
    "Leeuwarden":[5.774,53.224],"Den Helder":[4.789,52.928],"Amsterdam":[4.781,52.309],
    "De Bilt":[5.178,52.101],"Deelen":[5.885,52.060],"Hoogeveen":[6.520,52.730],
    "Enschede":[6.889,52.275],"Vlissingen":[3.596,51.442],"Hoek van Holland":[4.131,51.978],
    "Rotterdam Airport":[4.437,51.957],"Gilze Rijen":[4.931,51.567],
    "Eindhoven":[5.377,51.451],"Maastricht":[5.770,50.911],"Gent":[3.720,51.054],
    "Antwerpen":[4.405,51.219],"Brussel":[4.484,50.901],"Kleine Brogel":[5.470,51.168],
    "Dollart":[7.220,53.230],"Wielen":[6.450,52.320],"IJsselmeer":[5.433,52.618],
    "Valkenburg":[4.417,52.270],"Kleve":[6.140,51.790],"Weeze":[6.141,51.603],
    "Bocholt":[6.617,51.838],"Nettetal":[6.276,51.317],"Geilenkirchen":[6.030,50.580],
    "Borkum":[6.749,53.586],"Volkel":[5.707,51.657],
}

STATIONS_BE = [
    ("06451","Brussel"),("06431","Gent"),("06450","Antwerpen"),
    ("06479","Kleine Brogel"),("06407","Oostende"),("06449","Charleroi"),
    ("06478","Bierset"),("06490","Spa"),("06476","St-Hubert"),
    ("06456","Florennes"),("07015","Lille"),("F9600","Heinerschied"),
    ("06458","Beauvechain"),("H908","Monschau"),("P0155","Brugge"),
    ("07075","Charleville"),("07017","Cambrai"),("P0437","Calais"),
    ("07061","Saint-Quentin"),
]

COORDS_BE = {
    "Brussel":[4.484,50.901],"Gent":[3.720,51.054],"Antwerpen":[4.405,51.219],
    "Kleine Brogel":[5.470,51.168],"Oostende":[2.862,51.199],
    "Charleroi":[4.453,50.460],"Bierset":[5.453,50.638],
    "Spa":[5.910,50.493],"St-Hubert":[5.404,50.035],
    "Florennes":[4.648,50.243],"Lille":[3.106,50.563],
    "Heinerschied":[6.080,50.030],"Beauvechain":[4.768,50.758],
    "Monschau":[6.243,50.560],"Brugge":[3.217,51.200],
    "Charleville":[4.647,49.783],"Cambrai":[3.164,50.222],
    "Calais":[1.954,50.819],"Saint-Quentin":[3.207,49.843],
}

# ── MOSMIX helpers ───────────────────────────────────────────────────────────

def strip_namespaces(s):
    s = re.sub(r'<(/?)\w+:', r'<\1', s)
    s = re.sub(r'\b\w+:(\w+=)', r'\1', s)
    return re.sub(r'\s+xmlns(?::\w+)?="[^"]*"', '', s)

def download_kmz(station):
    url = (f"https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/"
           f"single_stations/{station}/kml/MOSMIX_L_LATEST_{station}.kmz")
    try:
        r = requests.get(url, timeout=30); r.raise_for_status()
        z = zipfile.ZipFile(io.BytesIO(r.content))
        return ET.fromstring(strip_namespaces(z.read(z.namelist()[0]).decode("utf-8")))
    except Exception as e:
        print(f"  x {station}: {e}"); return None

def get_issue_time(root):
    """Lees de IssueTime uit de MOSMIX XML (= model run tijdstip)."""
    el = root.find('.//IssueTime')
    if el is not None and el.text:
        try:
            return datetime.strptime(el.text.strip()[:19], "%Y-%m-%dT%H:%M:%S")
        except:
            pass
    return None

def get_times(root):
    times = []
    for ts in root.findall('.//ForecastTimeSteps/TimeStep'):
        try: times.append(datetime.strptime((ts.text or '').strip()[:19], "%Y-%m-%dT%H:%M:%S"))
        except: pass
    return times

def parse_values(root, name):
    for fc in root.findall('.//Forecast'):
        if fc.get('elementName') == name:
            val = fc.find('value')
            if val is not None and val.text:
                res = []
                for t in val.text.strip().split():
                    if t == '-': res.append(None)
                    else:
                        try: res.append(float(t))
                        except: res.append(None)
                return res
    return []

# ── Gevoelstemperatuur ───────────────────────────────────────────────────────

def windchill(t_c, ff_ms):
    """Windchill formule (Environment Canada / KNMI)."""
    v_kmh = ff_ms * 3.6
    if t_c >= 10.0 or v_kmh <= 4.8:
        return t_c
    wc = 13.12 + 0.6215*t_c - 11.37*(v_kmh**0.16) + 0.3965*t_c*(v_kmh**0.16)
    return round(wc, 1)

# ── Astronomische daglengte (voor zon-schatting) ─────────────────────────────

def max_daglengte(datum, lat_deg=52.0):
    dag_nr = datum.timetuple().tm_yday
    decl = math.radians(-23.45 * math.cos(math.radians(360/365 * (dag_nr + 10))))
    lat = math.radians(lat_deg)
    cos_ha = -math.tan(lat) * math.tan(decl)
    cos_ha = max(-1.0, min(1.0, cos_ha))
    return 2 * math.degrees(math.acos(cos_ha)) / 15.0

def sd_uit_neff(neff_gem, datum):
    dl = max_daglengte(datum)
    return round(max(0.0, dl * (1.0 - neff_gem / 100.0) * 0.75), 1)

# ── Hoofdverwerking per station ──────────────────────────────────────────────

def verwerk_station(code, naam):
    """Haal alle parameters op voor 1 station, return (data_dict, issue_time)."""
    root = download_kmz(code)
    if root is None:
        return {}, None

    times = get_times(root)
    if not times:
        return {}, None

    issue_time = get_issue_time(root)

    # Ruwe waarden ophalen
    tx_raw   = parse_values(root, 'TX')
    tn_raw   = parse_values(root, 'TN')
    ttt_raw  = parse_values(root, 'TTT')
    ff_raw   = parse_values(root, 'FF')
    fx_raw   = parse_values(root, 'FX1')
    dd_raw   = parse_values(root, 'DD')
    rr_raw   = parse_values(root, 'RR1c')
    sd_raw   = parse_values(root, 'SunD1')
    td_raw   = parse_values(root, 'Td')
    neff_raw = parse_values(root, 'Neff')
    vv_raw   = parse_values(root, 'VV')      # zicht in meters
    wwm_raw  = parse_values(root, 'wwM')     # kans op mist %
    wwz_raw  = parse_values(root, 'wwZ')     # kans op hagel %

    # Conversie Kelvin → Celsius
    tx = [v - 273.15 if v and v > 200 else None for v in tx_raw]
    tn = [v - 273.15 if v and v > 200 else None for v in tn_raw]
    ttt = [v - 273.15 if v and v > 200 else None for v in ttt_raw]
    td = [v - 273.15 if v and v > 200 else None for v in td_raw]

    # Dagaggregatie
    daily = defaultdict(lambda: {
        "tx": [], "tn": [],
        "ff_dag": [], "fx_dag": [], "dd_dag": [],
        "ff_nacht": [], "fx_nacht": [], "dd_nacht": [],
        "rr": 0.0,
        "sd": 0.0, "heeft_sd": False, "neff": [],
        "td_nacht": [],
        "gevoels_nacht": [],
        "vv_min": [],
        "wwm": [],
        "wwz": [],
    })

    for i, dt in enumerate(times):
        loc = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d = loc.date()
        hour = loc.hour
        dd = daily[d]

        # TX: max temp, geldig ≥12h lokaal
        if i < len(tx) and tx[i] is not None and hour >= 12:
            dd["tx"].append(tx[i])

        # TN: min temp, geldig <12h lokaal
        if i < len(tn) and tn[i] is not None and hour < 12:
            dd["tn"].append(tn[i])

        # Wind: dag 6-18h
        if 6 <= hour < 18:
            if i < len(ff_raw) and ff_raw[i] is not None:
                dd["ff_dag"].append(ff_raw[i])
                dd["dd_dag"].append(dd_raw[i] if i < len(dd_raw) and dd_raw[i] is not None else None)
            if i < len(fx_raw) and fx_raw[i] is not None:
                dd["fx_dag"].append(fx_raw[i])
        # Wind: nacht 18-06h
        else:
            if i < len(ff_raw) and ff_raw[i] is not None:
                dd["ff_nacht"].append(ff_raw[i])
                dd["dd_nacht"].append(dd_raw[i] if i < len(dd_raw) and dd_raw[i] is not None else None)
            if i < len(fx_raw) and fx_raw[i] is not None:
                dd["fx_nacht"].append(fx_raw[i])

        # Neerslag: hele dag
        if i < len(rr_raw) and rr_raw[i] is not None:
            dd["rr"] += rr_raw[i]

        # Zon: SunD1 (seconden afgelopen uur)
        if i < len(sd_raw) and sd_raw[i] is not None:
            dd["sd"] += sd_raw[i] / 3600.0
            dd["heeft_sd"] = True

        # Bewolking: hele dag
        if i < len(neff_raw) and neff_raw[i] is not None:
            dd["neff"].append(neff_raw[i])

        # Dauwpunt: nacht 0-12h
        if 0 <= hour < 12:
            if i < len(td) and td[i] is not None:
                dd["td_nacht"].append(td[i])

        # Gevoelstemperatuur: nacht 0-12h
        if 0 <= hour < 12:
            t_val = ttt[i] if i < len(ttt) else None
            f_val = ff_raw[i] if i < len(ff_raw) else None
            if t_val is not None and f_val is not None:
                dd["gevoels_nacht"].append(windchill(t_val, f_val))

        # Zicht / mist: minimum over hele dag (meters)
        if i < len(vv_raw) and vv_raw[i] is not None:
            dd["vv_min"].append(vv_raw[i])

        # Mistkans: max over hele dag (%)
        if i < len(wwm_raw) and wwm_raw[i] is not None:
            dd["wwm"].append(wwm_raw[i])

        # Hagelkans: max over hele dag (%)
        if i < len(wwz_raw) and wwz_raw[i] is not None:
            dd["wwz"].append(wwz_raw[i])

    # Aggregeer naar eindwaarden per dag
    result = {}
    for d, dd in daily.items():
        r = {}
        r["TX"] = round(max(dd["tx"]), 1) if dd["tx"] else None
        r["TN"] = round(min(dd["tn"]), 1) if dd["tn"] else None

        # Wind
        if dd["ff_dag"]:
            r["FF"] = round(sum(dd["ff_dag"]) / len(dd["ff_dag"]) * 3.6, 1)  # km/h
            # DD bij max FF
            max_idx = dd["ff_dag"].index(max(dd["ff_dag"]))
            r["DD"] = round(dd["dd_dag"][max_idx]) if max_idx < len(dd["dd_dag"]) and dd["dd_dag"][max_idx] is not None else None
        else:
            r["FF"] = None
            r["DD"] = None

        r["FX"] = round(max(dd["fx_dag"]) * 3.6, 1) if dd["fx_dag"] else None

        # Wind nacht (18-06h)
        if dd["ff_nacht"]:
            r["FF_N"] = round(sum(dd["ff_nacht"]) / len(dd["ff_nacht"]) * 3.6, 1)
            max_idx_n = dd["ff_nacht"].index(max(dd["ff_nacht"]))
            r["DD_N"] = round(dd["dd_nacht"][max_idx_n]) if max_idx_n < len(dd["dd_nacht"]) and dd["dd_nacht"][max_idx_n] is not None else None
        else:
            r["FF_N"] = None
            r["DD_N"] = None
        r["FX_N"] = round(max(dd["fx_nacht"]) * 3.6, 1) if dd["fx_nacht"] else None

        # Neerslag
        r["RR"] = round(dd["rr"], 1)

        # Zon
        neff_gem = round(sum(dd["neff"]) / len(dd["neff"])) if dd["neff"] else None
        if dd["heeft_sd"]:
            r["SQ"] = round(dd["sd"], 1)
        elif neff_gem is not None:
            r["SQ"] = sd_uit_neff(neff_gem, d)
        else:
            r["SQ"] = None

        # Bewolking
        r["Neff"] = neff_gem

        # Dauwpunt (minimum nachts)
        r["TTD"] = round(min(dd["td_nacht"]), 1) if dd["td_nacht"] else None

        # Gevoelstemperatuur (minimum nachts)
        r["gevoels"] = round(min(dd["gevoels_nacht"]), 1) if dd["gevoels_nacht"] else None

        # Zicht minimum (km)
        r["VV"] = round(min(dd["vv_min"]) / 1000, 1) if dd["vv_min"] else None

        # Mistkans max (%)
        r["wwM"] = round(max(dd["wwm"])) if dd["wwm"] else None

        # Hagelkans max (%)
        r["wwZ"] = round(max(dd["wwz"])) if dd["wwz"] else None

        result[d] = r

    return result, issue_time

# ── JSON samenstellen ────────────────────────────────────────────────────────

def bouw_json(stations, coords, output_file):
    print(f"\n{'='*60}")
    print(f"  {output_file} — {len(stations)} stations")
    print(f"{'='*60}")

    vandaag = datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()
    alle_data = {}  # {naam: {date: {param: val}}}
    laatste_run = None  # IssueTime van het model

    for code, naam in stations:
        print(f"  {naam} ({code})...")
        station_data, issue_time = verwerk_station(code, naam)
        if station_data:
            alle_data[naam] = station_data
        if issue_time is not None and (laatste_run is None or issue_time > laatste_run):
            laatste_run = issue_time

    # Bepaal 10 dagen vanaf vandaag
    alle_datums = set()
    for naam, sd in alle_data.items():
        for d in sd.keys():
            if d >= vandaag:
                alle_datums.add(d)
    dagen = sorted(alle_datums)[:10]

    if not dagen:
        print("  GEEN DATA!"); return

    # Structureer data per dag per parameter
    data_out = {}
    params = ["TX", "TN", "RR", "FF", "FX", "DD", "FF_N", "FX_N", "DD_N", "SQ", "TTD", "Neff", "gevoels", "VV", "wwM", "wwZ"]

    for d in dagen:
        dag_key = d.isoformat()
        data_out[dag_key] = {}
        for p in params:
            data_out[dag_key][p] = {}
            for naam in alle_data:
                val = alle_data[naam].get(d, {}).get(p)
                if val is not None:
                    data_out[dag_key][p][naam] = val

    # Run-tijd formatteren (bijv. "2026-04-01T09:00:00Z")
    run_str = laatste_run.strftime("%Y-%m-%dT%H:%M:%SZ") if laatste_run else None

    output = {
        "bijgewerkt": datetime.now().isoformat(timespec="minutes"),
        "run": run_str,
        "stations": coords,
        "dagen": [d.isoformat() for d in dagen],
        "data": data_out,
    }

    with open(output_file, "w") as f:
        json.dump(output, f, ensure_ascii=False)

    # Bestandsgrootte
    size = os.path.getsize(output_file)
    print(f"\n  {output_file}: {size/1024:.0f} KB, {len(dagen)} dagen, {len(alle_data)} stations")

# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    import time
    t0 = time.time()
    print(f"MOSMIX JSON generator — {datetime.now():%Y-%m-%d %H:%M}")

    bouw_json(STATIONS_NL, COORDS_NL, "mosmix_nl.json")
    bouw_json(STATIONS_BE, COORDS_BE, "mosmix_be.json")

    print(f"\nKlaar in {time.time()-t0:.0f}s")

if __name__ == "__main__":
    main()
