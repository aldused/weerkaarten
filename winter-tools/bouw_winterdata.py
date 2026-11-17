"""Maak de statische Weerlab-winterbestanden uit KNMI-dagzips en uurcache."""
import argparse
from calendar import monthrange
from collections import defaultdict
import gzip
from itertools import chain
import json
from pathlib import Path
import re
from zipfile import ZipFile

DEFAULT_OUT = Path(__file__).resolve().parents[1] / "winter-data"
VISUAL = frozenset((24, 56, 57, 66, 67))
AUTOMATIC = frozenset((25, 47, 48, 54, 55, 56, 64, 65, 66))
VISUAL_SNOW = frozenset((22, 23, 26, 68, 69, 70, 71, 72, 73, 74, 75, 77, 83, 84, 85, 86))
STATION = re.compile(r"^#\s*(\d{3})\s+[-.\d]+\s+[-.\d]+\s+[-.\d]+\s+(.+)")

def snow_indicator(date, ww, ix, snow):
    # Vóór 1971 is S ook bij veel onweersmeldingen gezet, zonder sneeuwcode.
    # Lees voor die jaren alleen expliciete sneeuwcodes uit visuele WW.
    if date < "19710101":
        if ix not in ("", "1", "4") or not ww.isdecimal() or int(ww) > 99:
            return None
        return int(ww) in VISUAL_SNOW
    if snow in ("0", "1"):
        return snow == "1"
    return None


def records(lines, required):
    for line in lines:
        if line.startswith("#") and "," in line:
            header = [x.strip() for x in line[1:].split(",")]
            if header[0] == "STN" and set(required) <= set(header):
                break
    else:
        raise ValueError("Kolommen ontbreken: " + ", ".join(required))
    for line in lines:
        if line.lstrip()[:1].isdigit():
            yield dict(zip(header, (x.strip() for x in line.split(","))))

def temperature(source, first, last):
    stations = {}
    seasons = defaultdict(dict)
    for item in json.loads((source / "manifest.json").read_text()):
        station, name = str(item["station"]), item["name"]
        groups = defaultdict(dict)
        with ZipFile(source / item["file"]) as archive:
            filename, = [n for n in archive.namelist() if n.endswith(".txt")]
            lines = archive.read(filename).decode("latin1").splitlines()
        for row in records(iter(lines), ("STN", "YYYYMMDD", "TN", "TX", "TG")):
            date = row["YYYYMMDD"]
            year, month = int(date[:4]), int(date[4:6])
            end = year + (month == 12)
            if month not in (12, 1, 2) or not first <= end <= last:
                continue
            if row["TN"] and row["TX"] and row["TG"]:
                groups[end][date] = tuple(int(row[k]) for k in ("TN", "TX", "TG"))
        for year, days in groups.items():
            values = list(days.values())
            seasons[year][station] = [
                len(values),
                sum(lo < 0 for lo, hi, avg in values),
                sum(hi < 0 for lo, hi, avg in values),
                sum(hi > 0 for lo, hi, avg in values),
                sum(lo > 0 for lo, hi, avg in values),
                min(lo for lo, hi, avg in values) / 10,
                max(hi for lo, hi, avg in values) / 10,
                round(sum(avg for lo, hi, avg in values) / len(values) / 10, 1)
            ]
            stations[station] = name
    return {"stations": stations, "winters": dict(sorted(seasons.items()))}

def hourly(paths, year, modern):
    stations, events = {}, {}
    coverage = defaultdict(lambda: [set(), set(), set()])
    for month, path in zip((10, 11, 12, 1, 2, 3), paths):
        calendar_year = year - (month >= 10)
        prefix = f"{calendar_year}{month:02d}"
        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as f:
            header = []
            for line in f:
                header.append(line)
                if match := STATION.match(line.strip()):
                    stations[match[1]] = match[2].strip()
                if line.startswith("# STN,YYYYMMDD,HH,"):
                    break
            for row in records(chain(header, f), ("STN", "YYYYMMDD", "HH", "WW", "IX", "S")):
                date = row["YYYYMMDD"]
                if not date.startswith(prefix):
                    continue
                stn, ww, ix, snow = row["STN"], row["WW"], row["IX"], row["S"]
                hh = int(row["HH"])
                if not 1 <= hh <= 24:
                    raise ValueError(f"Ongeldig uurvak: {date} {hh}")
                # Stations kunnen een leeg WW hebben ook als S expliciet 0 is.
                # De oudste WW-reeksen dateren van vóór de automatisering
                # van actueel weer. Gebruik bij een lege IX daar de visuele tabel.
                visual = ix in ("1", "4") or (ix == "" and calendar_year < 1994)
                usable_code = ww.isdecimal() and 0 <= int(ww) <= 99
                valid_ww = ix in ("2", "5") or (usable_code and (visual or ix == "7"))
                snow_event = snow_indicator(date, ww, ix, snow)
                ice = row.get("Y", "")
                if valid_ww:
                    coverage[stn][0].add((date, hh))
                if snow_event is not None:
                    coverage[stn][1].add((date, hh))
                if ice in ("0", "1"):
                    coverage[stn][2].add((date, hh))
                kind = 0
                if usable_code:
                    if (visual and int(ww) in VISUAL) or (ix == "7" and int(ww) in AUTOMATIC):
                        kind |= 1
                if snow_event:
                    kind |= 2
                if ice == "1":
                    kind |= 4
                if kind:
                    iso = f"{date[:4]}-{date[4:6]}-{date[6:]}"
                    key = (iso, stn, hh)
                    if key in events:
                        raise ValueError(f"Dubbel KNMI-uur: {key}")
                    events[key] = [kind, int(ix) if ix else None, int(ww) if ww else None]
    active = sorted(coverage.keys() | {key[1] for key in events})
    expected = sum(monthrange(year - (m >= 10), m)[1] for m in (10,11,12,1,2,3)) * 24
    return {
        "stations": {s: stations.get(s, f"Station {s}") for s in active},
        "expected": expected,
        "source": "edr" if modern else "legacy",
        "coverage": {s: [len(obs) for obs in coverage[s]] for s in active},
        "events": [[*key, *value] for key, value in sorted(events.items())]
    }

def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dagcache", type=Path, required=True)
    p.add_argument("--uurcache", type=Path, required=True)
    p.add_argument("--edr-cache", type=Path)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--first", type=int, default=1951)
    p.add_argument("--last", type=int, default=2026)
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    write(a.out / "temperatuur.json", temperature(a.dagcache, a.first, a.last))
    available = []
    for y in range(a.first, a.last + 1):
        months = [f"{y - (m >= 10)}{m:02d}.txt.gz" for m in (10,11,12,1,2,3)]
        modern = y >= 2021 and a.edr_cache is not None and all((a.edr_cache / m).is_file() for m in months)
        files = [(a.edr_cache if modern else a.uurcache) / m for m in months]
        if not all(path.is_file() for path in files):
            continue
        data = hourly(files, y, modern)
        if not data["stations"]:
            continue
        write(a.out / f"uur-{y}.json", data)
        available.append(y)
    write(a.out / "uren.json", available)
    print(f"Uurarchief: {len(available)} winters {available[:1]}–{available[-1:]}")

if __name__ == "__main__":
    main()
