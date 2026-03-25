"""
haal_maanddata.py
Haalt daggegevens op voor Rotterdam Airport (344) via KNMI ZIP
en slaat op als maanddata_344.json voor maandoverzicht.html
"""
import os, requests, zipfile, io, json
from datetime import datetime, date
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

STATIONS = [
    (260, "De Bilt"),
    (235, "Den Helder"),
    (280, "Eelde"),
    (310, "Vlissingen"),
    (380, "Maastricht"),
    (330, "Hoek van Holland"),
    (344, "Rotterdam Airport"),
]
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

def haal_zip(station_nr):
    url = f"https://cdn.knmi.nl/knmi/map/page/klimatologie/gegevens/daggegevens/etmgeg_{station_nr}.zip"
    print(f"  Downloaden station {station_nr}...")
    r = requests.get(url, timeout=60)
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
                'rr': getal('RH'),   # neerslag som (kolom RH in KNMI ZIP)
                'sq': getal('SQ'),
                'ug': getal('UG', 1),  # relatieve vochtigheid %
                'pg': getal('PG', 10), # gem luchtdruk hPa
            }
        except:
            continue
    return data

nu = date.today()

for station_nr, naam in STATIONS:
    try:
        tekst = haal_zip(station_nr)
        data  = parse_zip(tekst)
        data  = {k: v for k, v in data.items() if k <= nu.isoformat()}
        resultaat = {
            "station": station_nr,
            "naam": naam,
            "bijgewerkt": datetime.now(LOCAL_TZ).strftime("%d %b %Y %H:%M"),
            "data": data
        }
        fname = f"maanddata_{station_nr}.json"
        with open(fname, "w") as f:
            json.dump(resultaat, f)
        print(f"  Opgeslagen: {fname} ({len(data)} dagen)")
    except Exception as e:
        print(f"  FOUT {station_nr}: {e}")

print("Klaar!")
