"""
haal_maanddata.py
Haalt daggegevens op voor KNMI-stations via KNMI ZIP en vult de laatste
ontbrekende dagen aan via de EDR API. Optionele stationsnummers op de
commandoregel beperken een handmatige/test-run; zonder argumenten draait alles.
"""
import os, requests, zipfile, io, json, sys
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

def _wigos(nr): return f"0-20000-0-06{nr}"
# Volledige KNMI-stations-lijst (zelfde als knmi_records.py)
_RUW = [
    # Hoofdstations
    (260, "De Bilt"), (344, "Rotterdam Airport"), (330, "Hoek van Holland"),
    (235, "Den Helder"), (240, "Schiphol"), (270, "Leeuwarden"),
    (280, "Eelde"), (290, "Twenthe"), (310, "Vlissingen"), (380, "Maastricht"),
    # Overige stations
    (210, "Valkenburg"), (215, "Voorschoten"), (225, "IJmuiden"),
    (229, "Texelhors"), (242, "Vlieland"), (248, "Wijdenes"), (249, "Berkhout"),
    (251, "Terschelling"), (257, "Wijk aan Zee"), (258, "Houtribdijk"),
    (265, "Soesterberg"), (267, "Stavoren"), (269, "Lelystad"),
    (273, "Marknesse"), (275, "Deelen"), (277, "Lauwersoog"),
    (278, "Heino"), (279, "Hoogeveen"), (283, "Hupsel"), (286, "Nieuw Beerta"),
    (319, "Westdorpe"), (323, "Wilhelminadorp"), (324, "Stavenisse"),
    (331, "Tholen"), (340, "Woensdrecht"), (343, "Rotterdam Geulhaven"),
    (348, "Cabauw"), (350, "Gilze-Rijen"), (356, "Herwijnen"),
    (370, "Eindhoven"), (375, "Volkel"), (377, "Ell"),
    (391, "Arcen"), (392, "Horst"),
]
STATIONS = [(nr, naam, _wigos(nr)) for nr, naam in _RUW]
if len(sys.argv) > 1:
    gevraagd = {int(arg) for arg in sys.argv[1:]}
    STATIONS = [station for station in STATIONS if station[0] in gevraagd]

KLIMAATARCHIEF_STATIONS = {235, 240, 260, 270, 275, 280, 283, 286, 290, 310, 330, 344, 350, 370, 380, 391}
MAANDDATA_FIELDS = ("tx", "tn", "tg", "rr", "sq", "q", "t10n")

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
KNMI_KEY  = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY2ZjIwYWZjOTMwYTRkNDY5M2Q3MTc5OWVhMTI4ZGQwIiwiaCI6Im11cm11cjEyOCJ9"
EDR_BASE  = "https://api.dataplatform.knmi.nl/edr/v1/collections"
HEADERS   = {"Authorization": KNMI_KEY}

EDR_COLLECTIES = [
    "daily-in-situ-meteorological-observations-validated",
    "daily-in-situ-meteorological-observations",
]
TOPLIJST_PATH = "toplijst.json"

def laad_toplijst():
    try:
        with open(TOPLIJST_PATH) as f:
            return json.load(f)
    except Exception:
        return {}

TOPLIJST = laad_toplijst()

def toplijst_waarde(datum, lijst, station_naam):
    rijen = TOPLIJST.get(datum, {}).get(lijst, [])
    if not isinstance(rijen, list):
        return None
    for rij in rijen:
        if len(rij) >= 2 and rij[1] == station_naam and isinstance(rij[0], (int, float)):
            return round(float(rij[0]), 1)
    return None

def pas_toplijst_correctie_toe(edr, datum, station_naam):
    correcties = []
    for lijst, veld in (("max", "tx"), ("min", "tn")):
        waarde = toplijst_waarde(datum, lijst, station_naam)
        if waarde is None:
            continue
        oud = edr.get(veld)
        if oud != waarde:
            correcties.append(f"{veld.upper()} {oud}->{waarde}")
            edr[veld] = waarde
    return correcties

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
                'q': getal('Q', 1),      # globale straling, J/cm2 (geen schaling)
                't10n': getal('T10N'),   # min. temp op 10 cm (grastemp)
                'ddvec': getal('DDVEC', 1),  # vector-gemiddelde windrichting, graden
                'fhvec': getal('FHVEC'),     # vector-gemiddelde windsnelheid, m/s
                'fg': getal('FG'),           # etmaalgemiddelde windsnelheid, m/s
                'sp': getal('SP', 1),        # relatieve zonneschijnduur, procent
            }
        except:
            continue
    return data

def _edr_query(wigos, edr_datum):
    """Vraag EDR voor een specifieke (UTC) datum. Returnt dict of None."""
    s = f"{edr_datum}T00:00:00Z"
    e = f"{edr_datum}T23:59:59Z"
    params = {"datetime": f"{s}/{e}", "parameter-name": "TX,TN,TG,RH,SQ,Q,T10N,DDVEC,FHVEC,FG,SP"}
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
            q  = laatste("Q");  t10n = laatste("T10N")
            ddvec = laatste("DDVEC"); fhvec = laatste("FHVEC")
            fg = laatste("FG"); sp = laatste("SP")
            if all(v is None for v in [tx, tn, tg, rr, sq, ddvec, fhvec, fg, sp]):
                continue
            bron = "validated" if "validated" in collectie else "realtime"
            return {
                'tx': round(tx, 1) if tx is not None else None,
                'tn': round(tn, 1) if tn is not None else None,
                'tg': round(tg, 1) if tg is not None else None,
                'rr': round(rr, 1) if rr is not None else None,
                'sq': round(sq, 1) if sq is not None else None,
                'q':  round(q, 0) if q is not None else None,
                't10n': round(t10n, 1) if t10n is not None else None,
                'ddvec': round(ddvec) if ddvec is not None else None,
                'fhvec': round(fhvec, 1) if fhvec is not None else None,
                'fg': round(fg, 1) if fg is not None else None,
                'sp': round(sp) if sp is not None else None,
                '_bron': bron,
            }
        except:
            continue
    return None

def haal_edr_dag(wigos, datum):
    """Haal 1 dag op via EDR: eerst validated, dan realtime als fallback.
    De EDR API gebruikt UTC-etmalen (00-00 UTC), terwijl de KNMI ZIP-bestanden
    etmaalwaarden gebruiken (08-08 UTC). Hierdoor loopt de EDR-datum 1 dag
    voor op de ZIP-conventie. We vragen daarom eerst datum+1 op (matcht ZIP).
    Als dat faalt — typisch voor de meest recente dag waarvoor het 0-0 UTC
    etmaal nog niet voltooid is — vallen we terug op datum zelf (geeft een
    iets afwijkende, maar bruikbare waarde voor gisteren)."""
    res = _edr_query(wigos, (date.fromisoformat(datum) + timedelta(days=1)).isoformat())
    if res:
        return res
    return _edr_query(wigos, datum)

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

        # Vul aan met EDR API t/m gisteren — maximaal 14 dagen terug.
        # Voorkomt urenlange runs voor gesloten/historische stations waarvan
        # de ZIP jaren achterloopt; EDR heeft sowieso geen oudere data.
        EDR_MAX_DAGEN_TERUG = 14
        startdatum = max(laatste_datum + timedelta(days=1), gisteren - timedelta(days=EDR_MAX_DAGEN_TERUG))
        d = startdatum
        aangevuld = 0
        while d <= gisteren:
            edr = haal_edr_dag(wigos, d.isoformat())
            if edr:
                correcties = pas_toplijst_correctie_toe(edr, d.isoformat(), naam)
                bron = edr.pop('_bron', '?')
                data[d.isoformat()] = edr
                aangevuld += 1
                extra = f" ({'; '.join(correcties)} via toplijst)" if correcties else ""
                print(f"    EDR [{bron}] {d}: tx={edr['tx']}° tn={edr['tn']}°{extra}")
            d += timedelta(days=1)

        if aangevuld:
            print(f"  {naam}: {aangevuld} dag(en) aangevuld via EDR (t/m gisteren)")

        # Bewaar voor klimaatarchiefstations een kleine recente overlap met de
        # extra wind- en SP-velden. Zo blijven de algemene maanddata-bestanden
        # compact en achterwaarts compatibel.
        if station_nr in KLIMAATARCHIEF_STATIONS:
            patch_dates = sorted(data)[-45:]
            patch_resultaat = {
                "station": station_nr,
                "naam": naam,
                "data": {datum: data[datum] for datum in patch_dates},
            }
            patch_name = f"klimaatarchief_actueel_{station_nr}.json"
            with open(patch_name, "w") as f:
                json.dump(patch_resultaat, f, separators=(",", ":"))

        publieke_data = {
            datum: {veld: dag.get(veld) for veld in MAANDDATA_FIELDS}
            for datum, dag in data.items()
        }
        resultaat = {
            "station": station_nr,
            "naam": naam,
            "bijgewerkt": datetime.now(LOCAL_TZ).strftime("%d %b %Y %H:%M"),
            "data": publieke_data
        }
        fname = f"maanddata_{station_nr}.json"
        with open(fname, "w") as f:
            json.dump(resultaat, f)
        print(f"  Opgeslagen: {fname} ({len(publieke_data)} dagen, t/m {max(publieke_data.keys())})")
    except Exception as e:
        print(f"  FOUT {station_nr}: {e}")

print("Klaar!")
