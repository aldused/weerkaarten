"""Publiceer actuele Benelux-modelruns op de bestaande Weerlab-databucket."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import numpy as np
from ecmwf_frames import atomic, crop_bounds, crop_grid, enrich, MIRROR, sunshine_minutes, write_frame
from regional_frames import GRID, NATIVE, native_model

UTC = timezone.utc
REMOTE = 'r2:weerlab-data/modelkaarten-benelux'
KEEP = 5  # Nieuwste run plus vier eerdere runs.
SCHEMA = 1
ECMWF_MODELS = {'ecmwf025': 'ecmwf025-grib', 'ecmwf': 'ecmwf-grib'}


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def read(path):
    return json.loads(path.read_bytes())


def snapshot(page):
    if not page or not page.is_file():
        return {}
    marker = b'<script id="bundle" type="application/json">'
    raw = page.read_bytes().split(marker, 1)[1].split(b'</script>', 1)[0]
    models = json.loads(raw)['models']
    # Archived runs are republished as JSON. Import packaged JavaScript as data.
    for model in models.values():
        batches = {}
        for run in model['runs']:
            for step in run['steps']:
                if 'data' in step:
                    continue
                name = step.pop('asset')
                if not re.fullmatch(r'[\w-]+\.js', name):
                    raise ValueError('Ongeldige naam van kaartbestand')
                if name not in batches:
                    payload = (page.parent/'modelkaarten-benelux-data'/name).read_text()
                    batches[name] = json.loads(payload.split(',', 1)[1].rsplit(');', 1)[0])
                step['data'] = batches[name][str(step['lead'])]
    return models


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def ecmwf_run(root, rid, manifest, cache, old=None):
    m = json.loads(manifest)
    region = crop_bounds(m['grid'])
    grid = crop_grid(m['grid'], region)
    start = datetime.fromisoformat(m['run_time'])
    hours_by_step = [int(h) for h in m['steps']]
    cache.mkdir(parents=True, exist_ok=True)
    old_steps = {s['lead']:s for s in (old or {}).get('steps', []) if (old or {}).get('enc') == m['enc']}
    if (old or {}).get('_build_key') != m.get('pipeline'):
        old_steps = {}
    def needs(lead):
        available = old_steps.get(lead, {}).get('keys', [])
        return ('ptype' not in available or (lead>0 and
                ('sun' not in available or not any(k in available for k in ('g1','g3','g6')))))
    wanted = [h for h in sorted(hours_by_step) if needs(h)]
    with ThreadPoolExecutor(max_workers=7) as pool:
        # All cumulative solar crops must be present before differencing steps.
        for _ in pool.map(lambda h: enrich(rid,h,cache,MIRROR,grid),wanted):
            pass
        def frame(lead):
            if not needs(lead):
                return old_steps[lead]
            extras = {}
            file = cache/f'{rid}-{lead:03}.npz'
            if file.exists():
                with np.load(file,allow_pickle=False) as data:
                    extras.update(data)
            period = 3 if lead<=144 else 6
            prev = lead-period
            prev_file = cache/f'{rid}-{prev:03}.npz'
            energy = extras.get('ssrd')
            if energy is not None:
                if prev==0:
                    extras['sun']=sunshine_minutes(start+timedelta(hours=lead),period,energy,grid)
                elif prev_file.exists():
                    with np.load(prev_file,allow_pickle=False) as data:
                        if 'ssrd' in data:
                            extras['sun']=sunshine_minutes(start+timedelta(hours=lead),period,energy-data['ssrd'],grid)
            return write_frame(root/rid,lead,m['steps'][str(lead)],region,m['grid'],m['grid_uv'],extras)
        steps=list(pool.map(frame,sorted(hours_by_step)))
    if not steps or not any({'t2m','tcc','rain','t850','t500','sdep'} <= set(s['keys']) for s in steps):
        raise ValueError(f'ECMWF {rid} mist de eerste complete kaarten')
    complete = all(not needs_new(s) for s in steps)
    return grid,dict(id=rid,time=m['run_time'],enc=m['enc'],steps=steps,_source=digest(manifest),
                     _build_key=m.get('pipeline'),_complete=complete)


def needs_new(step):
    keys = set(step['keys'])
    return 'ptype' not in keys or (step['lead']>0 and
        ('sun' not in keys or not keys.intersection({'g1','g3','g6'})))


def regional(key, project, cache, previous):
    meta_path = project/'weerlab'/f'{key}_canvas_meta.json'
    raw = meta_path.read_bytes()
    fingerprint = digest(raw)
    prior = next((r for r in previous if r.get('_source')==fingerprint),None)
    if prior and prior.get('_complete'):
        return GRID,previous
    try:
        run = native_model(meta_path.parent,key,ruc_solar=key=='icond2ruc',
                           dwd_levels=key.startswith('icon'),knmi_levels=key.startswith('harmonie'),cache_dir=cache)
    except (ValueError,OSError,RuntimeError) as exc:
        # Current temperatures/precipitation remain available while a secondary feed catches up.
        print(f'{key}: aanvullende velden tijdelijk niet beschikbaar ({type(exc).__name__})',flush=True)
        run = native_model(meta_path.parent,key,cache_dir=cache)
    if meta_path.read_bytes()!=raw:
        raise ValueError('Modeldata bijgewerkt tijdens de bouw')
    run['_source']=fingerprint
    run['_complete']=all({'t850','t500','sdep','sun'} <= set(s['keys']) and not s.get('snowPartial')
                         for s in run['steps'])
    # Keep a complete version if an optional field briefly fails on the same run.
    old = next((r for r in previous if r['id']==run['id'] and r.get('_complete')),None)
    if old and not run['_complete']:
        return GRID,previous
    return GRID,retain([run,*[r for r in previous if r['id']!=run['id']]])


def retain(runs):
    return sorted(runs,key=lambda r:r['id'],reverse=True)[:KEEP]


def ecmwf(key, project, cache, previous):
    root = project/'ecmwf_overview/data'/key
    prior = {r['id']:r for r in previous}
    source_runs = sorted(read(root/'runs.json')['runs'],key=lambda r:r['run'],reverse=True)[:KEEP]
    grid = None
    for i,entry in enumerate(source_runs):
        rid = entry['run']
        try:
            manifest = (root/rid/'manifest.json').read_bytes()
            source_grid = json.loads(manifest)['grid']
            grid = crop_grid(source_grid,crop_bounds(source_grid))
            old = prior.get(rid)
            # Herbruik bestaande oudere snapshots en vul ontbrekende runs aan uit de broncache.
            if old and (old.get('_source')==digest(manifest) and old.get('_complete') or
                        not old.get('_source') and i>=2):
                continue
            grid,new = ecmwf_run(root,rid,manifest,cache,old)
            prior[rid]=new
        except (ValueError,OSError,RuntimeError) as exc:
            if not prior:
                raise
            print(f'{key} {rid}: oude run behouden ({type(exc).__name__})',flush=True)
    if not grid:
        raise ValueError('Geen leesbaar ECMWF-bronraster')
    return grid,retain(prior.values())


def wire(key, grid, runs, assets):
    thin = []
    for run in runs:
        frames = []
        for i in range(0, len(run['steps']), 6):
            batch = run['steps'][i:i+6]
            payload = json_bytes({s['lead']:s['data'] for s in batch})
            name = f'{key}-{run["id"]}-{digest(payload)[:20]}.json'
            if not (assets/name).exists():
                atomic(assets/name,payload)
            frames.extend({k:v for k,v in s.items() if k!='data'} | {'asset':name} for s in batch)
        thin.append({k:v for k,v in run.items() if k!='steps' and not k.startswith('_')} | {'steps':frames})
    return {'schema':SCHEMA,'key':key,'grid':grid,'runs':thin}


def publish(rclone, remote, key, assets, manifest):
    common = ['--transfers','8','--checkers','8','--retries','3','--low-level-retries','5']
    subprocess.run([rclone,'copy',str(assets),f'{remote}/{key}/assets','--ignore-existing',
                    '--header-upload','Cache-Control: public, max-age=604800, immutable',*common],check=True)
    subprocess.run([rclone,'copyto',str(manifest),f'{remote}/{key}/runs.json',
                    '--header-upload','Cache-Control: no-store','--ignore-times',*common],check=True)


def clean_published_assets(key, args):
    folder = args.state/key
    published = (folder/'remote-fingerprint').read_text()
    cleaned = folder/'cleanup-fingerprint'
    if cleaned.exists() and cleaned.read_text()==published:
        return 0

    model_remote = f'{args.remote}/{key}'
    raw = subprocess.check_output([args.rclone,'cat',f'{model_remote}/runs.json'])
    feed = json.loads(raw)
    feed.pop('updated',None)
    if (feed.get('schema')!=SCHEMA or feed.get('key')!=key or
            digest(json_bytes(feed))!=published):
        raise ValueError('Gepubliceerd manifest wijkt af, kaartbestanden behouden')

    run_ids = {run['id'] for run in feed['runs']}
    removed = 0
    if len(run_ids)==KEEP and all(re.fullmatch(r'\d{10}',rid) for rid in run_ids):
        oldest = min(run_ids)
        assets_remote = f'{model_remote}/assets'
        names = subprocess.check_output([args.rclone,'lsf',assets_remote,'--files-only'],text=True).splitlines()
        generated = re.compile(re.escape(key)+r'-(\d{10})-[a-f0-9]{20}\.json')
        expired = [name for name in names if (match:=generated.fullmatch(name)) and match[1]<oldest]
        if expired:
            with tempfile.TemporaryDirectory(dir=folder) as temp:
                listing = Path(temp)/'expired-assets.txt'
                listing.write_text('\n'.join(expired)+'\n')
                subprocess.run([args.rclone,'delete',assets_remote,'--files-from-raw',str(listing)],check=True)
            removed = len(expired)

    atomic(cleaned,published.encode())
    return removed


def update(key, args, seeds):
    folder = args.state/key
    folder.mkdir(parents=True,exist_ok=True)
    history = folder/'history.json'
    previous = read(history) if history.exists() else seeds.get(key,{}).get('runs',[])
    cache = args.state/ECMWF_MODELS.get(key,'regionaal-grib')
    if key in ECMWF_MODELS:
        grid,runs = ecmwf(key,args.project,cache,previous)
    else:
        grid,runs = regional(key,args.project,cache,previous)
    if not runs:
        raise ValueError('Geen bruikbare modelruns')
    tag = folder/('remote-fingerprint' if args.publish else 'local-fingerprint')
    if tag.exists() and len(runs)==len(previous) and all(a is b for a,b in zip(runs,previous)):
        return key,runs[0]['id'],False
    with tempfile.TemporaryDirectory(dir=folder) as tmp:
        path=Path(tmp)
        assets=path/'assets'
        assets.mkdir()
        feed=wire(key,grid,runs,assets)
        content=digest(json_bytes(feed))
        if tag.exists() and tag.read_text()==content:
            atomic(history,json_bytes(runs))
            return key,runs[0]['id'],False
        feed['updated']=datetime.now(UTC).isoformat(timespec='seconds')
        atomic(path/'runs.json',json_bytes(feed))
        if args.publish:
            publish(args.rclone,args.remote,key,assets,path/'runs.json')
        else:
            out=args.state/'preview'/key
            (out/'assets').mkdir(parents=True,exist_ok=True)
            for file in assets.iterdir():
                atomic(out/'assets'/file.name,file.read_bytes())
            atomic(out/'runs.json',(path/'runs.json').read_bytes())
        atomic(history,json_bytes(runs))
        atomic(tag,content.encode())
    return key,runs[0]['id'],True


def main():
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--project',type=Path,required=True)
    cli.add_argument('--state',type=Path,required=True)
    cli.add_argument('--seed',type=Path)
    cli.add_argument('--rclone',default='rclone')
    cli.add_argument('--remote',default=REMOTE)
    cli.add_argument('--publish',action='store_true')
    cli.add_argument('--model',choices=[*ECMWF_MODELS,*NATIVE],action='append')
    a=cli.parse_args()
    a.state.mkdir(parents=True,exist_ok=True)
    with (a.state/'update.lock').open('a') as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        keys=a.model or [*ECMWF_MODELS,*NATIVE]
        seeds=snapshot(a.seed) if any(not (a.state/k/'history.json').exists() for k in keys) else {}
        failed=False
        with ThreadPoolExecutor(max_workers=3) as pool:
            tasks={pool.submit(update,k,a,seeds):k for k in keys}
            for task in as_completed(tasks):
                key=tasks[task]
                try:
                    _,run,changed=task.result()
                    print(key,run,'bijgewerkt' if changed else 'al actueel',flush=True)
                    if a.publish:
                        removed=clean_published_assets(key,a)
                        if removed:
                            print(f'{key}: {removed} verlopen kaartbestanden verwijderd',flush=True)
                except Exception as exc:
                    failed=True
                    print(f'{key}: {type(exc).__name__}: {str(exc).splitlines()[0][:250]}',file=sys.stderr,flush=True)
        return int(failed)


if __name__=='__main__':
    raise SystemExit(main())
