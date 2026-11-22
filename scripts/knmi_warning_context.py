#!/usr/bin/env python3
"""Archive genuine hourly KNMI observations beside all warning days.

Uses the current KDP EDR API, not the legacy Daggegevens endpoint scheduled to
close in 2026. Keys stay in the existing backend helper. Daily public JSON is
shared by every warning on that Dutch calendar day. No invented spatial fields,
missing-value substitution or conversion of hourly visibility codes to metres.
"""
from __future__ import annotations

import argparse
from calendar import monthrange
from datetime import datetime, timedelta, timezone
import fcntl
import gzip
import json
import math
from pathlib import Path
import subprocess
import time
from zoneinfo import ZoneInfo

BASE = 'https://api.dataplatform.knmi.nl/edr/v1/collections/'
VALIDATED = 'hourly-in-situ-meteorological-observations-validated'
PROVISIONAL = 'hourly-in-situ-meteorological-observations'
FIELDS = ['T', 'TD', 'VV', 'U', 'FF', 'FX', 'RH', 'P']
NL = ZoneInfo('Europe/Amsterdam')
UTC = timezone.utc


def stamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(UTC)


def iso(value):
    return value.astimezone(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z')


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
    temp.replace(path)


def warning_days(records, now):
    result = set()
    for record in records:
        if record.get('dates'):
            result.update(record['dates'])
            continue
        first = stamp(record['onset']).astimezone(NL).date()
        last = (stamp(record['expires']) - timedelta(microseconds=1)).astimezone(NL).date()
        while first <= last:
            result.add(first.isoformat())
            first += timedelta(days=1)
    return sorted(day for day in result if '2010-01-01' <= day <= now.astimezone(NL).date().isoformat())


def month_window(month):
    year, number = map(int, month.split('-'))
    start = datetime(year, number, 1, tzinfo=NL)
    end = start + timedelta(days=monthrange(year, number)[1])
    return start.astimezone(UTC), end.astimezone(UTC)


def rows(payload, quality):
    if payload.get('type') != 'CoverageCollection' or not isinstance(payload.get('coverages'), list):
        raise ValueError('Geen KNMI CoverageCollection')
    if any(link.get('rel') == 'next' for link in payload.get('links', [])):
        raise ValueError('KNMI-antwoord gepagineerd; maandvenster is te groot')
    result = {}
    for coverage in payload['coverages']:
        identity = coverage['eumetnet:locationId']
        axes = coverage['domain']['axes']
        times = axes['t']['values']
        lon, lat = axes['x']['values'][0], axes['y']['values'][0]
        if not (3 <= lon <= 7.5 and 50.5 <= lat <= 53.8):
            continue
        ranges = coverage['ranges']
        for field in FIELDS:
            values = ranges.get(field)
            if values and (values.get('axisNames') != ['t', 'y', 'x'] or values.get('shape') != [len(times), 1, 1] or len(values['values']) != len(times)):
                raise ValueError('Onverwachte dimensies voor ' + field)
        for index, value in enumerate(times):
            when = stamp(value)
            if when.minute or when.second:
                raise ValueError('KNMI uurmeting heeft geen heel uur als tijdstempel')
            row = []
            for field in FIELDS:
                item = ranges[field]['values'][index] if field in ranges else None
                if item is not None and (isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item)):
                    raise ValueError('Ongeldige waarneming')
                row.append(item)
            if not any(item is not None for item in row):
                continue
            result[(iso(when), identity)] = {'values': row, 'quality': quality, 'lon': lon, 'lat': lat}
    return result


def visibility_code(metres):
    if not isinstance(metres, (int, float)) or isinstance(metres, bool) or not math.isfinite(metres) or metres < 0:
        return None
    if metres < 5000:
        return min(49, int(metres // 100))
    if metres < 6000:
        return 50
    if metres < 30000:
        return min(79, int(metres // 1000) + 50)
    if metres <= 70000:
        return min(88, 80 + int((metres - 30000) // 5000))
    return 89


def ten_minute_rows(payload):
    if payload.get('type') != 'CoverageCollection' or any(link.get('rel') == 'next' for link in payload.get('links', [])):
        raise ValueError('Geen volledige tienminutenreeks')
    result = {}
    for coverage in payload['coverages']:
        axes = coverage['domain']['axes']; times = axes['t']['values']; ranges = coverage['ranges']
        lon, lat = axes['x']['values'][0], axes['y']['values'][0]
        if not (3 <= lon <= 7.5 and 50.5 <= lat <= 53.8): continue
        identity = coverage['eumetnet:locationId']
        for key, value in ranges.items():
            if value.get('shape') != [len(times), 1, 1] or value.get('axisNames') != ['t','y','x']:
                raise ValueError('Onverwachte tienminutendimensies')
        positions = {stamp(t): i for i, t in enumerate(times)}
        def value(key, index):
            v = ranges.get(key, {}).get('values', [None] * len(times))[index]
            return v if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None
        for when, index in positions.items():
            if when.minute or when.second: continue
            gusts = [value('fx', positions[when-timedelta(minutes=offset)]) if when-timedelta(minutes=offset) in positions else None for offset in (0,10,20,30,40,50)]
            gust = max(gusts) if all(v is not None for v in gusts) else None
            metres = value('vv', index)
            row = [value('ta', index), value('td', index), visibility_code(metres), value('rh', index), value('ff', index), gust, None, value('p0', index)]
            if any(v is not None for v in row): result[(iso(when), identity)] = {'values':row,'quality':'provisional-ten-minute','lon':lon,'lat':lat,'visibility_m':metres}
    return result


def daily_documents(all_rows, days, locations, checked):
    grouped = {day: {} for day in days}
    for (when, identity), row in all_rows.items():
        day = stamp(when).astimezone(NL).date().isoformat()
        if day in grouped:
            grouped[day][(when, identity)] = row
    documents = {}
    for day, data in grouped.items():
        if not data:
            continue
        times = sorted({when for when, _ in data})
        identities = sorted({identity for _, identity in data})
        stations = []
        for identity in identities:
            sample = next(row for (when, station), row in data.items() if station == identity)
            meta = locations.get(identity, {})
            if 'Platform' in meta.get('type', ''):
                # Offshore platforms add dense labels over the coast; use the
                # land, airport, wind and fog sites for this Netherlands map.
                continue
            stations.append({'id': identity, 'name': meta.get('name') or 'KNMI ' + identity[-5:],
                             'lon': sample['lon'], 'lat': sample['lat']})
        values = {field: [[data.get((when, station['id']), {}).get('values', [None] * len(FIELDS))[index]
                           for station in stations] for when in times] for index, field in enumerate(FIELDS)}
        qualities = ['provisional-ten-minute' if any(data.get((when, station['id']), {}).get('quality') == 'provisional-ten-minute' for station in stations) else 'provisional' if any(data.get((when, station['id']), {}).get('quality') == 'provisional' for station in stations) else 'validated' for when in times]
        documents[day] = {'schema': 1, 'day': day, 'timezone': 'Europe/Amsterdam', 'checked_at': iso(checked),
                          'source': 'KNMI KDP uur- en tienminutenwaarnemingen', 'source_url': BASE + VALIDATED,
                          'fields': FIELDS, 'stations': stations, 'times': times, 'values': values,
                          'quality': qualities, 'visibility_m': [[data.get((when, station['id']), {}).get('visibility_m') for station in stations] for when in times], 'units': {'T': '°C', 'TD': '°C', 'VV': 'KNMI-zichtcode', 'U': '%', 'FF': 'm/s', 'FX': 'm/s', 'RH': 'mm/uur', 'P': 'hPa'}}
    return documents


def fetch_json(url, params=None):
    from knmi_api import knmi_get
    response = knmi_get(url, params=params, timeout=120)
    response.raise_for_status()
    return response.json()


def fetch_window(collection, begin, end):
    # Keep each query comfortably below the KDP response-size limit. Shared
    # endpoints are retained once by rows(), not counted twice at a boundary.
    coverages = []
    current = begin
    while current < end:
        stop = min(end, current + timedelta(days=14))
        data = fetch_json(BASE + collection + '/cube', {'bbox': '3,50.5,7.5,53.8', 'datetime': iso(current) + '/' + iso(stop), 'parameter-name': ','.join(FIELDS)})
        rows(data, 'validated' if collection == VALIDATED else 'provisional')
        coverages.extend(data['coverages'])
        current = stop
    return {'type': 'CoverageCollection', 'coverages': coverages}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, default=Path(__file__).resolve().parents[1] / 'waarschuwingen-archief.json')
    parser.add_argument('--state', type=Path, default=Path.home() / 'Library/Application Support/Weerlab/waarschuwingenarchief/context')
    parser.add_argument('--limit-months', type=int, default=2)
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    args.state.mkdir(parents=True, exist_ok=True)
    with (args.state / '.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        now = datetime.now(UTC)
        days = warning_days(json.loads(args.archive.read_text())['records'], now)
        raw = args.state / 'raw'; raw.mkdir(exist_ok=True)
        public = args.state / 'pub'; public.mkdir(exist_ok=True)
        locfile = raw / 'locations.json'
        if not locfile.exists() or now.timestamp() - locfile.stat().st_mtime > 7 * 86400:
            atomic(locfile, fetch_json(BASE + VALIDATED + '/locations', {'bbox': '3,50.5,7.5,53.8'}))
        locations = {item['id']: item['properties'] for item in json.loads(locfile.read_text())['features']}
        months = sorted({day[:7] for day in days}, reverse=True)
        fetched, documents = 0, {}
        recent_ten = None
        for month in months:
            path = raw / (month + '.json.gz')
            recent = month >= (now - timedelta(days=14)).strftime('%Y-%m')
            refresh = recent and (not path.exists() or now.timestamp() - path.stat().st_mtime > 6 * 3600)
            if (not path.exists() or refresh) and (args.all or fetched < args.limit_months):
                begin, end = month_window(month)
                end = min(end, now.replace(minute=0, second=0, microsecond=0))
                payload = fetch_window(VALIDATED, begin, end)
                rows(payload, 'validated')
                temp = path.with_name(path.name + '.tmp'); temp.write_bytes(gzip.compress(json.dumps(payload).encode())); temp.replace(path)
                fetched += 1
                print('KNMI contextmaand:', month, 'opgehaald', fetched, flush=True)
                time.sleep(.6)
            if not path.exists():
                continue
            month_days = [day for day in days if day.startswith(month)]
            # Closed, already published historical days need no rewriting on
            # each update. New warning days can use the cached whole month.
            required = month_days if recent else [day for day in month_days if not (public / (day + '.json')).exists()]
            if not required:
                continue
            data = rows(json.loads(gzip.decompress(path.read_bytes())), 'validated')
            if recent:
                begin = (now - timedelta(days=4)).replace(minute=0, second=0, microsecond=0)
                response = fetch_window(PROVISIONAL, begin, now.replace(minute=0, second=0, microsecond=0))
                provisional = rows(response, 'provisional')
                provisional.update(data)  # Validated values, including nulls, win.
                if recent_ten is None:
                    response = fetch_json(BASE + '10-minute-in-situ-meteorological-observations/cube', {'bbox':'3,50.5,7.5,53.8','datetime':iso(now-timedelta(days=2))+'/'+iso(now),'parameter-name':'ta,td,vv,rh,ff,fx,p0'})
                    recent_ten = ten_minute_rows(response)
                ten = dict(recent_ten)
                ten.update(provisional)  # Genuine hourly source has priority.
                data = ten
            current_docs = daily_documents(data, required, locations, now)
            for day, document in current_docs.items():
                atomic(public / (day + '.json'), document)
            documents.update(current_docs)
        for day, data in documents.items():
            atomic(public / (day + '.json'), data)
        available = sorted(path.stem for path in public.glob('????-??-??.json'))
        atomic(public / 'index.json', {'schema': 1, 'checked_at': iso(now), 'days': available, 'source': 'KNMI KDP', 'license': 'CC BY 4.0'})
        if args.publish:
            subprocess.run(['/opt/homebrew/bin/rclone', 'copy', str(public), 'r2:weerlab-data/waarschuwingen-context', '--include', '*.json', '--header-upload', 'Cache-Control: public, max-age=300', '--transfers', '6', '--checkers', '8'], check=True)
        print('Contextkaarten:', len(available), 'dagen beschikbaar;', len(documents), 'dagen bijgewerkt', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
