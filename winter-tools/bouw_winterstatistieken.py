"""Bereken sneeuwdekreeksen, vorstvrije perioden en Hellmanngetallen per station."""
import argparse
from collections import defaultdict
from datetime import date, timedelta
import json
from pathlib import Path

from bouw_seizoenskalender import read_cover, read_rows, season_offsets


def iso(start, offset):
    return (start + timedelta(days=offset)).isoformat()


def longest_run(offsets):
    best_start = None
    best_length = 0
    current_start = previous = None
    for offset in sorted(offsets):
        if previous is None or offset != previous + 1:
            current_start = offset
        length = offset - current_start + 1
        if length > best_length:
            best_start, best_length = current_start, length
        previous = offset
    return best_start, best_length


def snow_cover(root, end, names):
    observations = defaultdict(lambda: (set(), set()))
    offsets = season_offsets(end)
    for year in (end - 1, end):
        if not (root / f"{year}.json.gz").is_file():
            raise FileNotFoundError(f"Sneeuwdekgegevens voor {year} ontbreken")
        read_cover(root, year, names, offsets, observations)
    start = date(end - 1, 7, 1)
    result = []
    for station, (valid, snow) in sorted(observations.items()):
        first, length = longest_run(snow)
        result.append([
            station, length,
            iso(start, first) if length else None,
            iso(start, first + length - 1) if length else None,
            len(valid)
        ])
    return result


def frost_free(year, minima):
    start = date(year, 1, 1)
    july = (date(year, 7, 1) - start).days
    result = []
    for station, days in sorted(minima.items()):
        spring = max((d for d, v in days.items() if d < july and v < 0), default=None)
        autumn = min((d for d, v in days.items() if d >= july and v < 0), default=None)
        length = None
        if spring is not None and autumn is not None and all(d in days for d in range(spring + 1, autumn)):
            length = autumn - spring - 1
        result.append([
            station, length,
            iso(start, spring) if spring is not None else None,
            iso(start, autumn) if autumn is not None else None,
            len(days)
        ])
    return result


def hellmann(end, temperatures):
    expected = (date(end, 4, 1) - date(end - 1, 11, 1)).days
    return [
        [station, sum(-v for v in days.values() if v < 0) / 10 if len(days) == expected else None,
         None, None, len(days)]
        for station, days in sorted(temperatures.items())
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("daily", "cover", "out"):
        parser.add_argument(f"--{key}", type=Path, required=True)
    parser.add_argument("--eerste", type=int, default=1902)
    parser.add_argument("--laatste", type=int, default=2026)
    args = parser.parse_args()
    cover_names, daily_names = {}, {}
    series = {kind: {} for kind in ("snow", "free", "cold")}
    pending_minima = defaultdict(dict)
    for end in range(args.eerste, args.laatste + 1):
        path = args.daily / f"{end}.txt.gz"
        new_minima = defaultdict(dict)
        means = defaultdict(dict)
        for station, raw_date, (minimum, mean) in read_rows(path, daily_names, "TN", "TG"):
            if not f"{end-1}0701" <= raw_date <= f"{end}0630":
                continue
            if minimum:
                measured = date.fromisoformat(raw_date)
                offset = (measured - date(measured.year, 1, 1)).days
                minima = pending_minima if measured.year == end - 1 else new_minima
                minima[station][offset] = int(minimum)
            if mean and f"{end-1}1101" <= raw_date <= f"{end}0331":
                means[station][raw_date] = int(mean)
        if end > args.eerste:
            series["free"][end - 1] = frost_free(end - 1, pending_minima)
        pending_minima = new_minima
        series["cold"][end] = hellmann(end, means)
        if end >= 1957:
            series["snow"][end] = snow_cover(args.cover, end, cover_names)
    result = {"names": {"snow": cover_names, "free": daily_names, "cold": daily_names}, "series": series}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(", ".join(f"{name}: {len(rows)} perioden" for name, rows in series.items()))


if __name__ == "__main__":
    main()
