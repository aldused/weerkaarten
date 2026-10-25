#!/usr/bin/env python3
"""Native DWD ICON-D2-EPS: preserve all 20 members; sample once, share locally/online."""
import argparse,bz2,concurrent.futures,fcntl,json,shutil,subprocess,tempfile
from datetime import datetime,timedelta,timezone
from pathlib import Path
import eccodes as ec
import numpy as np
from scipy.spatial import cKDTree
BASE='https://opendata.dwd.de/weather/nwp/icon-d2-eps/grib'
ROOT=Path('/Volumes/WEERLAB/Modeldata/ICON-D2-EPS')
REPO=Path('/Users/aldus/KNMI_Project/weerlab')
PARAMS={'t_2m':('temperature_2m','K'),'td_2m':('dew_point_2m','K'),'relhum_2m':('relative_humidity_2m','%'),'tot_prec':('precipitation','kg m**-2'),'u_10m':('_u','m s**-1'),'v_10m':('_v','m s**-1'),'vmax_10m':('wind_gusts_10m','m s**-1'),'clct':('cloud_cover','%'),'clcl':('cloud_cover_low','%'),'clcm':('cloud_cover_mid','%'),'clch':('cloud_cover_high','%'),'cape_ml':('cape','J kg**-1'),'vis':('visibility','m'),'lpi':('lightning_potential','J kg**-1')}
UTC=timezone.utc

def get(url):
 r=subprocess.run(['curl','-fsSL','--retry','4','--retry-delay','3','--connect-timeout','15','--max-time','180',url],capture_output=True,check=True);return r.stdout

def url(run,param,h=0):
 kind='time-invariant' if param in ('clat','clon') else 'single-level';level='0' if kind=='time-invariant' else '2d'
 return f'{BASE}/{run:%H}/{param}/icon-d2-eps_germany_icosahedral_{kind}_{run:%Y%m%d%H}_{h:03d}_{level}_{param}.grib2.bz2'

def choose():
 now=datetime.now(UTC)-timedelta(hours=2);run=now.replace(hour=now.hour//3*3,minute=0,second=0,microsecond=0)
 for _ in range(8):
  r=subprocess.run(['curl','-sS','-I','--max-time','20','-o','/dev/null','-w','%{http_code}',url(run,'t_2m',48)],capture_output=True,text=True)
  if r.returncode==0 and r.stdout.strip()=='200':return run
  run-=timedelta(hours=3)
 raise RuntimeError('Geen volledige recente ICON-D2-EPS-run')

def points():
 # Reuse only the station constant, without running legacy download code.
 import ast
 tree=ast.parse((REPO/'shell/pluim_trend_cache.py').read_text());stations=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='STATIONS' for t in n.targets))
 p=[dict(id=slug,name=name,lat=lat,lon=lon) for name,slug,lat,lon in stations]
 raster=json.loads(Path('/Users/aldus/KNMI_Project/pascal/raster.json').read_text())
 for province,coords in raster.items():
  for i,(lat,lon) in enumerate(coords):p.append(dict(id=f'pascal-{len(p)}',name=province,lat=lat,lon=lon,pascal=True))
 return p

def messages(raw):
 with tempfile.TemporaryFile() as f:
  f.write(bz2.decompress(raw));f.seek(0)
  while (g:=ec.codes_grib_new_from_file(f)) is not None:
   try:yield g
   finally:ec.codes_release(g)

def coords(run,p,folder):
 target=folder/'grid.npz'
 if target.exists():
  a=np.load(target);return a['indices'],a['lat'],a['lon']
 xy=[]
 for param in ('clat','clon'):
  for g in messages(get(url(run,param))):
   a=ec.codes_get_values(g);unit=ec.codes_get(g,'units').lower()
   if unit in ('rad','radian','radians'):a=np.rad2deg(a)
   elif 'degree' not in unit:raise ValueError('Onbekende coördinaateenheid '+unit)
   xy.append(a);break
 lat,lon=xy;lon=(lon+180)%360-180
 scale=np.cos(np.deg2rad(52));distance,idx=cKDTree(np.column_stack([lat,lon*scale])).query([[q['lat'],q['lon']*scale] for q in p])
 if np.max(distance)*111>10:raise ValueError('Locatie buiten eigen ICON-D2-rooster')
 np.savez(target,indices=idx,lat=lat[idx],lon=lon[idx]);return idx,lat[idx],lon[idx]

def sample(run,param,h,idx,folder):
 path=folder/f'{param}-{h:03d}.npz'
 if path.exists():
  z=np.load(path);return z['values'],float(z['error'])
 values={};errors=[]
 for g in messages(get(url(run,param,h))):
  valid=datetime.strptime(str(ec.codes_get(g,'validityDate'))+f"{int(ec.codes_get(g,'validityTime')):04d}",'%Y%m%d%H%M').replace(tzinfo=UTC)
  if valid!=run+timedelta(hours=h):continue  # DWD rain packages also contain quarter-hour records.
  member=int(ec.codes_get(g,'perturbationNumber'))
  if member in values or member not in range(1,21):raise ValueError('Verkeerd of dubbel lid')
  if int(ec.codes_get(g,'dataDate'))!=int(run.strftime('%Y%m%d')) or int(ec.codes_get(g,'dataTime'))!=run.hour*100:raise ValueError('Verkeerde modelrun')
  unit=ec.codes_get(g,'units');expected=PARAMS[param][1]
  if unit.replace('**','')!=expected.replace('**',''):raise ValueError(f'{param}: eenheid {unit}, verwacht {expected}')
  a=np.asarray(ec.codes_get_double_elements(g,'values',idx.tolist()),dtype='float64')
  if not np.isfinite(a).all() or np.any(a==ec.codes_get(g,'missingValue')):raise ValueError('Ontbrekende bronwaarden')
  if expected=='K':a-=273.15
  values[member]=a
  try:errors.append(float(ec.codes_get(g,'packingError')))
  except Exception:errors.append(0)
 if set(values)!=set(range(1,21)):raise ValueError('Niet alle20leden aanwezig')
 a=np.stack([values[i] for i in range(1,21)]);error=max(errors)
 tmp=path.with_suffix('.tmp')
 with tmp.open('wb') as f:np.savez(f,values=a,error=error)
 tmp.replace(path);print(f'{param} +{h:02d}: 20 leden gereed',flush=True);return a,error

def rain_hours(cumul,errors):
 delta=np.diff(cumul,axis=0);bound=np.asarray(errors[:-1])+np.asarray(errors[1:]);bad=delta < -bound[:,None,None]-1e-7
 if bad.any():raise ValueError('Cumulatieve neerslag daalt buiten bronprecisie')
 # Running maximum repairs only packing noise, then hourly differences conserve totals.
 fixed=np.maximum.accumulate(cumul,axis=0);result=np.concatenate([np.full_like(fixed[:1],np.nan),np.diff(fixed,axis=0)])
 return result

def publish(folder,run,p,grid,arrays):
 out=folder/'published';out.mkdir(exist_ok=True);stamp=run.strftime('%Y%m%d%H');times=[(run+timedelta(hours=h)).isoformat().replace('+00:00','Z') for h in range(49)]
 members=list(range(1,21));stations=[]
 for i,q in enumerate(p):
  fields={k:v[:,:,i].T.round(4).tolist() for k,v in arrays.items() if not k.startswith('_')}
  fields={k:[[float(x) if np.isfinite(x) else None for x in row] for row in v] for k,v in fields.items()}
  hourly={'time':times}
  for field,vals in fields.items():
   for m,row in zip(members,vals):hourly[f'{field}_member{m:02d}']=row
  d=dict(model='ICON-D2-EPS',source='DWD Open Data direct',run_utc=times[0],member_ids=members,control_member=None,latitude=float(grid[1][i]),longitude=float(grid[2][i]),hourly=hourly,units={'wind_speed_10m':'km/h','wind_gusts_10m':'km/h','wind_direction_10m':'°','precipitation':'mm','temperature_2m':'°C','dew_point_2m':'°C','visibility':'m','relative_humidity_2m':'%','cloud_cover':'%','cloud_cover_low':'%','cloud_cover_mid':'%','cloud_cover_high':'%','cape':'J/kg','lightning_potential':'J/kg'},station=q)
  path=out/(q['id']+'.json');path.write_text(json.dumps(d,separators=(',',':'),allow_nan=False))
  stations.append({**q,'url':f'https://data.weerlab.nl/icond2-eps/{stamp}/{q["id"]}.json'})
 manifest=dict(schema=1,complete=True,model='ICON-D2-EPS',source='DWD Open Data direct',source_url=BASE,run_utc=times[0],run_key=stamp,member_ids=members,member_count=20,control_member=None,steps=49,fields=sorted(k for k in arrays if not k.startswith('_')),stations=stations,updated_utc=datetime.now(UTC).isoformat(),precipitation_interval='preceding_hour; initial value missing',native_resolution_km=2.2)
 (out/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
 subprocess.run(['/opt/homebrew/bin/rclone','copy',str(out),f'r2:weerlab-data/icond2-eps/{stamp}','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
 subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(out/'manifest.json'),'r2:weerlab-data/icond2_eps_manifest.json','--header-upload','Cache-Control: public, max-age=60'],check=True)
 state=ROOT/'published.json';tmp=state.with_suffix('.tmp');tmp.write_text(json.dumps(manifest));tmp.replace(state)
 print('ICON-D2-EPS gepubliceerd: '+stamp,flush=True)

def prune(current):
 # This function is invoked only after successful publication and explicit approval.
 def old(names,keep):
  valid=sorted(n for n in names if len(n)==10 and n.isdigit())
  return [n for n in valid[:-keep] if n!=current]
 for name in old([p.name for p in (ROOT/'runs').iterdir() if p.is_dir()],8):
  shutil.rmtree(ROOT/'runs'/name)
 r=subprocess.run(['/opt/homebrew/bin/rclone','lsf','r2:weerlab-data/icond2-eps','--dirs-only'],capture_output=True,text=True,check=True)
 for name in old([n.strip('/') for n in r.stdout.splitlines()],2):
  subprocess.run(['/opt/homebrew/bin/rclone','purge','r2:weerlab-data/icond2-eps/'+name],check=True)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--run');ap.add_argument('--publish',action='store_true');ap.add_argument('--prune',action='store_true');ap.add_argument('--workers',type=int,default=3);args=ap.parse_args()
 import plistlib
 disk=plistlib.loads(subprocess.check_output(['/usr/sbin/diskutil','info','-plist','/Volumes/WEERLAB']))
 if disk.get('VolumeUUID')!='BBD67AB1-0A13-4865-B651-E9B8EF6AD337':raise RuntimeError('Bedoelde externe schijf ontbreekt')
 ROOT.mkdir(exist_ok=True)
 if shutil.disk_usage(ROOT).free<10_000_000_000:raise RuntimeError('Te weinig vrije ruimte voor tijdelijke bronverwerking')
 lock=(ROOT/'update.lock').open('w')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 pending=ROOT/'pending.json'
 if args.run:run=datetime.fromisoformat(args.run.replace('Z','+00:00'))
 elif pending.exists() and (datetime.now(UTC)-datetime.fromisoformat(json.loads(pending.read_text())['run_utc'])).total_seconds()<18*3600:
  run=datetime.fromisoformat(json.loads(pending.read_text())['run_utc'])
 else:run=choose()
 p=points();stamp=run.strftime('%Y%m%d%H');folder=ROOT/'runs'/stamp;folder.mkdir(parents=True,exist_ok=True)
 pending.write_text(json.dumps({'run_utc':run.isoformat()}))
 state=ROOT/'published.json'
 if state.exists() and json.loads(state.read_text())['run_key']>=stamp:
  print('Run reeds gepubliceerd')
  if args.prune:prune(json.loads(state.read_text())['run_key'])
  return
 snapshot=folder/'points.json'
 if snapshot.exists() and json.loads(snapshot.read_text())!=p:raise ValueError('Locatie-indeling gewijzigd; gebruik nieuwe cacheversie')
 snapshot.write_text(json.dumps(p));grid=coords(run,p,folder);arrays={};print(f'ICON-D2-EPS {stamp}: {len(p)} locaties, 20leden,49uurstappen',flush=True)
 for param,(field,unit) in PARAMS.items():
  with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:result=list(pool.map(lambda h:sample(run,param,h,grid[0],folder),range(49)))
  a=np.stack([x[0] for x in result])
  if field=='precipitation':a=rain_hours(a,[x[1] for x in result])
  arrays[field]=a
 arrays['wind_speed_10m']=np.hypot(arrays['_u'],arrays['_v'])*3.6;arrays['wind_direction_10m']=(270-np.rad2deg(np.arctan2(arrays['_v'],arrays['_u'])))%360;arrays['wind_gusts_10m']*=3.6;arrays['wind_gusts_10m'][0]=np.nan
 if args.publish:
  publish(folder,run,p,grid,arrays)
  pending.unlink(missing_ok=True)
  if args.prune:prune(stamp)
if __name__=='__main__':main()
