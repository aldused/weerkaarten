"""
maak_beta_verificatie.py

Per run:
1. Sla huidige MOSMIX-voorspelling (TX/TN komende 3 dagen) op in archief
2. Haal werkelijke TX/TN op via KNMI EDR API voor afgelopen 3 dagen
3. Combineer met Harmonie (via Open-Meteo, wordt live in browser gedaan)
4. Schrijf beta_verificatie.json
"""

import os, json, requests, zipfile, io, xml.etree.ElementTree as ET, re
from datetime import datetime, timedelta, date, timezone

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# ── Configuratie ──────────────────────────────────────────────────────────────
STATIONS_MOSMIX = [
    ("06260", "De Bilt",          52.10,  5.18,  "0-20000-0-06260"),
    ("06330", "Hoek van Holland", 51.978, 4.131, "0-20000-0-06330"),
    ("06344", "Rotterdam",        51.957, 4.437, "0-20000-0-06344"),
    ("06290", "Enschede",         52.275, 6.889, "0-20000-0-06290"),
    ("06280", "Eelde",            53.123, 6.586, "0-20000-0-06280"),
    ("06380", "Maastricht",       50.911, 5.770, "0-20000-0-06380"),
    ("06250", "Terschelling",     53.392, 5.350, "0-20000-0-06251"),
    ("06310", "Vlissingen",       51.442, 3.596, "0-20000-0-06310"),
    ("06275", "Deelen",           52.060, 5.885, "0-20000-0-06275"),
    ("06350", "Gilze-Rijen",      51.567, 4.931, "0-20000-0-06350"),
]

KNMI_KEY = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY2ZjIwYWZjOTMwYTRkNDY5M2Q3MTc5OWVhMTI4ZGQwIiwiaCI6Im11cm11cjEyOCJ9"
EDR_URL  = "https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations"
HEADERS  = {"Authorization": KNMI_KEY, "Accept": "application/json"}
UTC_OFFSET = timedelta(hours=1)
ARCHIEF_PATH = "beta_verificatie_archive.json"
OUTPUT_PATH  = "beta_verificatie.json"
DAGEN_TERUG  = 3

# ── MOSMIX helpers ─────────────────────────────────────────────────────────────
def strip_ns(xml_string):
    xml_string = re.sub(r'<(/?)\w+:', r'<\1', xml_string)
    xml_string = re.sub(r'\b\w+:(\w+=)', r'\1', xml_string)
    xml_string = re.sub(r'\s+xmlns(?::\w+)?="[^"]*"', '', xml_string)
    return xml_string

def download_kmz(station):
    url = (f"https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/"
           f"single_stations/{station}/kml/MOSMIX_L_LATEST_{station}.kmz")
    r = requests.get(url, timeout=30); r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    kml = strip_ns(z.read(z.namelist()[0]).decode("utf-8"))
    return ET.fromstring(kml)

def get_times(root):
    times = []
    for ts in root.findall('.//ForecastTimeSteps/TimeStep'):
        try: times.append(datetime.strptime((ts.text or '').strip()[:19], "%Y-%m-%dT%H:%M:%S"))
        except: pass
    return times

def parse_values(root, element_name):
    for fc in root.findall('.//Forecast'):
        if fc.get('elementName') == element_name:
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

def haal_mosmix_voorspelling(code):
    """Geeft dict {datum: {tx, tn}} voor de komende 3+ dagen."""
    root   = download_kmz(code)
    times  = get_times(root)
    tx_raw = parse_values(root, 'TX')
    tn_raw = parse_values(root, 'TN')
    daily  = {}
    for i, dt in enumerate(times):
        loc = dt + UTC_OFFSET
        d   = loc.date().isoformat()
        if d not in daily: daily[d] = {"tx": [], "tn": []}
        if i < len(tx_raw) and tx_raw[i] is not None:
            daily[d]["tx"].append(tx_raw[i] - 273.15)
        if i < len(tn_raw) and tn_raw[i] is not None:
            daily[d]["tn"].append(tn_raw[i] - 273.15)
    result = {}
    for d, v in daily.items():
        result[d] = {
            "tx": round(max(v["tx"]), 1) if v["tx"] else None,
            "tn": round(min(v["tn"]), 1) if v["tn"] else None,
        }
    return result

# ── KNMI werkelijke metingen ───────────────────────────────────────────────────
def haal_werkelijk(wigos_id, dag: date):
    """Haal TX/TN op voor één dag via KNMI EDR API."""
    s = f"{dag.isoformat()}T00:00:00Z"
    e = f"{(dag + timedelta(days=1)).isoformat()}T00:00:00Z"
    params = {"datetime": f"{s}/{e}", "parameter-name": "ta,tx,tn"}
    r = requests.get(f"{EDR_URL}/locations/{wigos_id}", headers=HEADERS, params=params, timeout=25)
    if r.status_code in (400, 404): return None
    r.raise_for_status()
    js = r.json()
    if not js.get("coverages"): return None
    ranges = js["coverages"][0].get("ranges", {})

    def max_v(key):
        vals = [float(v) for v in (ranges.get(key, {}).get("values") or []) if v is not None]
        vals = [v for v in vals if -50 < v < 60]
        return round(max(vals), 1) if vals else None

    def min_v(key):
        vals = [float(v) for v in (ranges.get(key, {}).get("values") or []) if v is not None]
        vals = [v for v in vals if -50 < v < 60]
        return round(min(vals), 1) if vals else None

    tx = max_v("tx") or max_v("ta")
    tn = min_v("tn") or min_v("ta")
    return {"tx": tx, "tn": tn}

# ── Archief bijwerken ──────────────────────────────────────────────────────────
vandaag   = date.today()
run_datum = vandaag.isoformat()

# Laad bestaand archief
if os.path.exists(ARCHIEF_PATH):
    with open(ARCHIEF_PATH) as f:
        archief = json.load(f)
else:
    archief = {}

# Sla huidige MOSMIX-voorspelling op (per station, per run-datum)
print("MOSMIX voorspellingen ophalen voor archief...")
for code, naam, lat, lon, wigos in STATIONS_MOSMIX:
    print(f"  {naam}...")
    try:
        voorspelling = haal_mosmix_voorspelling(code)
        if naam not in archief:
            archief[naam] = {}
        # Sla op: archief[naam][run_datum][doel_datum] = {tx, tn}
        archief[naam][run_datum] = voorspelling
        # Bewaar max 10 run-datums per station
        runs = sorted(archief[naam].keys())
        if len(runs) > 10:
            for oude_run in runs[:-10]:
                del archief[naam][oude_run]
    except Exception as e:
        print(f"    FOUT: {e}")

with open(ARCHIEF_PATH, "w") as f:
    json.dump(archief, f)
print(f"Archief opgeslagen ({ARCHIEF_PATH})")

# ── Werkelijke metingen ophalen ────────────────────────────────────────────────
print("\nWerkelijke metingen ophalen (afgelopen 3 dagen)...")
werkelijk = {}
for _, naam, lat, lon, wigos in STATIONS_MOSMIX:
    werkelijk[naam] = {}
    for i in range(1, DAGEN_TERUG + 1):
        dag = vandaag - timedelta(days=i)
        try:
            obs = haal_werkelijk(wigos, dag)
            if obs:
                werkelijk[naam][dag.isoformat()] = obs
                print(f"  {naam} {dag}: TX={obs['tx']} TN={obs['tn']}")
        except Exception as e:
            print(f"  {naam} {dag}: FOUT {e}")

# ── Verificatie JSON samenstellen ─────────────────────────────────────────────
# Voor elke dag in de afgelopen 3 dagen: zoek de MOSMIX-voorspelling
# die ~2-3 dagen eerder werd gemaakt (run_datum = dag - 2 of dag - 3)
verificatie = {
    "gegenereerd": datetime.now().strftime("%Y-%m-%d %H:%M"),
    "stations": []
}

for code, naam, lat, lon, wigos in STATIONS_MOSMIX:
    station_data = []
    for i in range(1, DAGEN_TERUG + 1):
        dag = vandaag - timedelta(days=i)
        dag_str = dag.isoformat()

        # Zoek beste MOSMIX-run (voorkeur: 2-3 dagen eerder, anders vandaag als fallback)
        mos_tx, mos_tn = None, None
        mos_run = None
        for offset in [2, 3, 1, 4, 0]:  # 0 = vandaag als fallback
            run = (dag - timedelta(days=offset)).isoformat() if offset > 0 else run_datum
            if naam in archief and run in archief[naam]:
                pred = archief[naam][run].get(dag_str, {})
                if pred.get("tx") is not None:
                    mos_tx = pred["tx"]
                    mos_tn = pred.get("tn")
                    mos_run = run + (" (vandaag)" if offset == 0 else "")
                    break

        # Werkelijke meting
        obs = werkelijk.get(naam, {}).get(dag_str, {})
        obs_tx = obs.get("tx")
        obs_tn = obs.get("tn")

        station_data.append({
            "datum":   dag_str,
            "mos_tx":  mos_tx,
            "mos_tn":  mos_tn,
            "mos_run": mos_run,
            "obs_tx":  obs_tx,
            "obs_tn":  obs_tn,
        })

    verificatie["stations"].append({
        "naam": naam,
        "lat":  lat,
        "lon":  lon,
        "data": list(reversed(station_data)),  # chronologisch
    })

with open(OUTPUT_PATH, "w") as f:
    json.dump(verificatie, f)
print(f"\n{OUTPUT_PATH} opgeslagen ({len(verificatie['stations'])} stations)")
