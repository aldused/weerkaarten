#!/usr/bin/env python3
"""Native NOAA GFS/GEFS. Indexed GRIB ranges, immutable sampled cache, no API tokens."""
import argparse,ast,concurrent.futures,fcntl,json,plistlib,re,shutil,struct,subprocess,tempfile,time
from pathlib import Path
from datetime import datetime,timedelta,timezone
from zoneinfo import ZoneInfo
import eccodes as ec
import numpy as np
from scipy.interpolate import interp1d
from arome_native_update import write_bin,old_runs,VOLUME_UUID
UTC=timezone.utc;LOCAL=ZoneInfo('Europe/Amsterdam');BASE=Path('/Volumes/WEERLAB/Modeldata/NOAA');LIVE=Path('/Users/aldus/KNMI_Project/weerlab')
# key: NOAA short name, exact index level. Never sum duplicate inventory messages.
SPECS={'temp':('TMP','2 m above ground'),'dew':('DPT','2 m above ground'),'rh':('RH','2 m above ground'),'u':('UGRD','10 m above ground'),'v':('VGRD','10 m above ground'),'gust':('GUST','surface'),'pressure':('PRMSL','mean sea level'),'rain':('APCP','surface'),'low':('LCDC','low cloud layer'),'mid':('MCDC','middle cloud layer'),'high':('HCDC','high cloud layer'),'cloud':('TCDC','entire atmosphere'),'cape':('CAPE','surface'),'visibility':('VIS','surface'),'solar':('DSWRF','surface')}
GEFS_KEYS=['temp','dew','rh','u','v','gust','pressure','rain','cloud','low','mid','high','visibility']
GFS_STEPS=list(range(0,121))+list(range(123,169,3));GEFS_STEPS=list(range(0,241,3))+list(range(246,385,6))

def http(url,byte_range=None):
 import urllib.request
 for attempt in range(5):
  try:
   req=urllib.request.Request(url,headers={'User-Agent':'Weerlab-native-NOAA/1.0',**({'Range':f'bytes={byte_range[0]}-{byte_range[1]}'} if byte_range else {})})
   with urllib.request.urlopen(req,timeout=120) as r:
    if byte_range and (r.status!=206 or r.headers.get('Content-Range','').split('/')[0]!=f'bytes {byte_range[0]}-{byte_range[1]}'):raise RuntimeError('NOAA range niet exact geleverd')
    data=r.read()
   if byte_range and len(data)!=byte_range[1]-byte_range[0]+1:raise RuntimeError('Onvolledige NOAA-range')
   return data
  except Exception:
   if attempt==4:raise
   time.sleep(2*(attempt+1))

def address(mode,run,h,member=0,secondary=False):
 if mode=='gfs':return f'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{run:%Y%m%d}/{run:%H}/atmos/gfs.t{run:%H}z.pgrb2.0p25.f{h:03d}'
 ident='c00' if member==0 else f'p{member:02d}'
 if h<=240 and not secondary:folder,part='pgrb2sp25','pgrb2s.0p25'
 else:folder,part=('pgrb2bp5','pgrb2b.0p50') if secondary else ('pgrb2ap5','pgrb2a.0p50')
 return f'https://noaa-gefs-pds.s3.amazonaws.com/gefs.{run:%Y%m%d}/{run:%H}/atmos/{folder}/ge{ident}.t{run:%H}z.{part}.f{h:03d}'

def choose(mode):
 run=(datetime.now(UTC)-timedelta(hours=5)).replace(minute=0,second=0,microsecond=0);run=run.replace(hour=run.hour//6*6)
 for _ in range(6):
  good=True
  for member in ([0] if mode=='gfs' else [0,30]):
   r=subprocess.run(['curl','-sS','-I','--max-time','20','-o','/dev/null','-w','%{http_code}',address(mode,run,168 if mode=='gfs' else 384,member)+'.idx'],capture_output=True,text=True)
   if r.returncode or r.stdout.strip()!='200':good=False;break
  if good:return run
  run-=timedelta(hours=6)
 raise RuntimeError('Geen volledige recente NOAA-run beschikbaar')

def inventory(text):
 rows=[]
 for line in text.splitlines():
  a=line.split(':')
  if len(a)>=6:rows.append(dict(offset=int(a[1]),param=a[3],level=a[4],detail=a[5]))
 for i,r in enumerate(rows[:-1]):r['end']=rows[i+1]['offset']-1
 return rows

def select(rows,keys,mode,h,secondary=False):
 result={}
 for key in keys:
  param,level=SPECS[key]
  if mode=='gefs' and key in ('low','mid','high'):param='TCDC'
  matches=[r for r in rows if r['param']==param and r['level']==level and 'end' in r]
  if key not in ('rain','solar'):
   instant=[r for r in matches if 'ave' not in r['detail'] and 'acc' not in r['detail']]
   if instant:matches=instant
  if matches:result[key]=matches[0]
  elif h==0 and key in ('rain','solar','cloud','low','mid','high'):continue
 return result

def groups(rows):
 out=[]
 for r in sorted(rows,key=lambda r:r['offset']):
  if out and r['offset']-out[-1][1]<32768:out[-1][1]=max(out[-1][1],r['end'])
  else:out.append([r['offset'],r['end']])
 return out

def sample_message(g,mode,points):
 ni,nj=int(ec.codes_get(g,'Ni')),int(ec.codes_get(g,'Nj'));lat0=float(ec.codes_get(g,'latitudeOfFirstGridPointInDegrees'));lon0=float(ec.codes_get(g,'longitudeOfFirstGridPointInDegrees'));dy=float(ec.codes_get(g,'jDirectionIncrementInDegrees'));dx=float(ec.codes_get(g,'iDirectionIncrementInDegrees'))
 if ec.codes_get(g,'jScansPositively') or ec.codes_get(g,'iScansNegatively') or ec.codes_get(g,'jPointsAreConsecutive'):raise ValueError('Onbekende NOAA-gridscan')
 if mode=='gfs':
  iy=np.where((lat0-np.arange(nj)*dy>=49-1e-6)&(lat0-np.arange(nj)*dy<=56+1e-6))[0][::-1];ix=np.where((lon0+np.arange(ni)*dx>=.5-1e-6)&(lon0+np.arange(ni)*dx<=11.3+1e-6))[0];idx=(iy[:,None]*ni+ix[None,:]).reshape(-1);shape=(len(iy),len(ix))
 else:
  yy=np.rint([(lat0-p['lat'])/dy for p in points]).astype(int);xx=np.rint([((p['lon']-lon0)%360)/dx for p in points]).astype(int)%ni
  if np.any((yy<0)|(yy>=nj)):raise ValueError('NOAA-punt buiten grid')
  idx=yy*ni+xx;shape=(len(points),)
 a=np.asarray(ec.codes_get_double_elements(g,'values',idx.tolist()),dtype='float64').reshape(shape)
 if not np.isfinite(a).all() or np.any(a==ec.codes_get(g,'missingValue')):raise ValueError('Ontbrekende NOAA-bronwaarde')
 return a,dx,(lat0-yy*dy if mode=='gefs' else None),(lon0+xx*dx if mode=='gefs' else None)

def get_step(mode,run,h,member,points,folder):
 target=folder/f'{member:02d}-{h:03d}.npz'
 if target.exists():
  z=np.load(target);return {k:z[k] for k in z.files}
 keys=list(SPECS) if mode=='gfs' else GEFS_KEYS;out={};meta={};resolution=None
 for secondary in ([False] if mode=='gfs' else [False,True]):
  needed=[k for k in keys if k not in out]
  if not needed:break
  url=address(mode,run,h,member,secondary);rows=inventory(http(url+'.idx').decode())
  if rows and any(SPECS[k]==(rows[-1]['param'],rows[-1]['level']) for k in needed):
   start=rows[-1]['offset'];header=http(url,(start,start+15))
   if header[:4]!=b'GRIB' or header[7]!=2:raise ValueError('Ongeldige laatste NOAA-boodschap')
   rows[-1]['end']=start+int.from_bytes(header[8:16],'big')-1
  selected=select(rows,needed,mode,h,secondary)
  by_offset={r['offset']:k for k,r in selected.items()}
  for start,end in groups(selected.values()):
   raw=http(url,(start,end))
   with tempfile.TemporaryFile() as f:
    f.write(raw);f.seek(0)
    while (g:=ec.codes_grib_new_from_file(f)) is not None:
     try:
      key=by_offset.get(start+ec.codes_get_message_offset(g))
      if key is None:continue
      valid=datetime.strptime(str(ec.codes_get(g,'validityDate'))+f"{int(ec.codes_get(g,'validityTime')):04d}",'%Y%m%d%H%M').replace(tzinfo=UTC)
      if valid!=run+timedelta(hours=h) or int(ec.codes_get(g,'dataDate'))!=int(run.strftime('%Y%m%d')) or int(ec.codes_get(g,'dataTime'))!=run.hour*100:raise ValueError('Verkeerde NOAA-run of termijn')
      if mode=='gefs':
       number=int(ec.codes_get(g,'perturbationNumber'))
       if number!=member:raise ValueError('Verkeerd GEFS-lid')
      a,step,gridlat,gridlon=sample_message(g,mode,points);
      if key=='temp' and mode=='gefs':out['_grid_latitude']=gridlat;out['_grid_longitude']=gridlon
      unit=ec.codes_get(g,'units');unit=unit.replace('**','')
      expected='K' if key in ('temp','dew') else '%' if key in ('rh','cloud','low','mid','high') else 'm s-1' if key in ('u','v','gust') else 'Pa' if key=='pressure' else 'kg m-2' if key=='rain' else 'W m-2' if key=='solar' else 'J kg-1' if key=='cape' else 'm'
      if unit!=expected:raise ValueError(f'{key}: eenheid {unit}, verwacht {expected}')
      if unit=='K':a-=273.15
      ec.codes_set(g,'stepUnits',1);begin=float(ec.codes_get(g,'startStep'));finish=float(ec.codes_get(g,'endStep'))
      out[key]=a
      try:error=float(ec.codes_get(g,'packingError'))
      except ec.KeyValueNotFoundError:error=(.5*2.**int(ec.codes_get(g,'binaryScaleFactor'))+abs(float(ec.codes_get(g,'referenceValue')))*2.**-23)*10.**(-int(ec.codes_get(g,'decimalScaleFactor')))
      meta[key]=[begin,finish,error]
      if resolution is None:resolution=step
     finally:ec.codes_release(g)
 # Forecast-zero interval fields may be absent. They remain missing, not fabricated zero.
 required=[k for k in keys if h or k not in ('rain','solar','cloud','low','mid','high')]
 missing=set(required)-set(out)
 if missing:raise ValueError('NOAA mist velden '+str(sorted(missing)))
 out['_metadata']=np.asarray(json.dumps(meta));out['_resolution']=np.asarray(resolution)
 tmp=target.with_suffix('.tmp')
 with tmp.open('wb') as f:np.savez_compressed(f,**out)
 tmp.replace(target);print(f'{mode} {run:%d/%H} lid{member:02d} +{h:03d} klaar',flush=True);return out

def intervals(values,windows,steps,average=False):
 """Disjoint amounts, repairing only packing noise while preserving each window total."""
 out=[np.full(values[1].shape,np.nan)];i=1
 while i<len(steps):
  start=windows[i][0];j=i+1
  while j<len(steps) and windows[j][0]==start:j+=1
  if start!=steps[i-1]:raise ValueError(f'NOAA-venster begint op {start}, verwacht {steps[i-1]}')
  amounts=[];errors=[]
  for k in range(i,j):
   begin,end,error=windows[k]
   if end!=steps[k] or end<=begin:raise ValueError('Onjuist NOAA-interval')
   scale=end-begin if average else 1;amounts.append(values[k]*scale);errors.append(error*scale*(2 if average else 1))  # NOAA running radiation means include upstream rounding; allow one full GRIB quantum.
  a=np.stack(amounts);e=np.asarray(errors)
  delta=np.diff(np.concatenate([np.zeros_like(a[:1]),a]),axis=0)
  bound=(e+np.r_[0,e[:-1]]).reshape((-1,)+(1,)*(a.ndim-1))
  if np.any(delta < -bound-1e-5):raise ValueError('NOAA-accumulatie daalt buiten bronprecisie')
  fixed=np.minimum(np.maximum.accumulate(a,axis=0),a[-1]);allowed=(e+np.max(e)).reshape((-1,)+(1,)*(a.ndim-1))
  if np.any(np.abs(fixed-a)>allowed+1e-5):raise ValueError('NOAA-venster past niet binnen bronprecisie')
  out.extend(np.diff(np.concatenate([np.zeros_like(fixed[:1]),fixed]),axis=0));i=j
 return np.stack(out)

def make_maps(run,folder,results):
 steps=np.asarray(GFS_STEPS);shape=results[0]['temp'].shape;fields={};meta=[json.loads(str(r['_metadata'])) for r in results]
 for key in SPECS:fields[key]=np.stack([r.get(key,np.full(shape,np.nan)) for r in results])
 rain=intervals(list(fields['rain']),[m.get('rain',[0,0,0]) for m in meta],steps)
 solar=intervals(list(fields['solar']),[m.get('solar',[0,0,0]) for m in meta],steps,True)
 hourly=np.arange(1,169)
 def inter(a):
  frames=[]
  for h in hourly:
   j=int(np.searchsorted(steps,h))
   if steps[j]==h:frames.append(a[j])
   else:
    f=(h-steps[j-1])/(steps[j]-steps[j-1]);frames.append(a[j-1]*(1-f)+a[j]*f)
  return np.asarray(frames,dtype='float32')
 cum=np.concatenate([np.zeros_like(rain[:1]),np.cumsum(rain[1:],axis=0)]);hourcum=inter(cum);hourrain=np.diff(np.concatenate([cum[:1],hourcum]),axis=0)
 sunshine=np.zeros((168,*shape),dtype='float32')
 for i,(a,b) in enumerate(zip(steps[:-1],steps[1:]),1):sunshine[a:b]=solar[i]/(b-a)
 specs={'temp':((inter(fields['temp']),),'Temperatuur 2 m (°C)'), 'dauwpunt':((inter(fields['dew']),),'Dauwpunt 2 m (°C)'), 'rv':((inter(fields['rh']),),'Relatieve vochtigheid (%)'),'wind':((inter(fields['u']),inter(fields['v'])),'Wind 10 m (m/s)'),'windstoten':((inter(fields['gust']),np.zeros((168,*shape),dtype='float32')),'Windstoten (m/s)'),'druk':((inter(fields['pressure']),),'Luchtdruk zeeniveau (Pa)'),'bewolking':((inter(fields['high'])/100,inter(fields['mid'])/100,inter(fields['low'])/100),'Bewolking hoog/midden/laag'),'cloud_total':((inter(fields['cloud']),),'Totale bewolking (%)'),'neerslag':((hourrain,),'Neerslag per uur (mm)'),'cumul':((hourcum,),'Neerslagsom vanaf run (mm)'),'cape':((inter(fields['cape']),),'CAPE (J/kg)'),'zicht':((inter(fields['visibility']),),'Zicht (m)'),'straling':((sunshine,),'Globale straling (W/m²)')}
 out=folder/'published';out.mkdir(exist_ok=True);params={};stamp=run.strftime('%Y%m%d%H')
 for key,(a,label) in specs.items():
  name=f'gfs_native_data_{key}.bin';write_bin(out/name,a);params[key]=dict(file=f'gfs-native/{stamp}/{name}',components=len(a),label=label)
  if key=='druk':params[key]['unit']='Pa'
  if key in ('wind','windstoten'):params[key]['unit']='m/s'
 d=dict(schema_version=1,model='GFS 0,25° · NOAA',run_utc=run.isoformat().replace('+00:00','Z'),run=run.astimezone(LOCAL).strftime('%d.%m.%Y %H:%M LT'),bijgewerkt=datetime.now(LOCAL).strftime('%d-%m-%Y %H:%M'),uren=168,tijden=[(run+timedelta(hours=int(h))).astimezone(LOCAL).isoformat() for h in hourly],grid=dict(n_lat=shape[0],n_lon=shape[1],lat_min=49.,lat_max=56.,lon_min=.5,lon_max=.5+(shape[1]-1)*.25),parameters=params,overlay='harmonie_overlay.png',source='NOAA GFS Open Data direct',native_resolution_degrees=.25,hourly_interpolated=True,native_steps_hours=GFS_STEPS)
 for key,info in params.items():
  source=out/Path(info['file']).name
  with source.open('rb') as f:header=f.read(16);data=np.frombuffer(f.read(),dtype='<f4').reshape(168,info['components'],*shape)
  name=f'gfs_native_points_{key}.bin'
  with (out/name).open('wb') as f:f.write(header);f.write(data.transpose(2,3,0,1).astype('<f4').tobytes())
  info['point_file']=f'gfs-native/{stamp}/{name}'
 d['point_layout']='lat,lon,time,component'
 (out/'meta.json').write_text(json.dumps(d));return out,d

def make_ensemble(run,folder,results,points):
 nt=len(GEFS_STEPS);n=len(points);fields={};rain=np.empty((nt,31,n))
 for member in range(31):
  rr=[results[(member,h)] for h in GEFS_STEPS];metadata=[json.loads(str(r['_metadata'])) for r in rr]
  for k in GEFS_KEYS:
   if k not in fields:fields[k]=np.full((nt,31,n),np.nan)
   fields[k][:,member]=np.stack([r.get(k,np.full(n,np.nan)) for r in rr])
  rain[:,member]=intervals(list(fields['rain'][:,member]),[m.get('rain',[0,0,0]) for m in metadata],GEFS_STEPS)
 arrays={'temperature_2m':fields['temp'],'dew_point_2m':fields['dew'],'relative_humidity_2m':fields['rh'],'pressure_msl':fields['pressure']/100,'wind_speed_10m':np.hypot(fields['u'],fields['v'])*3.6,'wind_direction_10m':(270-np.rad2deg(np.arctan2(fields['v'],fields['u'])))%360,'wind_gusts_10m':fields['gust']*3.6,'precipitation':rain,'cloud_cover':fields['cloud'],'cloud_cover_low':fields['low'],'cloud_cover_mid':fields['mid'],'cloud_cover_high':fields['high'],'visibility':fields['visibility']}
 arrays['wind_gusts_10m'][0]=np.nan
 times=[(run+timedelta(hours=h)).isoformat().replace('+00:00','Z') for h in GEFS_STEPS];stamp=run.strftime('%Y%m%d%H');out=folder/'published';out.mkdir(exist_ok=True);stations=[]
 for i,p in enumerate(points):
  hourly={'time':times}
  for field,a in arrays.items():
   for member in range(31):hourly[field if member==0 else f'{field}_member{member:02d}']=[round(float(v),4) if np.isfinite(v) else None for v in a[:,member,i]]
  d=dict(model='NOAA GEFS',source='NOAA Open Data direct',run_utc=times[0],member_ids=list(range(31)),control_member=0,latitude=float(results[(0,0)]['_grid_latitude'][i]),longitude=float(results[(0,0)]['_grid_longitude'][i]),grid_latitude_by_step=[float(results[(0,h)]['_grid_latitude'][i]) for h in GEFS_STEPS],grid_longitude_by_step=[float(results[(0,h)]['_grid_longitude'][i]) for h in GEFS_STEPS],hourly=hourly,units={'temperature_2m':'°C','dew_point_2m':'°C','relative_humidity_2m':'%','pressure_msl':'hPa','wind_speed_10m':'km/h','wind_gusts_10m':'km/h','wind_direction_10m':'°','precipitation':'mm','cloud_cover':'%','cloud_cover_low':'%','cloud_cover_mid':'%','cloud_cover_high':'%','visibility':'m'})
  (out/(p['id']+'.json')).write_text(json.dumps(d,separators=(',',':'),allow_nan=False));stations.append({**p,'url':f'https://data.weerlab.nl/gefs/{stamp}/{p["id"]}.json'})
 d=dict(schema=1,complete=True,model='NOAA GEFS',source='NOAA Open Data direct',run_utc=times[0],run_key=stamp,member_ids=list(range(31)),member_count=31,control_member=0,steps=nt,fields=sorted(arrays),stations=stations,native_steps_hours=GEFS_STEPS,resolution='0.25 degrees through +240h; 0.5 degrees thereafter; dew/gust/visibility 0.5 fallback if absent',updated_utc=datetime.now(UTC).isoformat())
 (out/'manifest.json').write_text(json.dumps(d,separators=(',',':')));return out,d

def upload(mode,out,meta):
 stamp=datetime.fromisoformat(meta['run_utc'].replace('Z','+00:00')).strftime('%Y%m%d%H')
 if mode=='gfs':
  remote='r2:weerlab-harmonie';prefix='gfs-native';latest=['gfs_native_canvas_meta.json','gfs_global_om_canvas_meta.json'];name='meta.json'
 else:remote='r2:weerlab-data';prefix='gefs';latest=['gefs_manifest.json'];name='manifest.json'
 subprocess.run(['/opt/homebrew/bin/rclone','copy',str(out),f'{remote}/{prefix}/{stamp}','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
 for alias in latest:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(out/name),f'{remote}/{alias}','--header-upload','Cache-Control: public, max-age=60'],check=True)
 state=BASE/mode/'published.json';tmp=state.with_suffix('.tmp');tmp.write_text(json.dumps(meta));tmp.replace(state);print(mode+' gepubliceerd '+stamp,flush=True)

def prune(mode,current):
 root=BASE/mode;remote='r2:weerlab-harmonie/gfs-native' if mode=='gfs' else 'r2:weerlab-data/gefs'
 for name in old_runs([p.name for p in (root/'runs').iterdir() if p.is_dir()],8,current):shutil.rmtree(root/'runs'/name)
 r=subprocess.run(['/opt/homebrew/bin/rclone','lsf',remote,'--dirs-only'],capture_output=True,text=True,check=True)
 for name in old_runs([p.strip('/') for p in r.stdout.splitlines()],2,current):subprocess.run(['/opt/homebrew/bin/rclone','purge',remote+'/'+name],check=True)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('mode',choices=['gfs','gefs']);ap.add_argument('--run');ap.add_argument('--publish',action='store_true');ap.add_argument('--prune',action='store_true');ap.add_argument('--workers',type=int,default=6);a=ap.parse_args()
 disk=plistlib.loads(subprocess.check_output(['/usr/sbin/diskutil','info','-plist','/Volumes/WEERLAB']))
 if disk.get('VolumeUUID')!=VOLUME_UUID:raise RuntimeError('Bedoelde externe schijf ontbreekt')
 root=BASE/a.mode;root.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(root).free<20_000_000_000:raise RuntimeError('Te weinig vrije schijfruimte')
 lock=(root/'update.lock').open('w')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 pending=root/'pending.json';state=root/'published.json'
 if a.run:run=datetime.fromisoformat(a.run.replace('Z','+00:00'))
 elif pending.exists() and (datetime.now(UTC)-datetime.fromisoformat(json.loads(pending.read_text())['run'])).total_seconds()<24*3600:run=datetime.fromisoformat(json.loads(pending.read_text())['run'])
 else:run=choose(a.mode)
 stamp=run.strftime('%Y%m%d%H')
 if state.exists() and json.loads(state.read_text())['run_utc']>=run.isoformat().replace('+00:00','Z'):print('NOAA-run reeds gepubliceerd');return
 pending.write_text(json.dumps({'run':run.isoformat()}));folder=root/'runs'/stamp;folder.mkdir(parents=True,exist_ok=True)
 import icond2_eps_native
 points=icond2_eps_native.points() if a.mode=='gefs' else []
 snapshot=folder/'points.json'
 if snapshot.exists() and json.loads(snapshot.read_text())!=points:raise ValueError('Locatievolgorde veranderd; cache niet hergebruikt')
 snapshot.write_text(json.dumps(points))
 steps=GFS_STEPS if a.mode=='gfs' else GEFS_STEPS;jobs=[(m,h) for m in (range(31) if a.mode=='gefs' else [0]) for h in steps];results={}
 print(f'{a.mode} {stamp}: {len(jobs)} snapshots voorbereiden',flush=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
  futures={pool.submit(get_step,a.mode,run,h,m,points,folder):(m,h) for m,h in jobs}
  for f in concurrent.futures.as_completed(futures):results[futures[f]]=f.result()
 out,meta=make_maps(run,folder,[results[(0,h)] for h in steps]) if a.mode=='gfs' else make_ensemble(run,folder,results,points)
 if a.publish:
  upload(a.mode,out,meta);pending.unlink(missing_ok=True)
  if a.prune:prune(a.mode,stamp)
if __name__=='__main__':main()
