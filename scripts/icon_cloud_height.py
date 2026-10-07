#!/usr/bin/env python3
"""Add native DWD ceiling (AGL) to an existing, exact-run ICON canvas feed.

Ceiling is the lowest large-scale cloud layer exceeding 50% coverage. It is
not the base of every scattered cloud. GRIB bitmap missing values remain NaN.
"""
import argparse
import bz2
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import tempfile
from urllib.parse import quote
from zoneinfo import ZoneInfo

import eccodes
import numpy as np
import requests
from scipy.spatial import cKDTree


def above_ground(ceiling, terrain):
    valid = np.isfinite(ceiling) & np.isfinite(terrain)
    return np.where(valid, np.maximum(0, ceiling - terrain), np.nan).astype(np.float32)


def grib(content):
    if content.startswith(b'BZh'):
        content = bz2.decompress(content)
    msg = eccodes.codes_new_from_message(content)
    try:
        eccodes.codes_set(msg, 'missingValue', 1e30)
        values = eccodes.codes_get_values(msg)
        values[values >= 1e30] = np.nan
        if eccodes.codes_get(msg, 'units') != 'm':
            raise ValueError('Ceiling/terrain unit must be metres')
        info = {k: eccodes.codes_get(msg, k) for k in
                ['gridType', 'dataDate', 'dataTime', 'endStep']}
        if info['gridType'] == 'regular_ll':
            lat = eccodes.codes_get_array(msg, 'latitudes')
            lon = eccodes.codes_get_array(msg, 'longitudes')
            info['lat'], info['lon'] = lat, (lon + 180) % 360 - 180
        return values, info
    finally:
        eccodes.codes_release(msg)


def get(url):
    r = requests.get(url, timeout=(10, 90))
    r.raise_for_status()
    return r.content


def nearest_indices(lat, lon, grid):
    y, x = np.meshgrid(np.linspace(grid['lat_min'], grid['lat_max'], grid['n_lat']),
                       np.linspace(grid['lon_min'], grid['lon_max'], grid['n_lon']), indexing='ij')
    cosine = np.cos(np.radians((grid['lat_min'] + grid['lat_max']) / 2))
    tree = cKDTree(np.column_stack([lat, lon * cosine]))
    distance, idx = tree.query(np.column_stack([y.ravel(), x.ravel() * cosine]))
    # Never extrapolate through an edge or a hole in the source domain.
    return idx, distance < 0.06


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--model', required=True, choices=['icond2', 'icond2ruc'])
    p.add_argument('--root', type=Path, default=Path('/Users/aldus/KNMI_Project/weerlab'))
    p.add_argument('--upload', action='store_true')
    args = p.parse_args()
    root, model = args.root, args.model
    path = root / f'{model}_canvas_meta.json'
    original = path.read_bytes()
    meta = json.loads(original)
    if meta['parameters'].get('wolkenbasis', {}).get('source') == 'DWD CEILING minus HSURF':
        print(f'{model}: native ceiling already present', flush=True)
        return
    run = datetime.fromisoformat(meta['run_utc'].replace('Z', '+00:00')).astimezone(timezone.utc)
    run_key = run.strftime('%Y%m%d%H')
    if model == 'icond2':
        base = f'https://opendata.dwd.de/weather/nwp/icon-d2/grib/{run.hour:02d}'
        def url(field, hour):
            listing = get(f'{base}/{field.lower()}/').decode()
            names = re.findall(r'href="([^"]+)"', listing)
            match = [n for n in names if 'regular-lat-lon' in n and run_key in n
                     and f'_{hour:03d}_' in n and n.endswith('.bz2')]
            if len(match) != 1:
                raise ValueError(f'Exact-run {field} step {hour} is unavailable')
            return f'{base}/{field.lower()}/{match[0]}'
    else:
        base = 'https://opendata.dwd.de/weather/nwp/v1/m/icon-d2-ruc/p'
        folder = quote(run.strftime('%Y-%m-%dT%H:%M'), safe='-T')
        def url(field, hour):
            return f'{base}/{field}/r/{folder}/s/PT{hour:03d}H00M.grib2'

    terrain, info = grib(get(url('HSURF', 0)))
    if info['gridType'] == 'regular_ll':
        lat, lon = info['lat'], info['lon']
    elif info['gridType'] == 'unstructured_grid':
        coords = np.load(root / 'icond2ruc_grid_coords.npz')
        lat, lon = coords['lat'], coords['lon']
        if len(lat) != len(terrain):
            raise ValueError('RUC coordinate cache does not match the source grid')
    else:
        raise ValueError(f"Unsupported grid: {info['gridType']}")
    idx, covered = nearest_indices(lat, lon, meta['grid'])
    surface = terrain[idx]
    hours = []
    for value in meta['tijden']:
        valid = datetime.fromisoformat(value)
        if valid.tzinfo is None:
            valid = valid.replace(tzinfo=ZoneInfo('Europe/Amsterdam'))
        delta = (valid.astimezone(timezone.utc) - run).total_seconds() / 3600
        if delta < 0 or delta != int(delta):
            raise ValueError('Cannot match canvas times to native hourly ICON steps')
        hours.append(int(delta))

    def step(hour):
        values, field_info = grib(get(url('CEILING', hour)))
        if (field_info['dataDate'] != int(run.strftime('%Y%m%d'))
                or field_info['dataTime'] != run.hour * 100
                or int(field_info['endStep']) != hour
                or field_info['gridType'] != info['gridType'] or len(values) != len(terrain)):
            raise ValueError(f'CEILING run/grid/time mismatch at step {hour}')
        out = above_ground(values[idx], surface)
        out[~covered] = np.nan
        print(f'{model}: ceiling step {hour} ready', flush=True)
        return out

    with ThreadPoolExecutor(max_workers=4) as pool:
        data = np.stack(list(pool.map(step, hours)))
    if not np.isfinite(data).any():
        raise ValueError('No finite ceiling data; metadata was not changed')
    g = meta['grid']
    blob = struct.pack('<HHHH8x', g['n_lat'], g['n_lon'], len(hours), 1) + data.astype('<f4').tobytes()
    fingerprint = hashlib.sha256(blob).hexdigest()[:12]
    name = f'{model}_data_wolkenbasis_{run_key}_{fingerprint}.bin'
    (root / name).write_bytes(blob)
    meta['parameters']['wolkenbasis'] = {
        'file': name, 'components': 1, 'unit': 'm', 'kind': 'ceiling',
        'label': 'Ceiling (m boven grond; laagbedekking >50%)',
        'source': 'DWD CEILING minus HSURF', 'clear_sky_value': None,
        'grid': g,
    }
    # Upload immutable field first. Avoid attaching it to a concurrently refreshed run.
    if args.upload:
        subprocess.run(['/opt/homebrew/bin/rclone', 'copyto', str(root / name), f'r2:weerlab-harmonie/{name}',
                        '--header-upload', 'Content-Type: application/octet-stream',
                        '--header-upload', 'Cache-Control: public, max-age=86400, immutable'], check=True)
    if path.read_bytes() != original:
        raise RuntimeError('ICON metadata changed during download; retry against the new run')
    updated = json.dumps(meta, indent=2, ensure_ascii=False) + '\n'
    with tempfile.NamedTemporaryFile(mode='w', dir=root, delete=False, suffix='.json') as tmp:
        tmp.write(updated)
        temporary = Path(tmp.name)
    if args.upload:
        subprocess.run(['/opt/homebrew/bin/rclone', 'copyto', str(temporary), f'r2:weerlab-harmonie/{path.name}',
                        '--header-upload', 'Content-Type: application/json',
                        '--header-upload', 'Cache-Control: public, max-age=30'], check=True)
    temporary.replace(path)
    print(f'{model}: {len(hours)} exact-run ceiling frames published={args.upload}', flush=True)


if __name__ == '__main__':
    main()
