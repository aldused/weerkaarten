import os, json, requests
from datetime import datetime, timezone

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

API     = "https://aviationweather.gov/api/data"
HEADERS = {"User-Agent": "EdAldusWM/1.0 metar-fetcher"}

# Alle vliegvelden Nederland en België
STATIONS = [
    # Nederland
    "EHAM","EHRD","EHBK","EHGG","EHLE","EHEH","EHLW","EHKD","EHTW","EHWO",
    "EHGR","EHHV","EHDB","EHDR","EHDL","EHVK","EHTE","EHBD","EHSE","EHSB",
    "EHFS","EHND","EHST","EHTN","EHTS","EHMZ",
    # België
    "EBBR","EBOS","EBCI","EBLG","EBAW","EBKT","EBBE","EBBL","EBFS","EBBX",
    "EBTN","EBTX","EBZR","EBZW","EBDT","EBMB","EBFN","EBST","EBSG","EBSP",
    # Grensgebied Duitsland dichtbij
    "EDDL","EDDK","EDDG","EDLW","EDLP","EDLN","EDLV","ETNG","ETNN",
    # Grensgebied België/FR/LUX
    "ELLX","LFQQ","LFQN","LFQB",
]

def haal(param, ids):
    try:
        r = requests.get(f"{API}/{param}",
                         params={"ids": ",".join(ids), "format": "json"},
                         headers=HEADERS, timeout=30)
        r.raise_for_status()
        data = r.json()
        return data if isinstance(data, list) else []
    except Exception as e:
        print(f"  x {param}: {e}"); return []

print(f"METAR ophalen ({len(STATIONS)} stations)...")
metars = haal("metar", STATIONS)
print(f"  {len(metars)} ontvangen")

print("TAF ophalen...")
tafs = haal("taf", STATIONS)
print(f"  {len(tafs)} ontvangen")

resultaat = {}
for m in metars:
    sid = m.get("icaoId") or m.get("stationId")
    if sid: resultaat[sid] = {"metar": m, "taf": None}
for t in tafs:
    sid = t.get("icaoId") or t.get("stationId")
    if sid:
        if sid in resultaat: resultaat[sid]["taf"] = t
        else: resultaat[sid] = {"metar": None, "taf": t}

update = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
resultaat["_update"] = update
resultaat["_count"]  = len(resultaat) - 2

with open("metar_data.json", "w") as f:
    json.dump(resultaat, f)

print(f"metar_data.json bijgewerkt: {resultaat['_count']} stations ({update})")
