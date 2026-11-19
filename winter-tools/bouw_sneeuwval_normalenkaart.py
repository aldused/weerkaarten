"""Publiceer de officiële KNMI-sneeuwvalnormalen (feitelijke meetperiode 2003–2020).

Bron: tabel 'Gemiddeld aantal dagen met sneeuwval', PDF-pagina 19.
'.' betekent niet voorgekomen (nul); '-' ontbreekt. Jaarwaarden worden exact
uit de jaarkolom overgenomen, nooit uit afgeronde maandwaarden opgeteld.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://cdn.knmi.nl/knmi/map/page/klimatologie/klimaatatlas/tabel/stationsdata/aantal-dagen-met_9120.pdf#page=19'
METHOD = 'https://www.knmi.nl/kennis-en-datacentrum/achtergrond/achtergrondinformatie-berekening-klimaatnormalen-1991-2020'
POSITIONS = 'https://www.daggegevens.knmi.nl/klimatologie/uurgegevens'
MONTHS = ('jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec')


def value(raw):
    if raw == '-':
        return None
    if raw == '.':
        return 0.0
    result = float(raw)
    if result < 0:
        raise ValueError('Negatief aantal sneeuwdagen')
    return result


def build(source, positions, geometry):
    with positions.open() as f:
        coords = {int(row['stationnummer']): row for row in csv.DictReader(f)}
    stations = []
    with source.open() as f:
        for row in csv.DictReader(f):
            sid = int(row['stationnummer'])
            point = coords[sid]
            stations.append({'id': sid, 'name': row['station'],
                             'lat': float(point['breedtegraad']), 'lon': float(point['lengtegraad']),
                             'mean': value(row['jaar']), 'monthly': [value(row[m]) for m in MONTHS],
                             'seasonal': {season: value(row[season]) for season in ('winter', 'lente', 'zomer', 'herfst')}})
    if len({s['id'] for s in stations}) != len(stations):
        raise ValueError('Dubbel stationsnummer')
    match = re.search(r'/\*GEO-START\*/const GEO=(.*?);/\*GEO-END\*/', geometry.read_text(), re.S)
    if not match:
        raise ValueError('Bestaande kaartgeometrie ontbreekt')
    return {'kind': 'snowfall', 'period': [2003, 2020], 'publicationPeriod': [1991, 2020],
            'source': SOURCE, 'methodSource': METHOD, 'positionSource': POSITIONS,
            'method': 'Gepubliceerde KNMI-jaarnormalen. Meetperiode sneeuwval 2003–2020 wegens overgang naar automatische waarneming. Niet rechtstreeks vergelijkbaar met eerdere visuele sneeuwvalnormalen. Ontbrekende jaarnormalen blijven onbekend; geen optelling van maandwaarden.',
            'inputSHA256': {source.name: hashlib.sha256(source.read_bytes()).hexdigest(),
                            positions.name: hashlib.sha256(positions.read_bytes()).hexdigest()},
            'geometry': json.loads(match[1]), 'stations': stations}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'winter-tools/bronnen/KNMI-sneeuwvalnormalen-2003-2020.csv')
    parser.add_argument('--positions', type=Path, default=ROOT / 'winter-tools/bronnen/KNMI-uurstations-sneeuwval.csv')
    parser.add_argument('--geometry', type=Path, default=ROOT / 'beta_neerslagstations.html')
    parser.add_argument('--out', type=Path, default=ROOT / 'winter-data')
    args = parser.parse_args()
    data = build(args.source, args.positions, args.geometry)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'sneeuwval-normalen-2003-2020.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    with (args.out / 'sneeuwval-normalen-2003-2020.csv').open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f, delimiter=';', lineterminator='\n')
        writer.writerow(['stationnummer', 'station', 'normaal_sneeuwdagen_per_kalenderjaar', 'meetperiode', *MONTHS, 'breedtegraad', 'lengtegraad'])
        for s in data['stations']:
            numbers = [str(v).replace('.', ',') if v is not None else '' for v in [s['mean'], *s['monthly']]]
            writer.writerow([s['id'], s['name'], numbers[0], '2003-2020', *numbers[1:], s['lat'], s['lon']])
    print(f"{len(data['stations'])} KNMI-stations; {sum(s['mean'] is not None for s in data['stations'])} gepubliceerde jaarnormalen")


if __name__ == '__main__':
    main()
