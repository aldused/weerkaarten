import os, requests, json
from datetime import datetime, date, timedelta

os.chdir(os.path.dirname(os.path.abspath(__file__)))

KNMI_KEY = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY2ZjIwYWZjOTMwYTRkNDY5M2Q3MTc5OWVhMTI4ZGQwIiwiaCI6Im11cm11cjEyOCJ9"
STATIONS = ["209","210","215","225","229","235","240","242","248","249","251","257","258","260","265","267","269","270","273","275","277","278","279","280","283","286","290","310","319","323","330","340","344","348","350","356","370","375","377","380","391"]

vandaag = date.today()
gisteren = vandaag - timedelta(days=1)

def haal_dag(d):
    datum_str = d.strftime("%Y%m%d")
    url = (f"https://api.knmi.nl/v1/observation/station/day?stationCode={','.join(STATIONS)}"
           f"&startDate={datum_str}&endDate={datum_str}&apiKey={KNMI_KEY}")
    try:
        r = requests.get(url, timeout=30); r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"KNMI fout: {e}"); return None

def verwerk(data, d):
    if not data: return None
    tx_lijst, tn_lijst, rr_lijst, fx_lijst = [], [], [], []
    for st in data.get("stationMeasurements", []):
        naam = st.get("stationCode","")
        obs = st.get("observations",[])
        for o in obs:
            if o.get("TX") is not None: tx_lijst.append((o["TX"]/10, naam, o.get("DTX","")))
            if o.get("TN") is not None: tn_lijst.append((o["TN"]/10, naam, o.get("DTN","")))
            if o.get("RH") is not None and o["RH"] >= 0: rr_lijst.append((o["RH"]/10, naam))
            if o.get("FXX") is not None: fx_lijst.append((o["FXX"]/10, naam, o.get("DFXX","")))
    return {
        "datum": d.isoformat(),
        "TX": sorted(tx_lijst, reverse=True)[:20],
        "TN": sorted(tn_lijst)[:20],
        "RR": sorted(rr_lijst, reverse=True)[:20],
        "FX": sorted(fx_lijst, reverse=True)[:20],
    }

resultaten = {}
for d in [vandaag, gisteren]:
    print(f"Ophalen KNMI {d}...")
    raw = haal_dag(d)
    res = verwerk(raw, d)
    if res: resultaten[d.isoformat()] = res

if not resultaten: print("Geen KNMI data"); exit()

with open("toplijst.json","w") as f:
    json.dump(resultaten, f)
print("toplijst.json bijgewerkt")

# HTML genereren
html_items = []
for datum_str, data in sorted(resultaten.items(), reverse=True):
    d = date.fromisoformat(datum_str)
    nl_d = ["ma","di","wo","do","vr","za","zo"][d.weekday()]
    nl_m = ["","jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"][d.month]
    html_items.append((datum_str, d, nl_d, nl_m, data))

html = open("toplijst.html").read() if os.path.exists("toplijst.html") else ""
print("toplijst.html al aanwezig — wordt niet overschreven (gebruik bestaande versie)")
