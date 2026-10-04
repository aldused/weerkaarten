#!/usr/bin/env python3
"""Keep immutable real model runs for a six-run comparison, never update-time aliases.

The published binaries are uncompressed so HTTP Range can retrieve one valid hour.
Metadata and the manifest are uploaded only after all three fields are complete.
"""
from __future__ import annotations
import hashlib, argparse, bz2, concurrent.futures, copy, json, os, re, shutil, struct, subprocess, tarfile, tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote
import numpy as np
import requests
import eccodes
from harmonie_precip import grib1_precip_kind, hourly_from_accumulation

UTC=timezone.utc
MODELS={'harmonie':('HARMONIE V43',1),'harmonie46':('HARMONIE V46',1),'icond2':('ICON-D2',3),'icond2ruc':('ICON-D2-RUC',1)}
FIELDS=('neerslag','wind','windstoten')
ROOT=Path(__file__).resolve().parents[1]

def utc(value):
    return datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(UTC)
def iso(value): return value.astimezone(UTC).isoformat(timespec='seconds').replace('+00:00','Z')
def stamp(value): return value.strftime('%Y%m%dT%H%MZ')
def atomic_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix('.json.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')));os.replace(tmp,path)
def binary_info(path,meta,info):
    with path.open('rb') as f: header=f.read(16)
    if len(header)!=16: raise ValueError('Missing binary header')
    ny,nx,nt,nc=struct.unpack('<HHHH',header[:8]);dtype=header[8]
    if dtype not in (0,1,2) or nt!=len(meta['tijden']) or nc!=info['components']:raise ValueError('Binary metadata mismatch')
    step_bytes=ny*nx*nc*(4 if dtype==0 else 1)
    if path.stat().st_size!=16+step_bytes*nt:raise ValueError('Incomplete binary')
    return dict(n_lat=ny,n_lon=nx,n_steps=nt,components=nc,dtype=dtype,step_bytes=step_bytes)

def install_run(store,model,meta,files):
    run=utc(meta['run_utc']); target=store/'runcompare'/model/stamp(run)
    if (target/'meta.json').exists(): return False
    staging=target.with_name(target.name+'.tmp');shutil.rmtree(staging,ignore_errors=True);staging.mkdir(parents=True)
    out=copy.deepcopy(meta);out['run_utc']=iso(run);out['archive']=True;out['parameters']={}
    # UTC timestamps avoid ambiguous Amsterdam wall hours when wintertime starts.
    from zoneinfo import ZoneInfo
    times=[]
    for time in meta['tijden']:
        dt=datetime.fromisoformat(time.replace('Z','+00:00'))
        if dt.tzinfo is None:dt=dt.replace(tzinfo=ZoneInfo('Europe/Amsterdam'))
        times.append(iso(dt))
    if len(set(times))!=len(times):raise ValueError('Ambiguous or duplicate source hours')
    out['tijden']=times
    for field in FIELDS:
        info=copy.deepcopy(meta['parameters'][field]);source=files[field]
        info['binary']=binary_info(source,out,info)
        info['file']=f'runcompare/{model}/{stamp(run)}/{field}.bin'
        shutil.copy2(source,staging/(field+'.bin'));out['parameters'][field]=info
    atomic_json(staging/'meta.json',out);target.parent.mkdir(parents=True,exist_ok=True);os.replace(staging,target)
    print(f'{model}: archived {iso(run)} ({len(times)} valid hours)',flush=True)
    return True

def capture_local(store,source,model):
    path=source/(model+'_canvas_meta.json')
    if not path.exists():return False
    raw=path.read_bytes();meta=json.loads(raw)
    if not meta.get('run_utc'):return False
    files={k:source/meta['parameters'][k]['file'] for k in FIELDS}
    # Exporters replace binaries first and metadata last. Do not archive a mixed run.
    if any(not p.exists() or p.stat().st_mtime_ns>path.stat().st_mtime_ns for p in files.values()):
        print(f'{model}: export in progress, snapshot deferred',flush=True);return False
    signatures={k:(f.stat().st_ino,f.stat().st_size,f.stat().st_mtime_ns) for k,f in files.items()}
    changed=install_run(store,model,meta,files)
    if path.read_bytes()!=raw or any((f.stat().st_ino,f.stat().st_size,f.stat().st_mtime_ns)!=signatures[k] for k,f in files.items()):
        if changed:shutil.rmtree(store/'runcompare'/model/stamp(utc(meta['run_utc'])))
        raise RuntimeError('Source run changed during snapshot')
    return changed

def manifest(store,model):
    folder=store/'runcompare'/model;folder.mkdir(parents=True,exist_ok=True)
    runs=[]
    for p in folder.glob('*/meta.json'):
        m=json.loads(p.read_text());runs.append(dict(run_utc=m['run_utc'],meta_file=f'runcompare/{model}/{p.parent.name}/meta.json',tijden=m['tijden']))
    runs.sort(key=lambda r:utc(r['run_utc']))
    # Keep a cushion for browsers still looking at the previous set of six.
    keep=runs[-12:]
    for run in runs[:-12]:shutil.rmtree(store/run['meta_file'].rsplit('/',1)[0])
    out=dict(model=model,label=MODELS[model][0],cadence_hours=MODELS[model][1],runs=keep,updated_utc=iso(datetime.now(UTC)))
    old=folder/'manifest.json'
    if old.exists():
        prior=json.loads(old.read_text())
        if prior.get('runs')==keep:return False
    atomic_json(old,out);return True

def publication_needed(store,model):
    folder=store/'runcompare'/model
    marker=folder/'.published.sha256'
    return not marker.exists() or marker.read_text()!=hashlib.sha256((folder/'manifest.json').read_bytes()).hexdigest()

def publish(store,model):
    folder=store/'runcompare'/model;remote=f'r2:weerlab-harmonie/runcompare/{model}'
    command=['/opt/homebrew/bin/rclone','copy',str(folder),remote,'--exclude','manifest.json','--exclude','*.tmp','--exclude','.published*','--transfers','6','--checkers','8','--header-upload','Cache-Control: public, max-age=31536000, immutable']
    subprocess.run(command,check=True)
    subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(folder/'manifest.json'),remote+'/manifest.json','--header-upload','Content-Type: application/json','--header-upload','Cache-Control: public, max-age=30','--no-traverse'],check=True)
    (folder/'.published.sha256').write_text(hashlib.sha256((folder/'manifest.json').read_bytes()).hexdigest())
    print(f'{model}: manifest published',flush=True)

def knmi_key(source):
    key=os.environ.get('KNMI_API_KEY','')
    if key:return key
    text=(source/'scripts/harmonie_update.sh').read_text()
    m=re.search(r"^KEY = '([^']+)'",text,re.M)
    if not m:raise RuntimeError('KNMI API credential unavailable')
    return m[1]

def knmi_runs(source,model,count):
    session=requests.Session();session.headers['Authorization']=knmi_key(source)
    dataset='harmonie_arome_cy43_p1' if model=='harmonie' else 'harmonie_arome_cy46_p1'
    base=f'https://api.dataplatform.knmi.nl/open-data/v1/datasets/{dataset}/versions/1.0/files'
    r=session.get(base,params=dict(maxKeys=24,orderBy='created',sorting='desc'),timeout=30);r.raise_for_status()
    runs={}
    for item in r.json()['files']:
        name=item['filename'];m=re.search(r'(20\d{8})',name)
        if m:runs[datetime.strptime(m[1],'%Y%m%d%H').replace(tzinfo=UTC)]=name
    return session,base,sorted(runs.items(),reverse=True)[:count]

_geometry_cache={}
def crop_message(gid,stride,coordinates=None):
    gtype=eccodes.codes_get_string(gid,'gridType')
    if gtype!='regular_ll':
        from scipy.spatial import cKDTree
        if coordinates is None:
            lat=eccodes.codes_get_array(gid,'latitudes');lon=eccodes.codes_get_array(gid,'longitudes')
        else:lat,lon=coordinates
        if len(lat)!=eccodes.codes_get_long(gid,'numberOfDataPoints'):raise ValueError('DWD grid-coordinate count mismatch')
        lon=np.where(lon>180,lon-360,lon)
        fingerprint=(gtype,len(lat),float(lat[0]),float(lat[-1]),float(lon[0]),float(lon[-1]),stride)
        if fingerprint not in _geometry_cache:
            ys=np.arange(max(47.5,float(np.min(lat))),min(56.5,float(np.max(lat)))+.0001,.02*stride)
            xs=np.arange(max(.5,float(np.min(lon))),min(12.5,float(np.max(lon)))+.0001,.03*stride)
            gx,gy=np.meshgrid(xs,ys);cos=np.cos(np.radians(52))
            tree=cKDTree(np.column_stack([lat,lon*cos]));distance,index=tree.query(np.column_stack([gy.ravel(),gx.ravel()*cos]))
            grid=dict(n_lat=len(ys),n_lon=len(xs),lat_min=float(ys[0]),lat_max=float(ys[-1]),lon_min=float(xs[0]),lon_max=float(xs[-1]))
            _geometry_cache[fingerprint]=(index,distance>.05,grid)
        index,missing,grid=_geometry_cache[fingerprint]
        eccodes.codes_set(gid,'missingValue',9.9e30)
        values=eccodes.codes_get_values(gid)[index];values=np.where(missing|(np.abs(values)>1e20),np.nan,values)
        return values.reshape(grid['n_lat'],grid['n_lon']).astype('<f4'),grid
    ny=eccodes.codes_get_long(gid,'Nj');nx=eccodes.codes_get_long(gid,'Ni')
    lat=np.linspace(eccodes.codes_get_double(gid,'latitudeOfFirstGridPointInDegrees'),eccodes.codes_get_double(gid,'latitudeOfLastGridPointInDegrees'),ny)
    lon1=eccodes.codes_get_double(gid,'longitudeOfFirstGridPointInDegrees');lon2=eccodes.codes_get_double(gid,'longitudeOfLastGridPointInDegrees')
    if lon1>180:lon1-=360
    if lon2>180:lon2-=360
    lon=np.linspace(lon1,lon2,nx)
    lon=np.where(lon>180,lon-360,lon)
    iy=np.where((lat>=47.5)&(lat<=56.5))[0];ix=np.where((lon>=0.5)&(lon<=12.5))[0]
    iy=iy[np.argsort(lat[iy])][::stride];ix=ix[np.argsort(lon[ix])][::stride]
    if len(iy)<2 or len(ix)<2:raise ValueError('No Benelux model coverage')
    eccodes.codes_set(gid,'missingValue',9.9e30)
    arr=eccodes.codes_get_values(gid).reshape(ny,nx)[np.ix_(iy,ix)]
    arr=np.where(np.abs(arr)>1e20,np.nan,arr).astype('<f4')
    grid=dict(n_lat=len(iy),n_lon=len(ix),lat_min=float(lat[iy[0]]),lat_max=float(lat[iy[-1]]),lon_min=float(lon[ix[0]]),lon_max=float(lon[ix[-1]]))
    return arr,grid

def validate_grib_time(gid,run,hour):
    init=datetime.strptime(str(eccodes.codes_get_long(gid,'dataDate'))+f"{eccodes.codes_get_long(gid,'dataTime'):04d}",'%Y%m%d%H%M').replace(tzinfo=UTC)
    valid=datetime.strptime(str(eccodes.codes_get_long(gid,'validityDate'))+f"{eccodes.codes_get_long(gid,'validityTime'):04d}",'%Y%m%d%H%M').replace(tzinfo=UTC)
    if init!=run or valid!=run+timedelta(hours=hour):raise ValueError('GRIB runtime or valid time differs from archive label')
def read_knmi_step(handle,model,run,hour):
    fields={};grids={}
    while True:
        gid=eccodes.codes_grib_new_from_file(handle)
        if gid is None:break
        try:
            level=eccodes.codes_get_long(gid,'level');key=None
            if model=='harmonie':
                ind=eccodes.codes_get_long(gid,'indicatorOfParameter')
                if grib1_precip_kind(ind,eccodes.codes_get_long(gid,'indicatorOfTypeOfLevel'),level,eccodes.codes_get_long(gid,'timeRangeIndicator'))=='cum':key='cum'
                elif level==10:key={33:'u',34:'v',162:'ug',163:'vg'}.get(ind)
            else:
                short=eccodes.codes_get_string(gid,'shortName')
                if short=='tp':key='cum'
                elif level==10:key={'10u':'u','u':'u','10v':'v','v':'v','max_10efg':'ug','max_10nfg':'vg'}.get(short)
                if short in ('max_10efg','max_10nfg'):key={'max_10efg':'ug','max_10nfg':'vg'}[short]
            if key:
                validate_grib_time(gid,run,hour)
                fields[key],grids[key]=crop_message(gid,1 if key=='cum' else 2)
        finally:eccodes.codes_release(gid)
    if not all(k in fields for k in ('cum','u','v','ug','vg')):raise ValueError(f'Missing run fields: {set(("cum","u","v","ug","vg"))-fields.keys()}')
    return fields,grids

def write_series(directory,model,run,series,grids,hours):
    meta=dict(model=MODELS[model][0],run_utc=iso(run),bijgewerkt=iso(datetime.now(UTC)),tijden=[iso(run+timedelta(hours=h)) for h in range(1,hours+1)],grid=grids['wind'],parameters={})
    files={}
    for field,values in series.items():
        nc=2 if field=='wind' else (2 if isinstance(values[0],tuple) else 1)
        g=grids[field];path=directory/(field+'.bin');files[field]=path
        with path.open('wb') as out:
            out.write(struct.pack('<HHHH',g['n_lat'],g['n_lon'],hours,nc)+b'\0'*8)
            for frame in values:
                for component in (frame if isinstance(frame,tuple) else (frame,)):
                    out.write(np.asarray(component,dtype='<f4').tobytes())
        meta['parameters'][field]=dict(file=path.name,components=nc,grid=g,label={'neerslag':'Neerslag voorgaande uur (mm)','wind':'Wind op 10 m (m/s)','windstoten':'Windstoten op 10 m (m/s)'}[field])
    return meta,files

def backfill_knmi(store,source,model,count,hours):
    session,base,runs=knmi_runs(source,model,count)
    for run,name in reversed(runs):
        if (store/'runcompare'/model/stamp(run)/'meta.json').exists():continue
        print(f'{model}: retrieve true source run {iso(run)}',flush=True)
        r=session.get(base+'/'+name+'/url',timeout=30);r.raise_for_status()
        with tempfile.TemporaryDirectory(prefix='weerlab-sixruns-') as tmp:
            directory=Path(tmp);tarpath=directory/'run.tar'
            with requests.get(r.json()['temporaryDownloadUrl'],stream=True,timeout=(30,300)) as response:
                response.raise_for_status()
                with tarpath.open('wb') as f:
                    for chunk in response.iter_content(1024*1024):f.write(chunk)
            steps={};grids={}
            with tarfile.open(tarpath,'r:*') as archive:
                members={int(m.name.split('_')[-2])//100:m for m in archive.getmembers() if m.isfile() and m.name.endswith('_GB')}
                for hour in range(hours+1):
                    member=members[hour]
                    # ecCodes needs a real seekable file descriptor.
                    path=directory/'step.grib'
                    with archive.extractfile(member) as inp,path.open('wb') as out:shutil.copyfileobj(inp,out)
                    with path.open('rb') as f:steps[hour],grids=read_knmi_step(f,model,run,hour)
            rain=hourly_from_accumulation([steps[h]['cum'] for h in range(hours+1)])
            series={'neerslag':rain,'wind':[(steps[h]['u'],steps[h]['v']) for h in range(1,hours+1)],'windstoten':[(steps[h]['ug'],steps[h]['vg']) for h in range(1,hours+1)]}
            meta,files=write_series(directory,model,run,series,{'neerslag':grids['cum'],'wind':grids['u'],'windstoten':grids['ug']},hours)
            install_run(store,model,meta,files)
        if manifest(store,model):publish(store,model)

DWD='https://opendata.dwd.de/weather/nwp/icon-d2/grib'
RUC='https://opendata.dwd.de/weather/nwp/v1/m/icon-d2-ruc/p'
def dwd_runs(model,count):
    if model=='icond2ruc':
        r=requests.get(RUC+'/T_2M/r/',timeout=30);r.raise_for_status()
        values=[]
        for link in re.findall(r'href="([^"]+)"',r.text):
            try:dt=utc(unquote(link).strip('/')+'Z')
            except ValueError:continue
            values.append(dt)
        return sorted(set(values),reverse=True)[:count]
    result=set()
    for hour in range(0,24,3):
        r=requests.get(f'{DWD}/{hour:02d}/tot_prec/',timeout=30)
        for date in re.findall(r'single-level_(20\d{8})_',r.text):result.add(datetime.strptime(date,'%Y%m%d%H').replace(tzinfo=UTC))
    return sorted(result,reverse=True)[:count]
def dwd_field(model,run,hour,key):
    param={'cum':'tot_prec','u':'u_10m','v':'v_10m','gust':'vmax_10m'}[key]
    if model=='icond2ruc':url=f'{RUC}/{param.upper()}/r/{run:%Y-%m-%dT%H:%M}/s/PT{hour:03d}H00M.grib2'
    else:url=f'{DWD}/{run:%H}/{param}/icon-d2_germany_regular-lat-lon_single-level_{run:%Y%m%d%H}_{hour:03d}_2d_{param}.grib2.bz2'
    r=requests.get(url,timeout=(20,60))
    if r.status_code==404 and model=='icond2':r=requests.get(url.replace('_2d_','_'),timeout=(20,60))
    r.raise_for_status();body=bz2.decompress(r.content) if model=='icond2' else r.content
    gid=eccodes.codes_new_from_message(body)
    try:
        validate_grib_time(gid,run,hour)
        return crop_message(gid,1,_ruc_coords if model=='icond2ruc' else None)
    finally:eccodes.codes_release(gid)
_ruc_coords=None
def backfill_dwd(store,model,count,hours):
    global _ruc_coords
    if model=='icond2ruc':
        cache=Path('/Users/aldus/KNMI_Project/weerlab/icond2ruc_grid_coords.npz')
        if not cache.exists():raise ValueError('Native RUC CLAT/CLON cache unavailable')
        with np.load(cache) as c:_ruc_coords=(c['lat'].copy(),c['lon'].copy())
    hours=min(hours,14 if model=='icond2ruc' else 24)
    candidates=dwd_runs(model,count+4)
    complete=[]
    for run in candidates:
        if model=='icond2ruc':check=f'{RUC}/VMAX_10M/r/{run:%Y-%m-%dT%H:%M}/s/PT{hours:03d}H00M.grib2'
        else:check=f'{DWD}/{run:%H}/vmax_10m/icon-d2_germany_regular-lat-lon_single-level_{run:%Y%m%d%H}_{hours:03d}_2d_vmax_10m.grib2.bz2'
        response=requests.head(check,timeout=20)
        if response.status_code==404 and model=='icond2':response=requests.head(check.replace('_2d_','_'),timeout=20)
        if response.ok:complete.append(run)
        if len(complete)==count:break
    for run in reversed(complete):
        if (store/'runcompare'/model/stamp(run)/'meta.json').exists():continue
        print(f'{model}: retrieve true source run {iso(run)}',flush=True)
        tasks=[(0,'cum')]+[(h,k) for h in range(1,hours+1) for k in ('cum','u','v','gust')]
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            values=list(pool.map(lambda task:dwd_field(model,run,*task),tasks))
        fields=dict(zip(tasks,values));cum=[fields[h,'cum'][0] for h in range(hours+1)]
        series={'neerslag':hourly_from_accumulation(cum),'wind':[(fields[h,'u'][0],fields[h,'v'][0]) for h in range(1,hours+1)],'windstoten':[fields[h,'gust'][0] for h in range(1,hours+1)]}
        grids={'neerslag':fields[0,'cum'][1],'wind':fields[1,'u'][1],'windstoten':fields[1,'gust'][1]}
        with tempfile.TemporaryDirectory(prefix='weerlab-sixruns-') as tmp:
            meta,files=write_series(Path(tmp),model,run,series,grids,hours);install_run(store,model,meta,files)
        if manifest(store,model):publish(store,model)

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=Path('/Users/aldus/KNMI_Project/weerlab'));p.add_argument('--store',type=Path,default=ROOT.parent/'zesluik-run-data');p.add_argument('--models',nargs='+',choices=MODELS,default=list(MODELS));p.add_argument('--backfill',action='store_true');p.add_argument('--publish',action='store_true');p.add_argument('--hours',type=int,default=24);p.add_argument('--count',type=int,default=6);a=p.parse_args()
    errors=[]
    for model in a.models:
        try:
            changed=capture_local(a.store,a.source,model)
            changed=manifest(a.store,model) or changed
            if a.publish and (changed or publication_needed(a.store,model)):publish(a.store,model)
            if a.backfill:
                if model.startswith('harmonie'):backfill_knmi(a.store,a.source,model,a.count,a.hours)
                else:backfill_dwd(a.store,model,a.count,a.hours)
        except Exception as e:
            # Signed download URLs and credentials are deliberately never logged.
            detail = ': '+str(e)[:180] if isinstance(e,ValueError) else ''
            print(f'{model}: archive failed ({type(e).__name__}){detail}',flush=True);errors.append(model)
    return 1 if errors else 0
if __name__=='__main__':raise SystemExit(main())
