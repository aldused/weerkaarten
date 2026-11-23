"""Bereken stationnormalen sneeuwdekdagen voor een klimaatperiode uit volledige kalenderjaren.

Bron: KNMI SX om 08 UTC; positieve codes (ook 997–999) tellen als sneeuwdek.
Een ontbrekende of tegenstrijdige dag is onbekend en maakt het jaar onvolledig.
Alleen 30 volledige kalenderjaren leveren een normaalwaarde op.
"""
import argparse
from collections import defaultdict
import csv
from datetime import date
import gzip
import hashlib
import json
from pathlib import Path
import re

from bouw_seizoenskalender import repeated_snow_code

ROOT = Path(__file__).resolve().parents[1]

PERIODS = ((1961, 1990), (1991, 2020))
SOURCE = 'https://daggegevens.knmi.nl/klimatologie/monv/reeksen'
POSITION_SOURCE = 'https://dataplatform.knmi.nl/catalog/datasets/index.html?x-dataset=climate_normals_1991_2020_precipitation_normals_by_station&x-dataset-version=1'


def positions(path):
    candidates = defaultdict(dict)
    for row in csv.reader(path.read_text(encoding='latin1').splitlines()):
        if len(row) < 5:
            continue
        try:
            number = int(row[1].strip().split('_')[0])
            lon, lat = float(row[2]), float(row[3])
        except ValueError:
            continue
        if 3 < lon < 7.5 and 50.5 < lat < 53.8:
            candidates[number][(lat, lon)] = row[0].strip()
    result = {}
    for number, locations in candidates.items():
        if len(locations) == 1:
            (lat, lon), name = next(iter(locations.items()))
            result[number] = {'name': name, 'lat': lat, 'lon': lon}
        else:
            result[number] = {'name': ' / '.join(sorted(set(locations.values()))), 'lat': None, 'lon': None,
                              'positionNote': 'Meerdere posities in de KNMI-stationslijst; alleen in de tabel.'}
    return result


def month_values(data, year, national=None):
    """Station -> twaalf [waargenomen sneeuwdekdagen, geldige dagen]."""
    counts = defaultdict(lambda: [[0, 0] for _ in range(12)])
    for raw_day, observations in data['days'].items():
        day = date.fromisoformat(raw_day)
        if day.year != year:
            continue
        values = defaultdict(set)
        for station, code in observations:
            counts[station]
            if isinstance(code, int) and not isinstance(code, bool) and 0 <= code <= 999 and not repeated_snow_code(raw_day, station, code):
                values[station].add(code)
        for station, codes in values.items():
            if len(codes) == 1:
                count = counts[station][day.month - 1]
                count[1] += 1
                count[0] += next(iter(codes)) > 0
        if national is not None:
            valid = [next(iter(codes)) for codes in values.values() if len(codes) == 1]
            national[day.month - 1][0] += any(code > 0 for code in valid)
            national[day.month - 1][1] += bool(valid)
    return dict(counts)


def year_values(data, year):
    """Station -> [sneeuwdekdagen of None, aantal geldige dagen]."""
    expected = (date(year + 1, 1, 1) - date(year, 1, 1)).days
    result = {}
    for sid, months in month_values(data, year).items():
        snow, valid = map(sum, zip(*months))
        result[sid] = [snow if valid == expected else None, valid]
    return result


def build(cover, station_file, geometry_file, start=1991, end=2020):
    if end - start != 29:
        raise ValueError("Een klimaatperiode moet 30 kalenderjaren bevatten")
    meta = positions(station_file)
    annual = defaultdict(dict)
    monthly = defaultdict(dict)
    names = {}
    sources = {}
    autumn_months = [[0, 0] for _ in range(12)]
    autumn_path = cover / f'{start - 1}.json.gz'
    autumn = {}
    autumn_hash = None
    if autumn_path.is_file():
        raw = autumn_path.read_bytes()
        autumn_hash = hashlib.sha256(raw).hexdigest()
        autumn = month_values(json.loads(gzip.decompress(raw)), start - 1, autumn_months)
    national = []
    for year in range(start, end + 1):
        path = cover / f'{year}.json.gz'
        raw = path.read_bytes()
        sources[path.name] = hashlib.sha256(raw).hexdigest()
        data = json.loads(gzip.decompress(raw))
        names.update({int(k): v for k, v in data['stations'].items()})
        expected = (date(year + 1, 1, 1) - date(year, 1, 1)).days
        national_months = [[0, 0] for _ in range(12)]
        for sid, months in month_values(data, year, national_months).items():
            monthly[sid][year] = months
            snow, valid = map(sum, zip(*months))
            annual[sid][year] = [snow if valid == expected else None, valid]
        national.append([year, national_months])
    stations = []
    for sid, years in sorted(annual.items()):
        series = [[year, *years.get(year, [None, 0])] for year in range(start, end + 1)]
        complete = [item for item in series if item[1] is not None]
        normal = sum(item[1] for item in complete) / 30 if len(complete) == 30 else None
        station = {'id': sid, 'name': meta.get(sid, {}).get('name', names[sid]),
                   'lat': meta.get(sid, {}).get('lat'), 'lon': meta.get(sid, {}).get('lon'),
                   'mean': round(normal, 4) if normal is not None else None,
                   'years': len(complete), 'validDays': sum(item[2] for item in series),
                   'annual': series,
                   'previousAutumn': autumn.get(sid, [[0, 0] for _ in range(12)])[9:],
                   'monthlyAnnual': [[y, monthly[sid].get(y, [[0, 0] for _ in range(12)])] for y in range(start, end + 1)]}
        stations.append(station)
    match = re.search(r'/\*GEO-START\*/const GEO=(.*?);/\*GEO-END\*/', geometry_file.read_text(), re.S)
    if not match:
        raise ValueError('Bestaande kaartgeometrie ontbreekt')
    return {'period': [start, end], 'minimumYears': 30, 'unit': 'dagen per kalenderjaar', 'timeUTC': '08:00',
            'expectedDays': (date(end + 1, 1, 1) - date(start, 1, 1)).days,
            'source': SOURCE, 'positionSource': POSITION_SOURCE,
            'method': 'Alleen 30 volledige kalenderjaren. SX > 0, inclusief gebroken sneeuwdek en sneeuwhopen. Ontbrekende, tegenstrijdige en bekende verdachte oude registraties zijn onbekend.',
            'monthlyAnnualFields': ['snowCoverDays', 'validDays'], 'inputSHA256': sources, 'positionSHA256': hashlib.sha256(station_file.read_bytes()).hexdigest(),
            'previousAutumnSHA256': autumn_hash,
            'geometry': json.loads(match[1]), 'stations': stations,
            'national': {'previousAutumn': autumn_months[9:], 'monthlyAnnual': national}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cover', type=Path, default=ROOT / 'sneeuwdek-data')
    parser.add_argument('--stations', type=Path, default=ROOT / 'winter-tools/bronnen/Neerslagstations-1991-2020.csv')
    parser.add_argument('--geometry', type=Path, default=ROOT / 'beta_neerslagstations.html')
    parser.add_argument('--out', type=Path, default=ROOT / 'winter-data')
    args = parser.parse_args()
    for start, end in PERIODS:
        write_period(args, start, end)


def write_period(args, start, end):
    data = build(args.cover, args.stations, args.geometry, start, end)
    stem = f"sneeuwdek-normalen-{start}-{end}"
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / f'{stem}.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    with (args.out / f'{stem}.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.writer(stream, delimiter=';', lineterminator='\n')
        writer.writerow(['stationnummer', 'station', 'normaal_sneeuwdekdagen_per_kalenderjaar', f'volledige_jaren_{start}_{end}', 'geldige_meetdagen', 'breedtegraad', 'lengtegraad'])
        for s in data['stations']:
            writer.writerow([f"{s['id']:03}", s['name'], str(s['mean']).replace('.', ',') if s['mean'] is not None else '', s['years'], s['validDays'], s['lat'], s['lon']])
    print(f"{start}–{end}: {len(data['stations'])} stations; {sum(s['mean'] is not None for s in data['stations'])} volledige normalen; "
          f"{sum(s['mean'] is not None and s['lat'] is None for s in data['stations'])} normalen zonder kaartpositie")


if __name__ == '__main__':
    main()
