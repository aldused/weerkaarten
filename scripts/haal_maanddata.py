"""
haal_maanddata.py
Haalt daggegevens op voor Rotterdam Airport (344) via KNMI ZIP
en slaat op als maanddata_344.json voor maandoverzicht.html
"""
import os, requests, zipfile, io, json
from datetime import datetime, date
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

STATION  = 344
ZIP_URL  = f"https://cdn.knmi.nl/knmi/map/page/klimatologie/gegevens/daggegevens/etmgeg_{STATION}.zip"
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

def haal_zip():
    print(f"Downloaden KNMI ZIP station {STATION}...")
    r = requests.get(ZIP_URL, timeout=60)
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    naam = next(n for n in z.namelist() if n.endswith('.txt'))
    return z.read(naam).decode('latin-1')

def parse_zip(tekst):
    data = {}
    in_data = False
    kolommen = []
    for regel in tekst.splitlines():
        regel = regel.strip()
        if not regel: continue
        if regel.startswith('# STN,'):
            # Kolomnamen ophalen
            kolommen = [k.strip() for k in regel[2:].split(',')]
            in_data = True
            continue
        if not in_data: continue
        if regel.startswith('#'): continue
        delen = [d.strip() for d in regel.split(',')]
        if len(delen) < len(kolommen): continue
        rij = dict(zip(kolommen, delen))
        try:
            datum_str = rij.get('YYYYMMDD','')
            if len(datum_str) != 8: continue
            datum = date(int(datum_str[:4]), int(datum_str[4:6]), int(datum_str[6:8]))
            def getal(k, schaal=10):
                v = rij.get(k,'').strip()
                if not v: return None
                iv = int(v)
                if iv == -1: return 0.0  # spoor/trace
                return round(iv/schaal, 1)
            data[datum.isoformat()] = {
                'tx': getal('TX'),
                'tn': getal('TN'),
                'tg': getal('TG'),
                'rr': getal('RR'),
                'sq': getal('SQ'),
                'fx': getal('FXX'),  # max windstoot in 0.1 m/s (KNMI kolom FXX)
                'ug': getal('UG', 1),  # relatieve vochtigheid %
                'pg': getal('PG', 10), # gem luchtdruk hPa
            }
        except:
            continue
    return data

tekst = haal_zip()
data  = parse_zip(tekst)
print(f"{len(data)} dagen geladen")

# Bewaar alleen jaren t/m heden
nu = date.today()
data = {k: v for k, v in data.items() if k <= nu.isoformat()}

# Voeg update-timestamp toe
resultaat = {
    "station": STATION,
    "naam": "Rotterdam Airport",
    "bijgewerkt": datetime.now(LOCAL_TZ).strftime("%d %b %Y %H:%M"),
    "data": data
}

with open("maanddata_344.json", "w") as f:
    json.dump(resultaat, f)

print(f"Opgeslagen: maanddata_344.json ({len(data)} dagen)")
