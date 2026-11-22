#!/usr/bin/env python3
"""National ENS rankings, with one independent result per sampled model cell.

City catalogue: existing GeoNames/Weerlab NL catalogue (CC BY 4.0).
All 51 members are retained until scores and snowfall probabilities are computed.
The existing 39-station plume archive contract is deliberately independent.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import fcntl
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import unicodedata

import numpy as np

NAME = 'pluim_top3_landelijk.json'
DAYS = (1, 3, 5, 10, 15)
RANKING_METHOD = 'member_extremes_v1'
REQUIRED = ('temperature_2m', 'wind_speed_10m', 'precipitation', 'snowfall', 'wind_gusts_10m')
STATE = Path('/Volumes/WEERLAB/Modeldata/ECMWF/pluimen/top3')


def iso(date):
    return date.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def catalog(repo):
    data = json.loads((Path(repo)/'cloudflare-worker/native-places.json').read_text())
    result, seen = [], set()
    for city in data:
        if city.get('land') != 'NL':
            continue
        name = str(city['naam']).strip()
        lat, lon = float(city['lat']), float(city['lon'])
        if not name or not (50.7 <= lat <= 53.6 and 3.2 <= lon <= 7.3):
            raise ValueError('Ongeldige Nederlandse plaats in de catalogus')
        key = (unicodedata.normalize('NFKC', name).casefold(), lat, lon)
        if key not in seen:
            seen.add(key)
            result.append(dict(name=name, lat=lat, lon=lon, population=int(city.get('pop') or 0)))
    if len(result) < 1000:
        raise ValueError('De landelijke plaatsencatalogus is onvolledig')
    return sorted(result, key=lambda p: (-p['population'], p['name'], p['lat'], p['lon']))


def regular_groups(cities):
    """Nearest 0.25° cells; both sampling coordinates are exact cell centres."""
    grouped = defaultdict(list)
    for city in cities:
        y = math.floor(city['lat']*4+.5)
        x = math.floor(city['lon']*4+.5)
        grouped[(y,x)].append(city)
    return [dict(id=f'ifs025_{y}_{x}', lat=y/4, lon=x/4, places=places)
            for (y,x),places in sorted(grouped.items())]


def sampling_configuration(repo,stations,params):
    """Append Dutch cells to existing GRIB sampling, preserving public stations."""
    if not (Path(repo)/'cloudflare-worker/native-places.json').exists():
        return stations,params,[]
    groups=regular_groups(catalog(repo))
    station_type=type(stations[0])
    extra=[station_type(g['places'][0]['name'],g['id'],g['lat'],g['lon']) for g in groups]
    return stations+extra,tuple(dict.fromkeys((*params,'sf'))),groups


def queue_direct(repo,run,steps,fields,groups,offset):
    """Small durable queue; publication never delays the ordinary station upload."""
    if not groups:return
    state=Path(os.environ.get('PLUIM_TOP3_STATE_DIR',str(STATE)))
    if state==STATE and not Path('/Volumes/WEERLAB').is_mount():
        print('NL_TOP3_WAIT: WEERLAB-schijf ontbreekt; bestaande ranglijsten behouden',flush=True)
        return
    folder=state/'direct-queue';folder.mkdir(parents=True,exist_ok=True)
    token=run.strftime('%Y%m%dT%H')
    data_path=folder/(token+'.npz')
    temporary=folder/(token+'.tmp')
    with temporary.open('wb') as handle:
        np.savez_compressed(handle,**{key:np.asarray(fields[key][:,offset:offset+len(groups),:],dtype=np.float32) for key in REQUIRED})
    digest=hashlib.sha256(temporary.read_bytes()).hexdigest()
    os.replace(temporary,data_path)
    meta=dict(run=iso(run),groups=groups,times_ms=[int(run.timestamp()*1000+step*3600000) for step in steps],
        data_sha256=digest,source=dict(provider='ECMWF Open Data',model='ecmwf_ifs025_ensemble',
        grid='0.25°',resolution='0,25°',run_initialisation=iso(run),
        availability=iso(datetime.now(timezone.utc)),
        catalog_revision=hashlib.sha256(canonical(catalog(repo))).hexdigest(),
        snowfall_method='ECMWF-sneeuwwaterequivalent × 0,7 cm/mm, per ensemblelid'))
    temporary.write_bytes(canonical(meta));os.replace(temporary,folder/(token+'.json'))
    print(f'NL_TOP3_QUEUED: {iso(run)}, {len(groups)} Nederlandse modelpunten',flush=True)


def drain_direct(repo,state,publish=True):
    folder=Path(state)/'direct-queue'
    for path in sorted(folder.glob('*.json'),reverse=True):
        meta=json.loads(path.read_text());data_path=path.with_suffix('.npz')
        if not data_path.exists() or hashlib.sha256(data_path.read_bytes()).hexdigest()!=meta['data_sha256']:
            continue
        with np.load(data_path,allow_pickle=False) as data:
            fields={key:data[key] for key in REQUIRED}
        run=datetime.fromisoformat(meta['run'].replace('Z','+00:00'))
        summary,documents=scores(meta['groups'],run,meta['times_ms'],fields,meta['source'])
        publish_run(repo,state,run,summary,documents,publish)
        if publish:
            path.unlink();data_path.unlink()


def scores(groups, run, times_ms, fields, source):
    """Fields have dimensions [member, independent model cell, timestamp]."""
    start = int(run.timestamp()*1000)
    times = np.asarray(times_ms, dtype=np.int64)
    if len(times) < 2 or times[0] != start or np.any(np.diff(times) <= 0) or np.any(np.diff(times) > 21600000):
        raise ValueError('Ongeldige landelijke ENS-tijdas')
    shape = (51, len(groups), len(times))
    arrays = {key:np.asarray(fields[key], dtype=np.float64) for key in REQUIRED}
    if any(a.shape != shape for a in arrays.values()):
        raise ValueError('Landelijke ENS mist leden, plaatsen of tijdstappen')
    if any(not np.isfinite(a).all() for a in arrays.values()):
        raise ValueError('Onvolledige landelijke ENS-gegevens')
    if any(np.any(a < 0) for key,a in arrays.items() if key != 'temperature_2m'):
        raise ValueError('Negatieve neerslag, sneeuw of windsnelheid')
    periods, winner_ids = [], set()
    for days in DAYS:
        match = np.flatnonzero(times == start+days*86400000)
        if not len(match):
            continue
        n = int(match[0])+1
        rankings, average_rankings = {}, {}
        durations = np.diff(times[:n])
        weights = (np.r_[0, durations] + np.r_[durations, 0]) / (2 * durations.sum())
        for category,field,operation in (
            ('cold','temperature_2m','min'),('mild','temperature_2m','max'),
            ('wind','wind_speed_10m','max'),('snow','snowfall','sum'),
            ('precipitation','precipitation','sum'),
        ):
            if operation == 'sum':
                totals = np.sum(arrays[field][:,:,1:n], axis=-1, dtype=np.float64)
                member_indices = np.argmax(totals, axis=0)
                values = totals[member_indices, np.arange(len(groups))]
                indices = None
            else:
                # One actual member/time pair; ties use earliest time, then member.
                samples = arrays[field][:,:,:n].transpose(1,2,0).reshape(len(groups),-1)
                extreme = (np.argmin if operation == 'min' else np.argmax)(samples, axis=-1)
                indices, member_indices = np.divmod(extreme, 51)
                values = samples[np.arange(len(groups)),extreme]
            if operation == 'sum':
                averages = totals.mean(axis=0)
            elif category == 'mild':
                averages = temperature_averages
            else:
                averages = arrays[field][:,:,:n].mean(axis=0) @ weights
                if category == 'cold':
                    temperature_averages = averages
            for output, scores_for_category, is_average in (
                (rankings, values, False), (average_rankings, averages, True),
            ):
                order = sorted(range(len(groups)), key=lambda i: (
                    scores_for_category[i] if operation == 'min' else -scores_for_category[i],
                    groups[i]['places'][0]['name'],
                ))
                rows = []
                for i in order:
                    if operation == 'sum' and scores_for_category[i] <= 1e-9:
                        continue
                    group = groups[i]
                    place = group['places'][0]
                    row = {key:place[key] for key in ('name','lat','lon')}
                    row.update(slug=group['id'], point=group['id'], value=round(float(scores_for_category[i]),4),
                               equivalent_count=len(group['places']),
                               equivalent_places=[p['name'] for p in group['places'][1:4]])
                    if not is_average:
                        row['member'] = int(member_indices[i])
                        if indices is not None:
                            row['time_ms'] = int(times[indices[i]])
                    if category == 'snow':
                        row['chance_1cm'] = round(float(np.mean(totals[:,i] >= 1)*100),4)
                    rows.append(row)
                    winner_ids.add(group['id'])
                    if len(rows) == 3:
                        break
                output[category] = rows
        periods.append(dict(days=days, start_ms=start, end_ms=int(times[n-1]),
                            rankings=rankings, average_rankings=average_rankings))
    if not periods:
        raise ValueError('Geen complete landelijke vergelijkingsperiode')
    summary = dict(schema=3, ranking_method=RANKING_METHOD, station_count=sum(len(g['places']) for g in groups),
                   grid_count=len(groups), member_count=51, periods=periods,
                   source=source, independent_grid_points=True)
    digest = hashlib.sha256(canonical(dict(run=iso(run),summary=summary)))
    for key in sorted(arrays):
        digest.update(key.encode()); digest.update(np.asarray(arrays[key],dtype='<f4').tobytes())
    revision = digest.hexdigest()
    summary['revision'] = revision
    token = run.strftime('%Y%m%dT%H')
    summary['path'] = f'pluim-top3/{token}/{revision}'
    documents = {}
    for i,group in enumerate(groups):
        if group['id'] not in winner_ids:
            continue
        members = {}
        for key,a in arrays.items():
            # Keep accumulated totals invariant to display-rounding.
            values = a[:,i,:]
            if key in ('snowfall','precipitation'):
                cumulative = np.round(np.cumsum(values,axis=-1,dtype=np.float64),4)
                values = np.diff(cumulative,axis=-1,prepend=np.zeros((51,1)))
            members[key] = np.round(values,4).tolist()
        documents[group['id']] = dict(schema=1,run=iso(run),revision=revision,
            name=group['places'][0]['name'],latitude=group['lat'],longitude=group['lon'],
            times_ms=times.tolist(),members=members,source=source)
    return summary, documents


def publish_run(repo, state, run, summary, documents, publish=True):
    """Immutable point files first; one compact manifest is the commit point."""
    repo, state = Path(repo), Path(state)
    state.mkdir(parents=True,exist_ok=True)
    with (state/'publish.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        path = repo/NAME
        old = json.loads(path.read_text()) if path.exists() else dict(schema=1,runs=[])
        entry = dict(run=iso(run),complete=True,top3_nl=summary)
        existing = next((r for r in old.get('runs',[]) if r['run']==entry['run']),None)
        if existing == entry and (not publish or (state/'published-revision').exists() and (state/'published-revision').read_text().strip()==old.get('revision')):
            return False
        # A later coarse-grid delivery must not displace a complete native result.
        if (existing and existing['top3_nl'].get('ranking_method')==RANKING_METHOD
                and existing['top3_nl'].get('source',{}).get('grid')=='O1280' and summary['source'].get('grid')!='O1280'):
            return False
        runs = sorted([r for r in old.get('runs',[]) if r['run']!=entry['run']]+[entry],key=lambda r:r['run'],reverse=True)[:8]
        if entry not in runs:
            return False
        manifest = dict(schema=1,complete=True,runs=runs)
        manifest['revision'] = hashlib.sha256(canonical(manifest)).hexdigest()
        manifest['updated'] = iso(datetime.now(timezone.utc))
        folder = state/summary['path']
        folder.mkdir(parents=True,exist_ok=True)
        for point,doc in documents.items():
            (folder/(point+'.json')).write_bytes(gzip.compress(canonical(doc),mtime=0))
        if publish:
            subprocess.run(['/opt/homebrew/bin/rclone','copy',str(folder),'r2:weerlab-data/'+summary['path'],
                '--transfers','4','--header-upload','Cache-Control: public, max-age=86400, immutable',
                '--header-upload','Content-Encoding: gzip','--header-upload','Content-Type: application/json'],check=True)
        data = canonical(manifest)
        temporary = state/'manifest.tmp.json'
        temporary.write_bytes(data)
        if publish:
            subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(temporary),'r2:weerlab-data/'+NAME,
                '--header-upload','Cache-Control: public, max-age=60','--header-upload','Content-Type: application/json'],check=True)
        local_tmp = path.with_name('.'+NAME+'.tmp')
        local_tmp.write_bytes(data);os.replace(local_tmp,path)
        if publish:
            (state/'published-revision').write_text(manifest['revision']+'\n')
        print(f'NL_TOP3_PUBLISHED: {iso(run)} {summary["station_count"]} plaatsen, {summary["grid_count"]} modelpunten',flush=True)
        return True


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--repo',type=Path,required=True)
    parser.add_argument('--state',type=Path,required=True)
    parser.add_argument('--no-publish',action='store_true')
    args=parser.parse_args()
    args.state.mkdir(parents=True,exist_ok=True)
    with (args.state/'fetch.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return
        drain_direct(args.repo,args.state,publish=not args.no_publish)
        from pluim_top3_om import update_native_runs
        update_native_runs(args.repo,args.state,publish=not args.no_publish)


if __name__=='__main__':
    main()
