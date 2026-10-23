#!/usr/bin/env python3
"""ECMWF Open Data → beta-only storm tracks and pointwise gust probabilities.
No surrogate wind, precomputed probabilities, synthetic data or filled gaps.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import time
import urllib.request

import eccodes as ec
import numpy as np
from scipy.ndimage import minimum_filter, gaussian_filter

SOURCE = 'https://data.ecmwf.int/forecasts'
MEMBERS = list(range(51))  # 0 = oper/fc (IFS control since cycle 50r1)
BOUNDS = [-45, 35, 30, 72]  # west, south, east, north


def request(url, headers=None):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={
                'User-Agent': 'Weerlab-beta-storm/1.0', **(headers or {})}), timeout=90) as r:
                data = r.read()
                if headers and 'Range' in headers:
                    if r.status != 206:
                        raise ValueError('Server ignored HTTP Range')
                return data
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def base_url(run, step, control=False):
    stream, kind = ('oper', 'fc') if control else ('enfo', 'ef')
    return f'{SOURCE}/{run:%Y%m%d}/{run:%H}z/ifs/0p25/{stream}/{run:%Y%m%d%H}0000-{step}h-{stream}-{kind}'


def index(run, step, control=False):
    return [json.loads(l) for l in request(base_url(run, step, control) + '.index').decode().splitlines() if l]


def latest_run(last_step):
    now = datetime.now(timezone.utc)
    for day in range(3):
        for hour in (12, 0):
            run = (now - timedelta(days=day)).replace(hour=hour, minute=0, second=0, microsecond=0)
            if run > now:
                continue
            try:
                # Both streams must have reached the requested horizon.
                index(run, last_step)
                index(run, last_step, True)
                return run
            except Exception:
                pass
    raise RuntimeError('Geen gepubliceerde ECMWF-run met volledige tijdshorizon gevonden')


def read_field(path, run, step, member, param):
    with open(path, 'rb') as f:
        gid = ec.codes_grib_new_from_file(f)
        if gid is None:
            raise ValueError('Leeg GRIB-bestand')
        try:
            expected_type = 'fc' if member == 0 else 'pf'
            if (ec.codes_get(gid, 'dataDate') != int(run.strftime('%Y%m%d')) or
                ec.codes_get(gid, 'dataTime') != run.hour * 100 or
                ec.codes_get(gid, 'endStep') != step or
                ec.codes_get(gid, 'dataType') != expected_type):
                raise ValueError('GRIB-run/type/tijd komt niet overeen met de aanvraag')
            if member and ec.codes_get(gid, 'perturbationNumber') != member:
                raise ValueError('Verkeerd ensemblelid')
            pid = ec.codes_get(gid, 'paramId')
            if (param == 'msl' and pid != 151) or (param == 'gust' and pid not in (49, 228028, 123)):
                raise ValueError(f'Onverwachte parameter {pid}')
            units = ec.codes_get(gid, 'units')
            if (param == 'msl' and units != 'Pa') or (param == 'gust' and units not in ('m s**-1', 'm s-1')):
                raise ValueError(f'Onverwachte eenheid {units}')
            start = int(ec.codes_get(gid, 'startStep'))
            if param == 'gust' and (ec.codes_get(gid, 'stepType') != 'max' or start >= step):
                raise ValueError('Windstootveld heeft geen geldig maximumtijdvenster')
            nx, ny = ec.codes_get(gid, 'Ni'), ec.codes_get(gid, 'Nj')
            lat = ec.codes_get_array(gid, 'latitudes').reshape(ny, nx)
            lon = ec.codes_get_array(gid, 'longitudes').reshape(ny, nx)
            lon = (lon + 180) % 360 - 180
            values = ec.codes_get_values(gid).reshape(ny, nx)
            values[values == ec.codes_get(gid, 'missingValue')] = np.nan
            rows = np.where((lat[:, 0] >= BOUNDS[1]) & (lat[:, 0] <= BOUNDS[3]))[0]
            cols = np.where((lon[0] >= BOUNDS[0]) & (lon[0] <= BOUNDS[2]))[0]
            cols = cols[np.argsort(lon[0, cols])]
            rows = rows[np.argsort(lat[rows, 0])]
            a = values[np.ix_(rows, cols)].astype(np.float32)
            if not np.isfinite(a).all():
                raise ValueError('Ontbrekende GRIB-roosterwaarden')
            return a / 100 if param == 'msl' else a, lat[rows, 0], lon[0, cols], start
        finally:
            ec.codes_release(gid)


def fetch_step(run, step, cache):
    fields, problems = {}, []
    coords = None
    for control in (False, True):
        try:
            entries = index(run, step, control)
        except Exception as e:
            problems.append(f'+{step}u {"control" if control else "ENS"}: index ontbreekt ({type(e).__name__})')
            continue
        for member in ([0] if control else range(1, 51)):
            for param, names in [('msl', ['msl']), ('gust', ['10fg', '10fg3', '10fg6'])]:
                if step == 0 and param == 'gust':
                    continue
                matches = [e for e in entries if e.get('param') in names and
                           e.get('type') == ('fc' if control else 'pf') and
                           (control or int(e.get('number', -1)) == member)]
                if len(matches) != 1:
                    problems.append(f'+{step}u lid {member}: {param} ontbreekt of dubbel')
                    continue
                e = matches[0]
                path = cache / f'{step}-{member}-{param}.grib2'
                try:
                    if not path.exists():
                        offset, length = int(e['_offset']), int(e['_length'])
                        data = request(base_url(run, step, control) + '.grib2',
                                       {'Range': f'bytes={offset}-{offset + length - 1}'})
                        if len(data) != length:
                            raise ValueError('Onvolledige download')
                        tmp = path.with_suffix('.tmp')
                        tmp.write_bytes(data)
                        tmp.replace(path)
                    a, lat, lon, start = read_field(path, run, step, member, param)
                    if coords is None:
                        coords = (lat, lon)
                    elif not (np.array_equal(coords[0], lat) and np.array_equal(coords[1], lon)):
                        raise ValueError('Roosters verschillen')
                    fields[(member, param)] = (a, start)
                except Exception as ex:
                    path.unlink(missing_ok=True)
                    problems.append(f'+{step}u lid {member}: {param} ongeldig ({ex})')
    print(f'+{step:03d}u: {len(fields)} velden, {len(problems)} meldingen', flush=True)
    return fields, coords, problems


def distance(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    q = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371 * 2 * math.asin(math.sqrt(min(1, q)))


def cores(pressure, lat, lon):
    """Smoothed local minima, closed by >=2 hPa on a ~300 km ring.
    Border minima and open troughs are not valid cores. Raw central pressure retained.
    """
    p = gaussian_filter(pressure, sigma=2)  # 0.5° smoothing on native 0.25° grid
    points = np.argwhere((p == minimum_filter(p, size=17)) & (p < 1015))
    result = []
    for y, x in points:
        dy, dx = 11, max(12, round(11 / math.cos(math.radians(float(lat[y])))))
        if y-dy < 0 or y+dy >= len(lat) or x-dx < 0 or x+dx >= len(lon):
            continue
        ring = [p[round(y+dy*math.sin(t)), round(x+dx*math.cos(t))] for t in np.linspace(0, 2*math.pi, 24, endpoint=False)]
        if min(ring) - p[y, x] >= 2:
            result.append([round(float(lat[y]), 3), round(float(lon[x]), 3), round(float(pressure[y,x]), 1)])
    return result


def choose_core(candidates, previous, hours, seed=False):
    if not candidates:
        return None
    if previous is None:
        return min(candidates, key=lambda c: c[2])
    nearby = [c for c in candidates if distance(c, previous) <= (600 if seed else 120*hours)]
    # Conservative continuity: no arbitrary new low after a missing position.
    return min(nearby, key=lambda c: distance(c, previous)) if nearby else None


def probabilities(arrays):
    if not arrays:
        return None
    a = np.stack(arrays)
    valid = np.isfinite(a)
    count = valid.sum(axis=0)
    hits = ((a > 25.0) & valid).sum(axis=0)  # strictly >90 km/h, not >=
    p = np.divide(hits * 100., count, out=np.full(count.shape, np.nan), where=count > 0)
    return p, count


def track_systems(core_map, steps):
    """Discover closed control lows throughout the horizon, then link each member.
    New systems may enter the domain or form after the run starts.
    A lost track never resumes by silently switching to another low.
    """
    systems = []
    for i, step in enumerate(steps):
        for system in systems:
            for member in MEMBERS:
                prev = system['tracks'][member][-1]
                pos = choose_core(core_map.get((step, member), []), prev, 3) if prev else None
                system['tracks'][member].append(pos)
        claimed = [system['tracks'][0][-1] for system in systems if system['tracks'][0][-1]]
        for seed in sorted(core_map.get((step, 0), []), key=lambda c: c[2]):
            if not (-40 <= seed[1] <= 20 and 40 <= seed[0] <= 65):
                continue
            if any(distance(seed, point) < 700 for point in claimed):
                continue
            tracks = {m: [None] * i + [choose_core(core_map.get((step, m), []), seed, 0, seed=True)] for m in MEMBERS}
            systems.append({'id': f'low-{step}-{round(seed[0]*4)}-{round(seed[1]*4)}',
                            'start_hour': step, 'seed': seed, 'tracks': tracks})
            claimed.append(seed)
    for system in systems:
        control = [(i, p) for i,p in enumerate(system['tracks'][0]) if p]
        deepest_i, deepest = min(control, key=lambda item: item[1][2])
        system['minimum_hpa'] = deepest[2]
        system['deepest_hour'] = steps[deepest_i]
        system['tracks'] = [{'member':m, 'points':system['tracks'][m]} for m in MEMBERS]
    return systems


def atomic_json(path, value):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, separators=(',', ':'), allow_nan=False))
    tmp.replace(path)


def build(args):
    steps = list(range(0, args.hours + 1, 3))
    run = datetime.strptime(args.run, '%Y%m%d%H').replace(tzinfo=timezone.utc) if args.run else latest_run(steps[-1])
    current = Path(args.output) / 'current.json'
    if current.exists() and not args.force:
        manifest = json.loads(current.read_text())
        previous = json.loads((current.parent / manifest['file']).read_text())
        if previous['run'] == run.isoformat().replace('+00:00', 'Z') and not previous['issues'] and len(previous['frames']) == len(steps) and previous['grid']['resolution'] == 0.25 and 'systems' in previous:
            print('Deze volledige ECMWF-run is al gepubliceerd')
            return
    cache = Path(args.cache) / run.strftime('%Y%m%d%H')
    cache.mkdir(parents=True, exist_ok=True)
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    results = {}
    # Bounded network concurrency; retain only cropped arrays in memory.
    with ThreadPoolExecutor(max_workers=3) as pool:
        for step, result in zip(steps, pool.map(lambda s: fetch_step(run, s, cache), steps)):
            results[step] = result
    if not results[0][1] or (0, 'msl') not in results[0][0]:
        raise RuntimeError('Control-druk op +0u ontbreekt; vorige geldige publicatie blijft behouden')
    lat, lon = results[0][1]
    core_map = {}
    for step, (fields, coords, problems) in results.items():
        for (member, param), (a, start) in fields.items():
            if param == 'msl':
                core_map[(step, member)] = cores(a, lat, lon)
    systems = track_systems(core_map, steps)
    # Compatibility top-level product: a verified requested seed, otherwise deepest start low.
    initial = [system for system in systems if system['start_hour'] == 0]
    if args.seed:
        initial = [system for system in initial if distance(system['seed'], args.seed) <= 600]
        initial.sort(key=lambda system: distance(system['seed'], args.seed))
    else:
        initial.sort(key=lambda system: system['seed'][2])
    default = initial[0] if initial else (systems[0] if systems else None)
    if default and args.name:
        default['storm_name'] = args.name
    seed = default['seed'] if default else None
    tracks = default['tracks'] if default else [{'member':m, 'points':[None]*len(steps)} for m in MEMBERS]
    frames, issues = [], []
    for step in steps:
        fields, coords, problems = results[step]
        issues.extend(problems)
        valid_time = (run + timedelta(hours=step)).isoformat().replace('+00:00', 'Z')
        if coords and not (np.array_equal(coords[0], lat) and np.array_equal(coords[1], lon)):
            raise ValueError('Tijdstappen gebruiken verschillende roosters')
        gusts = [(m, a, start) for (m, p), (a, start) in fields.items() if p == 'gust']
        windows = sorted(set(start for m, a, start in gusts))
        probability = None
        if len(windows) == 1:
            p, n = probabilities([a for m, a, start in gusts])
            probability = {'start_hour': windows[0], 'end_hour': step, 'members': [m for m,a,s in gusts],
                           'values': np.round(p, 2).tolist(), 'counts': n.tolist()}
        elif step:
            issues.append(f'+{step}u: geen gelijk windstootvenster; kansveld niet getoond')
        frames.append({'hour': step, 'valid': valid_time, 'gust': probability})
    if not any(f['gust'] for f in frames):
        raise RuntimeError('Geen geldige windstootdata; vorige geldige publicatie blijft behouden')
    data = {'schema': 1, 'model': 'ECMWF IFS ENS', 'run': run.isoformat().replace('+00:00','Z'),
            'generated': datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
            'storm_name': args.name or None, 'seed': seed,
            'source': 'https://www.ecmwf.int/en/forecasts/datasets/open-data',
            'expected_members': 51, 'control': 'oper/fc', 'threshold_kmh': 90,
            'grid': {'lat': lat.tolist(), 'lon': lon.tolist(), 'resolution': 0.25},
            'tracks': tracks, 'systems': systems,
            'frames': frames, 'issues': issues,
            'method': {'pressure_grid': 0.25, 'smoothing_degrees': 0.5, 'closure_hpa': 2,
                       'max_speed_kmh': 120, 'mean': 'spherical position mean of matched cores; no mean-pressure minimum',
                       'gust': 'pointwise fraction >25 m/s, same run and GRIB maximum window; no spatial smoothing'}}
    payload = json.dumps(data, separators=(',', ':'), allow_nan=False).encode()
    digest = hashlib.sha256(payload).hexdigest()[:12]
    filename = f'ens-{run:%Y%m%d%H}-{digest}.json'
    (out / filename).write_bytes(payload)
    # Publish data first and manifest last; readers can never mix model runs.
    atomic_json(out / 'current.json', {'schema':1, 'file':filename, 'run':data['run'], 'generated':data['generated']})
    # Keep two days of runs, including the current file.
    for path in out.glob('ens-*.json'):
        if path.name != filename and time.time() - path.stat().st_mtime > 172800:
            path.unlink()
    print(f'Gepubliceerd: {out / filename}; {len(issues)} meldingen')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--force', action='store_true', help='Bestaande run opnieuw berekenen')
    p.add_argument('--run', help='UTC YYYYMMDDHH; standaard nieuwste volledige 00/12z-run')
    p.add_argument('--hours', type=int, default=72, choices=range(3, 145, 3))
    p.add_argument('--seed', type=float, nargs=2, metavar=('LAT', 'LON'))
    p.add_argument('--name', help='Alleen een gecontroleerde officiële stormnaam opgeven')
    p.add_argument('--cache', default='/tmp/weerlab-storm-cache')
    p.add_argument('--output', default=str(Path(__file__).parent / 'data'))
    build(p.parse_args())
