"""Bouw eerste sneeuw(val/dek) en eerste/laatste vorst per KNMI-station."""
import argparse
from collections import defaultdict
from datetime import date, timedelta
import gzip
import json
from pathlib import Path
import re

from bouw_winterdata import snow_indicator

# De dag- en uurselecties hebben soms een dubbele punt achter het stationnummer.
STATION = re.compile(r"^#\s*(\d+):?\s+[-.\d]+\s+[-.\d]+\s+[-.\d]+\s+(.+?)\s*$")
SNOW_MONTHS = (8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7)
# Historische sneeuwmeldingen waarbij WW de sneeuw niet afzonderlijk aanduidt.
# https://www.weer.nl/nieuws/algemeen/2021/eerste-sneeuwvlokken-van-dit-winterseizoen-gezien
HISTORICAL_SNOWFALL = {
    1953: {
        "19520919": {235: "Den Helder", 310: "Vlissingen"},
        "19520920": {310: "Vlissingen"},
    },
    1955: {
        "19540929": {270: "Leeuwarden", 370: "Eindhoven"},
        "19540930": {280: "Eelde"},
    },
}
# Op Volkel stond om 07 UTC 14,6 °C en was het dauwpunt 13,3 °C.
# Ook in de uren ervoor bleef het ruim boven nul. WW 22 is hier verdacht.
SUSPECT_SNOW_HOURS = {(375, "19510810", "7")}
# Noordzeeplatforms en meetpunten op open water in het uurarchief.
OFFSHORE = {201, 203, 204, 205, 206, 207, 208, 209, 211, 212, 213, 214, 216, 218,
            239, 252, 285, 312, 313, 316, 317, 320, 321}


def read_rows(path, station_names, *keys):
    with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            if match := STATION.fullmatch(line.rstrip()):
                station_names[int(match[1])] = match[2]
            if line.startswith("# STN,YYYYMMDD,"):
                columns = [value.strip() for value in line[1:].split(",")]
                indices = [columns.index(key) for key in keys]
                break
        else:
            raise ValueError(f"KNMI-kolomkop ontbreekt in {path}")
        for line in f:
            if line.lstrip()[:1].isdigit():
                fields = line.split(",")
                yield int(fields[0]), fields[1].strip(), tuple(fields[index].strip() for index in indices)


def season_offsets(end, start_month=7):
    start = date(end - 1, start_month, 1)
    days = (date(end, start_month, 1) - start).days
    return {(start + timedelta(days=i)).strftime("%Y%m%d"): i for i in range(days)}


def classify(value):
    # Meetwaarden in 0,1 °C; KNMI-klassen sluiten elkaar uit.
    if value < -150:
        return 3
    if value < -100:
        return 2
    if value < -50:
        return 1
    if value < 0:
        return 0
    return None


def station_snow(path, station_names, offsets, observations, month):
    for station, day, (hour, ww, ix, snow) in read_rows(path, station_names, "HH", "WW", "IX", "S"):
        if station in OFFSHORE or day not in offsets or not day.startswith(month):
            continue
        event = snow_indicator(day, ww, ix, snow)
        if event is None:
            continue
        offset = offsets[day]
        days, positives = observations[station]
        days.add(offset)
        if event and (station, day, hour) not in SUSPECT_SNOW_HOURS:
            positives.add(offset)


def snow_rows(observations):
    return [
        [station, len(days), min(positives, default=None)]
        for station, (days, positives) in sorted(observations.items())
    ]


def snowfall_season(root, end, station_names):
    snow = defaultdict(lambda: (set(), set()))
    offsets = season_offsets(end, SNOW_MONTHS[0])
    for month in SNOW_MONTHS:
        prefix = f"{end - (month >= SNOW_MONTHS[0])}{month:02}"
        station_snow(root / f"{prefix}.txt.gz", station_names, offsets, snow, prefix)
    documented = HISTORICAL_SNOWFALL.get(end, {})
    for day, stations in documented.items():
        for station in stations:
            days, positives = snow[station]
            days.add(offsets[day])
            positives.add(offsets[day])
    rows = snow_rows(snow)
    coverage = set().union(*(days for days, _ in snow.values()))
    first = min((row[2] for row in rows if row[2] is not None), default=len(offsets) - 1)
    complete = all(offset in coverage for offset in range(first + 1))
    first_by_station = {station: offset for station, _, offset in rows}
    historical = {
        station: name for day, stations in documented.items() for station, name in stations.items()
        if first_by_station[station] == offsets[day]
    }
    result = {"val": rows, "valLength": len(offsets), "valComplete": complete}
    if historical:
        result["valHistorical"] = historical
    return result


def frost_rows(path, station_names, offsets):
    seen = defaultdict(set)
    occurrences = defaultdict(lambda: [[], [], [], []])
    for station, day, (value,) in read_rows(path, station_names, "TN"):
        if not value or day not in offsets:
            continue
        offset = offsets[day]
        seen[station].add(offset)
        category = classify(int(value))
        if category is not None:
            occurrences[station][category].append(offset)
    result = []
    for station, days in sorted(seen.items()):
        row = [station, len(days)]
        for group in occurrences[station]:
            row.extend((min(group, default=None), max(group, default=None)))
        result.append(row)
    return result


def read_cover(root, year, station_names, offsets, observations):
    path = root / f"{year}.json.gz"
    if not path.is_file():
        return
    with gzip.open(path, "rt", encoding="utf-8") as f:
        data = json.load(f)
    station_names.update({int(k): v for k, v in data["stations"].items()})
    for day, observations_on_day in data["days"].items():
        key = day.replace("-", "")
        if key not in offsets:
            continue
        offset = offsets[key]
        for station, code in observations_on_day:
            if code is None or repeated_snow_code(day, station, code):
                continue
            days, positives = observations[station]
            days.add(offset)
            if code > 0:
                positives.add(offset)


def repeated_snow_code(day, station, code):
    # Het archief herhaalt deze vaste station/code-combinaties jarenlang
    # op de 10e, 20e en 30e van de maand, ook midden in de zomer.
    if day[-2:] not in ("10", "20", "30"):
        return False
    year = int(day[:4])
    if 1961 <= year <= 1965:
        return {13: 1, 72: 2, 165: 4, 231: 997, 676: 8, 739: 999}.get(station) == code
    if 1966 <= year <= 1967:
        return {13: 1, 72: 2, 165: 4, 354: 2, 448: 23, 739: 999}.get(station) == code
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("daily", "hourly", "cover", "out"):
        parser.add_argument(f"--{key}", type=Path, required=True)
    parser.add_argument("--edr", type=Path, help="Optionele KNMI EDR-cache vanaf winterjaar 2020/21")
    parser.add_argument("--eerste", type=int, default=1902)
    parser.add_argument("--laatste", type=int, default=2026)
    args = parser.parse_args()
    stations = {metric: {} for metric in ("val", "dek", "vorst")}
    seasons = {}
    for end in range(args.eerste, args.laatste + 1):
        offsets = season_offsets(end)
        season = {"length": len(offsets)}
        path = args.daily / f"{end}.txt.gz"
        if not path.is_file():
            raise FileNotFoundError(path)
        season["vorst"] = frost_rows(path, stations["vorst"], offsets)
        if end >= 1951:
            root = args.edr if args.edr and end >= 2021 else args.hourly
            season.update(snowfall_season(root, end, stations["val"]))
        if end >= 1956:
            cover = defaultdict(lambda: (set(), set()))
            for year in (end - 1, end):
                read_cover(args.cover, year, stations["dek"], offsets, cover)
            season["dek"] = snow_rows(cover)
        seasons[end] = season
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(
        {"snowfallStart": "08-01", "stations": stations, "seasons": seasons}, ensure_ascii=False, separators=(",", ":")
    ) + "\n", encoding="utf-8")
    print(f"{len(seasons)} seizoenen, stations per bron: {', '.join(f'{k} {len(v)}' for k, v in stations.items())}")


if __name__ == "__main__":
    main()
