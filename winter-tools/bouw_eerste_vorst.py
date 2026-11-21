"""Eerste waargenomen vorst per station en winterjaar (1 augustus–31 juli)."""
import argparse
from collections import defaultdict
from datetime import date, datetime
import json
from pathlib import Path
from zoneinfo import ZoneInfo


def classify(tn):
    if tn >= 0:
        return None
    return 3 if tn < -150 else 2 if tn < -100 else 1 if tn < -50 else 0


def build(daily, registry, historical, records, today):
    names = {str(s['source']): name for name, s in registry['stations'].items() if s['source'] != 'nl_extreme'}
    stations = {key: {'name': name, 'historical': key in {'20', '130', '170'}} for key, name in names.items()}
    # Keep only one station/day value. Curated records fill missing observations;
    # a full daily series remains authoritative when both contain the same day.
    values = defaultdict(dict)

    def add(station, day, tn, replace=True):
        if not isinstance(tn, (float, int)) or tn <= -9990:
            return
        try:
            d = date.fromisoformat(day) if '-' in day else datetime.strptime(day, '%Y%m%d').date()
        except ValueError:
            return
        if d >= today:
            return
        if replace or d not in values[station]:
            values[station][d] = tn

    full = {str(key) for key, item in historical['stations'].items() if item.get('dailySeries')}
    for key in registry['sources']:
        key = str(key)
        if key in full:
            continue
        source = json.loads((daily / f'dagdata_{key}.json').read_text())
        columns = source['kolommen']
        if 'TN' not in columns:
            continue
        di, ti = columns.index('YYYYMMDD'), columns.index('TN')
        for row in source['data']:
            add(key, str(row[di]), row[ti])
    if historical.get('units') != 'physical':
        raise ValueError('Historische temperatuurreeks moet fysieke eenheden gebruiken')
    for day, observations in historical['days'].items():
        for key, obs in observations.items():
            if str(key) in full and obs.get('TN') is not None:
                add(str(key), day, round(obs['TN'] * 10))
    ids = {name: key for key, name in names.items()}
    curated = list(records.get('waarnemingen', []))
    for month in records.get('dag', {}).values():
        for day in month.values():
            for value, stamp, *name in day.get('tn_laag', []):
                if name:
                    curated.append({'parameter': 'TN', 'waarde': value, 'datum': stamp, 'station': name[0]})
    for obs in curated:
        if obs['parameter'] != 'TN':
            continue
        key = ids.get(obs['station'], 'hist:' + obs['station'])
        stations.setdefault(key, {'name': obs['station'], 'historical': True})
        add(key, obs['datum'], round(obs['waarde'] * 10), replace=False)
    seasons = {}
    through = max(d for rows in values.values() for d in rows)
    for station, observations in values.items():
        by_year = {}
        for d, tn in sorted(observations.items()):
            end = d.year + (d.month >= 8)
            start, stop = date(end - 1, 8, 1), date(end, 8, 1)
            season = seasons.setdefault(str(end), {'length': (stop - start).days, 'vorst': [], 'running': stop > today})
            row = by_year.setdefault(end, [station, 0, None, None, None, None, None, None, None, None])
            row[1] += 1
            category = classify(tn)
            if category is not None and row[2 + category * 2] is None:
                row[2 + category * 2:4 + category * 2] = [(d - start).days, tn / 10]
        for end, row in by_year.items():
            seasons[str(end)]['vorst'].append(row)
    for season in seasons.values():
        season['vorst'].sort(key=lambda row: stations[row[0]]['name'])
    return {'version': 1, 'start': '08-01', 'end': '07-31', 'through': through.isoformat(), 'stations': stations, 'seasons': seasons}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--daily', type=Path, required=True)
    p.add_argument('--registry', type=Path, default=Path('record-stations.json'))
    p.add_argument('--historical', type=Path, default=Path('historische-dagwaarden.json'))
    p.add_argument('--records', type=Path, required=True)
    p.add_argument('--today', type=date.fromisoformat, default=datetime.now(ZoneInfo('Europe/Amsterdam')).date())
    p.add_argument('--out', type=Path, default=Path('winter-data/eerste-vorst.json'))
    args = p.parse_args()
    result = build(args.daily, json.loads(args.registry.read_text()), json.loads(args.historical.read_text()), json.loads(args.records.read_text()), args.today)
    args.out.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f"{len(result['seasons'])} winterjaren, waarnemingen t/m {result['through']}, {len(result['stations'])} beschikbare stations")


if __name__ == '__main__':
    main()
