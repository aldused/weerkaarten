#!/usr/bin/env python3
"""
knmi_ev24.py — Download Makkink-referentieverdamping (EV24) voor AWS-stations.

Voor het neerslagtekort per P13-neerslagstation pairen we elk P13-station aan
een nabije AWS. EV24 is pas vanaf ~1957 beschikbaar.

Output:  ev24_cache/ev24_{stn}.csv   (raw KNMI-csv, 3-daagse cache)
"""

import os
import urllib.request
import urllib.parse
from datetime import datetime

# P13-neerslagstation  →  dichtstbijzijnde AWS (Makkink-verdamping EV24)
P13_TO_AWS = {
    "011": 251,   # West-Terschelling → Hoorn Terschelling
    "025": 235,   # De Kooy           → De Kooy
    "139": 280,   # Groningen         → Eelde
    "144": 280,   # Ter Apel          → Eelde
    "222": 249,   # Hoorn             → Berkhout
    "328": 278,   # Heerde            → Heino
    "438": 240,   # Hoofddorp         → Schiphol
    "550": 260,   # De Bilt           → De Bilt
    "666": 283,   # Winterswijk       → Hupsel
    "737": 310,   # Kerkwerve         → Vlissingen
    "770": 319,   # Westdorpe         → Westdorpe
    "828": 350,   # Oudenbosch        → Gilze-Rijen
    "961": 377,   # Roermond          → Ell
}

AWS_NAMEN = {
    235: "De Kooy", 240: "Schiphol", 249: "Berkhout",
    251: "Hoorn Terschelling", 260: "De Bilt", 278: "Heino",
    280: "Eelde", 283: "Hupsel", 310: "Vlissingen",
    319: "Westdorpe", 350: "Gilze-Rijen", 377: "Ell",
}

BASE_URL   = "https://daggegevens.knmi.nl/klimatologie/daggegevens"
START_DATE = "19570101"
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR  = os.path.join(SCRIPT_DIR, "ev24_cache")
CACHE_DAGEN = 1


def download_station(stn: int) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(CACHE_DIR, f"ev24_{stn}.csv")
    vandaag = datetime.now().strftime("%Y%m%d")

    if os.path.exists(cache_path):
        leeftijd = (datetime.now() - datetime.fromtimestamp(os.path.getmtime(cache_path))).days
        if leeftijd < CACHE_DAGEN:
            print(f"  Cache ({leeftijd}d): stn {stn} ({AWS_NAMEN.get(stn, '?')})")
            return cache_path

    params = urllib.parse.urlencode({
        "stns":  str(stn),
        "start": START_DATE,
        "end":   vandaag,
        "vars":  "RH:EV24",
        "fmt":   "csv",
    })
    url = f"{BASE_URL}?{params}"
    print(f"  Download: stn {stn} ({AWS_NAMEN.get(stn, '?')}) …")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            tekst = resp.read().decode("utf-8", errors="replace")
        if len(tekst) < 500:
            print(f"    LEEG antwoord ({len(tekst)} bytes) — stn {stn} overgeslagen")
            return ""
        with open(cache_path, "w", encoding="utf-8") as f:
            f.write(tekst)
        return cache_path
    except Exception as e:
        print(f"    FOUT stn {stn}: {e}")
        return ""


def main():
    print("=" * 60)
    print("knmi_ev24.py — EV24 Makkink verdamping, AWS-stations")
    print("=" * 60)
    unieke = sorted(set(P13_TO_AWS.values()))
    print(f"{len(unieke)} unieke AWS-stations te downloaden")
    for stn in unieke:
        download_station(stn)
    print(f"\nKlaar. Cache: {CACHE_DIR}")


if __name__ == "__main__":
    main()
