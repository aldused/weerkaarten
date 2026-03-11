import os, requests, json
from datetime import date, timedelta, datetime

os.chdir(os.path.dirname(os.path.abspath(__file__)))

KNMI_KEY = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY2ZjIwYWZjOTMwYTRkNDY5M2Q3MTc5OWVhMTI4ZGQwIiwiaCI6Im11cm11cjEyOCJ9"

STATIONS = {
    "0-20000-0-06209": "IJmond",
    "0-20000-0-06210": "Valkenburg",
    "0-20000-0-06215": "Voorschoten",
    "0-20000-0-06225": "IJmuiden",
    "0-20000-0-06229": "Texelhors",
    "0-20000-0-06235": "Den Helder",
    "0-20000-0-06240": "Schiphol",
    "0-20000-0-06242": "Vlieland",
    "0-20000-0-06248": "Wijdenes",
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

BASE_URL = "https://api.dataplatform.knmi.nl/edr/v1/collections/daily-in-situ-meteorological-observations-validated"
HEADERS  = {"Authorization": KNMI_KEY}

vandaag  = date.today()
gisteren = vandaag - timedelta(days=1)
dt_range = f"{gisteren}T00:00:00Z/{vandaag}T23:59:59Z"

print(f"Ophalen KNMI daggegevens {gisteren} t/m {vandaag} via EDR API...")

resultaten = {}

for station_id, naam in STATIONS.items():
    url = f"{BASE_URL}/locations/{station_id}"
    params = {"datetime": dt_range, "parameter-name": "TX,TN,RH,FXX"}
    try:
        r = requests.get(url, headers=HEADERS, params=params, timeout=20)
        if r.status_code == 404:
            continue
        r.raise_for_status()
        data = r.json()

        # CoverageCollection: loop over coverages
        for cov in data.get("coverages", []):
            times  = cov.get("domain", {}).get("axes", {}).get("t", {}).get("values", [])
            ranges = cov.get("ranges", {})
            for i, ts in enumerate(times):
                d   = datetime.fromisoformat(ts.replace("Z", "+00:00")).date()
                key = d.isoformat()
                if key not in resultaten:
                    resultaten[key] = {"datum": key, "TX": [], "TN": [], "RR": [], "FX": []}

                def get_val(param, idx=i):
                    vals = ranges.get(param, {}).get("values", [])
                    return vals[idx] if idx < len(vals) else None

                tx  = get_val("TX")
                tn  = get_val("TN")
                rh  = get_val("RH")
                fxx = get_val("FXX")
                if tx  is not None: resultaten[key]["TX"].append((tx,  naam))
                if tn  is not None: resultaten[key]["TN"].append((tn,  naam))
                if rh  is not None and rh >= 0: resultaten[key]["RR"].append((rh, naam))
                if fxx is not None: resultaten[key]["FX"].append((fxx, naam))

    except Exception as e:
        print(f"  Fout {naam}: {e}")

if not resultaten:
    print("Geen KNMI data ontvangen"); exit(1)

for key in resultaten:
    resultaten[key]["TX"] = sorted(resultaten[key]["TX"], reverse=True)[:20]
    resultaten[key]["TN"] = sorted(resultaten[key]["TN"])[:20]
    resultaten[key]["RR"] = sorted(resultaten[key]["RR"], reverse=True)[:20]
    resultaten[key]["FX"] = sorted(resultaten[key]["FX"], reverse=True)[:20]

with open("toplijst.json", "w") as f:
    json.dump(resultaten, f)
print(f"toplijst.json bijgewerkt ({len(resultaten)} dag(en))")

if os.path.exists("toplijst.html"):
    print("toplijst.html al aanwezig — wordt niet overschreven")
