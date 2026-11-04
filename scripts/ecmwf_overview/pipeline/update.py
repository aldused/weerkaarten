#!/usr/bin/env python3
"""Werkt de lokale frame-opslag bij voor de laatste runs van een model.

    python3 update.py                 # nieuwe stappen ophalen (launchd, elke 5 min)
    python3 update.py --run 2026102900 --steps 0,3,6
    python3 update.py --max-runs 1    # alleen de nieuwste run

Volgorde van schrijven (belangrijk voor 'nooit een half frame'):
frame-bestanden → run-manifest → runs.json. Een stap staat pas in het
manifest als al zijn bestanden er zijn; runs.json noemt een run pas
'complete' als alle verwachte stappen er zijn. Een nieuwe run is vanaf zijn
eerste stap de standaardrun en groeit stap voor stap; oudere runs blijven staan.
Drukt 'WIJZIGING <runs>' af als er iets nieuws is (de shell-wrapper uploadt die dan naar R2).
"""
import argparse
import json
import os
import shutil
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lcc  # noqa: E402
from config import (DATA_DIR, DOMAIN, ENC, KEEP_RUNS, MODELS, PRECIP_ZERO_BELOW, SCHEMA,  # noqa: E402
                    TCC_ZERO_BELOW, WORKERS)
import climate  # noqa: E402
import process  # noqa: E402
from publish import LivePublisher  # noqa: E402
from sources import aifs_opendata, ecmwf_opendata, ens_opendata  # noqa: E402

SOURCES = {'ecmwf_opendata': ecmwf_opendata, 'aifs_opendata': aifs_opendata,
           'ifs_ens': ens_opendata.IFS_ENS, 'aifs_ens': ens_opendata.AIFS_ENS}
PIPELINE_VERSION = 24
GIVE_UP_AFTER_H = 14     # stap die dan nog ontbreekt bij de bron = definitief gat


def model_domain(model):
    return {**DOMAIN, 'step': MODELS[model]['step']}


def grid_axes(model):
    dom = model_domain(model)
    d = dom['step']
    nx = int(round((dom['lon_max'] - dom['lon_min']) / d)) + 1
    ny = int(round((dom['lat_max'] - dom['lat_min']) / d)) + 1
    lons = dom['lon_min'] + d * np.arange(nx)
    lats = dom['lat_max'] - d * np.arange(ny)
    return lons, lats


def run_id(run):
    return run.strftime('%Y%m%d%H')


def model_dir(model):
    return os.path.join(DATA_DIR, model)


def write_json(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)
    os.replace(tmp, path)


def load_manifest(model, run, src):
    path = os.path.join(model_dir(model), run_id(run), 'manifest.json')
    if os.path.exists(path):
        with open(path) as f:
            m = json.load(f)
        if m.get('pipeline') == PIPELINE_VERSION:
            return m
    lons, lats = grid_axes(model)
    cfg = MODELS[model]
    d = cfg['step']
    n = process.wind_stride(d)
    return {
        'schema': SCHEMA, 'pipeline': PIPELINE_VERSION,
        'model': model, 'model_label': cfg['label'], 'attribution': cfg['attribution'],
        'resolution': cfg['resolution'],
        'run': run_id(run), 'run_time': run.strftime('%Y-%m-%dT%H:%MZ'),
        'grid': {'type': 'latlon', 'lon0': float(lons[0]), 'lat0': float(lats[0]),
                 'dlon': d, 'dlat': -d,
                 'nx': len(lons), 'ny': len(lats)},
        # grof niveau: 2×2-blokgemiddelde, celcentrum verschuift een halve cel
        'grid_lo': {'type': 'latlon', 'lon0': float(lons[0]) + d / 2,
                    'lat0': float(lats[0]) - d / 2,
                    'dlon': 2 * d, 'dlat': -2 * d,
                    'nx': len(lons) // 2, 'ny': len(lats) // 2},
        # vaantjes: elk n-de rasterpunt, dezelfde hoekpunten
        'grid_uv': {'type': 'latlon', 'lon0': float(lons[0]), 'lat0': float(lats[0]),
                    'dlon': round(d * n, 6), 'dlat': -round(d * n, 6),
                    'nx': len(lons[::n]), 'ny': len(lats[::n])},
        'proj': lcc.params(), 'enc': ENC, 'precip_zero_below': PRECIP_ZERO_BELOW, 'tcc_zero_below': TCC_ZERO_BELOW,
        'expected': src.expected_steps(run.hour),
        'steps': {}, 'gaps': [], 'status': 'partial',
        'created': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }


def _work(model, run_iso, step):
    """Draait in een subproces: downloaden + coderen van één stap."""
    run = datetime.fromisoformat(run_iso)
    cfg = MODELS[model]
    src = SOURCES[cfg['source']]
    t0 = time.time()
    fields = src.fetch_step(run, step, model_domain(model), cfg['resolution'])
    if fields is None:
        return step, None, time.time() - t0
    lons, lats = grid_axes(model)
    for src, out in (('t2m', 'anom'), ('t850', 'a850')):
        if src in fields:
            clim = climate.clim_at(src, run + timedelta(hours=step), lons, lats)
            if clim is not None:
                fields[out] = fields[src] - clim
    out_dir = os.path.join(model_dir(model), run_id(run), f'{step:03d}')
    info = process.write_step(fields, out_dir, lons, lats, os.path.join(model_dir(model), 'static'), cfg['step'])
    return step, info, time.time() - t0


def update_run(model, run, steps_filter=None, log=print, live=None):
    src = SOURCES[MODELS[model]['source']]
    m = load_manifest(model, run, src)
    if m['status'] == 'complete' and not steps_filter:
        return False
    try:
        avail = src.available_steps(run, MODELS[model]['resolution'])
    except Exception as e:      # bron onbereikbaar: volgende tick opnieuw
        log(f'{run_id(run)}: bron niet bereikbaar ({e})')
        return False
    done = {int(s) for s in m['steps']}
    todo = [s for s in avail if s in m['expected'] and (s not in done or steps_filter)]
    if steps_filter:
        todo = [s for s in todo if s in steps_filter]
    changed = False
    if todo:
        log(f'{run_id(run)}: {len(todo)} stap(pen) te doen ({todo[0]}..{todo[-1]})')
        rdir = os.path.join(model_dir(model), run_id(run))
        os.makedirs(rdir, exist_ok=True)
        with ProcessPoolExecutor(max_workers=WORKERS) as ex:
            futs = [ex.submit(_work, model, run.isoformat(), s) for s in todo]
            # Elke afgeronde stap meteen publiceren; een trage download blokkeert de rest niet.
            for n, fut in enumerate(as_completed(futs), 1):
                try:
                    step, info, dt = fut.result()
                except Exception as e:
                    log(f'  stap mislukt: {e!r}')
                    continue
                if info is None:
                    continue
                valid = run + timedelta(hours=step)
                if info.get('static'):
                    m['static'] = info['static']
                m['steps'][str(step)] = {'valid': valid.strftime('%Y-%m-%dT%H:%MZ'),
                                          'layers': {k: v['bytes'] for k, v in info['layers'].items()},
                                          'stats': {k: [v['min'], v['max']] for k, v in info['layers'].items() if 'min' in v},
                                          'missing': info['missing']}
                changed = True
                # meteen zichtbaar: de browser ziet de run stap voor stap groeien
                finalize(m, run)
                write_json(os.path.join(rdir, 'manifest.json'), m)
                write_index(model)
                if live:
                    live.add(run_id(run), step, m)
                log(f'  +{step:3d}h klaar in {dt:4.1f}s ({n}/{len(todo)})')
    if not m['steps']:      # nog niets binnen: run bestaat nog niet voor de browser
        return False
    before = (m['status'], list(m['gaps']))
    finalize(m, run)
    if changed or (m['status'], m['gaps']) != before:
        os.makedirs(os.path.join(model_dir(model), run_id(run)), exist_ok=True)
        write_json(os.path.join(model_dir(model), run_id(run), 'manifest.json'), m)
        changed = True
    return changed


def finalize(m, run):
    done = {int(s) for s in m['steps']}
    missing = [s for s in m['expected'] if s not in done]
    age_h = (datetime.now(timezone.utc) - run).total_seconds() / 3600
    m['gaps'] = missing if (missing and age_h > GIVE_UP_AFTER_H) else []
    m['status'] = 'complete' if (not missing or m['gaps']) else 'partial'
    m['steps'] = {str(s): m['steps'][str(s)] for s in sorted(done)}
    m['updated'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def write_index(model):
    mdir = model_dir(model)
    runs = []
    for rid in sorted(os.listdir(mdir), reverse=True) if os.path.isdir(mdir) else []:
        p = os.path.join(mdir, rid, 'manifest.json')
        if not os.path.exists(p):
            continue
        with open(p) as f:
            m = json.load(f)
        steps = [int(s) for s in m['steps']]
        runs.append({'run': m['run'], 'run_time': m['run_time'], 'status': m['status'],
                     'n_steps': len(steps), 'n_expected': len(m['expected']),
                     'last_step': max(steps) if steps else None, 'last_expected': max(m['expected']), 'gaps': m['gaps'],
                     'updated': m.get('updated')})
    # nieuwste run met minstens één stap, ook als die nog binnenkomt
    default = next((r for r in runs if r['n_steps']), None)
    idx = {'schema': SCHEMA, 'model': model, 'label': MODELS[model]['label'],
           'default': default['run'] if default else None, 'runs': runs,
           'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
    write_json(os.path.join(mdir, 'runs.json'), idx)
    return idx


def prune(model, idx, log=print):
    keep = {r['run'] for r in idx['runs'][:KEEP_RUNS]} | {idx['default']}
    for r in idx['runs']:
        if r['run'] not in keep:
            shutil.rmtree(os.path.join(model_dir(model), r['run']), ignore_errors=True)
            log(f'opgeruimd: {r["run"]}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='ecmwf')
    ap.add_argument('--run', help='YYYYMMDDHH')
    ap.add_argument('--steps', help='komma-lijst, alleen deze stappen (opnieuw) doen')
    ap.add_argument('--max-runs', type=int, default=4)
    ap.add_argument('--live-publish', action='store_true', help='elke klare stap meteen naar R2')
    a = ap.parse_args()
    src = SOURCES[MODELS[a.model]['source']]
    if a.run:
        runs = [datetime.strptime(a.run, '%Y%m%d%H').replace(tzinfo=timezone.utc)]
    else:
        runs = src.list_runs(cycles=MODELS[a.model]['cycles'])[:a.max_runs]
    steps = {int(s) for s in a.steps.split(',')} if a.steps else None
    changed = []
    live = LivePublisher(a.model) if a.live_publish else None
    for run in sorted(runs, reverse=True):  # nieuwste run meteen zichtbaar maken
        if update_run(a.model, run, steps, live=live):
            changed.append(run_id(run))
    if live:
        live.close()
    idx = write_index(a.model)
    if not a.run:
        prune(a.model, idx)
        idx = write_index(a.model)
    print(f"standaardrun: {idx['default']} | " +
          ', '.join(f"{r['run']}:{r['status']}({r['n_steps']}/{r['n_expected']})" for r in idx['runs']))
    if changed:
        print('WIJZIGING', ','.join(changed))


if __name__ == '__main__':
    main()
