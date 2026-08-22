#!/usr/bin/env python3
"""
Haalt KNMI 10-minuten temperatuurdata op voor 23:50 en 00:00 lokale tijd (CET)
op 31 december van alle KNMI-stations, via de EDR API.

Gebruik:
    python3 knmi_jaarwisseling_temp.py [jaar]
    python3 knmi_jaarwisseling_temp.py 2024
"""

import sys
import os
import requests
from datetime import datetime, timezone, timedelta

# ──────────────────────────────────────────────
# INSTELLINGEN
# ──────────────────────────────────────────────
API_KEY = os.environ.get("KNMI_API_KEY", "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY2ZjIwYWZjOTMwYTRkNDY5M2Q3MTc5OWVhMTI4ZGQwIiwiaCI6Im11cm11cjEyOCJ9")
BASE_URL = "https://api.dataplatform.knmi.nl/edr/v1"
COLLECTION = "10-minute-in-situ-meteorological-observations"

# Jaar instellen via argument of standaard vorig jaar
YEAR = int(sys.argv[1]) if len(sys.argv) > 1 else datetime.now().year - 1

# CET = UTC+1 (31 december valt altijd in wintertijd)
# 23:50 CET = 22:50 UTC  |  00:00 CET (1 jan) = 23:00 UTC (31 dec)
CET = timezone(timedelta(hours=1))
TIJDEN_CET = [
    datetime(YEAR, 12, 31, 23, 50, tzinfo=CET),   # 23:50 lokaal
    datetime(YEAR + 1, 1, 1,  0,  0, tzinfo=CET),  # 00:00 lokaal (jaarwisseling)
]
TIJDEN_UTC = [dt.astimezone(timezone.utc) for dt in TIJDEN_CET]

# Datetime range voor de API-query (iets ruimer dan nodig)
dt_start = TIJDEN_UTC[0].strftime("%Y-%m-%dT%H:%M:%SZ")
dt_end   = (TIJDEN_UTC[-1] + timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

# Bounding box Nederland (iets ruimer voor grensgebied)
NL_POLYGON = "POLYGON((3.0 50.4,7.6 50.4,7.6 53.9,3.0 53.9,3.0 50.4))"

# ──────────────────────────────────────────────
# API-CALL
# ──────────────────────────────────────────────
print(f"\n📡 Ophalen 10-minuten temperatuurdata voor 31 december {YEAR}")
print(f"   UTC-range: {dt_start} → {dt_end}\n")

url = f"{BASE_URL}/collections/{COLLECTION}/area"
params = {
    "coords":          NL_POLYGON,
    "datetime":        f"{dt_start}/{dt_end}",
    "parameter-name":  "ta",  # Luchttemperatuur in °C (nieuwe collectie)
    "f":               "GeoJSON",
}
headers = {"Authorization": API_KEY}

try:
    resp = requests.get(url, params=params, headers=headers, timeout=30)
    resp.raise_for_status()
except requests.HTTPError as e:
    print(f"❌ HTTP-fout: {e}\n   Response: {resp.text[:500]}")
    sys.exit(1)
except requests.RequestException as e:
    print(f"❌ Verbindingsfout: {e}")
    sys.exit(1)

data = resp.json()
features = data.get("features", [])
print(f"✅ {len(features)} stations ontvangen\n")

# ──────────────────────────────────────────────
# VERWERKING
# ──────────────────────────────────────────────
# Doeltijdstempels in UTC (als string, voor vergelijking)
target_utc_strings = {dt.strftime("%Y-%m-%dT%H:%M:%SZ") for dt in TIJDEN_UTC}

resultaten = []  # (naam, station_id, tijdstip_lokaal, temp)

for feature in features:
    props      = feature.get("properties", {})
    station_id = props.get("stationId", feature.get("id", "?"))
    naam       = props.get("stationName", station_id)

    # Tijdreeks + waarden zitten in properties
    # Structuur: {"T": {"values": [...], "times": [...]} }  — of vergelijkbaar
    t_data = props.get("ta", {})
    waarden = t_data.get("values", [])
    tijden  = t_data.get("times",  [])

    # Alternatief: soms zit het als losse observaties in de feature
    if not tijden and "resultTime" in props:
        tijden  = props.get("resultTime", [])
        waarden = props.get("ta", [])
        if isinstance(waarden, dict):
            waarden = waarden.get("values", [])

    for t_str, temp in zip(tijden, waarden):
        # Normaliseer tijdstempel naar UTC-string
        t_norm = t_str.replace(" ", "T")
        if not t_norm.endswith("Z"):
            t_norm += "Z"

        if t_norm in target_utc_strings:
            dt_utc = datetime.fromisoformat(t_norm.replace("Z", "+00:00"))
            dt_loc = dt_utc.astimezone(CET)
            resultaten.append({
                "naam":      naam,
                "id":        station_id,
                "tijd_utc":  t_norm,
                "tijd_loc":  dt_loc.strftime("%H:%M"),
                "temp":      temp,
            })

# ──────────────────────────────────────────────
# OUTPUT
# ──────────────────────────────────────────────
resultaten.sort(key=lambda x: (x["naam"], x["tijd_utc"]))

if not resultaten:
    print("⚠️  Geen matchende metingen gevonden.")
    print("   Controleer: juist jaar? API-key geldig? Collectie-naam correct?")
    print(f"\n   Gezochte UTC-tijden: {sorted(target_utc_strings)}")
    print(f"\n   Ruwe API-respons (eerste feature):")
    if features:
        import json
        print(json.dumps(features[0], indent=2)[:1000])
    sys.exit(0)

print(f"{'Station':<30} {'Tijd (CET)':<12} {'T (°C)':>8}")
print("─" * 54)

station_data = {}
for r in resultaten:
    key = r["naam"]
    if key not in station_data:
        station_data[key] = []
    station_data[key].append(r)

for naam, metingen in station_data.items():
    for m in metingen:
        t = m["temp"]
        t_str = f"{t:+.1f}" if t is not None else "  n.b."
        print(f"{naam:<30} {m['tijd_loc']:<12} {t_str:>8}")
    if len(metingen) == 2:
        delta = metingen[1]["temp"] - metingen[0]["temp"]
        print(f"  {'↕ verschil':>28}  {delta:+.1f}")
    print()

print(f"\nTotaal: {len(station_data)} stations, {len(resultaten)} metingen")
