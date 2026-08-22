#!/usr/bin/env python3
"""
maak_dagrecords_nl.py

Bouwt dagrecords_nl.json: per KNMI-station, per kalenderdag (MM-DD) de hoogste
maximumtemperatuur ooit gemeten (tx_hoog[0]) + de datum waarop dat record viel.

Bron: de per-station records_<nr>.json. Standaard van R2 (data.weerlab.nl) zodat de
LOPENDE EDR-patch (elke ~10 min) meekomt — een vandaag verbroken record staat dan
direct in tx_hoog[0]. Valt terug op lokale files als R2 onbereikbaar is.
Output voedt dagrecords_6dagen.html (geinterpoleerde NL-kaartjes, 6 dagen).
"""
import os, json, glob, time
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    requests = None

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

R2_BASE = "https://data.weerlab.nl"

def laad_records(nr):
    """Lokale records eerst — de lopend-patcher (nl.edaldus.weerrecords-lopend,
    elke ~10 min) houdt deze incl. lopende EDR vers. Snel + geen R2-egress
    (records-files zijn ~9 MB elk). Fallback R2 als lokaal ontbreekt."""
    pad = f"records_{nr}.json"
    if os.path.exists(pad):
        try:
            with open(pad) as f:
                return json.load(f), "lokaal"
        except Exception:
            pass
    if requests is not None:
        try:
            r = requests.get(f"{R2_BASE}/records_{nr}.json", timeout=20)
            if r.ok:
                return r.json(), "r2"
        except Exception:
            pass
    return None, None

# Station-nr -> naam (zelfde set als knmi_records.py)
STATIONS = [
    ("260","De Bilt"),("344","Rotterdam Airport"),("330","Hoek van Holland"),
    ("235","Den Helder"),("240","Schiphol"),("270","Leeuwarden"),
    ("280","Eelde"),("290","Twenthe"),("310","Vlissingen"),("380","Maastricht"),
    ("210","Valkenburg"),("215","Voorschoten"),("225","IJmuiden"),
    ("229","Texelhors"),("242","Vlieland"),("248","Wijdenes"),("249","Berkhout"),
    ("251","Terschelling"),("257","Wijk aan Zee"),("258","Houtribdijk"),
    ("265","Soesterberg"),("267","Stavoren"),("269","Lelystad"),
    ("273","Marknesse"),("275","Deelen"),("277","Lauwersoog"),("278","Heino"),
    ("279","Hoogeveen"),("283","Hupsel"),("286","Nieuw Beerta"),("319","Westdorpe"),
    ("323","Wilhelminadorp"),("324","Stavenisse"),("331","Tholen"),
    ("340","Woensdrecht"),("343","Rotterdam Geulhaven"),("348","Cabauw"),
    ("350","Gilze-Rijen"),("356","Herwijnen"),("370","Eindhoven"),
    ("375","Volkel"),("377","Ell"),("391","Arcen"),("392","Horst"),
]

# Naam -> (lon, lat)  (uit maak_toplijst_kaarten.py)
COORDS = {
    "Valkenburg":(4.430,52.171),
    "Voorschoten":(4.447,52.125),"IJmuiden":(4.555,52.458),"Texelhors":(4.862,52.982),
    "Den Helder":(4.789,52.928),"Schiphol":(4.781,52.309),"Vlieland":(4.920,53.250),
    "Wijdenes":(5.166,52.632),"Berkhout":(4.979,52.644),"Terschelling":(5.350,53.392),
    "Wijk aan Zee":(4.601,52.504),"Houtribdijk":(5.385,52.649),"De Bilt":(5.178,52.101),
    "Soesterberg":(5.276,52.128),"Stavoren":(5.362,52.882),"Lelystad":(5.521,52.458),
    "Leeuwarden":(5.774,53.224),"Marknesse":(5.888,52.703),"Deelen":(5.885,52.060),
    "Lauwersoog":(6.201,53.413),"Heino":(6.261,52.439),"Hoogeveen":(6.520,52.730),
    "Eelde":(6.586,53.123),"Hupsel":(6.657,52.069),"Nieuw Beerta":(7.150,53.197),
    "Twenthe":(6.889,52.275),"Vlissingen":(3.596,51.442),"Westdorpe":(3.861,51.226),
    "Wilhelminadorp":(3.884,51.527),"Stavenisse":(4.001,51.594),
    "Hoek van Holland":(4.131,51.978),"Tholen":(4.219,51.531),"Woensdrecht":(4.342,51.449),
    "Rotterdam Geulhaven":(4.320,51.893),"Rotterdam Airport":(4.437,51.957),
    "Cabauw":(4.926,51.971),"Gilze-Rijen":(4.931,51.567),"Herwijnen":(5.146,51.859),
    "Eindhoven":(5.377,51.451),"Volkel":(5.707,51.657),"Ell":(5.763,51.198),
    "Maastricht":(5.770,50.911),"Arcen":(6.196,51.500),"Horst":(6.029,51.449),
}

# Historische/gecureerde recordplaatsen die niet in de actuele KNMI-stationset
# zitten. De coordinaten zijn de plaats- of voormalige meetlocatiecoordinaten;
# ze zijn alleen nodig om de sparse records uit records_nl_extreme.json te tonen.
HISTORISCHE_COORDS = {
    "'s-Heerenberg":(6.259,51.877),"Akkrum":(5.831,53.050),"Almen":(6.300,52.158),
    "Assen":(6.563,52.997),"Avereest":(6.390,52.607),"Breda":(4.776,51.587),
    "Buchten":(5.810,51.043),"Castricum":(4.669,52.548),"Dedemsvaart":(6.458,52.600),
    "Echt":(5.874,51.106),"Emmeloord":(5.749,52.711),"Emmen":(6.907,52.779),
    "Epen":(5.912,50.777),"Ermelo":(5.622,52.298),"Gemert":(5.690,51.556),
    "Goes":(3.889,51.504),"Haamstede":(3.743,51.697),"Joure":(5.803,52.966),
    "Kapellebrug":(4.064,51.253),"Kortgene":(3.802,51.556),
    "Maastricht Caberg":(5.664,50.865),
    "Oost-Maarland":(5.715,50.794),"Oudenbosch":(4.535,51.588),
    "Rotterdam":(4.479,51.923),"Rottum":(5.895,52.937),"Sittard":(5.869,50.998),
    "Slijk-Ewijk":(5.788,51.884),"St. Jansteen":(4.052,51.263),
    "Ten Post":(6.728,53.298),"Ternaard":(5.965,53.382),
    "Uithuizermeeden":(6.724,53.414),"Urk":(5.601,52.663),"Venlo":(6.168,51.370),
    "Wageningen":(5.667,51.970),"Warnsveld":(6.231,52.138),
    "Wijster":(6.518,52.817),"Winterswijk":(6.700,51.981),"Witteveen":(6.660,52.813),
}

# Reguliere stationreeksen beperken we tot locaties die recent nog temperatuur
# meten, zodat de kaart leesbaar blijft. Belangrijke records van opgeheven
# locaties komen hieronder alsnog gericht uit de gecureerde landelijke bron.
MAX_TX_GAP = 2
# Min. aantal jaren met TX-waarde voor één kalenderdag. Wind/zee-stations (bv.
# Rotterdam Geulhaven, Texelhors, Houtribdijk) meten geen of nauwelijks temp →
# onrealistisch dagrecord. tx_hoog is afgekapt op top-25, dus de lengte =
# aantal jaren-met-data zolang dat < 25 is.
MIN_SAMPLE = 10
VANDAAG = datetime.now().date()

DIT_JAAR = datetime.now().year

stations_out = {}
dagrecords = {}   # "MM-DD" -> { naam: {"t":val,"d":"YYYY-MM-DD"[, "l":1]} }
gemist = []
historische_namen = set()
lopend_data = []   # lopend-datum per station (EDR-tussenstand t/m)

bronnen = {"r2": 0, "lokaal": 0}
for nr, naam in STATIONS:
    if naam not in COORDS:
        gemist.append((nr, naam, "geen coords")); continue
    rec, bron = laad_records(nr)
    if rec is None:
        gemist.append((nr, naam, "geen data")); continue
    bronnen[bron] = bronnen.get(bron, 0) + 1
    dag = rec.get("dag", {})
    # Meet dit station nu nog temperatuur? Nieuwste TX-jaar over alle dagen.
    tx_jaren = [int(v[1][:4]) for mn in dag.values() for vals in mn.values()
                for v in vals.get("tx_hoog", [])]
    nieuwste_tx = max(tx_jaren) if tx_jaren else 0
    if nieuwste_tx < VANDAAG.year - MAX_TX_GAP:
        historische_namen.add(naam)
        continue
    lon, lat = COORDS[naam]
    stations_out[naam] = [lon, lat]
    if rec.get("lopend"):
        lopend_data.append(rec["lopend"])
    for m_str, dagen in dag.items():
        m = int(m_str)
        for d_str, vals in dagen.items():
            d = int(d_str)
            txh = vals.get("tx_hoog")
            if not txh or len(txh) < MIN_SAMPLE:
                continue
            top = txh[0]              # [value, "YYYY-MM-DD"] — bevat al lopende EDR
            val, datum = top[0], top[1]
            sleutel = f"{m:02d}-{d:02d}"
            cel = {"t": round(val, 1), "d": datum}
            if naam in historische_namen:
                cel["h"] = 1
            if datum[:4] == str(DIT_JAAR):     # record dit (lopende) seizoen gezet
                cel["l"] = 1
            dagrecords.setdefault(sleutel, {})[naam] = cel

# Voeg de gecureerde landelijke extremen toe. Deze bron bevat juist de oude
# meetlocaties die geen doorlopende records_<nr>.json-reeks meer hebben. Per
# locatie en kalenderdag wint de hoogste waarde van de reguliere en curated bron.
extremen, extremen_bron = laad_records("nl_extreme")
if extremen is not None:
    bronnen[extremen_bron] = bronnen.get(extremen_bron, 0) + 1
    for m_str, dagen in extremen.get("dag", {}).items():
        for d_str, vals in dagen.items():
            sleutel = f"{int(m_str):02d}-{int(d_str):02d}"
            for top in vals.get("tx_hoog", []):
                if len(top) < 3:
                    continue
                val, datum, naam = top[0], top[1], top[2]
                coords = COORDS.get(naam) or HISTORISCHE_COORDS.get(naam)
                if coords is None:
                    gemist.append(("hist", naam, "geen coords"))
                    continue
                huidige = dagrecords.setdefault(sleutel, {}).get(naam)
                if huidige is not None and huidige["t"] >= val:
                    continue
                historische_namen.add(naam)
                stations_out[naam] = list(coords)
                dagrecords[sleutel][naam] = {
                    "t": round(val, 1), "d": datum, "h": 1,
                }
else:
    gemist.append(("nl_extreme", "Historische extremen NL", "geen data"))

# Stations zonder enig dagrecord (alle dagen te weinig sample) eruit
gebruikt = {naam for dag in dagrecords.values() for naam in dag}
stations_out = {n: c for n, c in stations_out.items() if n in gebruikt}
historisch_gebruikt = gebruikt & historische_namen

uit = {
    "gegenereerd": datetime.now(timezone.utc).isoformat(timespec="minutes"),
    "bron": "KNMI dagrecords — hoogste maximumtemperatuur ooit per kalenderdag",
    "lopend": max(lopend_data) if lopend_data else None,   # incl. lopende EDR t/m
    "station_aantallen": {
        "totaal": len(stations_out),
        "historisch": len(historisch_gebruikt),
    },
    "stations": stations_out,
    "dagrecords": dagrecords,
}
with open("dagrecords_nl.json", "w") as f:
    json.dump(uit, f, ensure_ascii=False, separators=(",", ":"))

print(f"Meetlocaties: {len(stations_out)} ({len(historisch_gebruikt)} historisch) | "
      f"kalenderdagen: {len(dagrecords)} | bron: {bronnen}")
if gemist:
    print("Gemist:", gemist)
# Snelcheck: vandaag
vandaag = datetime.now().strftime("%m-%d")
vd = dagrecords.get(vandaag, {})
if vd:
    top = max(vd.items(), key=lambda kv: kv[1]["t"])
    print(f"Record {vandaag}: hoogste = {top[1]['t']}° ({top[0]}, {top[1]['d']})")
