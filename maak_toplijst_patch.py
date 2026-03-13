#!/usr/bin/env python3
"""
maak_toplijst.py — KNMI EDR 10-min waarnemingen → toplijst.json
Wijziging: rh (luchtvochtigheid) → rr (neerslag dagsom mm)
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone
import urllib.request

API_KEY = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY2ZjIwYWZjOTMwYTRkNDY5M2Q3MTc5OWVhMTI4ZGQwIiwiaCI6Im11cm11cjEyOCJ9"
BASE = "https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations/locations"

STATIONS = {
    "0-20000-0-06209": "Berkhout",
    "0-20000-0-06210": "Vlieland",
    "0-20000-0-06214": "Stavoren",
    "0-20000-0-06215": "Heino",
    "0-20000-0-06225": "IJmuiden",
    "0-20000-0-06229": "Hoogeveen",
    "0-20000-0-06233": "Hoorn Terschelling",
    "0-20000-0-06234": "Wijk aan Zee",
    "0-20000-0-06235": "Den Helder",
    "0-20000-0-06239": "Berkhout",
    "0-20000-0-06240": "Schiphol",
    "0-20000-0-06242": "Valkenburg",
    "0-20000-0-06248": "Wijdenes",
    "0-20000-0-06249": "Berkhout",
    "0-20000-0-06251": "Hoorn",
    "0-20000-0-06252": "K13a",
    "0-20000-0-06257": "Wijk aan Zee",
    "0-20000-0-06258": "Houtribdijk",
    "0-20000-0-06260": "De Bilt",
    "0-20000-0-06267": "Stavoren",
    "0-20000-0-06269": "Lelystad",
    "0-20000-0-06270": "Leeuwarden",
    "0-20000-0-06273": "Marknesse",
    "0-20000-0-06275": "Deelen",
    "0-20000-0-06277": "Lauwersoog",
    "0-20000-0-06278": "Heino",
    "0-20000-0-06279": "Hoogeveen",
    "0-20000-0-06280": "Eelde",
    "0-20000-0-06283": "Hupsel",
    "0-20000-0-06286": "Nieuw Beerta",
    "0-20000-0-06290": "Twenthe",
    "0-20000-0-06310": "Vlissingen",
    "0-20000-0-06316": "Schaar",
    "0-20000-0-06317": "Wilhelminadorp",
    "0-20000-0-06319": "Westdorpe",
    "0-20000-0-06320": "Oosterschelde",
    "0-20000-0-06321": "Tholen",
    "0-20000-0-06323": "Wilhelminadorp",
    "0-20000-0-06324": "Stavenisse",
    "0-20000-0-06330": "Hoek van Holland",
    "0-20000-0-06340": "Woensdrecht",
    "0-20000-0-06343": "Rotterdam Airport",
    "0-20000-0-06344": "Rotterdam Geulhaven",
    "0-20000-0-06348": "Cabauw",
    "0-20000-0-06350": "Gilze-Rijen",
    "0-20000-0-06356": "Herwijnen",
    "0-20000-0-06370": "Eindhoven",
    "0-20000-0-06375": "Volkel",
    "0-20000-0-06377": "Ell",
    "0-20000-0-06380": "Maastricht",
    "0-20000-0-06391": "Voorschoten",
}

# Gebruik de echte stations uit het werkende script
# (bovenstaande lijst is een benadering — vervang door de echte STATIONS dict uit maak_toplijst.py)

def fetch_station(wigos, naam, dag_start, dag_eind):
    """Haal tx, tn, rr, fx op voor één station voor één dag."""
    url = (f"{BASE}/{wigos}"
           f"?datetime={dag_start}/{dag_eind}"
           f"&parameter-name=tx,tn,rr,fx")
    req = urllib.request.Request(url, headers={"Authorization": API_KEY})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"  FOUT {naam}: {e}", file=sys.stderr)
        return None

    # Parse coverage-rangetype parameters
    params = {}
    try:
        ranges = data["ranges"]
        for pnaam, pdata in ranges.items():
            values = [v for v in pdata.get("values", []) if v is not None]
            params[pnaam.lower()] = values
    except Exception:
        return None

    return params

def dagsom_rr(values):
    """Som van alle 10-min neerslagwaarden → dagsom in mm. Negatieve waarden (sensor ruis) → 0."""
    if not values:
        return None
    totaal = sum(max(0.0, v) for v in values)
    return round(totaal, 1)

def verwerk_dag(datum_str):
    """Verwerk alle stations voor één dag. Geeft dict met max/min/rr/fx lijsten."""
    dag_start = datum_str + "T00:00:00Z"
    dag_eind  = datum_str + "T23:59:00Z"

    tx_list = []
    tn_list = []
    rr_list = []
    fx_list = []

    for wigos, naam in STATIONS.items():
        params = fetch_station(wigos, naam, dag_start, dag_eind)
        if not params:
            continue

        if params.get("tx"):
            tx_list.append((max(params["tx"]), naam))
        if params.get("tn"):
            tn_list.append((min(params["tn"]), naam))
        if params.get("rr") is not None:
            som = dagsom_rr(params["rr"])
            if som is not None:
                rr_list.append((som, naam))
        if params.get("fx"):
            fx_list.append((max(params["fx"]), naam))

    # Sorteren: tx/rr/fx aflopend (hoogste eerst), tn oplopend (koudste eerst)
    tx_list.sort(key=lambda x: -x[0])
    tn_list.sort(key=lambda x:  x[0])
    rr_list.sort(key=lambda x: -x[0])
    fx_list.sort(key=lambda x: -x[0])

    nu = datetime.now()
    return {
        "datum":  datum_str,
        "status": "voorlopig",
        "update": nu.strftime("%d %b %Y %H:%M"),
        "max": tx_list,
        "min": tn_list,
        "rr":  rr_list,
        "fx":  fx_list,
    }

def main():
    resultaat = {}
    vandaag = datetime.now(timezone.utc).date()

    for i in range(5):
        dag = vandaag - timedelta(days=i)
        datum_str = dag.strftime("%Y-%m-%d")
        print(f"Verwerk {datum_str}…", file=sys.stderr)
        resultaat[datum_str] = verwerk_dag(datum_str)

    uitvoer = os.path.join(os.path.dirname(__file__), "toplijst.json")
    with open(uitvoer, "w") as f:
        json.dump(resultaat, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Geschreven: {uitvoer}", file=sys.stderr)

if __name__ == "__main__":
    main()
