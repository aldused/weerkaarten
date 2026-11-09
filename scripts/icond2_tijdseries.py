#!/usr/bin/env python3
"""Zet de bestaande native ICON-D2 canvasvelden om naar compacte tijdserietegels.

Geen downloads of extra ruimtelijke interpolatie: elk veld wordt op de
bestaande canvascoördinaten bemonsterd. De fijnere neerslagvelden bevatten
exact dezelfde coördinaten; alleen die punten worden overgenomen.
"""
from __future__ import annotations
import argparse
import json
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT))
from tijdseries import store, publish


def build(root: Path) -> store.RunData:
    meta_path = root / 'icond2_canvas_meta.json'
    original = meta_path.read_bytes()
    meta = json.loads(original)
    run = datetime.fromisoformat(meta['run_utc'].replace('Z', '+00:00'))
    if run.tzinfo is None:
        raise ValueError('ICON-D2 run moet een tijdzone hebben')
    run = run.astimezone(timezone.utc)
    # De canvaspijplijn levert elk uur vanaf +1; controleer de lokale labels
    # tegen die UTC-tijdas, ook bij de wisseling zomer-/wintertijd.
    from datetime import timedelta
    leads = list(range(1, len(meta['tijden']) + 1))
    if not leads or len(leads) != meta['uren']:
        raise ValueError('Onvolledige ICON-D2 tijdas')
    for h, label in zip(leads, meta['tijden']):
        expected = run + timedelta(hours=h)
        given = datetime.fromisoformat(label.replace('Z', '+00:00'))
        if given.tzinfo:
            match = given.astimezone(timezone.utc) == expected
        else:
            match = given == expected.astimezone(ZoneInfo('Europe/Amsterdam')).replace(tzinfo=None)
        if not match:
            raise ValueError(f'ICON-D2 tijdas wijkt af op +{h}: {label}')
    g = meta['grid']
    grid = store.Grid(g['lat_min'], (g['lat_max']-g['lat_min'])/(g['n_lat']-1), g['n_lat'],
                      g['lon_min'], (g['lon_max']-g['lon_min'])/(g['n_lon']-1), g['n_lon'])
    values, provenance, windows = {}, {}, {}
    source_files = {}

    def read(name):
        spec = meta['parameters'].get(name)
        if not spec:
            return None
        path = root / spec['file']
        source_files[path] = path.stat().st_mtime_ns
        with path.open('rb') as f:
            head = f.read(16)
        ny, nx, nt, nc = struct.unpack_from('<4H', head)
        pg = spec.get('grid', g)
        if (ny,nx,nt,nc) != (pg['n_lat'],pg['n_lon'],len(leads),spec['components']):
            raise ValueError(f'{name}: rasterheader komt niet overeen met metadata')
        dtype = spec.get('dtype', 'u8sqrt' if head[8] == 1 else 'float32')
        if dtype not in ('u8sqrt','float32'):
            raise ValueError(f'{name}: onbekend dtype {dtype}')
        dt = np.dtype('u1' if dtype == 'u8sqrt' else '<f4')
        if path.stat().st_size != 16 + ny*nx*nt*nc*dt.itemsize:
            raise ValueError(f'{name}: incompleet rasterbestand')
        a = np.memmap(path, mode='r', offset=16, dtype=dt, shape=(nt,nc,ny,nx))
        ys=(np.linspace(g['lat_min'],g['lat_max'],grid.nlat)-pg['lat_min'])/(pg['lat_max']-pg['lat_min'])*(ny-1)
        xs=(np.linspace(g['lon_min'],g['lon_max'],grid.nlon)-pg['lon_min'])/(pg['lon_max']-pg['lon_min'])*(nx-1)
        if not (np.allclose(ys,np.rint(ys),atol=1e-5) and np.allclose(xs,np.rint(xs),atol=1e-5)):
            raise ValueError(f'{name}: uitvoerpunten ontbreken op dit rooster')
        if ys.min()<0 or xs.min()<0 or ys.max()>ny-1+1e-5 or xs.max()>nx-1+1e-5:
            raise ValueError(f'{name}: punt buiten bronrooster')
        a=np.asarray(a[:,:,np.rint(ys).astype(int)][:,:,:,np.rint(xs).astype(int)],dtype=np.float32)
        if dtype == 'u8sqrt':
            a=(a/spec['scale'])**spec.get('power',2)
        return a

    def put(key,a,name,note='',derived=False):
        if a is None: return
        values[key]=a
        provenance[key]={'product':'DWD ICON-D2 native canvas', 'field':name, 'note':note, 'derived':derived}

    for key,name,factor in [('t2m','temp',1),('td2m','dauwpunt',1),('rh','rv',1),
                            ('vis','zicht',1),('msl','druk',0.01),('cape','cape',1),('precip','neerslag',1)]:
        a=read(name)
        if a is not None:
            put(key,a[:,0]*factor,name,'Dichtstbijzijnd punt op het bestaande canvasrooster; geen aanvullende interpolatie.')
    wind=read('wind')
    if wind is not None:
        put('u10',wind[:,0],'wind component 0','Geografische oostcomponent (m/s).')
        put('v10',wind[:,1],'wind component 1','Geografische noordcomponent (m/s).')
    gust=read('windstoten')
    if gust is not None:
        put('gust',np.hypot(gust[:,0],gust[:,1]),'vmax_10m','Maximale windstoot in het voorgaande uur; scalar opgeslagen als (vmax,0).',True)
        windows['gust']=[[h-1,h] for h in leads]
    cloud=read('bewolking')
    if cloud is not None:
        for i,key in enumerate(('hcc','mcc','lcc')):
            put(key,cloud[:,i]*100,'bewolking component '+str(i),'Bedekkingsfractie omgezet naar procenten.')
    if 'precip' in values: windows['precip']=[[h-1,h] for h in leads]
    required={'t2m','td2m','u10','v10','gust'}
    if not required.issubset(values): raise ValueError('Essentiële ICON-D2-velden ontbreken')
    if meta_path.read_bytes()!=original or any(f.stat().st_mtime_ns!=stamp for f,stamp in source_files.items()):
        raise ValueError('ICON-D2-bron gewijzigd tijdens inlezen; probeer opnieuw')
    return store.RunData(model='icond2',run=run,grid=grid,leads=leads,values=values,
        provenance=provenance,windows=windows,info={
            'label':'ICON-D2','cycle':'DWD ICON-D2','product':'DWD Open Data, native ICON-D2 via bestaande Weerlab-canvasvelden',
            'status_label':'operationeel','resolution':'Canvasrooster 0,04° (native model ±2,2 km)',
            'timestep':'1 uur','interpolation':'Bestaand regulier canvasrooster; dichtstbijzijnd roosterpunt.'})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--publish',action='store_true')
    args=parser.parse_args()
    rd=build(args.root)
    index=store.OUT/'icond2'/'runs.json'
    if index.exists():
        previous=json.loads(index.read_text())
        if previous.get('runs') and previous['runs'][0]['run']==rd.run.strftime('%Y-%m-%dT%H:%MZ'):
            print('ICON-D2-tijdseries zijn al bijgewerkt voor deze run')
            if args.publish: publish.publish('icond2')
            return
    man=store.write_run(rd,keep=8)
    print(f"ICON-D2: {len(man['params'])} parameters, {len(rd.leads)} uren, {man['bytes']/1e6:.1f} MB")
    if args.publish: publish.publish('icond2')

if __name__=='__main__': main()
