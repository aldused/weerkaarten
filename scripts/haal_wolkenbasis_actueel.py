"""Actuele wolkenbasis: eigen meettijden voor KNMI + regionale METARs.
Wordt door de bestaande 15-minuten METAR-taak gestart. Publiceer nooit lege feeds.
"""
import json
import os
from pathlib import Path
from datetime import datetime, timedelta, timezone
import requests
from knmi_api import knmi_get

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations'


def write(name, data):
    target = ROOT / name
    temp = target.with_suffix(f'.{os.getpid()}.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    os.replace(temp, target)


def knmi_feed():
    # Gebruik dezelfde stationscoördinaten als de bestaande KNMI-feed.
    data = requests.get('https://data.weerlab.nl/actueel.json', timeout=25)
    data.raise_for_status()
    stations = {s['wigos']: s for s in data.json()['stations'].values() if s.get('wigos') and s.get('h') is not None}
    now = datetime.now(timezone.utc)
    params = {'datetime': f'{(now-timedelta(hours=1)).isoformat()}/{now.isoformat()}', 'parameter-name': 'h'}
    result = {}
    ids = list(stations)
    for offset in range(0, len(ids), 10):
        response = knmi_get(BASE+'/locations/'+','.join(ids[offset:offset+10]), params=params, timeout=45)
        response.raise_for_status()
        for cov in response.json().get('coverages', []):
            sid = next((cov.get(k) for k in ['eumetnet:locationId', 'inspiregloss:Identifier', 'id'] if cov.get(k)), None)
            if sid not in stations:
                continue
            times = cov.get('domain', {}).get('axes', {}).get('t', {}).get('values', [])
            values = cov.get('ranges', {}).get('h', {}).get('values', [])
            for i in range(min(len(times), len(values))-1, -1, -1):
                if values[i] is not None:
                    s = stations[sid]
                    result[sid] = {k: s.get(k) for k in ['naam', 'wigos', 'lat', 'lon']}
                    result[sid].update(h=values[i], h_t=times[i])
                    break
    if len(result) < 10:
        raise RuntimeError(f'Te weinig KNMI-wolkenhoogten: {len(result)}; vorige feed behouden')
    write('wolkenbasis_knmi.json', {'stations': result, 'updated': now.isoformat()})
    print(f'KNMI: {len(result)} actuele wolkenhoogten')


def metar_feed():
    response = requests.get('https://aviationweather.gov/api/data/metar',
        params={'bbox': '41,-6,55,11', 'format': 'json'},
        headers={'User-Agent': 'Weerlab/1.0 cloud-base observations'}, timeout=30)
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, list) or len(data) < 30:
        raise RuntimeError('Onvolledige METAR-feed; vorige feed behouden')
    result = {m['icaoId']: {'metar': m} for m in data if m.get('icaoId')}
    result['_update'] = datetime.now(timezone.utc).isoformat()
    write('wolkenbasis_metar.json', result)
    print(f'METAR: {len(data)} luchthavenmeldingen')


if __name__ == '__main__':
    failed = False
    for updater in (knmi_feed, metar_feed):
        try:
            updater()
        except Exception as exc:
            failed = True
            print(f'Wolkenbasis-import mislukt ({updater.__name__}): {type(exc).__name__}: {exc}')
    raise SystemExit(1 if failed else 0)
