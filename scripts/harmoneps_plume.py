#!/usr/bin/env python3
"""Verified KNMI P2a point plumes, hourly source discovery and atomic R2 publication.

P2a contains control + five perturbations for ONE start hour, not the full
lagged 30-member ensemble. Parameter identities include level and TRI.
Documentation: https://www.knmidata.nl/open-data/harmonie (P2a/P4a table).
"""
from __future__ import annotations
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen
import eccodes as ec
import numpy as np

REPO = Path(__file__).resolve().parents[1]
API = 'https://api.dataplatform.knmi.nl/open-data/v1/datasets/harmonie_arome_cy43_p2a/versions/1.0/files'
SCHEMA = 2
# Codes 186 and 209 are cloud base and lightning, NEVER PWAT or CAPE.
FIELDS = {
 (11,105,2,0):'temp', (33,105,10,0):'u', (34,105,10,0):'v',
 (33,105,50,0):'u50', (34,105,50,0):'v50',
 (162,105,10,2):'gu', (163,105,10,2):'gv',
 (52,105,2,0):'rh', (1,103,0,0):'pressure', (20,105,0,0):'visibility',
 (71,105,0,0):'cloud', (73,105,0,0):'low', (74,105,0,0):'mid', (75,105,0,0):'high',
 (181,105,0,4):'rain', (184,105,0,4):'snow', (201,105,0,4):'graupel',
 (186,200,0,0):'cloudbase',
}
REQUIRED = set(FIELDS.values())

def atomic_json(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w',dir=path.parent,delete=False) as f:
        json.dump(value,f,separators=(',',':'),allow_nan=False)
        tmp=Path(f.name)
    os.replace(tmp,path)

def latest_file(files):
    valid=[f for f in files if re.fullmatch(r'harm43_v1_P2a_\d{10}\.tar',f.get('filename','')) and f.get('size',0)>0]
    if not valid: raise ValueError('Geen gepubliceerde KNMI P2a-run gevonden')
    return max(valid,key=lambda f:f['filename'])

def interval_precip(rain,snow,graupel):
    total=np.asarray(rain)+np.asarray(snow)+np.asarray(graupel)
    if not np.isfinite(total).all(): raise ValueError('Ontbrekende neerslagaccumulatie')
    if np.any(abs(total[...,0])>.02): raise ValueError('Neerslag begint niet op nul bij runstart')
    diff=np.diff(total,axis=-1,prepend=0)
    if np.any(diff<-.02): raise ValueError('Neerslagaccumulatie loopt terug')
    return np.maximum(diff,0)

def transform(raw):
    for values in raw.values():
        if not np.isfinite(values).all(): raise ValueError('Onvolledig KNMI-veld')
    out={'t2m_c':raw['temp']-273.15,'wind_kmh':np.hypot(raw['u'],raw['v'])*3.6,
         'wind50_kmh':np.hypot(raw['u50'],raw['v50'])*3.6,
         'wind_dir_deg':(270-np.degrees(np.arctan2(raw['v'],raw['u'])))%360,
         'gust_kmh':np.hypot(raw['gu'],raw['gv'])*3.6,
         'msl_hpa':raw['pressure']/100,'vis_km':raw['visibility']/1000,
         'cloud_base_m':raw['cloudbase'],
         'precip_mm_per_h':interval_precip(raw['rain'],raw['snow'],raw['graupel'])}
    for source,target in [('cloud','tcc_pct'),('low','lcc_pct'),('mid','mcc_pct'),('high','hcc_pct'),('rh','rh_pct')]:
        v=raw[source]
        # Native P2a values are fractions, verified against a real GRIB message.
        if np.any((v<-.0001)|(v>1.0001)): raise ValueError('Ongeldige fractie in '+source)
        out[target]=np.clip(v*100,0,100)
    return out

def api_json(url,key):
    with urlopen(Request(url,headers={'Authorization':key}),timeout=30) as r:return json.load(r)

def read_points(stream, stations, run):
    records={}; grid=None; point_indexes=None; point_coords=None; count=0
    started=time.monotonic()
    with tarfile.open(fileobj=stream,mode='r|') as archive:
        for entry in archive:
            if not entry.isfile():continue
            parts=Path(entry.name).name.split('_')
            if len(parts)!=9 or parts[-1]!='GB': raise ValueError('Onbekende GRIB-bestandsnaam')
            member=int(parts[5]);file_run=parts[6]
            if file_run != run.strftime('%Y%m%d%H%M'):raise ValueError('Verschillende starts in een KNMI-batch')
            with tempfile.TemporaryFile() as f:
                f.write(archive.extractfile(entry).read());f.seek(0)
                while (gid:=ec.codes_grib_new_from_file(f)) is not None:
                    try:
                        ident=tuple(ec.codes_get(gid,k,int) for k in ['indicatorOfParameter','indicatorOfTypeOfLevel','level','timeRangeIndicator'])
                        field=FIELDS.get(ident)
                        if field is None:continue
                        ref=datetime.strptime(str(ec.codes_get(gid,'dataDate'))+str(ec.codes_get(gid,'dataTime')).zfill(4),'%Y%m%d%H%M').replace(tzinfo=timezone.utc)
                        valid=datetime.strptime(str(ec.codes_get(gid,'validityDate'))+str(ec.codes_get(gid,'validityTime')).zfill(4),'%Y%m%d%H%M').replace(tzinfo=timezone.utc)
                        step=(valid-ref).total_seconds()/3600
                        if ref!=run or step!=int(step) or not 0<=step<=60:raise ValueError('Ongeldige GRIB-geldigheid')
                        step=int(step)
                        current=tuple(ec.codes_get(gid,k) for k in ['Ni','Nj','latitudeOfFirstGridPointInDegrees','latitudeOfLastGridPointInDegrees','longitudeOfFirstGridPointInDegrees','longitudeOfLastGridPointInDegrees','jPointsAreConsecutive','iScansNegatively','jScansPositively'])
                        if grid is None:
                            grid=current;ni,nj,lat1,lat2,lon1,lon2,consecutive,_,_=grid
                            if consecutive:raise ValueError('Onverwachte scanvolgorde')
                            lats=np.linspace(lat1,lat2,nj);lons=np.linspace(lon1,lon2,ni)
                            ij=[(int(np.argmin(abs(lats-s['lat']))),int(np.argmin(abs(lons-s['lon'])))) for s in stations]
                            point_indexes=[i*ni+j for i,j in ij];point_coords=[(float(lats[i]),float(lons[j])) for i,j in ij]
                        elif current!=grid:raise ValueError('Rooster verandert binnen KNMI-batch')
                        key=(member,step,field)
                        if key in records:raise ValueError('Dubbel GRIB-veld')
                        values=np.asarray(ec.codes_get_elements(gid,'values',point_indexes),dtype=float)
                        if np.any(abs(values)>1e10):raise ValueError('Missing-value in KNMI-stationveld')
                        records[key]=values
                    finally:ec.codes_release(gid)
            count+=1
            if count%60==0:print(f'Decode: {count}/366 bestanden, {time.monotonic()-started:.0f}s',flush=True)
    members=sorted({m for m,_,_ in records});steps=sorted({s for _,s,_ in records})
    if len(members)!=6 or members[0]!=0 or steps!=list(range(61)) or count!=366:raise ValueError('Onvolledige KNMI-batch: verwacht controle + vijf leden, 61 uur')
    raw={}
    for field in REQUIRED:
        try:raw[field]=np.stack([np.stack([records[(m,s,field)] for s in steps],axis=-1) for m in members])
        except KeyError:raise ValueError('Ontbrekend GRIB-veld: '+field) from None
    return transform(raw),members,point_coords

def publish(directory,manifest):
    rclone='/opt/homebrew/bin/rclone'
    destination='r2:weerlab-data/harmoneps_plume/'
    # Immutable run files first. Latest manifest is the single commit point.
    subprocess.run([rclone,'copy',str(directory),destination+manifest['run_key'],'--header-upload','Cache-Control: public, max-age=31536000, immutable','--transfers','4'],check=True)
    subprocess.run([rclone,'copyto',str(directory/'manifest.json'),destination+'latest.json','--header-upload','Cache-Control: public, max-age=60'],check=True)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--publish',action='store_true');ap.add_argument('--out',type=Path,default=REPO/'harmoneps_plume');args=ap.parse_args()
    key=os.environ.get('KNMI_API_KEY')
    if not key:
        for line in (REPO.parent/'pascal/.env').read_text().splitlines():
            if line.startswith('KNMI_API_KEY='):key=line.split('=',1)[1].strip().strip('"\'')
    if not key:raise ValueError('KNMI_API_KEY ontbreekt')
    source=latest_file(api_json(API+'?maxKeys=12&sorting=desc',key)['files'])
    run=datetime.strptime(source['filename'].removeprefix('harm43_v1_P2a_').removesuffix('.tar'),'%Y%m%d%H').replace(tzinfo=timezone.utc)
    run_key=run.strftime('%Y%m%d%H');directory=args.out/run_key
    marker=args.out/'published.json'
    if marker.exists():
        published=json.loads(marker.read_text())
        if published.get('schema')==SCHEMA and published.get('run_key','')>=run_key:
            print('Actueel: '+published['run_key']);return
    if (directory/'manifest.json').exists():
        manifest=json.loads((directory/'manifest.json').read_text())
    else:
        stations=json.loads((REPO/'pluim_harmoneps/_index.json').read_text())
        discovered=datetime.now(timezone.utc).isoformat()
        download=api_json(API+'/'+source['filename']+'/url',key)['temporaryDownloadUrl']
        print('Nieuwe bron: '+source['filename'],flush=True)
        with urlopen(download,timeout=90) as response:values,members,coords=read_points(response,stations,run)
        times=[datetime.fromtimestamp(run.timestamp()+s*3600,timezone.utc).isoformat() for s in range(61)]
        fetched=datetime.now(timezone.utc).isoformat()
        for i,station in enumerate(stations):
            fields={name:np.round(matrix[:,i,:],2 if name=='precip_mm_per_h' else 1).tolist() for name,matrix in values.items()}
            atomic_json(directory/(station['id']+'.json'),{'schema':SCHEMA,'complete':True,'station':station,'run':run_key+'Z','run_initialisation':run.isoformat(),'fetched_at':fetched,'grid_lat':round(coords[i][0],4),'grid_lon':round(coords[i][1],4),'n_members':6,'member_ids':members,'times':times,'vars':fields,'precipitation':'total_water_equivalent_preceding_hour','source':source['filename']})
        manifest={'schema':SCHEMA,'complete':True,'run_key':run_key,'run':run.isoformat(),'discovered_at':discovered,'published_at':fetched,'station_count':len(stations),'n_members':6,'member_ids':members,'stations':stations,'fields':sorted(values),'time_count':61,'data_end':times[-1],'source':source['filename']}
        atomic_json(directory/'manifest.json',manifest)
    if args.publish:
        publish(directory,manifest);atomic_json(marker,manifest)
    atomic_json(args.out/'latest.json',manifest)
    print('Volledig: '+run_key+' · '+str(manifest['station_count'])+' stations')

if __name__=='__main__':
    with open('/tmp/weerlab-harmoneps-plume.lock','w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:print('Invoer draait al');raise SystemExit(0)
        main()
