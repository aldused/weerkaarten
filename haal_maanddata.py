"""
haal_maanddata.py
Haalt daggegevens op via KNMI ZIP (gevalideerd) en vult de meest
recente dagen aan via de KNMI EDR API (niet-gevalideerd, zelfde dag).
"""
import os, requests, zipfile, io, json
from datetime import datetime, date, timedelta
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

# WIGOS-IDs voor EDR API
WIGOS = {
    260: "0-20000-0-06260",
    235: "0-20000-0-06235",
    280: "0-20000-0-06280",
    310: "0-20000-0-06310",
    380: "0-20000-0-06380",
    330: "0-20000-0-06330",
    344: "0-20000-0-06344",
}

EDR_KEY = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6ImNjNWRiNTU0NTZhNTQzZTRiMDZlZjg0NjExNTA2Y2EwIiwiaCI6Im11cm11cjEyOCJ9"
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

def haal_zip(station_nr):
    url = f"https://cdn.knmi.nl/knmi/map/page/klimatologie/gegevens/daggegevens/etmgeg_{station_nr}.zip"
    print(f"  ZIP downloaden station {station_nr}...")
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
                if iv == -1: return 0.0
                return round(iv/schaal, 1)
            data[datum.isoformat()] = {
                'tx': getal('TX'),
                'tn': getal('TN'),
                'tg': getal('TG'),
                'rr': getal('RH'),
                'sq': getal('SQ'),
                'ug': getal('UG', 1),
                'pg': getal('PG', 10),
            }
        except:
            continue
    return data

def haal_edr(station_nr, start_datum, eind_datum):
    """Vul recente dagen aan via EDR API."""
    wigos = WIGOS.get(station_nr)
    if not wigos: return {}
    start = f"{start_datum}T00:00:00Z"
    eind  = f"{eind_datum}T23:59:59Z"
    url = (f"https://api.dataplatform.knmi.nl/edr/v1/collections/"
           f"daily-in-situ-meteorological-observations-validated/locations/{wigos}"
           f"?datetime={start}/{eind}&parameter-name=TX,TN,RH,SQ")
    try:
        r = requests.get(url, headers={"Authorization": EDR_KEY}, timeout=30)
        r.raise_for_status()
        js = r.json()
        params = js.get("parameters", {})
        times  = js.get("domain", {}).get("axes", {}).get("t", {}).get("values", [])
        result = {}
        for i, t in enumerate(times):
            d = t[:10]
            def val(naam, idx=i):
                v = params.get(naam, {}).get("values", [])
                if idx >= len(v) or v[idx] is None: return None
                return round(v[idx], 1)
            result[d] = {
                "tx": val("TX"),
                "tn": val("TN"),
                "rr": val("RH"),
                "sq": val("SQ"),
                "tg": None, "ug": None, "pg": None,
            }
        return result
    except Exception as e:
        print(f"    EDR fout {station_nr}: {e}")
        return {}

nu = date.today()

for station_nr, naam in STATIONS:
    try:
        tekst = haal_zip(station_nr)
        data  = parse_zip(tekst)
        data  = {k: v for k, v in data.items() if k <= nu.isoformat()}

        # Zoek de laatste datum in de ZIP
        if data:
            laatste_zip = max(data.keys())
            laatste_datum = date.fromisoformat(laatste_zip)
        else:
            laatste_datum = nu - timedelta(days=7)

        # Vul aan met EDR als er ontbrekende dagen zijn
        if laatste_datum < nu:
            start = (laatste_datum + timedelta(days=1)).isoformat()
            eind  = nu.isoformat()
            print(f"  EDR aanvullen {naam} van {start} t/m {eind}...")
            edr_data = haal_edr(station_nr, start, eind)
            if edr_data:
                print(f"    {len(edr_data)} dag(en) toegevoegd via EDR")
                data.update(edr_data)

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
