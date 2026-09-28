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

# One registry for present and former stations; activity never excludes a record.
from pathlib import Path
registry = json.loads(Path("record-stations.json").read_text())
STATIONS = [(entry["source"], name) for name, entry in registry["stations"].items()
            if entry["source"] != "nl_extreme"]
COORDS = {name: entry["coordinates"] for name, entry in registry["stations"].items()}
HISTORISCHE_COORDS = COORDS
MAX_TX_GAP = 2
VANDAAG = datetime.now().date()

DIT_JAAR = datetime.now().year

stations_out = {}
dagrecords = {}   # "MM-DD" -> { naam: {"t":val,"d":"YYYY-MM-DD"[, "l":1]} }
gemist = []
historische_namen = set()
lopend_data = []   # lopend-datum per station (EDR-tussenstand t/m)

bronnen = {"r2": 0, "lokaal": 0}
for nr, naam in STATIONS:
    if not COORDS.get(naam):
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
    lon, lat = COORDS[naam]
    stations_out[naam] = [lon, lat]
    if rec.get("lopend"):
        lopend_data.append(rec["lopend"])
    for m_str, dagen in dag.items():
        m = int(m_str)
        for d_str, vals in dagen.items():
            d = int(d_str)
            txh = vals.get("tx_hoog")
            if not txh:
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
# Never replace a valid feed with a partial build.
if gemist:
    raise RuntimeError(f"Onvolledige dagrecordbronnen: {gemist}")
if len(dagrecords) != 366:
    raise RuntimeError("Niet alle 366 kalenderdagen aanwezig")
previous = Path("dagrecords_nl.json")
if previous.exists():
    old = json.loads(previous.read_text())
    for day, records in old.get("dagrecords", {}).items():
        for name, record in records.items():
            new = dagrecords.get(day, {}).get(name)
            if new is None or new["t"] < record["t"]:
                raise RuntimeError(f"Dagrecord verdwenen/verlaagd: {day} {name}")
for day, value, date in [("09-29", 28.0, "1934-09-29"), ("09-30", 26.7, "1895-09-30")]:
    record = dagrecords.get(day, {}).get("Winterswijk")
    if not record or record["t"] < value:
        raise RuntimeError(f"Historisch controlerecord ontbreekt: {day} Winterswijk")
with open("dagrecords_nl.json.tmp", "w") as f:
    json.dump(uit, f, ensure_ascii=False, separators=(",", ":"))
os.replace("dagrecords_nl.json.tmp", "dagrecords_nl.json")

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
