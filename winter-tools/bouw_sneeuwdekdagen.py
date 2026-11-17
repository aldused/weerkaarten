"""Tel sneeuwdekdagen en bereken de eerste witte dag uit KNMI-SX."""
import argparse
from collections import defaultdict
import csv
from datetime import date, timedelta
import json
from pathlib import Path
from statistics import mean

from bouw_seizoenskalender import read_cover

REFERENCE = date(2001, 10, 1)
PERIODS = ((1961, 1990), (1991, 2020))


def calendar_offset(day):
    year = REFERENCE.year + (day.month < REFERENCE.month)
    return (date(year, day.month, min(day.day, 28) if day.month == 2 else day.day) - REFERENCE).days


def season(root, end):
    start, stop = date(end - 1, 10, 1), date(end, 4, 1)
    dates = {(start + timedelta(days=i)).strftime("%Y%m%d"): i for i in range((stop - start).days)}
    observations = defaultdict(lambda: (set(), set()))
    for year in (end - 1, end):
        read_cover(root, year, {}, dates, observations)

    stations = [snow for valid, snow in observations.values() if 10 * len(valid) >= 9 * len(dates)]
    national = set().union(*(snow for _, snow in observations.values()))
    if not stations:
        raise ValueError(f"Geen stations met voldoende dekking voor {end}")

    first_dates = [start + timedelta(days=min(snow)) for snow in stations if snow]
    first_national = start + timedelta(days=min(national)) if national else None
    return {
        "mean": mean(map(len, stations)),
        "national": len(national),
        "stations": len(stations),
        "meanFirst": mean(map(calendar_offset, first_dates)) if first_dates else None,
        "firstNational": first_national,
    }


def normal(seasons, start, end, field, convert):
    values = [convert(seasons[y][field]) for y in range(start, end + 1) if seasons[y][field] is not None]
    return (REFERENCE + timedelta(days=round(mean(values)))).isoformat() if values else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cover", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    index = json.loads((args.cover / "index.json").read_text())
    first, last = (date.fromisoformat(index[key]) for key in ("first", "last"))
    first_end = first.year + (first > date(first.year, 10, 1)) + 1
    last_end = last.year - (last < date(last.year, 3, 31))
    seasons = {end: season(args.cover, end) for end in range(first_end, last_end + 1)}
    with (args.out / "sneeuwdekdagen.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["eindjaar", "gemiddeld_per_station", "ergens_in_nederland", "stations_met_90pct_dekking"])
        for year, row in seasons.items():
            writer.writerow([year, round(row["mean"], 3), row["national"], row["stations"]])

    normals = [
        [f"{start}–{end}", normal(seasons, start, end, "meanFirst", lambda value: value),
         normal(seasons, start, end, "firstNational", calendar_offset)]
        for start, end in PERIODS
    ]
    (args.out / "eerste-sneeuwdek.json").write_text(
        json.dumps(normals, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
