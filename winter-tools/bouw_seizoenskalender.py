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
        if day not in offsets or not day.startswith(month):
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
            if code is None:
                continue
            days, positives = observations[station]
            days.add(offset)
            if code > 0:
                positives.add(offset)


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
            snow = defaultdict(lambda: (set(), set()))
            root = args.edr if end >= 2021 else args.hourly
            for month in MONTHS:
                prefix = f"{end - (month >= 7)}{month:02d}"
                path = root / f"{prefix}.txt.gz"
                if not path.is_file():
                    raise FileNotFoundError(path)
                station_snow(path, stations["val"], offsets, snow, prefix)
            season["val"] = snow_rows(snow)
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
