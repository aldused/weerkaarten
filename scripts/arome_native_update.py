#!/usr/bin/env python3
"""AROME France HD directly from Météo-France public GRIB packages.

Raw files and generated fields live on the dedicated external model-data folder.
No Open-Meteo calls, credentials or point-query budgets are used.
"""
from __future__ import annotations
import argparse, concurrent.futures, fcntl, json, shutil, struct, subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import eccodes as ec
import numpy as np
from scipy.interpolate import RegularGridInterpolator

ROOT = Path('/Volumes/WEERLAB/Modeldata/AROME')
REPO = Path('/Users/aldus/KNMI_Project/weerlab')
VOLUME_UUID = 'BBD67AB1-0A13-4865-B651-E9B8EF6AD337'
BASE = 'https://meteofrance-pnt.s3.rbx.io.cloud.ovh.net/pnt'
UTC = timezone.utc
LOCAL = ZoneInfo('Europe/Amsterdam')
GROUPS = [(0, 6)] + [(h, min(h+5,51)) for h in range(7,52,6)]
LATS = np.round(np.arange(49.0,55.0001,.02),6)
LONS = np.round(np.arange(.5,11.3001,.02),6)
GRID = dict(n_lat=len(LATS),n_lon=len(LONS),lat_min=float(LATS[0]),lat_max=float(LATS[-1]),lon_min=float(LONS[0]),lon_max=float(LONS[-1]))


def url_for(run, grid, package, step):
    stamp=run.strftime('%Y-%m-%dT%H:%M:%SZ')
    return f'{BASE}/{stamp}/arome/{grid}/{package}/arome__{grid}__{package}__{step}__{stamp}.grib2'


def run_available(run):
    for grid,package,step in [('001','SP1','51H'),('001','SP2','51H'),('0025','SP1','49H51H')]:
        p=subprocess.run(['curl','-sS','--head','--connect-timeout','10','--max-time','20','--output','/dev/null','--write-out','%{http_code}',url_for(run,grid,package,step)],capture_output=True,text=True)
        if p.returncode or p.stdout.strip()!='200':return False
    return True


def choose_run(explicit=None):
    if explicit:
        run=datetime.fromisoformat(explicit.replace('Z','+00:00')).astimezone(UTC)
        if run.minute or run.second or run.hour%3:raise ValueError('AROME heeft 3-uurlijkse UTC-runs')
        if not run_available(run):raise RuntimeError('Gekozen AROME-run nog onvolledig')
        return run
    now=datetime.now(UTC)-timedelta(hours=2)
    run=now.replace(hour=now.hour//3*3,minute=0,second=0,microsecond=0)
    for _ in range(9):
        if run_available(run):return run
        print(f'Run {run:%d-%m %HZ} nog onvolledig',flush=True);run-=timedelta(hours=3)
    raise RuntimeError('Geen volledige recente AROME-run gevonden')


def assert_volume(root):
    import plistlib
    info=plistlib.loads(subprocess.check_output(['diskutil','info','-plist','/Volumes/WEERLAB']))
    if info.get('VolumeUUID')!=VOLUME_UUID or info.get('TotalSize',0)<9_000_000_000_000:
        raise RuntimeError('De bedoelde 10 TB WEERLAB-schijf is niet aangesloten; niets opgeslagen')
    if not root.resolve().is_relative_to(Path('/Volumes/WEERLAB/Modeldata/AROME').resolve()):
        raise RuntimeError('Modeldata moet in de eigen AROME-map staan')
    root.mkdir(parents=True,exist_ok=True)
    if shutil.disk_usage(root).free < 50_000_000_000:
        raise RuntimeError('Minder dan 50 GB vrij op WEERLAB; geen nieuwe run opgehaald')


def valid_grib(path):
    try:
        with path.open('rb') as f:
            if f.read(4)!=b'GRIB':return False
            f.seek(-4,2);return f.read()==b'7777'
    except (OSError,ValueError):return False


def download(job):
    url,path=job
    if valid_grib(path):return path
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.part')
    subprocess.run(['curl','-fSsL','--connect-timeout','15','--max-time','240','--retry','3','--retry-delay','5',url,'-o',str(temp)],check=True)
    if not valid_grib(temp):raise ValueError(f'Onvolledig GRIB-bestand: {path.name}')
    temp.replace(path)
    return path


def crop(g):
    ni,nj=ec.codes_get(g,'Ni'),ec.codes_get(g,'Nj')
    if ec.codes_get(g,'iScansNegatively') or ec.codes_get(g,'jScansPositively'):
        raise ValueError('Onverwachte AROME-scanrichting')
    values=ec.codes_get_values(g).reshape(nj,ni)
    values[values==ec.codes_get(g,'missingValue')]=np.nan
    lat0,lon0=ec.codes_get(g,'latitudeOfFirstGridPointInDegrees'),ec.codes_get(g,'longitudeOfFirstGridPointInDegrees')
    if lon0 > 180:lon0 -= 360
    dx,dy=ec.codes_get(g,'iDirectionIncrementInDegrees'),ec.codes_get(g,'jDirectionIncrementInDegrees')
    rows=(lat0-LATS)/dy;cols=(LONS-lon0)/dx
    if np.allclose(rows,np.round(rows),atol=1e-5) and np.allclose(cols,np.round(cols),atol=1e-5):
        return values[np.ix_(np.round(rows).astype(int),np.round(cols).astype(int))].astype('float32')
    # Bilinear interpolation from the companion 2.5-km model; missing cells stay missing.
    iy=np.arange(max(0,int(np.floor(rows.min()))-1),min(nj,int(np.ceil(rows.max()))+2))
    ix=np.arange(max(0,int(np.floor(cols.min()))-1),min(ni,int(np.ceil(cols.max()))+2))
    lat=lat0-iy*dy;lon=lon0+ix*dx
    interpolator=RegularGridInterpolator((lat[::-1],lon),values[np.ix_(iy[::-1],ix)],bounds_error=False,fill_value=np.nan)
    yy,xx=np.meshgrid(LATS,LONS,indexing='ij')
    return interpolator(np.stack([yy,xx],axis=-1)).astype('float32')


def decode(path, run, high, expected_step=None):
    results={}
    names={'2t':'temp','2r':'rv','10u':'u','10v':'v','max_10efg':'gust_u','max_10nfg':'gust_v','CAPE_INS':'cape','lcc':'low','mcc':'mid','hcc':'high','tirf':'rain_cumul','tsnowp':'snow_cumul','tgrp':'graupel_cumul'} if high else {'prmsl':'druk','ssrd':'solar_cumul'}
    with path.open('rb') as f:
        while (g:=ec.codes_grib_new_from_file(f)) is not None:
            try:
                if ec.codes_get(g,'dataDate')!=int(run.strftime('%Y%m%d')) or ec.codes_get(g,'dataTime')!=run.hour*100:
                    raise ValueError('Verschillende modelruns in GRIB-pakket')
                step=int(ec.codes_get(g,'endStep'))
                if expected_step is not None and step!=expected_step:raise ValueError('Onverwachte forecaststap')
                sn=ec.codes_get(g,'shortName');key=names.get(sn)
                if high and ec.codes_get(g,'discipline')==0 and ec.codes_get(g,'parameterCategory')==16 and ec.codes_get(g,'parameterNumber')==193:key='radar'
                if not key:continue
                if key.endswith('_cumul') and ec.codes_get(g,'startStep')!=0:raise ValueError('Geen cumulatie vanaf modelstart')
                arr=crop(g)
                if key=='temp':arr-=273.15
                if key in ('low','mid','high'):arr=np.clip(arr/100,0,1)
                if key=='rv':arr=np.clip(arr,0,100)
                results.setdefault(step,{})[key]=arr
            finally:ec.codes_release(g)
    return results


def dewpoint(temp,rh):
    gamma=np.log(np.clip(rh,1e-6,100)/100)+(17.625*temp)/(243.04+temp)
    return (243.04*gamma/(17.625-gamma)).astype('float32')


def hourly_accumulation(cumulative, seconds=1, tolerance=.1):
    result=np.full_like(cumulative,np.nan)
    result[1:]=np.diff(cumulative,axis=0)/seconds
    # Packing creates tiny rounding differences; real resets are rejected.
    if np.nanmin(result[1:]) < -tolerance:raise ValueError('Onverwachte afname in cumulatief veld')
    result[1:]=np.maximum(result[1:],0)
    result[0]=np.where(np.isfinite(cumulative[0]),0,np.nan)
    return result


def write_bin(path, arrays):
    t,y,x=arrays[0].shape
    with path.open('wb') as f:
        f.write(struct.pack('<HHHH',y,x,t,len(arrays))+b'\x00'*8)
        for i in range(t):
            for a in arrays:f.write(a[i].astype('<f4').tobytes())


def build(run,raw,out,workers):
    jobs=[]
    for h in range(52):
        for package in ['SP1','SP2']:
            step=f'{h:02d}H';jobs.append((url_for(run,'001',package,step),raw/f'001-{package}-{step}.grib2'))
    for a,b in GROUPS:
        step=f'{a:02d}H{b:02d}H';jobs.append((url_for(run,'0025','SP1',step),raw/f'0025-SP1-{step}.grib2'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for i,path in enumerate(pool.map(download,jobs),1):
            if i%10==0 or i==len(jobs):print(f'Download {i}/{len(jobs)}: {path.name}',flush=True)
    shape=(52,len(LATS),len(LONS));fields={}
    def merge(decoded):
        for h,row in decoded.items():
            for key,value in row.items():
                if key not in fields:fields[key]=np.full(shape,np.nan,dtype='float32')
                fields[key][h]=value
    for h in range(52):
        for package in ['SP1','SP2']:merge(decode(raw/f'001-{package}-{h:02d}H.grib2',run,True,h))
        if h%6==0:print(f'HD verwerkt: +{h} uur',flush=True)
    for a,b in GROUPS:merge(decode(raw/f'0025-SP1-{a:02d}H{b:02d}H.grib2',run,False))
    needed=['temp','rv','u','v','gust_u','gust_v','cape','low','mid','high','rain_cumul','snow_cumul','graupel_cumul','druk','solar_cumul','radar']
    missing=set(needed)-fields.keys()
    if missing:raise ValueError(f'Velden ontbreken: {sorted(missing)}')
    # Accumulations start at zero by definition; +0 interval/cloud fields are not published.
    for key in ['rain_cumul','snow_cumul','graupel_cumul','solar_cumul']:
        fields[key][0] = np.where(np.isfinite(fields['temp'][0]) & np.isfinite(fields[key][1]),0,np.nan)
    # Export +1..+51 only: never fabricate missing initial cloud or gust fields.
    # All NL verification stations must have every forecast hour for the core fields.
    stations={'Vlissingen':(51.44,3.6),'De Bilt':(52.1,5.18),'Groningen':(53.13,6.58),'Maastricht':(50.91,5.77)}
    for city,(lat,lon) in stations.items():
        iy=int(np.argmin(abs(LATS-lat)));ix=int(np.argmin(abs(LONS-lon)))
        for key in needed:
            if not np.isfinite(fields[key][1:,iy,ix]).all():raise ValueError(f'{city}: onvolledig veld {key}')
    total=fields['rain_cumul']+fields['snow_cumul']+fields['graupel_cumul']
    precip=hourly_accumulation(total)
    # Native packed cumulative solar energy has sub-0.25 W/m² rounding differences.
    radiation=hourly_accumulation(fields['solar_cumul'],3600,tolerance=.25)
    td=dewpoint(fields['temp'],fields['rv'])
    gust=np.hypot(fields['gust_u'],fields['gust_v']).astype('float32')
    out.mkdir(parents=True,exist_ok=True)
    prefix='arome_native'
    specs={
        'temp':((fields['temp'],),'Temperatuur 2m (°C)','AROME HD 2t'),
        'rv':((fields['rv'],),'Relatieve vochtigheid 2m (%)','AROME HD 2r'),
        'dauwpunt':((td,),'Dauwpunt 2m (°C)','Magnus uit AROME HD temperatuur en relatieve vochtigheid'),
        'wind':((fields['u'],fields['v']),'Wind 10m','AROME HD 10u/10v'),
        'windstoten':((gust,np.where(np.isfinite(gust),0,np.nan).astype('float32')),'Windstoten afgelopen uur','AROME HD uurmaximum uit U_RAF/V_RAF'),
        'bewolking':((fields['high'],fields['mid'],fields['low']),'Bewolking hoog/midden/laag','AROME HD hcc/mcc/lcc'),
        'cape':((fields['cape'],),'CAPE (J/kg)','AROME HD CAPE_INS'),
        'neerslag':((precip,),'Uurlijkse neerslag (mm/u)','Verschil totale regen, sneeuw en graupel in water-equivalent'),
        'cumul':((total,),'Neerslagsom vanaf modelstart (mm)','AROME HD regen + sneeuw + graupel'),
        'radar':((fields['radar'],),'Modelreflectiviteit kolommaximum (dBZ)','AROME HD RFLCTVT_MAX; GRIB 0/16/193'),
        'druk':((fields['druk'],),'Luchtdruk zeeniveau (hPa)','AROME 2,5 km prmsl'),
        'straling':((radiation,),'Globale straling afgelopen uur (W/m²)','AROME 2,5 km ssrd, uurdifferentie / 3600'),
    }
    times=[(run+timedelta(hours=h)).astimezone(LOCAL).isoformat() for h in range(52)]
    cumulative_solar=np.full_like(radiation,np.nan);acc=None
    for h,stamp in enumerate(times):
        local=datetime.fromisoformat(stamp)
        if local.hour==0:
            acc=np.where(np.isfinite(radiation[h]),0,np.nan).astype('float32')
        elif acc is not None:
            acc=acc+radiation[h]
        if acc is not None:cumulative_solar[h]=acc
    specs['cumstraling']=((cumulative_solar,),'Straling dagsom (Wh/m², reset middernacht)','Som beschikbare uurstraling sinds lokale dagstart')
    params={}
    for key,(arrays,label,source) in specs.items():
        name=f'{prefix}_data_{key}.bin';write_bin(out/name,tuple(a[1:] for a in arrays))
        params[key]=dict(file=f'arome-native/{run:%Y%m%d%H}/{name}',components=len(arrays),label=label,source=source)
    now=datetime.now(LOCAL)
    meta=dict(model='AROME HD 1,3 km',run=run.astimezone(LOCAL).strftime('%d.%m.%Y %H:%M LT'),run_utc=run.isoformat().replace('+00:00','Z'),bijgewerkt=now.strftime('%d-%m-%Y %H:%M'),uren=51,tijden=times[1:],grid=GRID,parameters=params,overlay='harmonie_overlay.png',source='Météo-France, rechtstreeks uit open GRIB2-pakketten',attribution='Source: Météo-France — Licence Ouverte / Open Licence 2.0',native_resolution_km=1.3,export_grid_step_degrees=.02,source_checked_at=datetime.now(UTC).isoformat(),schema_version=1)
    # Numerical evidence for this exact dataset, kept alongside the external output.
    qa={}
    for key in ['temp','rv','cape','druk']:
        a=fields[key];qa[key]=dict(min=float(np.nanmin(a)),max=float(np.nanmax(a)),missing_percent=round(float(np.isnan(a).mean()*100),2))
    qa['precipitation_max_mm_per_hour']=float(np.nanmax(precip))
    qa['gust_max_ms']=float(np.nanmax(gust))
    qa['verified_stations']=list(stations)
    (out/'validation.json').write_text(json.dumps(qa,indent=2)+'\n')
    (out/f'{prefix}_canvas_meta.json').write_text(json.dumps(meta,indent=2,ensure_ascii=False)+'\n')
    print('Validatie:',json.dumps(qa),flush=True)
    return meta


def publish(out,meta):
    files=[p['file'] for p in meta['parameters'].values()]+['arome_native_canvas_meta.json']
    for name in files:
        content='application/json' if name.endswith('.json') else 'application/octet-stream'
        subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(out/Path(name).name),f'r2:weerlab-harmonie/{name}','--header-upload','Cache-Control: public, max-age=30','--header-upload',f'Content-Type: {content}','--no-traverse'],check=True)
        print('Gepubliceerd:',name,flush=True)


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--run');ap.add_argument('--root',type=Path,default=ROOT);ap.add_argument('--workers',type=int,default=3);ap.add_argument('--publish',action='store_true');args=ap.parse_args()
    assert_volume(args.root)
    lock=(args.root/'update.lock').open('w')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:print('AROME-update is al bezig');return 0
    run=choose_run(args.run);stamp=run.strftime('%Y%m%d%H');folder=args.root/'runs'/stamp;out=folder/'processed'
    state=args.root/'published.json'
    if args.publish and state.exists():
        previous=json.loads(state.read_text())
        if previous.get('run_utc','')>=run.strftime('%Y-%m-%dT%H:%M:%SZ'):
            print('Zelfde of nieuwere volledige AROME-run al gepubliceerd; geen download');return 0
    meta_path=out/'arome_native_canvas_meta.json'
    meta=json.loads(meta_path.read_text()) if meta_path.exists() else build(run,folder/'raw',out,max(1,min(args.workers,4)))
    if args.publish:
        publish(out,meta)
        temp=state.with_suffix('.tmp');temp.write_text(json.dumps(dict(run_utc=meta['run_utc'],published_at=datetime.now(UTC).isoformat(),folder=str(folder)),indent=2));temp.replace(state)
    print('Klaar:',meta['run_utc'],out,flush=True);return 0

if __name__=='__main__':raise SystemExit(main())
