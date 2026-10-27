#!/usr/bin/env python3
"""Direct DWD ICON Global maps and all 40 ICON-EPS members; no Open-Meteo fallback."""
import argparse,bz2,concurrent.futures,fcntl,json,plistlib,re,shutil,struct,subprocess,tempfile
from datetime import datetime,timedelta,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import eccodes as ec
import numpy as np
from scipy.spatial import cKDTree
import icond2_eps_native as stations_module
UTC=timezone.utc
ROOT=Path('/Volumes/WEERLAB/Modeldata/ICON-GLOBAL')
VOLUME='BBD67AB1-0A13-4865-B651-E9B8EF6AD337'
PARAMS={'t_2m':('temp','K'),'td_2m':('dew','K'),'relhum_2m':('rh','%'),'tot_prec':('rain','kg m**-2'),'u_10m':('u','m s**-1'),'v_10m':('v','m s**-1'),'vmax_10m':('gust','m s**-1'),'clct':('cloud','%')}
MAP_EXTRA={'clcl':('low','%'),'clcm':('mid','%'),'clch':('high','%'),'pmsl':('pressure','Pa'),'cape_ml':('cape','J kg**-1'),'aswdir_s':('direct','W m**-2'),'aswdifd_s':('diffuse','W m**-2')}
LAT=np.round(np.linspace(49,56,57),6);LON=np.round(np.linspace(.5,11.25,87),6)
def get(url):
 return subprocess.run(['curl','-fsSL','--retry','3','--retry-delay','2','--connect-timeout','15','--max-time','180',url],capture_output=True,check=True).stdout
def base(mode):return 'https://opendata.dwd.de/weather/nwp/'+('icon' if mode=='maps' else 'icon-eps')+'/grib'
def listing(mode,cycle,param):
 url=f'{base(mode)}/{cycle:02d}/{param}/';s=get(url).decode();return [url+n for n in re.findall(r'href="([^"/]+\.bz2)"',s)]
def run_of(url):return re.search(r'_(\d{10})_',url).group(1)
def hour_of(url):return int(re.search(r'_\d{10}_(\d{3})_',url).group(1))
def discover(mode,explicit):
 now=datetime.now(UTC)-timedelta(hours=4);candidate=now.replace(hour=now.hour//6*6,minute=0,second=0,microsecond=0)
 if explicit:candidate=datetime.fromisoformat(explicit.replace('Z','+00:00')).astimezone(UTC)
 for _ in range(4):
  urls=listing(mode,candidate.hour,'t_2m');stamp=candidate.strftime('%Y%m%d%H');urls=[u for u in urls if run_of(u)==stamp]
  steps=sorted(hour_of(u) for u in urls);last=180 if candidate.hour in [0,12] else 120
  if steps and steps[0]==0 and steps[-1]==last:return candidate,steps
  if explicit:break
  candidate-=timedelta(hours=6)
 raise RuntimeError('Geen volledige recente DWD-run beschikbaar')
def messages(raw):
 with tempfile.TemporaryFile() as f:
  f.write(bz2.decompress(raw));f.seek(0)
  while (g:=ec.codes_grib_new_from_file(f)) is not None:
   try:yield g
   finally:ec.codes_release(g)
def xyz(lat,lon):
 a,b=np.deg2rad(lat),np.deg2rad(lon);return np.column_stack([np.cos(a)*np.cos(b),np.cos(a)*np.sin(b),np.sin(a)])
def grid(mode,run,folder,points):
 p=folder/'grid.npz'
 if p.exists():
  a=np.load(p);return a['indices'],a['lat'],a['lon'],int(a['grid_id']),int(a['grid_size'])
 arrays=[];grid_id=None
 for param in ['clat','clon']:
  urls=[u for u in listing(mode,run.hour,param) if run_of(u)==run.strftime('%Y%m%d%H')]
  if len(urls)!=1:raise ValueError('Geen uniek DWD-coordinatenbestand')
  for g in messages(get(urls[0])):
   a=ec.codes_get_values(g);unit=ec.codes_get(g,'units').lower()
   if unit in ['rad','radian','radians']:a=np.rad2deg(a)
   elif 'degree' not in unit:raise ValueError('Onbekende coordinateneenheid')
   arrays.append(a);grid_id=int(ec.codes_get(g,'numberOfGridUsed'));break
 lat,lon=arrays;lon=(lon+180)%360-180
 tree=cKDTree(xyz(lat,lon));distance,idx=tree.query(xyz(points[:,0],points[:,1]))
 if np.max(distance)*6371>40:raise ValueError('Locatie te ver van DWD-rooster')
 np.savez(p,indices=idx,lat=lat[idx],lon=lon[idx],grid_id=grid_id,grid_size=len(lat));return idx,lat[idx],lon[idx],grid_id,len(lat)
def source_package(url,path):
 # DWD supports byte ranges. Small, validated chunks avoid losing a whole 60 MB
 # member package on a slow transfer; at most six packages remain on disk.
 headers=subprocess.run(['curl','-fsSI','--max-time','30',url],capture_output=True,text=True,check=True).stdout
 length=int(re.findall(r'(?im)^content-length:\s*(\d+)',headers)[-1]);etag=re.findall(r'(?im)^etag:\s*(.+)',headers)[-1].strip()
 signature=path.with_suffix('.source.json');identity={'url':url,'bytes':length,'etag':etag}
 if path.exists() and (not signature.exists() or json.loads(signature.read_text())!=identity):path.unlink()
 signature.write_text(json.dumps(identity));offset=path.stat().st_size if path.exists() else 0
 if offset>length:raise ValueError('Te groot tijdelijk DWD-bestand')
 while offset<length:
  end=min(length-1,offset+4*1024*1024-1);h=path.with_suffix('.headers');part=path.with_suffix('.chunk')
  subprocess.run(['curl','-fsSL','--retry','3','--retry-delay','2','--max-time','120','--range',f'{offset}-{end}','-H','If-Match: '+etag,'-D',str(h),'-o',str(part),url],check=True)
  response=h.read_text();expected=f'bytes {offset}-{end}/{length}'
  if not re.search(r'(?im)^content-range:\s*'+re.escape(expected)+r'\s*$',response) or part.stat().st_size!=end-offset+1:raise ValueError('DWD leverde een onjuiste byte-range')
  with path.open('ab') as f:f.write(part.read_bytes())
  part.unlink();h.unlink();offset=end+1
 return path.read_bytes()

def sample(job):
 mode,run,param,h,url,idx,grid_id,grid_size,folder=job
 p=folder/f'{param}-{h:03d}.npz'
 if p.exists():
  source=folder/f'{param}-{h:03d}.source.bz2'
  for extra in [source,source.with_suffix('.source.json'),source.with_suffix('.chunk'),source.with_suffix('.headers')]:extra.unlink(missing_ok=True)
  z=np.load(p);return h,z['values'],json.loads(str(z['metadata']))
 values={};member_errors={};info=None
 source=folder/f'{param}-{h:03d}.source.bz2'
 raw=source_package(url,source) if mode=='eps' else get(url)
 for g in messages(raw):
  if int(ec.codes_get(g,'dataDate'))!=int(run.strftime('%Y%m%d')) or int(ec.codes_get(g,'dataTime'))!=run.hour*100:raise ValueError('Verkeerde DWD-run')
  valid=datetime.strptime(str(ec.codes_get(g,'validityDate'))+f"{int(ec.codes_get(g,'validityTime')):04d}",'%Y%m%d%H%M').replace(tzinfo=UTC)
  if valid!=run+timedelta(hours=h):raise ValueError('Verkeerde DWD-geldigheid')
  if int(ec.codes_get(g,'numberOfGridUsed'))!=grid_id or int(ec.codes_get(g,'numberOfDataPoints'))!=grid_size:raise ValueError('DWD-rooster veranderd')
  expected={**PARAMS,**MAP_EXTRA}[param][1];unit=ec.codes_get(g,'units')
  if unit.replace('**','')!=expected.replace('**',''):raise ValueError(f'{param}: onverwachte eenheid {unit}')
  member=0 if mode=='maps' else int(ec.codes_get(g,'perturbationNumber'))
  if member in values:raise ValueError('Dubbel DWD-lid')
  a=np.asarray(ec.codes_get_double_elements(g,'values',idx.tolist()),dtype='float64')
  if not np.isfinite(a).all() or np.any(a==ec.codes_get(g,'missingValue')):raise ValueError('Ontbrekende DWD-bronwaarde')
  if expected=='K':a-=273.15
  values[member]=a
  start=ec.codes_get(g,'startStep');end=ec.codes_get(g,'endStep');unitstep=ec.codes_get(g,'stepUnits')
  def hour(v):return float(str(v).removesuffix('m'))/60 if str(v).endswith('m') or unitstep==0 else float(v)
  member_errors[member]=float(ec.codes_get(g,'packingError'))
  record={'start':hour(start),'end':hour(end),'kind':ec.codes_get(g,'stepType'),'error':float(ec.codes_get(g,'packingError'))}
  if info is not None and info['kind']!=record['kind']:raise ValueError('Gemengde DWD-statistiek')
  info=record
 ids=[0] if mode=='maps' else list(range(1,41))
 if sorted(values)!=ids:raise ValueError('DWD-leden ontbreken of onbekende leden')
 info['member_errors']=[member_errors[m] for m in ids]
 a=np.stack([values[m] for m in ids]);tmp=p.with_suffix('.tmp')
 with tmp.open('wb') as f:np.savez(f,values=a,metadata=json.dumps(info))
 tmp.replace(p);source.unlink(missing_ok=True);source.with_suffix('.source.json').unlink(missing_ok=True);print(f'{mode} {param} +{h:03d}: {len(ids)} leden',flush=True);return h,a,info
def interpolate(a,steps,hours):
 flat=a.reshape(len(steps),-1);out=np.stack([np.interp(hours,steps,flat[:,i]) for i in range(flat.shape[1])],axis=1)
 return out.reshape((len(hours),)+a.shape[1:])
def intervals(a,steps,meta,average=False):
 if any(m['start']!=0 or m['kind']!=('avg' if average else 'accum') for m in meta[1:]):raise ValueError('Geen accumulatie/gemiddelde vanaf runstart')
 totals=a*np.asarray(steps).reshape((-1,)+(1,)*(a.ndim-1)) if average else a.copy()
 errors=np.array([m.get('member_errors',[m.get('error',0)]*a.shape[1]) for m in meta],dtype=float)
 if average:totals[0]=0;errors*=np.asarray(steps)[:,None]
 if not average:
  # Find a monotone sequence inside one coarsest original GRIB packing quantum for each member/run.
  # A coarser final GRIB may round below earlier fine-packed totals; anchor
  # the exact final sum and bound every correction by that measured quantum.
  # Keep first and final published totals exact; reject inconsistent sources.
  e=np.broadcast_to(2*np.max(errors,axis=0,keepdims=True),errors.shape).reshape((len(steps),a.shape[1])+(1,)*(a.ndim-2));low=totals-e;high=totals+e
  low[0]=high[0]=totals[0];low[-1]=high[-1]=totals[-1]
  low=np.maximum.accumulate(low,axis=0);high=np.minimum.accumulate(high[::-1],axis=0)[::-1]
  if np.any(low>high+1e-9):raise ValueError('DWD-neerslagsom daalt buiten GRIB-precisie')
  fixed=np.maximum.accumulate(np.clip(totals,low,high),axis=0)
  if np.any(np.abs(fixed-totals)>e+1e-9):raise ValueError('DWD-neerslagcorrectie buiten GRIB-precisie')
  totals=fixed
 delta=np.diff(totals,axis=0);hours=np.arange(0,steps[-1]+1);cum=interpolate(totals,steps,hours);hour=np.concatenate([np.full_like(cum[:1],np.nan),np.diff(cum,axis=0)])
 for i,h in enumerate(steps[1:],1):
  bad=delta[i-1]<0
  if average and bad.any():
   # Negative radiation increments are unavailable, never fabricated as sunshine.
   hour[steps[i-1]+1:h+1]=np.where(bad,np.nan,hour[steps[i-1]+1:h+1])
  valid=~bad
  if not np.allclose(hour[steps[i-1]+1:h+1].sum(axis=0)[valid],delta[i-1][valid],atol=1e-7,rtol=1e-8):raise ValueError('DWD-intervaltotaal niet behouden')
 return hour,cum

def write_bin(path,frames):
 # Existing canvas header: ny, nx, nt, components and eight reserved bytes; then frame/component/row/column float32.
 a=np.stack(frames,axis=1).astype('<f4');nt,nc,ny,nx=a.shape
 with path.open('wb') as f:f.write(struct.pack('<HHHH',ny,nx,nt,nc)+b'\x00'*8);f.write(a.tobytes())
 return a

def maps(run,folder,data,steps):
 hours=np.arange(0,steps[-1]+1);out=folder/'published';out.mkdir(exist_ok=True);stamp=run.strftime('%Y%m%d%H');fields={}
 for k,(s,a,m) in data.items():fields[k]=interpolate(a[:,0],s,hours).reshape(len(hours),len(LAT),len(LON))
 rain,cum=intervals(data['rain'][1],data['rain'][0],data['rain'][2]);fields['rain']=rain[:,0].reshape(fields['temp'].shape);fields['cumul']=cum[:,0].reshape(fields['temp'].shape)
 for key in ['direct','diffuse']:
  s,a,m=data[key];hour,_=intervals(a,s,m,True);fields[key]=hour[:,0].reshape(fields['temp'].shape)
 specs={'temp':([fields['temp']],'Temperatuur 2 m (°C)'),'dauwpunt':([fields['dew']],'Dauwpunt (°C)'),'rv':([fields['rh']],'Relatieve vochtigheid (%)'),'neerslag':([fields['rain']],'Neerslag per uur (mm)'),'cumul':([fields['cumul']],'Neerslagsom vanaf run (mm)'),'wind':([fields['u'],fields['v']],'Wind 10 m (m/s)'),'windstoten':([fields['gust'],np.zeros_like(fields['gust'])],'Windstoten (m/s)'),'druk':([fields['pressure']],'Luchtdruk zeeniveau (Pa)'),'cape':([fields['cape']],'CAPE (J/kg)'),'bewolking':([fields['high']/100,fields['mid']/100,fields['low']/100],'Bewolking hoog/midden/laag'),'cloud_total':([fields['cloud']],'Totale bewolking (%)'),'straling':([fields['direct']+fields['diffuse']],'Globale straling (W/m²)'),'straling_direct':([fields['direct']],'Directe straling (W/m²)')}
 params={}
 for key,(arrays,label) in specs.items():
  name=f'icon_global_native_data_{key}.bin';a=write_bin(out/name,arrays);pointname=f'icon_global_native_points_{key}.bin'
  with (out/pointname).open('wb') as f:f.write(struct.pack('<HHHH',len(LAT),len(LON),len(hours),len(arrays))+b'\x00'*8);f.write(a.transpose(2,3,0,1).astype('<f4').tobytes())
  params[key]={'file':f'icon-global-native/{stamp}/{name}','point_file':f'icon-global-native/{stamp}/{pointname}','components':len(arrays),'label':label}
  if key in ['wind','windstoten']:params[key]['unit']='m/s'
  if key=='druk':params[key]['unit']='Pa'
 meta={'schema_version':1,'model':'ICON Global · DWD','source':'DWD Open Data direct','attribution':'DWD / Deutscher Wetterdienst','run_utc':run.isoformat().replace('+00:00','Z'),'run':run.astimezone(ZoneInfo('Europe/Amsterdam')).strftime('%d.%m.%Y %H:%M LT'),'uren':int(hours[-1]),'tijden':[(run+timedelta(hours=int(h))).isoformat() for h in hours],'grid':{'n_lat':len(LAT),'n_lon':len(LON),'lat_min':49.,'lat_max':56.,'lon_min':.5,'lon_max':11.25},'parameters':params,'native_steps_hours':steps,'hourly_interpolated':True,'accumulation_precision':'Monotone within one coarsest GRIB quantum per member/run; final total exact','radiation_negative_increments':'missing; never clipped to fake positive radiation','overlay':'harmonie_overlay.png'}
 (out/'meta.json').write_text(json.dumps(meta));return meta

def ensemble(run,folder,data,steps,grid,p):
 hours=np.arange(steps[-1]+1);out=folder/'published';out.mkdir(exist_ok=True);stamp=run.strftime('%Y%m%d%H');ids=list(range(1,41));arrays={}
 for k,(s,a,m) in data.items():
  if k=='rain':arrays[k]=intervals(a,s,m)[0]
  else:arrays[k]=interpolate(a,s,hours)
 speed=np.hypot(arrays['u'],arrays['v']);direction=(270-np.rad2deg(np.arctan2(arrays['v'],arrays['u'])))%360;direction[speed<1e-6]=np.nan
 fields={'temperature_2m':arrays['temp'],'dew_point_2m':arrays['dew'],'relative_humidity_2m':arrays['rh'],'precipitation':arrays['rain'],'cloud_cover':arrays['cloud'],'wind_speed_10m':speed*3.6,'wind_direction_10m':direction,'wind_gusts_10m':arrays['gust']*3.6}
 fields['wind_gusts_10m'][0]=np.nan;times=[(run+timedelta(hours=int(h))).isoformat().replace('+00:00','Z') for h in hours];stations=[]
 for i,q in enumerate(p):
  hourly={'time':times}
  for field,a in fields.items():
   for j,m in enumerate(ids):hourly[field+f'_member{m:02d}']=[float(v) if np.isfinite(v) else None for v in a[:,j,i]]
  doc={'model':'ICON Global EPS','source':'DWD Open Data direct','run_utc':times[0],'member_ids':ids,'control_member':None,'latitude':float(grid[1][i]),'longitude':float(grid[2][i]),'hourly':hourly,'units':{'temperature_2m':'°C','dew_point_2m':'°C','relative_humidity_2m':'%','cloud_cover':'%','precipitation':'mm','wind_speed_10m':'km/h','wind_direction_10m':'°','wind_gusts_10m':'km/h'}}
  (out/(q['id']+'.json')).write_text(json.dumps(doc,separators=(',',':'),allow_nan=False));stations.append({**q,'url':f'https://data.weerlab.nl/icon-global-eps/{stamp}/{q["id"]}.json'})
 meta={'schema':1,'complete':True,'model':'ICON Global EPS','source':'DWD Open Data direct','source_url':base('eps'),'run_utc':times[0],'run_key':stamp,'member_ids':ids,'member_count':40,'control_member':None,'steps':len(hours),'native_steps_hours':steps,'native_steps_by_field':{k:v[0] for k,v in data.items()},'accumulation_precision':'Within one coarsest original GRIB quantum per member/run; final total exact','hourly_interpolated':True,'fields':list(fields),'stations':stations,'updated_utc':datetime.now(UTC).isoformat()}
 (out/'manifest.json').write_text(json.dumps(meta,separators=(',',':')));return meta

def publish(mode,folder,run,meta):
 remote='r2:weerlab-harmonie' if mode=='maps' else 'r2:weerlab-data';prefix='icon-global-native' if mode=='maps' else 'icon-global-eps';filename='meta.json' if mode=='maps' else 'manifest.json';aliases=['icon_global_native_canvas_meta.json','icon_global_om_canvas_meta.json'] if mode=='maps' else ['icon_global_eps_manifest.json'];stamp=run.strftime('%Y%m%d%H')
 subprocess.run(['/opt/homebrew/bin/rclone','copy',str(folder/'published'),remote+'/'+prefix+'/'+stamp,'--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
 for alias in aliases:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(folder/'published'/filename),remote+'/'+alias,'--header-upload','Cache-Control: public, max-age=60'],check=True)
 state=folder.parent.parent/'published.json';tmp=state.with_suffix('.tmp');tmp.write_text(json.dumps(meta));tmp.replace(state)
 print(mode+' gepubliceerd '+stamp,flush=True)
def prune(mode,root,current):
 def old(names,n):return [s for s in sorted(names)[:-n] if s!=current and re.fullmatch(r'\d{10}',s)]
 for s in old([p.name for p in (root/'runs').iterdir() if p.is_dir()],8):shutil.rmtree(root/'runs'/s)
 remote='r2:weerlab-harmonie/icon-global-native' if mode=='maps' else 'r2:weerlab-data/icon-global-eps';r=subprocess.run(['/opt/homebrew/bin/rclone','lsf',remote,'--dirs-only'],capture_output=True,text=True,check=True)
 for s in old([s.strip('/') for s in r.stdout.splitlines()],2):subprocess.run(['/opt/homebrew/bin/rclone','purge',remote+'/'+s],check=True)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--mode',choices=['maps','eps'],required=True);ap.add_argument('--run');ap.add_argument('--publish',action='store_true');ap.add_argument('--prune',action='store_true');ap.add_argument('--workers',type=int,default=4);args=ap.parse_args()
 disk=plistlib.loads(subprocess.check_output(['/usr/sbin/diskutil','info','-plist','/Volumes/WEERLAB']))
 if disk.get('VolumeUUID')!=VOLUME:raise RuntimeError('Bedoelde schijf ontbreekt')
 root=ROOT/args.mode;root.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(root).free<10_000_000_000:raise RuntimeError('Onvoldoende tijdelijke ruimte')
 lock=(root/'update.lock').open('w')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 run,steps=discover(args.mode,args.run);stamp=run.strftime('%Y%m%d%H');state=root/'published.json'
 if state.exists() and json.loads(state.read_text())['run_utc']>=run.isoformat().replace('+00:00','Z'):
  print('Zelfde of nieuwere run reeds gepubliceerd')
  if args.prune:prune(args.mode,root,stamp)
  return
 folder=root/'runs'/stamp;folder.mkdir(parents=True,exist_ok=True);p=stations_module.points();lo,la=np.meshgrid(LON,LAT);points=np.column_stack([la.ravel(),lo.ravel()]) if args.mode=='maps' else np.array([[q['lat'],q['lon']] for q in p]);snapshot=folder/'points.json';identity={'coordinates':points.tolist(),'station_ids':[q['id'] for q in p] if args.mode=='eps' else None}
 if snapshot.exists() and json.loads(snapshot.read_text())!=identity:raise ValueError('Locatie-indeling gewijzigd; checkpoint mag niet worden hergebruikt')
 snapshot.write_text(json.dumps(identity));g=grid(args.mode,run,folder,points);data={};spec={**PARAMS,**MAP_EXTRA} if args.mode=='maps' else PARAMS
 for param,(key,unit) in spec.items():
  urls={hour_of(u):u for u in listing(args.mode,run.hour,param) if run_of(u)==stamp};wanted=([h for h in steps if h%6==0] if args.mode=='eps' and key=='rh' else steps) if key!='gust' else steps[1:]
  if any(h not in urls for h in wanted):raise RuntimeError(f'Onvolledige bron {param}')
  jobs=[(args.mode,run,param,h,urls[h],g[0],g[3],g[4],folder) for h in wanted]
  executor=concurrent.futures.ProcessPoolExecutor if args.mode=="eps" else concurrent.futures.ThreadPoolExecutor
  with executor(max_workers=min(args.workers,6)) as pool:result=list(pool.map(sample,jobs))
  times=[x[0] for x in result];a=np.stack([x[1] for x in result]);meta=[x[2] for x in result]
  if key=='gust':times=[0]+times;a=np.concatenate([np.full_like(a[:1],np.nan),a]);meta=[meta[0]]+meta
  data[key]=(times,a,meta)
 meta=maps(run,folder,data,steps) if args.mode=='maps' else ensemble(run,folder,data,steps,g,p)
 if args.publish:
  publish(args.mode,folder,run,meta)
  if args.prune:prune(args.mode,root,stamp)
if __name__=='__main__':main()
