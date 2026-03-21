#!/usr/bin/env python3
"""
haal_satelliet.py
Download satellietbeelden van MET Norway (EUMETSAT Meteosat).
Output: sat_visible.png, sat_infrared.png, sat_waterdamp.png
"""

import os, requests
from datetime import datetime

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

BASE = "https://api.met.no/weatherapi/geosatellite/1.4/"
HEADERS = {"User-Agent": "EdAldusWM/1.0 github.com/aldused/weerkaarten"}

BEELDEN = [
    ("visible",     "sat_visible.png"),
    ("infrared",    "sat_infrared.png"),
]

print(f"=== Satellietbeelden === {datetime.now():%Y-%m-%d %H:%M}")
for type_naam, bestand in BEELDEN:
    try:
        url = f"{BASE}?area=europe&type={type_naam}"
        r = requests.get(url, headers=HEADERS, timeout=30)
        if r.status_code == 200:
            with open(bestand, "wb") as f:
                f.write(r.content)
            print(f"  OK: {bestand} ({len(r.content)//1024} KB)")
        else:
            print(f"  FOUT {r.status_code}: {type_naam}")
    except Exception as e:
        print(f"  FOUT {type_naam}: {e}")
