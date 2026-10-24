#!/usr/bin/env python3
"""ECMWF IFS 0.1-degree official open data to the shared Weerlab canvas feed."""
import argparse,concurrent.futures,fcntl,json,plistlib,shutil,subprocess
from datetime import datetime,timedelta,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import eccodes as ec
import numpy as np
from arome_native_update import write_bin,VOLUME_UUID,old_runs
ROOT=Path('/Volumes/WEERLAB/Modeldata/ECMWF/kaarten')
BASE='https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com'
UTC=timezone.utc;LOCAL=ZoneInfo('Europe/Amsterdam')
EXTRA={'sot1':('sot',1,'sfc'),'t850':('t',850,'pl'),'t925':('t',925,'pl'),'gh500':('gh',500,'pl'),'u300':('u',300,'pl'),'v300':('v',300,'pl')}
PARAMS=['2t','2d','msl','10u','10v','tp','lcc','mcc','hcc','mucape','10fg','ssrd','tcc','skt','sd','rsn','sot1','t850','t925','gh500','u300','v300']
LAT=np.round(np.arange(49,56.001,.1),5);LON=np.round(np.arange(.5,11.301,.1),5)
GRID=dict(n_lat=len(LAT),n_lon=len(LON),lat_min=float(LAT[0]),lat_max=float(LAT[-1]),lon_min=float(LON[0]),lon_max=float(LON[-1]))
def stem(run,h,group='sfc'):return f'{BASE}/{run:%Y%m%d}/{run:%H}z/ifs/0p1/oper/{run:%Y%m%d%H}0000-{h}h-oper-fc-{group}'
def steps_for(run):return list(range(0,145,3))+(list(range(150,169,6)) if run.hour in [0,12] else [])
def curl(address,path,extra=()):subprocess.run(['curl','-fSsL','--connect-timeout','15','--max-time','180','--retry','6','--retry-delay','5',*extra,address,'-o',str(path)],check=True)
def choose(explicit):
 if explicit:return datetime.fromisoformat(explicit.replace('Z','+00:00')).astimezone(UTC)
 now=datetime.now(UTC)-timedelta(hours=7);run=now.replace(hour=now.hour//6*6,minute=0,second=0,microsecond=0)
 for _ in range(8):
  p=subprocess.run(['curl','-sS','-I','--max-time','20','-o','/dev/null','-w','%{http_code}',stem(run,steps_for(run)[-1])+'.index'],capture_output=True,text=True)
  if p.returncode==0 and p.stdout.strip()=='200':return run
  run-=timedelta(hours=6)
 raise RuntimeError('Geen complete ECMWF 0,1°-run gevonden')
def assert_volume():
 info=plistlib.loads(subprocess.check_output(['/usr/sbin/diskutil','info','-plist','/Volumes/WEERLAB']))
 if info.get('VolumeUUID')!=VOLUME_UUID:raise RuntimeError('De bedoelde WEERLAB-schijf ontbreekt')
 ROOT.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(ROOT).free<50_000_000_000:raise RuntimeError('Minder dan 50 GB vrij')
def fetch(job):
 address,path,offset,length=job
 if path.exists() and path.stat().st_size==length:return
 temp=path.with_suffix('.part');curl(address,temp,['-H',f'Range: bytes={offset}-{offset+length-1}'])
 if temp.stat().st_size!=length:raise RuntimeError('ECMWF byte-range heeft onjuiste lengte')
 with temp.open('rb') as f:
  if f.read(4)!=b'GRIB':raise RuntimeError('Geen GRIB')
  f.seek(-4,2)
  if f.read()!=b'7777':raise RuntimeError('Onvolledige GRIB')
 temp.replace(path)
def decode(path,run,h,param):
 with path.open('rb') as f:g=ec.codes_grib_new_from_file(f)
 try:
  if ({'10fg3':'10fg','10fg6':'10fg'}.get(ec.codes_get(g,'shortName'),ec.codes_get(g,'shortName')))!=EXTRA.get(param,(param,))[0] or int(ec.codes_get(g,'dataDate'))!=int(run.strftime('%Y%m%d')) or int(ec.codes_get(g,'dataTime'))!=run.hour*100 or int(ec.codes_get(g,'endStep'))!=h:raise ValueError('Verkeerde ECMWF-run/parameter/tijd')
  if (ec.codes_get(g,'Ni'),ec.codes_get(g,'Nj'))!=(3600,1801):raise ValueError('Geen 0,1° bronrooster')
  if ec.codes_get(g,'iScansNegatively') or ec.codes_get(g,'jScansPositively'):raise ValueError('Afwijkende scanrichting')
  a=ec.codes_get_values(g).reshape(1801,3600);a[a==ec.codes_get(g,'missingValue')]=np.nan
  lat0=ec.codes_get(g,'latitudeOfFirstGridPointInDegrees');lon0=ec.codes_get(g,'longitudeOfFirstGridPointInDegrees')
  if lon0>180:lon0-=360
  rows=np.rint((lat0-LAT)/.1).astype(int);cols=np.rint((LON-lon0)/.1).astype(int)
  data=a[np.ix_(rows,cols)].astype('float64' if param in ['tp','ssrd'] else 'float32')
  start=int(ec.codes_get(g,'startStep'));kind=ec.codes_get(g,'stepType')
  if param in ['tp','ssrd'] and (start!=0 or kind!='accum'):raise ValueError('Cumulatief veld start niet bij modelstart')
  if param=='10fg' and (kind!='max' or start>=h):raise ValueError('Geen officieel windstootmaximum')
  return data,dict(start=start,end=h,kind=kind,error=float(ec.codes_get(g,'packingError')),units=ec.codes_get(g,'units'))
 finally:ec.codes_release(g)
def deaccumulate(cumulative,errors,hours,factor=1,return_cumulative=False):
 values=cumulative.astype('float64')*factor;error=errors[:,None,None]*factor
 delta=np.diff(values,axis=0);allowed=error[1:]+error[:-1]+1e-5
 if np.any(delta < -allowed):raise ValueError('Cumulatief veld daalt sterker dan de bronprecisie toelaat')
 # Find a monotone series inside each GRIB's own precision interval.
 lower=np.maximum(values-error,0);upper=values+error
 lower[0]=upper[0]=values[0]
 lo=np.maximum.accumulate(lower,axis=0);hi=np.minimum.accumulate(upper[::-1],axis=0)[::-1]
 if np.any(lo>hi+1e-5):raise ValueError('Geen neerslag/energiesom binnen de bronprecisie mogelijk')
 # Keep the observed endpoint whenever physically feasible within all bounds.
 if np.all(lo[-1]<=values[-1]+1e-5):
  hi=np.minimum(hi,values[-1]);lo[-1]=hi[-1]=values[-1]
 fixed=np.maximum.accumulate(np.clip(values,lo,hi),axis=0)

 result=(np.maximum(np.diff(fixed,axis=0),0)/np.diff(hours)[:,None,None]).astype('float32')
 return (result,fixed) if return_cumulative else result
def build(run,folder):
 raw=folder/'raw';raw.mkdir(parents=True,exist_ok=True);out=folder/'processed';out.mkdir(exist_ok=True);steps=steps_for(run);jobs=[]
 for h in steps:
  groups={}
  needed=[p for p in PARAMS if p not in ['tp','ssrd','10fg']] if h==0 else PARAMS
  for param in needed:
   actual,level,group=EXTRA.get(param,(param,None,'sfc'))
   if group not in groups:
    index=raw/f'{h:03d}-{group}.index'
    if not index.exists():curl(stem(run,h,group)+'.index',index)
    groups[group]=[json.loads(line) for line in index.read_text().splitlines()]
   choices=[r for r in groups[group] if (r['param']==actual or (param=='10fg' and r['param'] in ['10fg3','10fg6'])) and (level is None or str(r.get('levelist'))==str(level))]
   if len(choices)!=1:raise ValueError(f'Geen uniek ECMWF-veld {param} op +{h}')
   row=choices[0];jobs.append((stem(run,h,group)+'.grib2',raw/f'{h:03d}-{param}.grib2',row['_offset'],row['_length']))
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  for i,_ in enumerate(pool.map(fetch,jobs),1):
   if i%40==0 or i==len(jobs):print(f'ECMWF opgehaald {i}/{len(jobs)}',flush=True)
 shape=(len(steps),len(LAT),len(LON));fields={k:np.full(shape,np.nan,dtype='float64' if k in ['tp','ssrd'] else 'float32') for k in PARAMS};errors={k:np.zeros(len(steps)) for k in ['tp','ssrd']};intervals={}
 for i,h in enumerate(steps):
  for param in ([p for p in PARAMS if p not in ['tp','ssrd','10fg']] if h==0 else PARAMS):
   a,info=decode(raw/f'{h:03d}-{param}.grib2',run,h,param);fields[param][i]=a
   if param in errors:errors[param][i]=info['error']
   if param=='10fg':intervals[h]=h-info['start']
  if i==0:
   for param in errors:fields[param][0]=np.where(np.isfinite(fields['2t'][0]),0,np.nan)
  if i%6==0:print(f'ECMWF verwerkt +{h} uur',flush=True)
 rain,rain_cumul=deaccumulate(fields['tp'],errors['tp'],np.array(steps),1000,True);solar=deaccumulate(fields['ssrd'],errors['ssrd'],np.array(steps),1/3600)
 # Interpolate momentary fields. Cumulative rain/energy are interpolated first,
 # so their hourly differences retain each complete native interval total.
 hourly=np.arange(1,steps[-1]+1)
 def interp(a,coordinates=steps):
  from scipy.interpolate import interp1d
  return interp1d(coordinates,a,axis=0,bounds_error=True)(hourly).astype('float32')
 hourly_cumul=interp(rain_cumul)
 hourly_rain=np.diff(np.concatenate([rain_cumul[:1],hourly_cumul.astype('float64')]),axis=0).astype('float32')
 hourly_solar=np.empty((len(hourly),len(LAT),len(LON)),dtype='float32')
 for i,(left,right) in enumerate(zip(steps[:-1],steps[1:])):hourly_solar[left:right]=solar[i]
 temp=interp(fields['2t'])-273.15;dew=interp(fields['2d'])-273.15
 rh=np.clip(100*np.exp(17.625*dew/(243.04+dew)-17.625*temp/(243.04+temp)),0,100).astype('float32')
 # There is no initial gust maximum: use +3 as an explicit estimate for +1/+2.
 gust=interp(np.concatenate([fields['10fg'][1:2],fields['10fg'][1:]],axis=0))
 specs={'temp':((temp,),'Temperatuur 2m (°C)','2t, tussenuren lineair geïnterpoleerd'),'dauwpunt':((dew,),'Dauwpunt 2m (°C)','2d, tussenuren lineair geïnterpoleerd'),'rv':((rh,),'Relatieve vochtigheid 2m (%)','Magnus uit geïnterpoleerde 2t en 2d'),'druk':((interp(fields['msl']),),'Luchtdruk zeeniveau (hPa)','msl, tussenuren geïnterpoleerd'),'wind':((interp(fields['10u']),interp(fields['10v'])),'Wind 10m','10u/10v, vectorieel geïnterpoleerd'),'windstoten':((gust,np.zeros_like(gust)),'Windstoten, berekende tussenuren','10fg, maxima op brontijden; tussenuren geïnterpoleerde schatting'),'bewolking':((interp(fields['hcc']),interp(fields['mcc']),interp(fields['lcc'])),'Bewolking hoog/midden/laag','hcc/mcc/lcc, tussenuren geïnterpoleerd'),'cape':((interp(fields['mucape']),),'CAPE meest onstabiele luchtpakket (J/kg)','mucape, tussenuren geïnterpoleerd'),'neerslag':((hourly_rain,),'Berekende uurneerslag (mm)','tp, 3-/6-uursommen gelijkmatig verdeeld; totale hoeveelheid behouden'),'cumul':((hourly_cumul,),'Neerslagsom vanaf modelstart (mm)','tp, som geïnterpoleerd binnen bronprecisie'),'straling':((hourly_solar,),'Berekende uurgemiddelde globale straling (W/m²)','ssrd, intervalgemiddelde; energiehoeveelheid behouden')}
 # Extra native fields serve all existing NL map/frost-model consumers.
 specs.update({'cloud_total':((interp(fields['tcc'])*100,),'Totale bewolking (%)','tcc'),'surface_temperature':((interp(fields['skt'])-273.15,),'Oppervlaktetemperatuur (°C)','skt'),'soil_temperature':((interp(fields['sot1'])-273.15,),'Bodemtemperatuur 0–7 cm (°C)','sot laag 1'),'temperature_850hPa':((interp(fields['t850'])-273.15,),'Temperatuur 850 hPa (°C)','t op 850 hPa'),'temperature_925hPa':((interp(fields['t925'])-273.15,),'Temperatuur 925 hPa (°C)','t op 925 hPa'),'geopotential_height_500hPa':((interp(fields['gh500']),),'Geopotentiële hoogte 500 hPa (m)','gh op 500 hPa'),'wind_300hPa':((interp(fields['u300']),interp(fields['v300'])),'Wind 300 hPa (m/s)','u/v op 300 hPa')})
 snow=np.divide(fields['sd']*1000,fields['rsn'],out=np.zeros_like(fields['sd']),where=fields['rsn']>0)
 specs['snow_depth']=((interp(snow),),'Sneeuwdikte (m)','sd water-equivalent / rsn sneeuw­dichtheid')
 params={}
 for key,(arrays,label,source) in specs.items():
  for a in arrays:
   if not np.isfinite(a).all():raise ValueError(f'Ontbrekende waarden {key}')
  filename=f'ecmwf_native_data_{key}.bin';write_bin(out/filename,arrays)
  params[key]=dict(file=f'ecmwf-native/{run:%Y%m%d%H}/{filename}',components=len(arrays),label=label,source='ECMWF IFS 0,1° (CC-BY-4.0), rechtstreeks: '+source)
 for p in params.values():p['interpolation']='hourly_from_native_3h_6h'
 params['neerslag']['source_interval_hours']=np.diff(steps).tolist();params['windstoten']['source_interval_hours']=[intervals[h] for h in steps[1:]]
 qa={key:dict(min=float(np.nanmin(v[0][0])),max=float(np.nanmax(v[0][0]))) for key,v in specs.items()}
 meta=dict(model='ECMWF IFS 9 km',run_utc=run.isoformat().replace('+00:00','Z'),run=run.astimezone(LOCAL).strftime('%d.%m.%Y %H:%M LT'),bijgewerkt=datetime.now(LOCAL).strftime('%d-%m-%Y %H:%M'),uren=steps[-1],tijden=[(run+timedelta(hours=int(h))).astimezone(LOCAL).isoformat() for h in hourly],grid=GRID,parameters=params,overlay='harmonie_overlay.png',source='ECMWF Open Data direct via AWS',attribution='© ECMWF 2026, CC-BY-4.0',native_resolution_km=9,export_grid_step_degrees=.1,native_steps_hours=steps[1:],hourly_interpolated=True,schema_version=3)
 (out/'validation.json').write_text(json.dumps(qa,indent=2));(out/'ecmwf_native_canvas_meta.json').write_text(json.dumps(meta,indent=2,ensure_ascii=False)+'\n');print('ECMWF validatie:',json.dumps(qa),flush=True);return out,meta

def point_files(out,meta):
 for key,info in meta['parameters'].items():
  path=out/Path(info['file']).name
  with path.open('rb') as f:header=f.read(16);a=np.frombuffer(f.read(),dtype='<f4')
  nlat,nlon=meta['grid']['n_lat'],meta['grid']['n_lon'];nt=len(meta['tijden']);nc=info['components']
  a=a.reshape(nt,nc,nlat,nlon).transpose(2,3,0,1)
  filename=f'ecmwf_native_points_{key}.bin'
  with (out/filename).open('wb') as f:f.write(header);f.write(a.astype('<f4').tobytes())
  info['point_file']=str(Path(info['file']).parent/filename)
 meta['point_layout']='lat,lon,time,component'
 (out/'ecmwf_native_canvas_meta.json').write_text(json.dumps(meta,indent=2,ensure_ascii=False)+'\n')

def publish(out,meta):
 stamp=datetime.fromisoformat(meta['run_utc'].replace('Z','+00:00')).strftime('%Y%m%d%H')
 meta_name=f'ecmwf-native/{stamp}/meta.json'
 point_files(out,meta)
 files=[(out/Path(p[k]).name,p[k]) for p in meta['parameters'].values() for k in ['file','point_file']]
 files += [(out/'ecmwf_native_canvas_meta.json',meta_name),(out/'ecmwf_native_canvas_meta.json','ecmwf_native_canvas_meta.json'),(out/'ecmwf_native_canvas_meta.json','ecmwf_om_canvas_meta.json')]
 for path,name in files:
  subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(path),'r2:weerlab-harmonie/'+name,'--header-upload','Cache-Control: public, max-age=30','--header-upload','Content-Type: '+('application/json' if name.endswith('.json') else 'application/octet-stream'),'--no-traverse'],check=True)
  print('ECMWF gepubliceerd:',name,flush=True)
 manifest=ROOT/'ecmwf_native_runs.json'
 old=json.loads(manifest.read_text())['runs'] if manifest.exists() else []
 runs=[r for r in old if r['run_utc']!=meta['run_utc']]+[dict(run_utc=meta['run_utc'],meta=meta_name,maxlead=meta['uren'])]
 document=dict(model='ECMWF IFS 9 km',latest=meta['run_utc'],runs=sorted(runs,key=lambda r:r['run_utc'],reverse=True)[:2])
 manifest.write_text(json.dumps(document,indent=2))
 subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(manifest),'r2:weerlab-harmonie/ecmwf_native_runs.json','--header-upload','Cache-Control: public, max-age=30','--header-upload','Content-Type: application/json'],check=True)

def cleanup(current):
 runs=ROOT/'runs'
 if runs.is_symlink():raise RuntimeError('Onveilige runmap')
 for name in old_runs([p.name for p in runs.iterdir() if p.is_dir() and not p.is_symlink()],8,current):shutil.rmtree(runs/name)
 r=subprocess.run(['/opt/homebrew/bin/rclone','lsf','r2:weerlab-harmonie/ecmwf-native/','--dirs-only'],capture_output=True,text=True,check=True)
 for name in old_runs([s.removesuffix('/') for s in r.stdout.splitlines()],2,current):subprocess.run(['/opt/homebrew/bin/rclone','purge',f'r2:weerlab-harmonie/ecmwf-native/{name}/'],check=True)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--run');parser.add_argument('--publish',action='store_true');parser.add_argument('--republish',action='store_true');args=parser.parse_args();assert_volume();lock=(ROOT/'update.lock').open('w')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:print('ECMWF is al bezig');return
 run=choose(args.run);folder=ROOT/'runs'/run.strftime('%Y%m%d%H');state=ROOT/'published.json'
 out=folder/'processed';mp=out/'ecmwf_native_canvas_meta.json'
 if args.publish and not args.republish and state.exists() and json.loads(state.read_text())['run_utc']>=run.isoformat().replace('+00:00','Z') and mp.exists() and json.loads(mp.read_text()).get('schema_version')==3:print('ECMWF-run al gepubliceerd');return
 if mp.exists() and json.loads(mp.read_text()).get('schema_version')==3:meta=json.loads(mp.read_text())
 else:out,meta=build(run,folder)
 if args.publish:
  if 'wolkenbasis' not in meta['parameters']:
   try:
    from ecmwf_cloud_height import update
    alias=out/'ecmwf_om_canvas_meta.json';alias.write_text(json.dumps(meta))
    update(out,upload=False)
    meta=json.loads(alias.read_text())
    info=meta['parameters']['wolkenbasis'];info['file']=f'ecmwf-native/{run:%Y%m%d%H}/'+Path(info['file']).name
    mp.write_text(json.dumps(meta,indent=2,ensure_ascii=False)+'\n')
   except Exception as exc:print('ECMWF wolkenbasis tijdelijk niet aangevuld:',exc,flush=True)
  publish(out,meta);tmp=state.with_suffix('.tmp');tmp.write_text(json.dumps(dict(run_utc=meta['run_utc'],published_at=datetime.now(UTC).isoformat())));tmp.replace(state)
  try:cleanup(run.strftime('%Y%m%d%H'))
  except Exception as exc:print('ECMWF-opruimfout:',exc,flush=True)
 print('ECMWF klaar:',out,flush=True)
if __name__=='__main__':main()
