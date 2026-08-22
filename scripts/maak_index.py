import os, glob, json, re
from datetime import date

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
vandaag = date.today()

mnd_map = {"jan":1,"feb":2,"mrt":3,"mar":3,"apr":4,"mei":5,"may":5,
           "jun":6,"jul":7,"aug":8,"sep":9,"okt":10,"oct":10,"nov":11,"dec":12}

def datum_uit_naam(naam):
    # Nieuw formaat: kaart_wind_nacht_20260330_maandag.png  (YYYYMMDD)
    m = re.search(r'_(\d{4})(\d{2})(\d{2})_', naam)
    if m:
        try: return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except: pass
    # Oud formaat: kaart_wind_nacht_maandag_30mrt2026.png  (DDmmmYYYY)
    m = re.search(r'(\d{2})([a-z]{3})(\d{4})', naam)
    if m:
        dag, mnd, jaar = m.groups()
        try: return date(int(jaar), mnd_map[mnd], int(dag))
        except: pass
    # Fallback: losse YYYYMMDD ergens in naam (bijv. synop, toplijst kaarten)
    m = re.search(r'(\d{8})', naam)
    if m:
        s = m.group(1)
        try: return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
        except: pass
    return None

kaarten = sorted([os.path.basename(f) for f in glob.glob("kaart_*.png")])

kaarten_gefilterd = []
for k in kaarten:
    d = datum_uit_naam(k)
    if d is None or d >= vandaag:
        kaarten_gefilterd.append(k)

# Sorteer chronologisch; kaarten zonder datum komen achteraan
kaarten_gefilterd.sort(key=lambda k: datum_uit_naam(k) or date(9999,1,1))

with open("index.json","w") as f:
    json.dump(kaarten_gefilterd, f)
print(f"index.json: {len(kaarten_gefilterd)} kaarten")

# Debug: toon wind nacht kaarten
wind_nacht = [k for k in kaarten_gefilterd if 'wind_nacht' in k]
print(f"  wind_nacht: {len(wind_nacht)} kaarten")
for k in wind_nacht:
    print(f"    {k}  →  {datum_uit_naam(k)}")
