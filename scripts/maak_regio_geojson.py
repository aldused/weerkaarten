#!/usr/bin/env python3
"""
Genereert GeoJSON-bestanden voor nieuwe MOSMIX-regio's:
  ce_regions.geojson      — Polen, Tsjechië, Slowakije, Hongarije
  balkan_regions.geojson  — Slovenië, Kroatië, Bosnië, Servië, Montenegro, N-Macedonië, Albanië, Bulgarije
  ee_regions.geojson      — Roemenië, Moldavië, Oekraïne, Estland, Letland, Litouwen

Bron: Natural Earth 110m countries (datasets/geo-countries GitHub)
"""

import json, requests, os

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

URL = "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson"

REGIO_ISO = {
    "ce":     {"POL","CZE","SVK","HUN"},
    "balkan": {"SVN","HRV","BIH","SRB","MNE","MKD","ALB","BGR"},
    "ee":     {"ROU","MDA","UKR","EST","LVA","LTU"},
}

NL_NAMEN = {
    "POL":"Polen","CZE":"Tsjechië","SVK":"Slowakije","HUN":"Hongarije",
    "SVN":"Slovenië","HRV":"Kroatië","BIH":"Bosnië","SRB":"Servië",
    "MNE":"Montenegro","MKD":"N-Macedonië","ALB":"Albanië","BGR":"Bulgarije",
    "ROU":"Roemenië","MDA":"Moldavië","UKR":"Oekraïne",
    "EST":"Estland","LVA":"Letland","LTU":"Litouwen",
}

print("Download Natural Earth countries...")
r = requests.get(URL, timeout=60)
r.raise_for_status()
world = r.json()
print(f"  {len(world['features'])} landen geladen")

for tag, iso_set in REGIO_ISO.items():
    features = []
    for f in world["features"]:
        iso = f["properties"].get("ISO3166-1-Alpha-3","")
        if iso in iso_set:
            features.append({
                "type": "Feature",
                "properties": {
                    "name": NL_NAMEN.get(iso, f["properties"].get("ADMIN",iso)),
                    "country": iso,
                },
                "geometry": f["geometry"],
            })
    out = {"type": "FeatureCollection", "features": features}
    path = f"{tag}_regions.geojson"
    with open(path, "w") as fp:
        json.dump(out, fp, separators=(",",":"))
    print(f"  {path}: {len(features)} landen ({[x['properties']['country'] for x in features]})")

print("Klaar.")
