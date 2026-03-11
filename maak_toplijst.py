import os, requests, json
from datetime import date, timedelta, datetime, timezone
from math import isnan
from zoneinfo import ZoneInfo

os.chdir(os.path.dirname(os.path.abspath(__file__)))

KNMI_KEY = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY2ZjIwYWZjOTMwYTRkNDY5M2Q3MTc5OWVhMTI4ZGQwIiwiaCI6Im11cm11cjEyOCJ9"
BASE_URL = "https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations"
HEADERS  = {"Authorization": KNMI_KEY}
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

STATIONS = {
    "0-20000-0-06209": "IJmond",
    "0-20000-0-06210": "Valkenburg",
    "0-20000-0-06215": "Voorschoten",
    "0-20000-0-06225": "IJmuiden",
    "0-20000-0-06235": "Den Helder",
    "0-20000-0-06240": "Schiphol",
    "0-20000-0-06242": "Vlieland",
    "0-20000-0-06249": "Berkhout",
    "0-20000-0-06251": "Hoorn Terschelling",
    "0-20000-0-06257": "Wijk aan Zee",
    "0-20000-0-06258": "Houtribdijk",
    "0-20000-0-06260": "De Bilt",
    "0-20000-0-06265": "Soesterberg",
    "0-20000-0-06267": "Stavoren",
    "0-20000-0-06269": "Lelystad",
    "0-20000-0-06270": "Leeuwarden",
    "0-20000-0-06273": "Marknesse",
    "0-20000-0-06275": "Deelen",
    "0-20000-0-06277": "Lauwersoog",
    "0-20000-0-06278": "Heino",
    "0-20000-0-06279": "Hoogeveen",
    "0-20000-0-06280": "Eelde",
    "0-20000-0-06283": "Hupsel",
    "0-20000-0-06286": "Nieuw Beerta",
    "0-20000-0-06290": "Twenthe",
    "0-20000-0-06310": "Vlissingen",
    "0-20000-0-06319": "Westdorpe",
    "0-20000-0-06323": "Wilhelminadorp",
    "0-20000-0-06330": "Hoek van Holland",
    "0-20000-0-06340": "Woensdrecht",
    "0-20000-0-06344": "Rotterdam Airport",
    "0-20000-0-06348": "Cabauw",
    "0-20000-0-06350": "Gilze-Rijen",
    "0-20000-0-06356": "Herwijnen",
    "0-20000-0-06370": "Eindhoven",
    "0-20000-0-06375": "Volkel",
    "0-20000-0-06377": "Ell",
    "0-20000-0-06380": "Maastricht",
    "0-20000-0-06391": "Arcen",
}

def to_nums(vals):
    out = []
    for v in (vals or []):
        try:
            x = float(v)
            if not isnan(x): out.append(x)
        except: pass
    return out

def haal_station(station_id, dt_range):
    params = {"datetime": dt_range, "parameter-name": "tx,tn,rh,fx"}
    r = requests.get(f"{BASE_URL}/locations/{station_id}", headers=HEADERS, params=params, timeout=20)
    if r.status_code in (404, 400): return None
    r.raise_for_status()
    js = r.json()
    if not js.get("coverages"): return None
    cov = js["coverages"][0]
    ranges = cov.get("ranges", {})
    def last_nonnan(param):
        vals = to_nums(ranges.get(param, {}).get("values"))
        return vals[-1] if vals else None
    return {
        "tx":  last_nonnan("tx"),
        "tn":  last_nonnan("tn"),
        "rr":  last_nonnan("rr"),
        "fx":  last_nonnan("fx"),
    }

vandaag  = date.today()
gisteren = vandaag - timedelta(days=1)

resultaten = {}

for dag in [vandaag - timedelta(days=i) for i in range(4, -1, -1)]:
    dt_range = f"{dag}T00:00:00Z/{dag}T23:59:59Z"
    key = dag.isoformat()
    resultaten[key] = {"datum": key, "TX": [], "TN": [], "RR": [], "FX": []}
    print(f"Ophalen {dag}...")
    for station_id, naam in STATIONS.items():
        try:
            d = haal_station(station_id, dt_range)
            if not d: continue
            if d["tx"]  is not None: resultaten[key]["TX"].append((d["tx"],  naam))
            if d["tn"]  is not None: resultaten[key]["TN"].append((d["tn"],  naam))
            if d["rr"]  is not None and d["rr"] >= 0: resultaten[key]["RR"].append((d["rr"], naam))
            if d["fx"]  is not None: resultaten[key]["FX"].append((d["fx"],  naam))
        except Exception as e:
            print(f"  Fout {naam}: {e}")

for key in resultaten:
    resultaten[key]["TX"] = sorted(resultaten[key]["TX"], reverse=True)[:20]
    resultaten[key]["TN"] = sorted(resultaten[key]["TN"])[:20]
    resultaten[key]["RR"] = sorted(resultaten[key]["RR"], reverse=True)[:20]
    resultaten[key]["FX"] = sorted(resultaten[key]["FX"], reverse=True)[:20]

if not any(resultaten[k]["TX"] for k in resultaten):
    print("Geen data"); exit(1)

with open("toplijst.json", "w") as f:
    json.dump(resultaten, f)
print(f"toplijst.json bijgewerkt")

if os.path.exists("toplijst.html"):
    print("toplijst.html al aanwezig — wordt niet overschreven")
