"""Tel waargenomen sneeuwdagen over 1961–1990 en 1991–2020 uit KNMI-uurwaarden.

Een bruikbaar kalenderjaar heeft op iedere dag een geldige registratie en
minstens 99% geldige uurvakken. Minstens 24 van de 30 bruikbare jaren zijn vereist voor een gemiddelde.
Ontbrekende/tegenstrijdige uren worden niet ingevuld. Dit is een eigen telling
van waargenomen sneeuwdagen, geen gehomogeniseerde officiële KNMI-normaal.
"""
import argparse
from collections import defaultdict
from datetime import date, timedelta
import csv
import gzip
import hashlib
import json
from pathlib import Path
import re

from bouw_seizoenskalender import OFFSHORE
from bouw_winterdata import snow_indicator

ROOT = Path(__file__).resolve().parents[1]
PERIODS = ((1961, 1990), (1991, 2020))
FULL_DAY = (1 << 24) - 1
NATIONAL = "national"
STATION = re.compile(r'^#\s*(\d+):?\s+([-.\d]+)\s+([-.\d]+)\s+[-.\d]+\s+(.+?)\s*$')
SOURCE = 'https://www.daggegevens.knmi.nl/klimatologie/uurgegevens'
METHOD_SOURCE = 'https://www.knmi.nl/kennis-en-datacentrum/achtergrond/achtergrondinformatie-berekening-klimaatnormalen-1991-2020'


def add_hour(masks, hour, event):
    """Bitmasks [valid, snow, conflicting]; duplicates never count twice."""
    if event is None or not 1 <= hour <= 24:
        return
    bit = 1 << (hour - 1)
    if masks[2] & bit:
        return
    if masks[0] & bit and bool(masks[1] & bit) != event:
        masks[0] &= ~bit
        masks[1] &= ~bit
        masks[2] |= bit
        return
    masks[0] |= bit
    if event:
        masks[1] |= bit


def summarize_year(days, year):
    expected = (date(year + 1, 1, 1) - date(year, 1, 1)).days
    valid_days = sum(bool(valid) for valid, snow, conflicts in days.values())
    valid_hours = sum(valid.bit_count() for valid, snow, conflicts in days.values())
    snow_days = sum(bool(snow) for valid, snow, conflicts in days.values())
    usable = valid_days == expected and valid_hours * 100 >= expected * 24 * 99
    return [year, snow_days if usable else None, valid_days, valid_hours, snow_days]


def read_year(root, year, stations, hashes, monthly=None, months=range(1, 13)):
    daily = defaultdict(dict)
    start = date(year, 1, 1)
    allowed = {(start + timedelta(days=i)).strftime('%Y%m%d') for i in range((date(year + 1, 1, 1) - start).days)}
    for month in months:
        prefix = f'{year}{month:02}'
        path = root / f'{prefix}.txt.gz'
        hashes[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        with gzip.open(path, 'rt', encoding='utf-8', errors='replace') as f:
            for line in f:
                if match := STATION.fullmatch(line.rstrip()):
                    sid, lon, lat, name = match.groups()
                    lon, lat = float(lon), float(lat)
                    stations[int(sid)] = {'name': name, 'lon': lon if 3 < lon < 7.5 and 50.5 < lat < 54 else None,
                                          'lat': lat if 3 < lon < 7.5 and 50.5 < lat < 54 else None}
                if line.startswith('# STN,YYYYMMDD,HH,'):
                    cols = [v.strip() for v in line[1:].split(',')]
                    indices = [cols.index(k) for k in ('HH', 'WW', 'IX', 'S')]
                    break
            else:
                raise ValueError(f'KNMI-kolomkop ontbreekt: {path}')
            for line in f:
                if not line.lstrip()[:1].isdigit():
                    continue
                row = line.split(',')
                sid, day = int(row[0]), row[1].strip()
                # Selecties kunnen een extra uur/dag buiten de maand leveren.
                if sid in OFFSHORE or not day.startswith(prefix) or day not in allowed:
                    continue
                hour, ww, ix, snow = (row[i].strip() for i in indices)
                masks = daily[sid].setdefault(day, [0, 0, 0])
                add_hour(masks, int(hour), snow_indicator(day, ww, ix, snow))
    if monthly is not None:
        monthly[year] = {}
        national = defaultdict(lambda: [0, 0])
        for sid, days in daily.items():
            totals = [[0, 0, 0] for _ in range(12)]
            for day, (valid, snow, conflicts) in days.items():
                row = totals[int(day[4:6]) - 1]
                row[0] += bool(snow)
                row[1] += bool(valid)
                row[2] += valid.bit_count()
                national[day][0] |= valid
                national[day][1] |= snow
            monthly[year][sid] = totals
        totals = [[0, 0, 0] for _ in range(12)]
        for day, (valid, snow) in national.items():
            row = totals[int(day[4:6]) - 1]
            row[0] += bool(snow)
            row[1] += bool(valid)
            row[2] += valid.bit_count()
        monthly[year][NATIONAL] = totals
    return {sid: summarize_year(days, year) for sid, days in daily.items()}


def build_period(root, start, end, geometry):
    names, hashes, annual, monthly = {}, {}, defaultdict(dict), {}
    autumn_hashes = {}
    read_year(root, start - 1, names, autumn_hashes, monthly, months=range(10, 13))
    autumn = monthly[start - 1]
    for year in range(start, end + 1):
        for sid, row in read_year(root, year, names, hashes, monthly).items():
            annual[sid][year] = row
    stations = []
    for sid, years in sorted(annual.items()):
        rows = [years.get(y, [y, None, 0, 0, 0]) for y in range(start, end + 1)]
        usable = [r for r in rows if r[1] is not None]
        # Stations zonder één geldige uurregistratie hebben geen sneeuwreeks.
        if not any(r[3] for r in rows):
            continue
        stations.append({'id': sid, **names.get(sid, {'name': f'Station {sid}', 'lat': None, 'lon': None}),
                         'mean': round(sum(r[1] for r in usable) / len(usable), 4) if len(usable) >= 24 else None,
                         'years': len(usable), 'validDays': sum(r[2] for r in rows),
                         'validHours': sum(r[3] for r in rows), 'annual': rows,
                         'previousAutumn': autumn.get(sid, [[0, 0, 0] for _ in range(12)])[9:],
                         'monthlyAnnual': [[y, monthly[y].get(sid, [[0, 0, 0] for _ in range(12)])] for y in range(start, end + 1)]})
    expected = (date(end + 1, 1, 1) - date(start, 1, 1)).days
    return {'kind': 'snowfall', 'period': [start, end], 'expectedDays': expected, 'expectedHours': expected * 24,
            'minimumYearHourCoverage': 0.99, 'minimumYears': 24, 'source': SOURCE, 'methodSource': METHOD_SOURCE,
            'method': 'Eigen telling van waargenomen sneeuwdagen per UTC-kalenderjaar. Ieder jaar vereist een geldige registratie op elke kalenderdag en minstens 99% geldige uurvakken. Minstens 24 van de 30 bruikbare jaren zijn vereist. Ontbrekende jaren worden niet als nul geteld. Ontbrekende of tegenstrijdige uren zijn onbekend. De reeks bevat de overgang van visuele naar automatische waarnemingen en is niet gehomogeniseerd.',
            'monthlyAnnualFields': ['snowDays', 'validDays', 'validHours'], 'inputSHA256': hashes,
            'previousAutumnSHA256': autumn_hashes, 'geometry': geometry, 'stations': stations,
            'national': {'previousAutumn': autumn[NATIONAL][9:],
                         'monthlyAnnual': [[y, monthly[y][NATIONAL]] for y in range(start, end + 1)]}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hourly', type=Path, required=True)
    parser.add_argument('--geometry', type=Path, default=ROOT / 'beta_neerslagstations.html')
    parser.add_argument('--out', type=Path, default=ROOT / 'winter-data')
    args = parser.parse_args()
    match = re.search(r'/\*GEO-START\*/const GEO=(.*?);/\*GEO-END\*/', args.geometry.read_text(), re.S)
    if not match:
        raise ValueError('Kaartgeometrie ontbreekt')
    args.out.mkdir(parents=True, exist_ok=True)
    for start, end in PERIODS:
        data = build_period(args.hourly, start, end, json.loads(match[1]))
        stem = f'sneeuwval-normalen-{start}-{end}'
        (args.out / f'{stem}.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
        with (args.out / f'{stem}.csv').open('w', encoding='utf-8-sig', newline='') as f:
            writer = csv.writer(f, delimiter=';', lineterminator='\n')
            writer.writerow(['stationnummer', 'station', 'gemiddeld_waargenomen_sneeuwdagen_per_jaar', 'klimaatperiode', 'bruikbare_jaren', 'geldige_dagen', 'geldige_uurvakken', 'verwachte_uurvakken', 'breedtegraad', 'lengtegraad'])
            for s in data['stations']:
                writer.writerow([s['id'], s['name'], str(s['mean']).replace('.', ',') if s['mean'] is not None else '', f'{start}-{end}', s['years'], s['validDays'], s['validHours'], data['expectedHours'], s['lat'], s['lon']])
        print(f'{start}–{end}: {len(data["stations"])} stations; {sum(s["mean"] is not None for s in data["stations"])} periodegemiddelden met minstens 24 bruikbare jaren', flush=True)


if __name__ == '__main__':
    main()
