#!/usr/bin/env python3
"""Ververs de Nederlandse plaatsen voor de MOS/MIX-zoekgrafiek uit GeoNames (CC BY 4.0)."""

import argparse
from collections import defaultdict
from io import BytesIO
import json
from math import cos, hypot, radians
from pathlib import Path
import re
import unicodedata
from urllib.request import urlopen
from zipfile import ZipFile


DOWNLOAD = "https://download.geonames.org/export/dump/NL.zip"
CATALOGUE = Path(__file__).resolve().parents[1] / "temperature-places.json"
PLACE_TYPES = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5", "PPLC", "PPLF", "PPLG", "PPLL", "PPLX"}


def normalise(name):
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", ascii_name.lower()).strip()


def distance(a, b):
    latitude = (a["lat"] + b["lat"]) / 2
    return 111.2 * hypot(a["lat"] - b["lat"], (a["lon"] - b["lon"]) * cos(radians(latitude)))


def read_places(archive):
    with ZipFile(BytesIO(archive)) as zipped:
        rows = [line.decode("utf-8").split("\t") for line in zipped.open("NL.txt")]

    provinces = {
        row[10]: row[1].removeprefix("Provincie ")
        for row in rows if row[7] == "ADM1"
    }
    municipalities = {
        (row[10], row[11]): row[1].removeprefix("Gemeente ")
        for row in rows if row[7] == "ADM2"
    }
    candidates = []
    for row in rows:
        if row[6] != "P" or row[7] not in PLACE_TYPES or row[8] != "NL":
            continue
        lat, lon = float(row[4]), float(row[5])
        if not (50.7 <= lat <= 53.7 and 3 <= lon <= 7.25):
            continue
        point = {
            "name": row[1],
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "geonameId": int(row[0]),
        }
        province = provinces.get(row[10], "")
        municipality = municipalities.get((row[10], row[11]), "")
        area = ", ".join(part for part in (municipality, province)
                         if part and normalise(part) != normalise(point["name"]))
        if area:
            point["area"] = area
        candidates.append((int(row[14] or 0), row[7] in {"PPLX", "PPLL"}, point))
    candidates.sort(key=lambda item: (item[1], -item[0], item[2]["name"], item[2]["geonameId"]))
    return [point for _, _, point in candidates]


def expand_catalogue(existing, candidates):
    # Bewaar de eerdere selectie, inclusief luchtvaartstations en handmatige aliassen.
    legacy = [point for point in existing if "geonameId" not in point]
    by_name = defaultdict(list)
    for point in candidates:
        by_name[normalise(point["name"])].append(point)

    retained = defaultdict(list)
    for point in legacy:
        key = normalise(point["name"])
        matches = by_name[key]
        if matches:
            nearest = min(matches, key=lambda candidate: distance(point, candidate))
            if "area" in nearest and distance(point, nearest) <= 3:
                point["area"] = nearest["area"]
        retained[key].append(point)

    rank = max(point["rank"] for point in legacy) + 1
    additions = []
    for point in candidates:
        key = normalise(point["name"])
        if any(distance(point, previous) <= 2 and
               (not point.get("area") or not previous.get("area") or point["area"] == previous["area"])
               for previous in retained[key]):
            continue
        point["rank"] = rank + len(additions)
        additions.append(point)
        retained[key].append(point)
    return legacy + additions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Gebruik een lokaal GeoNames NL.zip-bestand.")
    args = parser.parse_args()
    if args.archive:
        archive = args.archive.read_bytes()
    else:
        with urlopen(DOWNLOAD, timeout=30) as response:
            archive = response.read()

    existing = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    places = expand_catalogue(existing["places"], read_places(archive))
    result = {
        "source": "GeoNames NL en cities5000 (CC BY 4.0), Weerlab plaatsenlijst, aviationweather.gov stations",
        "places": places,
    }
    CATALOGUE.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n",
                         encoding="utf-8")
    print(f"{len(places)} plaatsen en locaties in {CATALOGUE.name}")


if __name__ == "__main__":
    main()
