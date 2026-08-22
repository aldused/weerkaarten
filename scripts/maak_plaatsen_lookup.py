#!/usr/bin/env python3
"""Genereer plaatsen_lookup.json — grote plaatsen-database voor reverse-geocoding bliksem.

Bron: GeoNames cities500 (CC-BY 4.0). Filter NL+BE+LU + grenssteden DE/FR/UK
binnen bbox lon -2..10, lat 48..55.
"""

import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

GEONAMES_URL = "https://download.geonames.org/export/dump/cities500.zip"
COUNTRIES = {"NL", "BE", "LU", "DE", "FR", "GB"}
BBOX = (-2.0, 48.0, 10.0, 55.0)  # lon_min, lat_min, lon_max, lat_max

OUT = Path(__file__).resolve().parent.parent / "plaatsen_lookup.json"


def main():
    print(f"download {GEONAMES_URL} ...", file=sys.stderr)
    req = urllib.request.Request(GEONAMES_URL, headers={"User-Agent": "weerlab-bliksem/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        zip_bytes = r.read()
    print(f"  {len(zip_bytes)/1024:.0f} KB", file=sys.stderr)

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        with zf.open("cities500.txt") as f:
            text = f.read().decode("utf-8")

    # GeoNames-formaat (tab-separated):
    # 0:geonameid 1:name 2:asciiname 3:alternatenames 4:lat 5:lon 6:fclass 7:fcode
    # 8:country 9:cc2 10:admin1 11:admin2 12:admin3 13:admin4 14:population ...
    plaatsen = []
    for line in text.splitlines():
        cols = line.split("\t")
        if len(cols) < 15:
            continue
        country = cols[8]
        if country not in COUNTRIES:
            continue
        try:
            lat = float(cols[4])
            lon = float(cols[5])
            pop = int(cols[14] or 0)
        except ValueError:
            continue
        lon_min, lat_min, lon_max, lat_max = BBOX
        if not (lon_min <= lon <= lon_max and lat_min <= lat <= lat_max):
            continue
        # Voor DE/FR/GB: alleen plaatsen >50k binnen 80km van NL/BE-grens (rough: lat 49.5-54, lon 1-9)
        if country in ("DE", "FR", "GB") and pop < 50000:
            continue
        # Voor NL/BE/LU: alle (drempel 500 al via cities500)
        plaatsen.append({
            "naam": cols[1],
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "land": country,
            "pop": pop,
        })

    # Sorteer op populatie aflopend (bij twee dichtbij wint groter)
    plaatsen.sort(key=lambda p: -p["pop"])

    payload = {"plaatsen": plaatsen}
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"geschreven: {OUT.name} — {len(plaatsen)} plaatsen ({OUT.stat().st_size/1024:.0f} KB)",
          file=sys.stderr)


if __name__ == "__main__":
    main()
