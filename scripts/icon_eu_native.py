#!/usr/bin/env python3
"""Publish the DWD ICON-EU Benelux crop in Weerlab's native map format."""

import argparse
import concurrent.futures
import fcntl
import json
import re
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import eccodes as ec
import numpy as np
from scipy.spatial import cKDTree

from icon_global_native import get, intervals, write_bin, xyz


DWD = 'https://opendata.dwd.de/weather/nwp/v1/m/icon-eu/p'
REMOTE = 'r2:weerlab-harmonie'
PREFIX = 'icon-eu-native'
STEM = 'icon_eu_native'
STATE_DIR = Path('/Volumes/WEERLAB/Modeldata/ICON-EU')
LAT = np.arange(48.75, 54.375, .0625)
LON = np.arange(1.6875, 8.5, .0625)
PARAMETERS = {
    'T_2M': 'K', 'TD_2M': 'K', 'U_10M': 'm s-1', 'V_10M': 'm s-1',
    'VMAX_10M': 'm s-1', 'PMSL': 'Pa', 'TOT_PREC': 'kg m-2',
    'CLCH': '%', 'CLCM': '%', 'CLCL': '%', 'CLCT': '%', 'H_SNOW': 'm',
    'CEILING': 'm',
}
HOURLY_WIND = {'U_10M', 'V_10M', 'VMAX_10M'}


def directory(param, run):
    return f'{DWD}/{param}/r/{run:%Y-%m-%dT%H}%3A00/s/'


def source_url(param, run, lead):
    return directory(param, run) + f'PT{lead:03d}H00M.grib2'


def published_steps(param, run):
    text = get(directory(param, run)).decode()
    return {int(h) for h in re.findall(r'href="PT(\d{3})H00M\.grib2"', text)}


def required_steps(param):
    steps = list(range(121)) if param in HOURLY_WIND else [
        *range(79), *range(81, 121, 3)
    ]
    return steps[1:] if param == 'VMAX_10M' else steps


def discover(pool, last):
    listing = get(f'{DWD}/T_2M/r/').decode()
    dates = re.findall(r'href="(\d{4}-\d{2}-\d{2}T\d{2})%3A00/"', listing)
    for date in sorted(set(dates), reverse=True):
        run = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
        if run.hour % 6:
            continue
        if last and run <= last:
            return None
        if 120 not in published_steps('T_2M', run):
            continue
        futures = {p: pool.submit(published_steps, p, run) for p in PARAMETERS}
        if all(set(required_steps(p)) <= result.result() for p, result in futures.items()):
            return run
    raise RuntimeError('Geen volledige ICON-EU-hoofdrun beschikbaar')


def read_grib(param, run, lead, indices=None, expected_grid=None):
    message = ec.codes_new_from_message(get(source_url(param, run, lead)))
    try:
        read = lambda key: ec.codes_get(message, key)
        valid = run + timedelta(hours=lead)
        if (read('dataDate'), read('dataTime'), read('validityDate'), read('validityTime')) != (
            int(run.strftime('%Y%m%d')), run.hour * 100,
            int(valid.strftime('%Y%m%d')), valid.hour * 100,
        ):
            raise ValueError(f'{param} +{lead}: afwijkende modeltijd')
        grid = (read('uuidOfHGrid'), read('numberOfDataPoints'))
        if expected_grid and grid != expected_grid:
            raise ValueError(f'{param} +{lead}: afwijkend ICON-EU-rooster')
        unit = read('units').replace('**', '')
        if param in PARAMETERS and unit != PARAMETERS[param]:
            raise ValueError(f'{param} +{lead}: onverwachte eenheid {unit}')
        values = ec.codes_get_values(message)
        if indices is not None:
            values = values[indices]
        if np.any(~np.isfinite(values) | (values == read('missingValue'))):
            raise ValueError(f'{param} +{lead}: ontbrekende GRIB-waarden')
        if unit == 'K':
            values -= 273.15
        ec.codes_set(message, 'stepUnits', 'h')
        info = dict(start=read('startStep'), end=read('endStep'),
                    kind=read('stepType'), error=read('packingError'))
        return values, grid, unit, info
    finally:
        ec.codes_release(message)


def sample_grid(run, pool):
    coordinates = [pool.submit(read_grib, name, run, 0) for name in ('CLAT', 'CLON')]
    (lat, grid, lat_unit, _), (lon, other_grid, lon_unit, _) = [
        item.result() for item in coordinates
    ]
    if grid != other_grid or (lat_unit, lon_unit) not in {
        ('rad', 'rad'), ('degree', 'degree'), ('degrees', 'degrees'), ('Degree N', 'Degree E'),
    }:
        raise ValueError(f'Ongeldige ICON-EU-coördinaten: {lat_unit}, {lon_unit}')
    if lat_unit == 'rad':
        lat, lon = np.rad2deg(lat), np.rad2deg(lon)
    target_lon, target_lat = np.meshgrid(LON, LAT)
    distance, indices = cKDTree(xyz(lat, lon)).query(xyz(target_lat.ravel(), target_lon.ravel()))
    if np.max(distance) * 6371 > 9:
        raise ValueError('ICON-EU-bronpunten liggen te ver van de Benelux-uitsnede')
    return indices.reshape(target_lat.shape), grid


def fields_for_run(run, pool):
    indices, grid = sample_grid(run, pool)
    jobs = {param: [
        pool.submit(read_grib, param, run, hour, indices, grid)
        for hour in required_steps(param)
    ] for param in PARAMETERS}
    fields = {}
    for param, futures in jobs.items():
        samples = [future.result() for future in futures]
        values = np.stack([sample[0] for sample in samples])
        steps = required_steps(param)
        if param == 'TOT_PREC':
            info = [sample[3] for sample in samples]
            if any(m['end'] != h for m, h in zip(info, steps)):
                raise ValueError('ICON-EU-neerslaginterval eindigt op verkeerd uur')
            rain, total = intervals(values[:, None, :, :], steps, info)
            fields['neerslag'], fields['cumul'] = rain[:, 0], total[:, 0]
        elif param == 'VMAX_10M':
            if any((m['start'], m['end'], m['kind']) != (hour - 1, hour, 'max')
                   for hour, (_, _, _, m) in zip(steps, samples)):
                raise ValueError('ICON-EU-windstoot heeft een afwijkend tijdvak')
            fields[param] = np.concatenate([np.full_like(values[:1], np.nan), values])
        else:
            hourly = np.empty((121, *indices.shape), dtype=np.float32)
            if param == 'CEILING':
                values = np.where((values >= 0) & (values < 20000), values, np.nan)
            hourly[steps] = values
            for i, (left, right) in enumerate(zip(steps, steps[1:])):
                for hour in range(left + 1, right):
                    weight = (hour - left) / (right - left)
                    hourly[hour] = values[i] * (1 - weight) + values[i + 1] * weight
            fields[param] = hourly
        print(f'ICON-EU {run:%Y%m%d%H} {param}: {len(steps)} bronstappen', flush=True)
    return fields


def package(run, folder, f):
    stamp = run.strftime('%Y%m%d%H')
    fields = {
        'temp': [f['T_2M']], 'dauwpunt': [f['TD_2M']], 'wind': [f['U_10M'], f['V_10M']],
        'windstoten': [f['VMAX_10M']], 'druk': [f['PMSL']], 'neerslag': [f['neerslag']],
        'cumul': [f['cumul']], 'bewolking': [f[p] / 100 for p in ('CLCH', 'CLCM', 'CLCL')],
        'cloud_total': [f['CLCT']], 'sneeuwhoogte': [100 * f['H_SNOW']],
        'wolkenbasis': [f['CEILING']],
    }
    parameters = {}
    for key, components in fields.items():
        name = f'{STEM}_data_{key}.bin'
        write_bin(folder / name, components)
        parameters[key] = dict(file=f'{PREFIX}/{stamp}/{name}', components=len(components))
    parameters['wolkenbasis'].update(kind='ceiling', clear_sky_value=None)
    meta = {
        'schema_version': 1, 'model': 'ICON-EU · DWD', 'source': 'DWD Open Data direct',
        'attribution': 'DWD / Deutscher Wetterdienst', 'run_utc': run.isoformat(),
        'tijden': [(run + timedelta(hours=h)).isoformat() for h in range(121)],
        'grid': dict(n_lat=len(LAT), n_lon=len(LON), lat_min=LAT[0], lat_max=LAT[-1],
                     lon_min=LON[0], lon_max=LON[-1]),
        'parameters': parameters, 'hourly_interpolated_after': 78,
    }
    metadata = folder / 'meta.json'
    metadata.write_text(json.dumps(meta) + '\n')
    return metadata


def publish(run, folder, meta):
    rclone = '/opt/homebrew/bin/rclone'
    stamp = run.strftime('%Y%m%d%H')
    subprocess.run([
        rclone, 'copy', str(folder), f'{REMOTE}/{PREFIX}/{stamp}', '--immutable',
        '--header-upload', 'Cache-Control: public, max-age=31536000, immutable',
    ], check=True)
    subprocess.run([
        rclone, 'copyto', str(meta), f'{REMOTE}/{STEM}_canvas_meta.json', '--ignore-times',
        '--header-upload', 'Cache-Control: public, max-age=60',
    ], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--state-dir', type=Path, default=STATE_DIR)
    args = parser.parse_args()
    if args.state_dir == STATE_DIR and not STATE_DIR.parent.is_dir():
        raise RuntimeError('Weerlab-modelschijf ontbreekt')
    args.state_dir.mkdir(parents=True, exist_ok=True)
    with (args.state_dir / 'update.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        state = args.state_dir / 'published.json'
        last = datetime.fromisoformat(json.loads(state.read_text())['run_utc']) if args.publish and state.exists() else None
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            run = discover(pool, last)
            if run is None:
                return
            with tempfile.TemporaryDirectory(dir=args.state_dir) as tmp:
                folder = Path(tmp)
                meta = package(run, folder, fields_for_run(run, pool))
                if args.publish:
                    publish(run, folder, meta)
                    meta.replace(state)
                print(f'ICON-EU {run:%Y%m%d%H} ' + ('gepubliceerd' if args.publish else 'geverifieerd'))


if __name__ == '__main__':
    main()
