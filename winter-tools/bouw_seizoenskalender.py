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
MONTHS = (7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6)
SNOW_MONTHS = MONTHS[MONTHS.index(9):]
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


def season_offsets(end):
    start = date(end - 1, 7, 1)
    days = (date(end, 7, 1) - start).days
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
    for station, day, (ww, ix, snow) in read_rows(path, station_names, "WW", "IX", "S"):
        if station in OFFSHORE or day not in offsets or not day.startswith(month):
            continue
        event = snow_indicator(day, ww, ix, snow)
        if event is None:
            continue
        offset = offsets[day]
        days, positives = observations[station]
        days.add(offset)
        if event:
            positives.add(offset)


def snow_rows(observations):
    return [
        [station, len(days), min(positives, default=None)]
        for station, (days, positives) in sorted(observations.items())
    ]


def snowfall_season(root, end, station_names, offsets):
    snow = defaultdict(lambda: (set(), set()))
    snow_start = f"{end-1}{SNOW_MONTHS[0]:02}01"
    snow_offsets = {day: offset for day, offset in offsets.items() if day >= snow_start}
    for month in SNOW_MONTHS:
        prefix = f"{end - (month >= 7)}{month:02}"
        station_snow(root / f"{prefix}.txt.gz", station_names, snow_offsets, snow, prefix)
    rows = snow_rows(snow)
    coverage = set().union(*(days for days, _ in snow.values()))
    first = min((row[2] for row in rows if row[2] is not None), default=len(offsets) - 1)
    complete = all(offset in coverage for offset in snow_offsets.values() if offset <= first)
    return {"val": rows, "valLength": len(snow_offsets), "valComplete": complete}


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
    for key in ("daily", "hourly", "edr", "cover", "out"):
        parser.add_argument(f"--{key}", type=Path, required=True)
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
            root = args.edr if end >= 2021 else args.hourly
            season.update(snowfall_season(root, end, stations["val"], offsets))
        if end >= 1956:
            cover = defaultdict(lambda: (set(), set()))
            for year in (end - 1, end):
                read_cover(args.cover, year, stations["dek"], offsets, cover)
            season["dek"] = snow_rows(cover)
        seasons[end] = season
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(
        {"stations": stations, "seasons": seasons}, ensure_ascii=False, separators=(",", ":")
    ) + "\n", encoding="utf-8")
    print(f"{len(seasons)} seizoenen, stations per bron: {', '.join(f'{k} {len(v)}' for k, v in stations.items())}")


if __name__ == "__main__":
    main()
