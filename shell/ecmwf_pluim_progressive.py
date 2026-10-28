#!/usr/bin/env python3
"""Publish verified contiguous native ENS prefixes; complete archives stay untouched."""
from __future__ import annotations
import concurrent.futures
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import subprocess
import tempfile
import time
from datetime import datetime, timezone, timedelta
import numpy as np
import ecmwf_pluim_direct as direct


def prefix_count(raw, params):
    """A gap in any field/member/station ends the publishable prefix."""
    good = np.logical_and.reduce([np.isfinite(raw[p]).all(axis=(0, 1)) for p in params])
    for p in ('tp', 'sf'):
        if p in params:
            good &= np.isfinite(raw[p + '_packing_error']).all(axis=(0, 1))
    missing = np.flatnonzero(~good)
    return int(missing[0]) if len(missing) else len(good)


def step_ready(client, run, step):
    stamp = run.strftime('%Y%m%d%H0000')
    for stream, kind in [('enfo', 'ef'), ('oper', 'fc')]:
        url = f'{direct.ECMWF_ROOT}/{run:%Y%m%d}/{run:%H}z/ifs/0p25/{stream}/{stamp}-{step}h-{stream}-{kind}.index'
        r = client.session.head(url, timeout=15, allow_redirects=True, verify=client.verify)
        if r.status_code == 404:
            return False
        if r.status_code != 200:
            raise RuntimeError(f'Progressive source readiness HTTP {r.status_code}')
    return True


def available_steps(client, run, steps):
    # Inspect each native step: never assume that files arrive in order.
    result = []
    for step in steps:
        if not step_ready(client, run, step):
            break
        result.append(step)
    return tuple(result)


def snapshot(raw, params, steps, stations, grid, run, metrics, discovered):
    count = prefix_count(raw, params)
    if count < 2:
        return None
    native_steps = steps[:count]
    fields = direct.transform_fields({p: v[..., :count] for p, v in raw.items()})
    import sys
    sys.path.insert(0, str(Path(direct.__file__).resolve().parents[1] / 'scripts'))
    from ecmwf_interpolate import hourly_ensemble
    fields, hours = hourly_ensemble(fields, native_steps)
    now = datetime.now(timezone.utc)
    documents = {}
    for i, (station, point) in enumerate(zip(stations, grid)):
        item = direct.build_station_run(i, station, point, run, run.hour, hours, fields, discovered, discovered, now, metrics)
        item['source'].pop('source_ready', None)  # First observation is not final-run availability.
        item['source'].update(progressive=True, forecast_complete=count == len(steps),
                              available_through_hour=native_steps[-1], expected_through_hour=steps[-1],
                              native_steps_hours=list(native_steps), hourly_interpolated=True)
        direct.update_digest(item)
        documents[station.slug] = dict(schema=3, station=station.name, slug=station.slug,
                                       lat=station.lat, lon=station.lon, runs=[item])
    revision = hashlib.sha256(json.dumps({k: v['runs'][0]['data_sha256'] for k, v in sorted(documents.items())}, sort_keys=True).encode()).hexdigest()
    manifest = dict(schema=1, ready=True, progressive=True, complete=count == len(steps),
                    run=direct.iso_z(run), revision=revision, updated=direct.iso_z(now),
                    station_count=len(stations), member_count=51, fields=sorted(fields),
                    available_through_hour=native_steps[-1], expected_through_hour=steps[-1],
                    path=f'pluim-progressive/{run:%Y%m%dT%H}/{revision}',
                    station_digests={slug: doc['runs'][0]['data_sha256'] for slug, doc in documents.items()})
    return manifest, documents


def publish_snapshot(result, root, repo, uploader=subprocess.run):
    manifest, documents = result
    previous = direct.load_meta_document(root / 'pluim_progressive_meta.json')
    if previous.get('run', '') > manifest['run']:
        raise RuntimeError('Refuse rollback of progressive run')
    if previous.get('run') == manifest['run'] and previous.get('available_through_hour', -1) > manifest['available_through_hour']:
        raise RuntimeError('Refuse shortening a published progressive run')
    folder = root / manifest['path']
    folder.mkdir(parents=True, exist_ok=True)
    for slug, doc in documents.items():
        (folder / f'{slug}.json').write_text(json.dumps(doc, separators=(',', ':'), allow_nan=False))
    meta = root / 'pluim_progressive_meta.json'
    temporary = root / '.pluim_progressive_meta.json.tmp'
    temporary.write_text(json.dumps(manifest, separators=(',', ':'), allow_nan=False))
    # Immutable objects first; the small mutable pointer is the commit point.
    uploader(['/opt/homebrew/bin/rclone', 'copy', str(folder), 'r2:weerlab-data/' + manifest['path'],
              '--header-upload', 'Cache-Control: public, max-age=86400, immutable', '--transfers', '4'], check=True)
    uploader(['/opt/homebrew/bin/rclone', 'copyto', str(temporary), 'r2:weerlab-data/pluim_progressive_meta.json',
              '--header-upload', 'Cache-Control: no-cache, max-age=0'], check=True)
    os.replace(temporary, meta)
    prune_runs(root, manifest['path'].split('/')[1], uploader)
    print(f"PROGRESSIVE_PUBLISHED: {manifest['run']} +{manifest['available_through_hour']}h / +{manifest['expected_through_hour']}h", flush=True)


def prune_runs(root, current, uploader=subprocess.run):
    import re
    import shutil
    base=root / 'pluim-progressive'
    names=sorted([p.name for p in base.iterdir() if p.is_dir() and re.fullmatch(r'\d{8}T(?:00|06|12|18)',p.name)], reverse=True)
    keep=set(names[:8]) | {current}
    for name in names:
        if name not in keep: shutil.rmtree(base / name)
    listing=uploader(['/opt/homebrew/bin/rclone','lsf','r2:weerlab-data/pluim-progressive','--dirs-only','--max-depth','1'],check=True,capture_output=True,text=True)
    names=sorted([n.rstrip('/') for n in listing.stdout.splitlines() if re.fullmatch(r'\d{8}T(?:00|06|12|18)/?',n)],reverse=True)
    keep=set(names[:2]) | {current}
    for name in names:
        if name not in keep:
            uploader(['/opt/homebrew/bin/rclone','purge','r2:weerlab-data/pluim-progressive/'+name],check=True)


def main(argv=None):
    args = direct.parse_args(argv)
    if args.no_write or args.archive_only or args.slug or args.test_step or args.limit_steps:
        raise RuntimeError('Progressive production requires all stations and the full native timeline')
    direct.install_signal_handlers()
    direct.use_safe_multipart_chunk_size()
    direct.ECMWF_ROOT = direct.SOURCE_ROOTS[args.source]
    run = datetime.strptime(args.date, '%Y%m%d').replace(hour=args.cycle, tzinfo=timezone.utc)
    stations = direct.load_stations(args.repo_dir, set())
    floor, _ = direct.newest_complete_floor((args.out_dir / 'pluim_direct_meta.json', args.published_state), args.fields, len(stations))
    if floor is not None and run <= floor:
        print('PROGRESSIVE_FULL: already in complete archive', flush=True)
        return 0
    client = direct.Client(source=args.source)
    direct.configure_client_timeouts(client)
    steps = direct.cycle_steps(run.hour)
    ready = available_steps(client, run, steps)
    if len(ready) < 2:
        print('PROGRESSIVE_WAIT: first complete native intervals not available', flush=True)
        return 0
    params = direct.FIELD_SETS[args.fields]
    shape = (51, len(stations), len(steps))
    path = direct.checkpoint_path(run, args.fields)
    resumed = direct.load_checkpoint(path, run, steps, stations, params, shape)
    metrics = direct.Metrics(started_monotonic=time.monotonic())
    if resumed:
        raw, grid, stored = resumed
        for k, value in stored.items():
            if hasattr(metrics, k): setattr(metrics, k, value)
    else:
        raw = {p: np.full(shape, np.nan) for p in params}
        grid = None
    for p in ('tp', 'sf'):
        if p in params: raw.setdefault(p + '_packing_error', np.full(shape, np.nan))
    index = {h: i for i, h in enumerate(steps)}
    root = direct.RUNTIME_ROOT / 'progressive-publication'
    root.mkdir(parents=True, exist_ok=True)
    previous = direct.load_meta_document(root / 'pluim_progressive_meta.json')
    published = previous.get('available_through_hour', -1) if previous.get('run') == direct.iso_z(run) else -1
    discovered = datetime.now(timezone.utc)

    def publish_if_grown(final=False):
        nonlocal published
        n = prefix_count(raw, params)
        h = steps[n - 1] if n else -1
        # First 12 hours, then half-day growth. Final remainder is always visible.
        if grid is None or h < 12 or h <= published or (not final and published >= 0 and h < published + 12): return
        result = snapshot(raw, params, steps, stations, grid, run, metrics, discovered)
        if result:
            publish_snapshot(result, root, args.repo_dir)
            published = h

    jobs = [(i, (h,), params) for i, h in enumerate(ready) if not all(np.isfinite(v[..., index[h]]).all() for v in raw.values())]
    direct.RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='weerlab_ecmwf_progressive_', dir=direct.RUNTIME_ROOT) as temp:
        try:
            publish_if_grown(final=True)
            with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers, mp_context=multiprocessing.get_context('spawn')) as pool:
                def submit(pool, job):
                    _, h, p = job
                    return pool.submit(direct.process_native_batch, args.source, run, run.hour, h, p, stations, grid, temp, int(args.max_temp_gib * 1024**3) // args.workers)
                for number, result in direct.bounded_batch_results(pool, jobs, submit, args.workers,
                        on_error=lambda number, error: print(f"PROGRESSIVE_RETRY: batch {number}: {error}", flush=True)):
                    grid = direct.merge_native_batch(raw, index, grid, result)
                    metrics.grib_bytes += result['bytes']; metrics.download_seconds += result['download']; metrics.decode_seconds += result['decode']; metrics.batches += 1
                    metrics.peak_temp_bytes = max(metrics.peak_temp_bytes, result['peak'] * args.workers)
                    direct.save_checkpoint(path, run, steps, stations, params, raw, grid, metrics)
                    print(f"PROGRESSIVE_BATCH: steps={result['steps']}", flush=True)
                    publish_if_grown()
        finally:
            publish_if_grown(final=True)
    complete = prefix_count(raw, params) == len(steps)
    print('PROGRESSIVE_FULL: native checkpoint complete' if complete else 'PROGRESSIVE_WAIT: published prefix; resume next poll', flush=True)
    return 0

if __name__ == '__main__':
    import sys
    sys.exit(main(sys.argv[1:]))
