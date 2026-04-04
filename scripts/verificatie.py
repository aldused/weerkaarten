#!/usr/bin/env python3
"""
verificatie.py — Vergelijkt MOSMIX-voorspelling met KNMI-waarnemingen.

1) Archiveert de huidige MOSMIX-voorspelling voor morgen in verificatie_archief.json
2) Als er een gearchiveerde voorspelling voor gisteren bestaat:
   haalt KNMI dagobservaties op en vergelijkt → verificatie.json

Parameters: TX (max temp), TN (min temp), RR (neerslag), FF (gem. wind)
"""

import os, json, time
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo
from knmi_api import knmi_get

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

# Alleen NL KNMI-stations (code begint met 06)
MOSMIX_NL_STATIONS = {
    "Eelde": "0-20000-0-06280",
    "Terschelling": "0-20000-0-06250",
    "Vlieland": "0-20000-0-06242",
    "Leeuwarden": "0-20000-0-06270",
    "Den Helder": "0-20000-0-06235",
    "Amsterdam": "0-20000-0-06240",
    "De Bilt": "0-20000-0-06260",
    "Deelen": "0-20000-0-06275",
    "Hoogeveen": "0-20000-0-06279",
    "Enschede": "0-20000-0-06290",
    "Vlissingen": "0-20000-0-06310",
    "Hoek van Holland": "0-20000-0-06330",
    "Rotterdam Airport": "0-20000-0-06344",
    "Gilze Rijen": "0-20000-0-06350",
    "Eindhoven": "0-20000-0-06370",
    "Maastricht": "0-20000-0-06380",
    "Valkenburg": "0-20000-0-06210",
    "Volkel": "0-20000-0-06375",
}

EDR_BASE = "https://api.dataplatform.knmi.nl/edr/v1/collections"
EDR_COLLECTIES = [
    "daily-in-situ-meteorological-observations-validated",
    "daily-in-situ-meteorological-observations",
]

ARCHIEF_FILE = "verificatie_archief.json"
OUTPUT_FILE = "verificatie.json"
MOSMIX_FILE = "mosmix_nl.json"

PARAMS = ["TX", "TN", "RR", "FF"]

# ── Stap 1: Archiveer MOSMIX-voorspelling voor morgen ───────────────────────

def archiveer_mosmix():
    """Lees mosmix_nl.json en sla de voorspelling voor morgen op."""
    if not os.path.exists(MOSMIX_FILE):
        print("  MOSMIX bestand niet gevonden"); return

    mosmix = json.load(open(MOSMIX_FILE))
    morgen = (date.today() + timedelta(days=1)).isoformat()

    if morgen not in mosmix.get("data", {}):
        print(f"  Geen MOSMIX data voor morgen ({morgen})"); return

    dag_data = mosmix["data"][morgen]
    archief_entry = {
        "run": mosmix.get("run"),
        "gearchiveerd": datetime.now().isoformat(timespec="minutes"),
        "stations": {},
    }

    for naam in MOSMIX_NL_STATIONS:
        station = {}
        for p in PARAMS:
            val = dag_data.get(p, {}).get(naam)
            if val is not None:
                station[p] = val
        if station:
            archief_entry["stations"][naam] = station

    # Lees bestaand archief
    archief = {}
    if os.path.exists(ARCHIEF_FILE):
        try:
            archief = json.load(open(ARCHIEF_FILE))
        except:
            archief = {}

    # Bewaar max 30 dagen
    archief[morgen] = archief_entry
    if len(archief) > 30:
        for k in sorted(archief.keys())[:-30]:
            del archief[k]

    json.dump(archief, open(ARCHIEF_FILE, "w"), ensure_ascii=False)
    print(f"  Archief: voorspelling voor {morgen} opgeslagen ({len(archief_entry['stations'])} stations)")

# ── Stap 2: Haal KNMI dagobservaties op ────────────────────────────────────

def haal_knmi_obs(datum_str):
    """Haal dagobservaties op voor alle stations via KNMI EDR API.
    Let op: EDR API gebruikt UTC-etmalen, KNMI ZIP-bestanden 08-08 UTC.
    Daarom vragen we datum+1 op."""
    edr_datum = (date.fromisoformat(datum_str) + timedelta(days=1)).isoformat()
    s = f"{edr_datum}T00:00:00Z"
    e = f"{edr_datum}T23:59:59Z"

    observaties = {}
    for naam, wigos in MOSMIX_NL_STATIONS.items():
        for collectie in EDR_COLLECTIES:
            try:
                url = f"{EDR_BASE}/{collectie}/locations/{wigos}"
                r = knmi_get(url, params={
                    "datetime": f"{s}/{e}",
                    "parameter-name": "TX,TN,RH,FG",
                }, timeout=15)
                if r.status_code != 200:
                    continue
                js = r.json()
                if not js.get("coverages"):
                    continue
                ranges = js["coverages"][0].get("ranges", {})

                def laatste(key):
                    vals = ranges.get(key, {}).get("values", [])
                    for v in reversed(vals):
                        if v is not None:
                            return v
                    return None

                tx = laatste("TX")
                tn = laatste("TN")
                rh = laatste("RH")
                fg = laatste("FG")

                obs = {}
                if tx is not None: obs["TX"] = round(tx, 1)
                if tn is not None: obs["TN"] = round(tn, 1)
                if rh is not None: obs["RR"] = round(max(0, rh), 1)  # negatief = spoor
                if fg is not None: obs["FF"] = round(fg * 3.6, 1)    # m/s → km/h

                if obs:
                    observaties[naam] = obs
                    break  # gelukt, niet naar volgende collectie
            except Exception as ex:
                print(f"    {naam} ({collectie}): {ex}")
                continue
        time.sleep(0.05)

    return observaties

# ── Stap 3: Vergelijk en genereer output ───────────────────────────────────

def vergelijk():
    """Vergelijk gearchiveerde MOSMIX-voorspelling met KNMI-observaties."""
    gisteren = (date.today() - timedelta(days=1)).isoformat()

    if not os.path.exists(ARCHIEF_FILE):
        print("  Geen archief gevonden"); return False

    archief = json.load(open(ARCHIEF_FILE))
    if gisteren not in archief:
        print(f"  Geen gearchiveerde voorspelling voor {gisteren}"); return False

    voorspelling = archief[gisteren]
    print(f"\n  Vergelijking voor {gisteren} (MOSMIX run: {voorspelling.get('run')})")

    # Haal observaties op
    print("  KNMI dagobservaties ophalen...")
    observaties = haal_knmi_obs(gisteren)
    print(f"  {len(observaties)} stations met observaties")

    if not observaties:
        print("  Geen observaties beschikbaar"); return False

    # Vergelijk per station
    stations_out = {}
    totalen = {p: {"verschil": [], "abs_verschil": []} for p in PARAMS}

    for naam in sorted(MOSMIX_NL_STATIONS.keys()):
        voorsp = voorspelling.get("stations", {}).get(naam, {})
        obs = observaties.get(naam, {})
        if not voorsp or not obs:
            continue

        station_out = {}
        for p in PARAMS:
            v = voorsp.get(p)
            g = obs.get(p)
            if v is not None and g is not None:
                verschil = round(v - g, 1)
                station_out[p] = {
                    "verwacht": v,
                    "gemeten": g,
                    "verschil": verschil,
                }
                totalen[p]["verschil"].append(verschil)
                totalen[p]["abs_verschil"].append(abs(verschil))

        if station_out:
            stations_out[naam] = station_out

    # Samenvatting: MAE en bias per parameter
    samenvatting = {}
    for p in PARAMS:
        vals = totalen[p]
        if vals["verschil"]:
            n = len(vals["verschil"])
            samenvatting[p] = {
                "mae": round(sum(vals["abs_verschil"]) / n, 1),
                "bias": round(sum(vals["verschil"]) / n, 1),
                "n": n,
            }

    output = {
        "bijgewerkt": datetime.now().isoformat(timespec="minutes"),
        "datum": gisteren,
        "mosmix_run": voorspelling.get("run"),
        "stations": stations_out,
        "samenvatting": samenvatting,
    }

    json.dump(output, open(OUTPUT_FILE, "w"), ensure_ascii=False)
    print(f"\n  {OUTPUT_FILE} geschreven: {len(stations_out)} stations")

    # Print samenvatting
    for p, s in samenvatting.items():
        eenheid = "mm" if p == "RR" else ("km/h" if p == "FF" else "\u00b0C")
        print(f"    {p}: MAE={s['mae']}{eenheid}  bias={s['bias']:+}{eenheid}  (n={s['n']})")

    return True

# ── Main ───────────────────────────────────────────────────────────────────

def main():
    t0 = time.time()
    print(f"Verificatie — {datetime.now():%Y-%m-%d %H:%M}")

    print("\n1. MOSMIX-voorspelling archiveren...")
    archiveer_mosmix()

    print("\n2. Verificatie gisteren...")
    vergelijk()

    print(f"\nKlaar in {time.time()-t0:.0f}s")

if __name__ == "__main__":
    main()
