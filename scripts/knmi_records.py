"""
knmi_records.py

Stap 1: Download historische dagwaarden voor De Bilt (station 260) via KNMI klimatologie API
Stap 2: Bereken records per dag, decade, maand, seizoen, jaar en alltime
Stap 3: Sla op als records_debilt.json
"""

import os, json, requests
from datetime import date, datetime, timedelta
from collections import defaultdict

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# ── Configuratie ──────────────────────────────────────────────────────────────
STATIONS = [
    # Hoofdstations
    ("260",  "De Bilt"),
    ("344",  "Rotterdam"),
    ("330",  "Hoek van Holland"),
    ("235",  "Den Helder"),
    ("240",  "Schiphol"),
    ("270",  "Leeuwarden"),
    ("280",  "Eelde"),
    ("290",  "Twenthe"),
    ("310",  "Vlissingen"),
    ("380",  "Maastricht"),
    # Overige stations
    ("210",  "Valkenburg"),
    ("215",  "Voorschoten"),
    ("225",  "IJmuiden"),
    ("229",  "Texelhors"),
    ("242",  "Vlieland"),
    ("248",  "Wijdenes"),
    ("249",  "Berkhout"),
    ("251",  "Terschelling"),
    ("257",  "Wijk aan Zee"),
    ("258",  "Houtribdijk"),
    ("265",  "Soesterberg"),
    ("267",  "Stavoren"),
    ("269",  "Lelystad"),
    ("273",  "Marknesse"),
    ("275",  "Deelen"),
    ("277",  "Lauwersoog"),
    ("278",  "Heino"),
    ("279",  "Hoogeveen"),
    ("283",  "Hupsel"),
    ("286",  "Nieuw Beerta"),
    ("319",  "Westdorpe"),
    ("323",  "Wilhelminadorp"),
    ("324",  "Stavenisse"),
    ("331",  "Tholen"),
    ("340",  "Woensdrecht"),
    ("343",  "Rotterdam Geulhaven"),
    ("348",  "Cabauw"),
    ("350",  "Gilze-Rijen"),
    ("356",  "Herwijnen"),
    ("370",  "Eindhoven"),
    ("375",  "Volkel"),
    ("377",  "Ell"),
    ("391",  "Arcen"),
    ("392",  "Horst"),
]

# Parameters: TX=max temp, TN=min temp, RH=neerslag, FX=max windstoot, FG=gem wind
# Waarden in 0.1 eenheden → delen door 10. RH: -1 = <0.05mm

# ── Download ──────────────────────────────────────────────────────────────────
def download_knmi(station, cache_path):
    gisteren = (date.today() - timedelta(days=1)).isoformat()

    # Check of cache actueel is
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            inhoud = f.read()
        # Zoek laatste datum in bestand
        laatste = ""
        for regel in inhoud.splitlines():
            if regel.strip() and not regel.startswith("#"):
                delen = regel.strip().split(",")
                if len(delen) > 1:
                    d = delen[1].strip()
                    if len(d) == 8 and d.isdigit():
                        laatste = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        if laatste >= gisteren:
            print(f"Cache actueel ({laatste}): {cache_path}")
            return inhoud
        else:
            print(f"Cache verouderd ({laatste}), opnieuw downloaden...")
            os.remove(cache_path)

    zip_url = f"https://cdn.knmi.nl/knmi/map/page/klimatologie/gegevens/daggegevens/etmgeg_{station}.zip"
    print(f"Downloaden: {zip_url}...")
    r = requests.get(zip_url, timeout=60)
    r.raise_for_status()

    import zipfile, io
    z = zipfile.ZipFile(io.BytesIO(r.content))
    tekst = z.read(z.namelist()[0]).decode("latin-1")

    with open(cache_path, "w", encoding="utf-8") as f:
        f.write(tekst)
    print(f"Opgeslagen: {cache_path} ({len(tekst)} bytes)")
    return tekst

# ── Parse CSV ─────────────────────────────────────────────────────────────────
def parse_csv(tekst):
    """
    Parset KNMI etmgeg CSV → lijst van dicts per dag.
    Waarden in 0.1 eenheden → delen door 10.
    Kolomnamen staan op de laatste # regel voor de data.
    """
    records = []
    kolomnamen = None
    for regel in tekst.splitlines():
        stripped = regel.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            # Laatste #-regel met STN bevat kolomnamen
            if "STN" in stripped and "YYYYMMDD" in stripped:
                kolomnamen = [k.strip() for k in stripped.lstrip("#").split(",")]
            continue
        if kolomnamen is None:
            continue
        delen = [d.strip() for d in stripped.split(",")]
        if len(delen) < 4:
            continue
        try:
            datum_str = delen[1].strip()
            jaar  = int(datum_str[:4])
            maand = int(datum_str[4:6])
            dag   = int(datum_str[6:8])
        except:
            continue

        def val(naam):
            try:
                idx = kolomnamen.index(naam)
                v = delen[idx].strip()
                if v == "" or v == "9": return None
                f = float(v)
                if naam == "RH" and f < 0: return 0.0
                if naam == "SQ" and f < 0: return 0.0
                return round(f / 10.0, 1)
            except:
                return None

        records.append({
            "datum":   f"{jaar:04d}-{maand:02d}-{dag:02d}",
            "jaar":    jaar,
            "maand":   maand,
            "dag":     dag,
            "decade":  ((dag - 1) // 10) + 1,
            "seizoen": seizoen(maand),
            "tx": val("TX"),
            "tn": val("TN"),
            "tg": val("TG"),
            "rh": val("RH"),
            "fx": val("FXX"),
            "fg": val("FG"),
            "fhx": val("FHX"),
            "pg": val("PG"),
            "px": val("PX"),
            "pn": val("PN"),
            "sq": val("SQ"),
        })
    return records

def seizoen(maand):
    if maand in (12, 1, 2):  return "winter"
    if maand in (3, 4, 5):   return "lente"
    if maand in (6, 7, 8):   return "zomer"
    return "herfst"

# ── Record helpers ────────────────────────────────────────────────────────────
def top10_max(groep, param):
    vals = [(r[param], r["datum"]) for r in groep if r[param] is not None]
    return sorted(vals, reverse=True)[:25]

def top10_min(groep, param):
    vals = [(r[param], r["datum"]) for r in groep if r[param] is not None]
    return sorted(vals)[:25]

def bereken_hittegolven(groep):
    """
    KNMI-definitie: ≥5 aaneengesloten dagen TX≥25°C, waarvan ≥3 dagen TX≥30°C.
    Geeft lijst van hittegolven: {start, eind, duur, tropische_dagen, tx_max}
    """
    # Sorteer op datum
    dagen = sorted([r for r in groep if r["tx"] is not None], key=lambda r: r["datum"])
    golven = []
    i = 0
    while i < len(dagen):
        if dagen[i]["tx"] >= 25:
            # Begin van een warme reeks
            j = i
            while j < len(dagen) and dagen[j]["tx"] >= 25:
                j += 1
            reeks = dagen[i:j]
            duur = len(reeks)
            if duur >= 5:
                tropisch = sum(1 for r in reeks if r["tx"] >= 30)
                if tropisch >= 3:
                    golven.append({
                        "start": reeks[0]["datum"],
                        "eind":  reeks[-1]["datum"],
                        "duur":  duur,
                        "tropische_dagen": tropisch,
                        "tx_max": max(r["tx"] for r in reeks),
                    })
            i = j
        else:
            i += 1
    return golven

def bereken_koudegolven(groep):
    """
    KNMI-definitie: ≥5 aaneengesloten ijsdagen (TX<0°C),
    waarvan ≥3 dagen met strenge vorst (TN<-10°C).
    Geeft lijst van koudegolven: {start, eind, duur, strenge_vorst_dagen, tn_min}
    """
    dagen = sorted([r for r in groep if r["tx"] is not None], key=lambda r: r["datum"])
    golven = []
    i = 0
    while i < len(dagen):
        if dagen[i]["tx"] < 0:
            j = i
            while j < len(dagen) and dagen[j]["tx"] < 0:
                j += 1
            reeks = dagen[i:j]
            duur = len(reeks)
            if duur >= 5:
                streng = sum(1 for r in reeks if r["tn"] is not None and r["tn"] < -10)
                if streng >= 3:
                    golven.append({
                        "start": reeks[0]["datum"],
                        "eind":  reeks[-1]["datum"],
                        "duur":  duur,
                        "strenge_vorst_dagen": streng,
                        "tn_min": min(r["tn"] for r in reeks if r["tn"] is not None),
                    })
            i = j
        else:
            i += 1
    return golven

# ── Hoofdprogramma ────────────────────────────────────────────────────────────
for STATION, STATION_NAAM in STATIONS:
    CACHE_CSV   = f"knmi_dagdata_{STATION}.csv"
    OUTPUT_JSON = f"records_{STATION}.json"
    csv_tekst = download_knmi(STATION, CACHE_CSV)
    data      = parse_csv(csv_tekst)
    if not data:
        print(f"Geen data voor {STATION_NAAM}"); continue
    print(f"Dagen ingelezen: {len(data)} (van {data[0]['datum']} t/m {data[-1]['datum']})")

    records = {
        "station":    STATION_NAAM,
        "station_nr": STATION,
        "van":        data[0]["datum"],
        "tm":         data[-1]["datum"],
        "gegenereerd": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "dag":        {},
        "decade":     {},
        "maand":      {},
        "seizoen":    {},
        "jaar":       {},
        "alltime":    {},
    }

# ── Dagrecords ────────────────────────────────────────────────────────────────
    print(f"Dagrecords berekenen... ({STATION_NAAM})")
    dag_groepen = defaultdict(list)
    for r in data:
        dag_groepen[(r["maand"], r["dag"])].append(r)

    for (m, d), groep in dag_groepen.items():
        msleutel = str(m); dsleutel = str(d)
        if msleutel not in records["dag"]: records["dag"][msleutel] = {}
        records["dag"][msleutel][dsleutel] = {
            "tx_hoog": top10_max(groep, "tx"), "tx_laag": top10_min(groep, "tx"),
            "tn_hoog": top10_max(groep, "tn"), "tn_laag": top10_min(groep, "tn"),
            "tg_hoog": top10_max(groep, "tg"), "tg_laag": top10_min(groep, "tg"),
            "rh_hoog": top10_max(groep, "rh"), "fx_hoog": top10_max(groep, "fx"),
            "fhx_hoog": top10_max(groep, "fhx"),
            "fg_hoog":  top10_max(groep, "fg"),
            "pg_hoog": top10_max(groep, "pg"), "pg_laag": top10_min(groep, "pg"),
            "px_hoog": top10_max(groep, "px"), "pn_laag": top10_min(groep, "pn"),
            "sq_hoog": top10_max(groep, "sq"),
        }

    # ── Decaderecords ──────────────────────────────────────────────────────────
    print("Decaderecords berekenen...")
    dec_groepen = defaultdict(list)
    for r in data: dec_groepen[(r["maand"], r["decade"])].append(r)
    for (m, dec), groep in dec_groepen.items():
        msleutel = str(m); dsleutel = str(dec)
        if msleutel not in records["decade"]: records["decade"][msleutel] = {}
        records["decade"][msleutel][dsleutel] = {
            "tx_hoog": top10_max(groep, "tx"), "tx_laag": top10_min(groep, "tx"),
            "tn_hoog": top10_max(groep, "tn"), "tn_laag": top10_min(groep, "tn"),
            "tg_hoog": top10_max(groep, "tg"), "tg_laag": top10_min(groep, "tg"),
            "rh_hoog": top10_max(groep, "rh"), "fx_hoog": top10_max(groep, "fx"),
            "fhx_hoog": top10_max(groep, "fhx"),
            "fg_hoog":  top10_max(groep, "fg"),
            "pg_hoog": top10_max(groep, "pg"), "pg_laag": top10_min(groep, "pg"),
            "px_hoog": top10_max(groep, "px"), "pn_laag": top10_min(groep, "pn"),
            "sq_hoog": top10_max(groep, "sq"),
        }

    # ── Maandrecords ───────────────────────────────────────────────────────────
    print("Maandrecords berekenen...")
    mnd_groepen = defaultdict(list)
    for r in data: mnd_groepen[r["maand"]].append(r)
    for m, groep in mnd_groepen.items():
        records["maand"][str(m)] = {
            "tx_hoog": top10_max(groep, "tx"), "tx_laag": top10_min(groep, "tx"),
            "tn_hoog": top10_max(groep, "tn"), "tn_laag": top10_min(groep, "tn"),
            "tg_hoog": top10_max(groep, "tg"), "tg_laag": top10_min(groep, "tg"),
            "rh_hoog": top10_max(groep, "rh"), "fx_hoog": top10_max(groep, "fx"),
            "fhx_hoog": top10_max(groep, "fhx"),
            "fg_hoog":  top10_max(groep, "fg"),
            "pg_hoog": top10_max(groep, "pg"), "pg_laag": top10_min(groep, "pg"),
            "px_hoog": top10_max(groep, "px"), "pn_laag": top10_min(groep, "pn"),
            "sq_hoog": top10_max(groep, "sq"),
        }

    # ── Seizoensrecords ────────────────────────────────────────────────────────
    print("Seizoensrecords berekenen...")
    sei_groepen = defaultdict(list)
    for r in data: sei_groepen[r["seizoen"]].append(r)
    for s, groep in sei_groepen.items():
        records["seizoen"][s] = {
            "tx_hoog": top10_max(groep, "tx"), "tx_laag": top10_min(groep, "tx"),
            "tn_hoog": top10_max(groep, "tn"), "tn_laag": top10_min(groep, "tn"),
            "tg_hoog": top10_max(groep, "tg"), "tg_laag": top10_min(groep, "tg"),
            "rh_hoog": top10_max(groep, "rh"), "fx_hoog": top10_max(groep, "fx"),
            "fhx_hoog": top10_max(groep, "fhx"),
            "fg_hoog":  top10_max(groep, "fg"),
            "pg_hoog": top10_max(groep, "pg"), "pg_laag": top10_min(groep, "pg"),
            "px_hoog": top10_max(groep, "px"), "pn_laag": top10_min(groep, "pn"),
            "sq_hoog": top10_max(groep, "sq"),
        }

    # ── Jaarrecords ────────────────────────────────────────────────────────────
    print("Jaarrecords berekenen...")
    jaar_groepen = defaultdict(list)
    for r in data: jaar_groepen[r["jaar"]].append(r)
    for j, groep in jaar_groepen.items():
        records["jaar"][str(j)] = {
            "tx_hoog": top10_max(groep, "tx"), "tx_laag": top10_min(groep, "tx"),
            "tn_hoog": top10_max(groep, "tn"), "tn_laag": top10_min(groep, "tn"),
            "tg_hoog": top10_max(groep, "tg"), "tg_laag": top10_min(groep, "tg"),
            "rh_hoog": top10_max(groep, "rh"), "fx_hoog": top10_max(groep, "fx"),
            "fhx_hoog": top10_max(groep, "fhx"),
            "fg_hoog":  top10_max(groep, "fg"),
            "pg_hoog": top10_max(groep, "pg"), "pg_laag": top10_min(groep, "pg"),
            "px_hoog": top10_max(groep, "px"), "pn_laag": top10_min(groep, "pn"),
            "sq_hoog": top10_max(groep, "sq"),
            "sq_totaal": round(sum(r["sq"] for r in groep if r["sq"] is not None), 1),
            "warme_dagen":     sum(1 for r in groep if r["tx"] is not None and r["tx"] >= 20),
            "ijsdagen":        sum(1 for r in groep if r["tx"] is not None and r["tx"] <  0),
            "vorstdagen":      sum(1 for r in groep if r["tn"] is not None and r["tn"] <  0),
            "zomerse_dagen":   sum(1 for r in groep if r["tx"] is not None and r["tx"] >= 25),
            "tropische_dagen": sum(1 for r in groep if r["tx"] is not None and r["tx"] >= 30),
            "hittegolven":     bereken_hittegolven(groep),
            "koudegolven":     bereken_koudegolven(groep),
        }

    # ── Alltime records ────────────────────────────────────────────────────────
    print("Alltime records berekenen...")
    records["alltime"] = {
        "tx_hoog": top10_max(data, "tx"), "tx_laag": top10_min(data, "tx"),
        "tn_hoog": top10_max(data, "tn"), "tn_laag": top10_min(data, "tn"),
        "tg_hoog": top10_max(data, "tg"), "tg_laag": top10_min(data, "tg"),
        "rh_hoog": top10_max(data, "rh"), "fx_hoog": top10_max(data, "fx"),
        "fhx_hoog": top10_max(data, "fhx"),
        "fg_hoog":  top10_max(data, "fg"),
        "pg_hoog": top10_max(data, "pg"), "pg_laag": top10_min(data, "pg"),
        "px_hoog": top10_max(data, "px"), "pn_laag": top10_min(data, "pn"),
        "sq_hoog": top10_max(data, "sq"),
    }

    # ── Maandranking ──────────────────────────────────────────────────────────
    print("Maandranking berekenen...")
    maandranking = {}
    for m in range(1, 13):
        maand_data = [r for r in data if r["maand"] == m]
        jaar_groepen = defaultdict(list)
        for r in maand_data:
            jaar_groepen[r["jaar"]].append(r)

        tx_gem, tn_gem, tg_gem, rh_som, sq_som = [], [], [], [], []
        for j, groep in sorted(jaar_groepen.items()):
            tx_v = [r["tx"] for r in groep if r["tx"] is not None]
            tn_v = [r["tn"] for r in groep if r["tn"] is not None]
            tg_v = [r["tg"] for r in groep if r["tg"] is not None]
            rh_v = [r["rh"] for r in groep if r["rh"] is not None]
            sq_v = [r["sq"] for r in groep if r["sq"] is not None]
            min_dagen = 20
            if len(tx_v) >= min_dagen: tx_gem.append((round(sum(tx_v)/len(tx_v),1), str(j)))
            if len(tn_v) >= min_dagen: tn_gem.append((round(sum(tn_v)/len(tn_v),1), str(j)))
            if len(tg_v) >= min_dagen: tg_gem.append((round(sum(tg_v)/len(tg_v),1), str(j)))
            if len(rh_v) >= min_dagen: rh_som.append((round(sum(rh_v),1), str(j)))
            if len(sq_v) >= min_dagen: sq_som.append((round(sum(sq_v),1), str(j)))

        maandranking[str(m)] = {
            "tx_hoog": sorted(tx_gem, reverse=True)[:50],
            "tx_laag": sorted(tx_gem)[:25],
            "tn_hoog": sorted(tn_gem, reverse=True)[:25],
            "tn_laag": sorted(tn_gem)[:50],
            "tg_hoog": sorted(tg_gem, reverse=True)[:25],
            "tg_laag": sorted(tg_gem)[:25],
            "rh_hoog": sorted(rh_som, reverse=True)[:25],
            "rh_laag": sorted(rh_som)[:25],
            "sq_hoog": sorted(sq_som, reverse=True)[:25],
            "sq_laag": sorted(sq_som)[:25],
        }
    records["maandranking"] = maandranking

    # ── Seizoenranking ────────────────────────────────────────────────────────
    print("Seizoenranking berekenen...")
    # Seizoen is gebaseerd op meteorologisch seizoen (op jaarbasis van het hoofdjaar)
    # Winter: dec(jaar-1) + jan + feb → jaar = jan/feb jaar
    # Lente: mrt apr mei, Zomer: jun jul aug, Herfst: sep okt nov
    SEI_MAANDEN = {
        "winter": (12, 1, 2),
        "lente":  (3, 4, 5),
        "zomer":  (6, 7, 8),
        "herfst": (9, 10, 11),
    }

    def seizoen_jaar(r):
        """Geef het 'hoofd-jaar' van het seizoen (winter: jan/feb jaar)."""
        if r["maand"] == 12:
            return r["jaar"] + 1  # dec hoort bij volgend seizoensjaar
        return r["jaar"]

    seizoenranking = {}
    for sei, maanden in SEI_MAANDEN.items():
        sei_data = [r for r in data if r["maand"] in maanden]
        jaar_groepen = defaultdict(list)
        for r in sei_data:
            jaar_groepen[seizoen_jaar(r)].append(r)

        tx_gem, tn_gem, tg_gem, rh_som, sq_som = [], [], [], [], []
        min_dagen = 60  # seizoen heeft ~90 dagen, eis minimaal 60
        for j, groep in sorted(jaar_groepen.items()):
            tx_v = [r["tx"] for r in groep if r["tx"] is not None]
            tn_v = [r["tn"] for r in groep if r["tn"] is not None]
            tg_v = [r["tg"] for r in groep if r["tg"] is not None]
            rh_v = [r["rh"] for r in groep if r["rh"] is not None]
            sq_v = [r["sq"] for r in groep if r["sq"] is not None]
            if len(tx_v) >= min_dagen: tx_gem.append((round(sum(tx_v)/len(tx_v),1), str(j)))
            if len(tn_v) >= min_dagen: tn_gem.append((round(sum(tn_v)/len(tn_v),1), str(j)))
            if len(tg_v) >= min_dagen: tg_gem.append((round(sum(tg_v)/len(tg_v),1), str(j)))
            if len(rh_v) >= min_dagen: rh_som.append((round(sum(rh_v),1), str(j)))
            if len(sq_v) >= min_dagen: sq_som.append((round(sum(sq_v),1), str(j)))

        seizoenranking[sei] = {
            "tx_hoog": sorted(tx_gem, reverse=True)[:25],
            "tx_laag": sorted(tx_gem)[:25],
            "tn_hoog": sorted(tn_gem, reverse=True)[:25],
            "tn_laag": sorted(tn_gem)[:25],
            "tg_hoog": sorted(tg_gem, reverse=True)[:25],
            "tg_laag": sorted(tg_gem)[:25],
            "rh_hoog": sorted(rh_som, reverse=True)[:25],
            "rh_laag": sorted(rh_som)[:25],
            "sq_hoog": sorted(sq_som, reverse=True)[:25],
            "sq_laag": sorted(sq_som)[:25],
        }
    records["seizoenranking"] = seizoenranking
    print("Tussenstand berekenen...")
    vandaag    = date.today()
    huid_maand = vandaag.month
    huid_jaar  = vandaag.year
    huid_dag   = vandaag.day

    def tussenstand_param(maand, dag, param, aggregaat="gem"):
        jaar_vals = defaultdict(list)
        for r in data:
            if r["maand"] == maand and r["dag"] <= dag and r[param] is not None:
                jaar_vals[r["jaar"]].append(r[param])
        jaar_agg = {}
        for j, vals in jaar_vals.items():
            if len(vals) >= max(dag - 4, 1):
                v = round(sum(vals)/len(vals), 1) if aggregaat == "gem" else round(sum(vals), 1)
                jaar_agg[j] = v
        if huid_jaar not in jaar_agg:
            return None
        huidige = jaar_agg[huid_jaar]
        gesorteerd = sorted(jaar_agg.items(), key=lambda x: x[1], reverse=True)
        rang = next((i+1 for i,(j,_) in enumerate(gesorteerd) if j == huid_jaar), None)
        return {
            "waarde":  huidige,
            "rang":    rang,
            "totaal":  len(gesorteerd),
            "top3":    [(w, str(j)) for j, w in sorted(jaar_agg.items(), key=lambda x: x[1], reverse=True)[:3]],
            "laag3":   [(w, str(j)) for j, w in sorted(jaar_agg.items(), key=lambda x: x[1])[:3]],
        }

    records["tussenstand"] = {
        "maand": huid_maand,
        "jaar":  huid_jaar,
        "dag":   huid_dag,
        "tx": tussenstand_param(huid_maand, huid_dag, "tx", "gem"),
        "tn": tussenstand_param(huid_maand, huid_dag, "tn", "gem"),
        "tg": tussenstand_param(huid_maand, huid_dag, "tg", "gem"),
        "rh": tussenstand_param(huid_maand, huid_dag, "rh", "som"),
        "sq": tussenstand_param(huid_maand, huid_dag, "sq", "som"),
    }

    # ── Opslaan ────────────────────────────────────────────────────────────────
    with open(OUTPUT_JSON, "w") as f:
        json.dump(records, f)
    print(f"\nKlaar! {OUTPUT_JSON} opgeslagen")
    tx_rec = records['alltime']['tx_hoog']
    tn_rec = records['alltime']['tn_laag']
    print(f"  Alltime TX: {tx_rec[0] if tx_rec else 'geen data'}")
    print(f"  Alltime TN: {tn_rec[0] if tn_rec else 'geen data'}")
