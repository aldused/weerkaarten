import os, glob, json
from datetime import date

os.chdir(os.path.dirname(os.path.abspath(__file__)))
vandaag = date.today()

kaarten = sorted([
    os.path.basename(f) for f in glob.glob("kaart_*.png")
    if os.path.basename(f) >= f"kaart_{vandaag.strftime('%Y%m%d')}"
    or True  # alle kaarten tonen, maak_index filtert op naam
])

# Filter kaarten van vóór vandaag op basis van datum in bestandsnaam
import re
def datum_uit_naam(naam):
    m = re.search(r'(\d{2})([a-z]{3})(\d{4})', naam)
    if not m: return None
    dag,mnd,jaar = m.groups()
    mnd_map = {"jan":1,"feb":2,"mrt":3,"apr":4,"mei":5,"jun":6,
               "jul":7,"aug":8,"sep":9,"okt":10,"nov":11,"dec":12}
    try: return date(int(jaar), mnd_map[mnd], int(dag))
    except: return None

kaarten_gefilterd = []
for k in kaarten:
    d = datum_uit_naam(k)
    if d is None or d >= vandaag:
        kaarten_gefilterd.append(k)

kaarten_gefilterd.sort()
with open("index.json","w") as f:
    json.dump(kaarten_gefilterd, f)
print(f"index.json: {len(kaarten_gefilterd)} kaarten")
