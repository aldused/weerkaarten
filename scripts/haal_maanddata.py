"""
haal_maanddata.py
Haalt daggegevens op voor 7 stations via KNMI ZIP
en vult de laatste ontbrekende dagen aan via de EDR API.
"""
import os, requests, zipfile, io, json
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

STATIONS = [
    (260, "De Bilt",           "0-20000-0-06260"),
    (235, "Den Helder",        "0-20000-0-06235"),
    (280, "Eelde",             "0-20000-0-06280"),
    (310, "Vlissingen",        "0-20000-0-06310"),
    (380, "Maastricht",        "0-20000-0-06380"),
    (330, "Hoek van Holland",  "0-20000-0-06330"),
    (344, "Rotterdam Airport", "0-20000-0-06344"),
]

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
KNMI_KEY  = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY2ZjIwYWZjOTMwYTRkNDY5M2Q3MTc5OWVhMTI4ZGQwIiwiaCI6Im11cm11cjEyOCJ9"
EDR_BASE  = "https://api.dataplatform.knmi.nl/edr/v1/collections"
HEADERS   = {"Authorization": KNMI_KEY}

EDR_COLLECTIES = [
    "daily-in-situ-meteorological-observations-validated",
    "daily-in-situ-meteorological-observations",
]

def haal_zip(station_nr):
    url = f"https://cdn.knmi.nl/knmi/map/page/klimatologie/gegevens/daggegevens/etmgeg_{station_nr}.zip"
    print(f"  ZIP station {station_nr}...")
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
            }
        except:
            continue
    return data

def haal_edr_dag(wigos, datum):
    """Haal 1 dag op via EDR: eerst validated, dan realtime als fallback.
    De EDR API gebruikt UTC-etmalen (00-00 UTC), terwijl de KNMI ZIP-bestanden
    etmaalwaarden gebruiken (08-08 UTC). Hierdoor loopt de EDR-datum 1 dag
    voor op de ZIP-conventie. We vragen daarom datum+1 op bij de EDR API."""
    edr_datum = (date.fromisoformat(datum) + timedelta(days=1)).isoformat()
    s = f"{edr_datum}T00:00:00Z"
    e = f"{edr_datum}T23:59:59Z"
    params = {"datetime": f"{s}/{e}", "parameter-name": "TX,TN,TG,RH,SQ"}

    for collectie in EDR_COLLECTIES:
        try:
            r = requests.get(
                f"{EDR_BASE}/{collectie}/locations/{wigos}",
                headers=HEADERS,
                params=params,
                timeout=15
            )
            if r.status_code != 200:
                continue
            js = r.json()
            if not js.get("coverages"):
                continue
            ranges = js["coverages"][0].get("ranges", {})
            def laatste(key):
                vals = ranges.get(key, {}).get("values", [])
                for v in reversed(vals):
                    if v is not None: return v
                return None
            tx = laatste("TX"); tn = laatste("TN"); tg = laatste("TG")
            rr = laatste("RH"); sq = laatste("SQ")
            if all(v is None for v in [tx, tn, tg, rr, sq]):
                continue
            bron = "validated" if "validated" in collectie else "realtime"
            return {
                'tx': round(tx, 1) if tx is not None else None,
                'tn': round(tn, 1) if tn is not None else None,
                'tg': round(tg, 1) if tg is not None else None,
                'rr': round(rr, 1) if rr is not None else None,
                'sq': round(sq, 1) if sq is not None else None,
                '_bron': bron,
            }
        except:
            continue
    return None

nu       = date.today()
gisteren = nu - timedelta(days=1)

for station_nr, naam, wigos in STATIONS:
    try:
        tekst = haal_zip(station_nr)
        data  = parse_zip(tekst)
        # Filter tot en met gisteren — vandaag is nog niet volledig
        data  = {k: v for k, v in data.items() if k <= gisteren.isoformat()}

        # Vind de laatste datum in de ZIP
        laatste_zip = max(data.keys()) if data else "2000-01-01"
        laatste_datum = date.fromisoformat(laatste_zip)

        # Vul aan met EDR API t/m gisteren (vandaag is nog niet volledig)
        d = laatste_datum + timedelta(days=1)
        aangevuld = 0
        while d <= gisteren:
            edr = haal_edr_dag(wigos, d.isoformat())
            if edr:
                bron = edr.pop('_bron', '?')
                data[d.isoformat()] = edr
                aangevuld += 1
                print(f"    EDR [{bron}] {d}: tx={edr['tx']}° tn={edr['tn']}°")
            d += timedelta(days=1)

        if aangevuld:
            print(f"  {naam}: {aangevuld} dag(en) aangevuld via EDR (t/m gisteren)")

        resultaat = {
            "station": station_nr,
            "naam": naam,
            "bijgewerkt": datetime.now(LOCAL_TZ).strftime("%d %b %Y %H:%M"),
            "data": data
        }
        fname = f"maanddata_{station_nr}.json"
        with open(fname, "w") as f:
            json.dump(resultaat, f)
        print(f"  Opgeslagen: {fname} ({len(data)} dagen, t/m {max(data.keys())})")
    except Exception as e:
        print(f"  FOUT {station_nr}: {e}")

print("Klaar!")
