"""Export complete historical daily series and dated curated observations.

Usage: python3 scripts/maak_historische_dagkaart.py --source-dir /path/to/records
Values retain physical units; no rankings or period averages become daily data.
"""
import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARAMS = {'tx': 'TX', 'tn': 'TN', 'tg': 'TG', 'rh': 'RH', 'sq': 'SQ', 'fg': 'FG'}

def build(source_dir):
    registry = json.loads((ROOT / 'record-stations.json').read_text())['stations']
    stations = {s['id']: {'naam': name, 'lon': s['coordinates'][0], 'lat': s['coordinates'][1]}
                for name, s in registry.items() if s['coordinates']}
    days = {}
    def add(date, station, param, value):
        if value is not None and isinstance(value, (int, float)) and math.isfinite(value):
            days.setdefault(date.replace('-', ''), {}).setdefault(station, {})[param] = value
    for name, station in registry.items():
        if station['import']['type'] not in ('historical_csv', 'epen_csv'):
            continue
        data = json.loads((source_dir / f"records_{station['source']}.json").read_text())
        if not data.get('maanddetail'):
            raise ValueError(f'Geen volledige dagreeks voor {name}')
        for year, months in data['maanddetail'].items():
            for month, detail in months.items():
                for row in detail['dagen']:
                    date = f'{int(year):04d}-{int(month):02d}-{row["dag"]:02d}'
                    for key, param in PARAMS.items():
                        add(date, station['id'], param, row.get(key))
    curated = json.loads((source_dir / 'records_nl_extreme.json').read_text())
    for row in curated['waarnemingen']:
        station = registry[row['station']]
        if station['coordinates'] and row['parameter'] in PARAMS.values():
            add(row['datum'], station['id'], row['parameter'], row['waarde'])
    return {'units': 'physical', 'stations': stations, 'days': days}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=ROOT)
    args = parser.parse_args()
    data = build(args.source_dir)
    target = ROOT / 'historische-dagwaarden.json'
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), sort_keys=True))
    temporary.replace(target)
    print(f'{len(data["days"])} dagen, {target.stat().st_size} bytes')
