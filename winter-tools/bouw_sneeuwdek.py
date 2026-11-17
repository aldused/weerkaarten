"""Maak het sneeuwdekarchief en een ZIP met één CSV per kalenderjaar."""
import argparse
from collections import defaultdict
import csv
from datetime import date
import gzip
import io
import json
from pathlib import Path
import re
import zipfile

STATION = re.compile(r"^#\s+(\d+)\s+(.+?)\s*$")
COLUMNS = "# STN,YYYYMMDD,"
SOURCE = "Koninklijk Nederlands Meteorologisch Instituut (KNMI), Dagwaarden neerslagstations (SX)"

def read_period(path):
    names = defaultdict(set)
    days = defaultdict(set)
    with gzip.open(path, "rt", encoding="utf-8-sig") as f:
        for line in f:
            if match := STATION.fullmatch(line.rstrip("\r\n")):
                names[int(match[1])].add(match[2])
            if line.startswith(COLUMNS):
                break
        else:
            raise ValueError(f"Kolomkop ontbreekt in {path.name}")
        for fields in csv.reader(f, skipinitialspace=True):
            if not fields or not fields[0].strip().isdigit():
                continue
            station, day, _, value = [field.strip() for field in fields]
            day = date.fromisoformat(day).isoformat()
            code = int(value) if value else None
            if code is not None and not 0 <= code <= 999:
                raise ValueError(f"Onbekende SX-code {code} in {path.name}")
            days[day].add((int(station), code))
    return names, days

def station_name(names, station):
    choices = sorted(names[station], key=str.casefold)
    return " / ".join(choices) if choices else f"Station {station:03}"

def pack(data):
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("cache", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("zip", type=Path)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    args.zip.parent.mkdir(parents=True, exist_ok=True)

    by_year = defaultdict(list)
    for path in sorted(args.cache.glob("????????-????????.txt.gz")):
        by_year[path.name[:4]].append(path)
    if not by_year:
        raise ValueError("De maandcache is leeg.")
    index = dict(years={}, stationCount=0, observationCount=0)
    archive_stations = set()
    conflicts = []

    temporary_zip = args.zip.with_suffix(".part")
    with zipfile.ZipFile(temporary_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=7) as archive:
        archive.writestr("LEESMIJ.txt", f"""{SOURCE}
Meetmoment: 08.00 UTC (eenmaal per dag).
SX: 0 = sneeuwvrij, 1–996 = dikte in cm, 997 = gebroken sneeuwdek < 1 cm,
998 = gebroken sneeuwdek ≥ 1 cm, 999 = sneeuwhopen.
Een lege waarde is een ontbrekende sneeuwdekregistratie.
Identieke sneeuwdekregels voor één station op één dag zijn samengevoegd.
Bij verschillende bronwaarden voor één station op één dag blijven beide staan.
Stationnamen volgen de stationslijst van de KNMI-selectie. Waar één nummer
meerdere namen heeft in die lijst, zijn die met een schuine streep gescheiden.
Bron: https://daggegevens.knmi.nl/klimatologie/monv/reeksen
""")
        for year, paths in sorted(by_year.items()):
            if len(paths) != 2:
                raise ValueError(f"Onvolledige cache voor {year}: {len(paths)} bestanden")
            names, days = defaultdict(set), defaultdict(set)
            for path in paths:
                period_names, period_days = read_period(path)
                for station, choices in period_names.items():
                    names[station].update(choices)
                for day, values in period_days.items():
                    days[day].update(values)
            known_days = []
            known_stations = set()
            count = 0
            for day, values in days.items():
                stations = {s for s,c in values if c is not None}
                if not stations:
                    continue
                known_stations.update(stations)
                known_days.append(day)
                count += len(stations)
                if sum(c is not None for _,c in values) > len(stations):
                    conflicts.append(day)
            if not known_days:
                continue
            out = {
                "stations": {s: station_name(names, s) for s in sorted({s for rs in days.values() for s,_ in rs})},
                "days": {
                    day: sorted(values, key=lambda pair: (pair[0], -1 if pair[1] is None else pair[1]))
                    for day, values in sorted(days.items())
                }
            }
            index["years"][year] = [min(known_days), max(known_days), len(known_days), len(known_stations)]
            index["observationCount"] += count
            archive_stations.update(known_stations)
            (args.out / f"{year}.json.gz").write_bytes(gzip.compress(pack(out), compresslevel=7, mtime=0))

            station_days = defaultdict(list)
            for day, values in out["days"].items():
                for station, code in values:
                    station_days[station].append((day, code))
            with archive.open(f"sneeuwdek-{year}.csv", "w") as member:
                with io.TextIOWrapper(member, encoding="utf-8-sig", newline="") as f:
                    writer = csv.writer(f, delimiter=";")
                    writer.writerow(["datum", "tijd_UTC", "stationnummer", "KNMI_station", "SX", "dikte_cm"])
                    writer.writerows(
                        [day, "08:00", f"{s:03}", out["stations"][s], code,
                         code if code is not None and 0 <= code <= 996 else ""]
                        for s in sorted(station_days) for day, code in station_days[s]
                    )
    if not index["years"]:
        raise ValueError("Geen sneeuwdekregistraties in de cache")
    temporary_zip.replace(args.zip)
    index["stationCount"] = len(archive_stations)
    index["first"] = next(iter(index["years"].values()))[0]
    index["last"] = next(reversed(index["years"].values()))[1]
    (args.out / "index.json").write_bytes(pack(index) + b"\n")
    print(f'{index["first"]} t/m {index["last"]}, {len(index["years"])} jaren, '
          f'{index["stationCount"]} stationsnummers, {index["observationCount"]} stationdagen.')
    print(f'{len(conflicts)} dagen met verschillende waarden onder hetzelfde stationsnummer.')

if __name__ == "__main__":
    main()
