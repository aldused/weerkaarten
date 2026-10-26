#!/usr/bin/env python3
"""UKV 2 km direct from the public Met Office ASDI bucket; no paid API."""
import argparse, concurrent.futures, fcntl, json, plistlib, shutil, subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import h5py
import numpy as np
from pyproj import CRS, Transformer
from scipy.interpolate import RegularGridInterpolator
from arome_native_update import write_bin, LATS, LONS, GRID, VOLUME_UUID, old_runs
ROOT=Path('/Volumes/WEERLAB/Modeldata/UKMO-UKV')
BASE='https://met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com/uk-deterministic-2km'
UTC=timezone.utc
LOCAL=ZoneInfo('Europe/Amsterdam')
# Output units match the existing four-panel binary reader.
FIELDS={
 'temp':('temperature_at_screen_level','K','Temperatuur op schermhoogte (°C)'),
 'rv':('relative_humidity_at_screen_level','1','Relatieve vochtigheid op schermhoogte (%)'),
 'dauwpunt':('temperature_of_dew_point_at_screen_level','K','Dauwpunt op schermhoogte (°C)'),
 'speed':('wind_speed_at_10m','m s-1','Wind 10m'),
 'direction':('wind_direction_at_10m','degrees','Windrichting 10m'),
 'windstoten':('wind_gust_at_10m_max-PT01H','m s-1','Windstoten: maximum afgelopen uur'),
 'low':('cloud_amount_of_low_cloud','1','Lage bewolking'),
 'mid':('cloud_amount_of_medium_cloud','1','Middelbare bewolking'),
 'high':('cloud_amount_of_high_cloud','1','Hoge bewolking'),
 'neerslag':('precipitation_accumulation-PT01H','m','Neerslag in het afgelopen uur (mm)'),
 'druk':('pressure_at_mean_sea_level','Pa','Luchtdruk op zeeniveau (hPa)'),
 'cape':('CAPE_surface','J kg-1','CAPE vanaf schermhoogte (J/kg)'),
 'zicht':('visibility_at_screen_level','m','Zicht op schermhoogte (m)'),
 'wolkenbasis':('height_AGL_at_cloud_base_where_cloud_cover_2p5_oktas','m','Wolkenbasis bij minstens 2,5 oktas (m)'),
}

def name(run,h,field):
 valid=run+timedelta(hours=h)
 return f'{valid:%Y%m%dT%H%MZ}-PT{h:04d}H00M-{field}.nc'

def url(run,h,field):return f'{BASE}/{run:%Y%m%dT%H%MZ}/{name(run,h,field)}'

def choose_run(explicit=None):
 if explicit:return datetime.fromisoformat(explicit.replace('Z','+00:00')).astimezone(UTC)
 # Use 00/06/12/18 UTC short runs: a consistent complete hourly +1..+54 window.
 now=datetime.now(UTC)-timedelta(hours=3)
 run=now.replace(hour=now.hour//6*6,minute=0,second=0,microsecond=0)
 for _ in range(8):
  ok=True
  for field in ['temperature_at_screen_level','precipitation_accumulation-PT01H','wind_gust_at_10m_max-PT01H']:
   p=subprocess.run(['curl','-sS','-I','--max-time','20','-o','/dev/null','-w','%{http_code}',url(run,54,field)],capture_output=True,text=True)
   if p.returncode or p.stdout.strip()!='200':ok=False;break
  if ok:return run
  run-=timedelta(hours=6)
 raise RuntimeError('Geen volledige recente UKV-run gevonden')

def assert_volume():
 info=plistlib.loads(subprocess.check_output(['diskutil','info','-plist','/Volumes/WEERLAB']))
 if info.get('VolumeUUID')!=VOLUME_UUID:raise RuntimeError('De bedoelde WEERLAB-schijf ontbreekt')
 ROOT.mkdir(parents=True,exist_ok=True)
 if shutil.disk_usage(ROOT).free<50_000_000_000:raise RuntimeError('Minder dan 50 GB vrij; update gestopt')

def download(job):
 address,path=job
 if path.exists() and h5py.is_hdf5(path):return
 temp=path.with_suffix('.part')
 subprocess.run(['curl','-fSsL','--connect-timeout','15','--max-time','180','--retry','3',address,'-o',str(temp)],check=True)
 if not h5py.is_hdf5(temp):raise ValueError('Ongeldig NetCDF-bestand')
 temp.replace(path)

def text(value):return value.decode() if isinstance(value,bytes) else str(value)

def read(path,unit,run,h,interval=False):
 with h5py.File(path) as f:
  if int(f['forecast_reference_time'][()])!=int(run.timestamp()) or int(f['time'][()])!=int((run+timedelta(hours=h)).timestamp()):raise ValueError('UKV modelrun/tijd wijkt af')
  if interval and not np.array_equal(f['forecast_period_bnds'][:],[(h-1)*3600,h*3600]):raise ValueError('Geen exact uurinterval')
  variables=[v for v in f.values() if isinstance(v,h5py.Dataset) and v.ndim==2 and 'grid_mapping' in v.attrs]
  if len(variables)!=1:raise ValueError('Onverwachte UKV-variabelen')
  v=variables[0]
  if text(v.attrs.get('units'))!=unit:raise ValueError(f'Onverwachte eenheid {v.attrs.get("units")}, verwacht {unit}')
  a=v[:].astype('float32')
  for key in ['_FillValue','missing_value']:
   if key in v.attrs:a[a==v.attrs[key]]=np.nan
  if not np.isfinite(a).any():raise ValueError('Leeg UKV-veld')
  return a

class Sampler:
 def __init__(self,path):
  with h5py.File(path) as f:
   attrs={k:(text(v) if isinstance(v,bytes) else np.asarray(v).item()) for k,v in f['lambert_azimuthal_equal_area'].attrs.items()}
   transform=Transformer.from_crs('EPSG:4326',CRS.from_cf(attrs),always_xy=True)
   lon,lat=np.meshgrid(LONS,LATS);xx,yy=transform.transform(lon,lat)
   self.points=np.stack([yy,xx],axis=-1)
   self.x=f['projection_x_coordinate'][:];self.y=f['projection_y_coordinate'][:]
 def sample(self,a,nearest=False):
  if a.shape!=(len(self.y),len(self.x)):raise ValueError('Afwijkend UKV-bronrooster')
  return RegularGridInterpolator((self.y,self.x),a,method='nearest' if nearest else 'linear',bounds_error=False,fill_value=np.nan)(self.points).astype('float32')

def wind_components(speed,direction):
 radians=np.deg2rad(direction)
 return -speed*np.sin(radians),-speed*np.cos(radians)

def solar_parameter(run,folder):
 # ASDI supplies instantaneous direct horizontal flux. Trapezoidal hourly
 # averages are estimates, not a native sunshine-duration observation.
 raw=folder/'raw';raw.mkdir(parents=True,exist_ok=True);out=folder/'processed';out.mkdir(exist_ok=True)
 field='radiation_flux_in_shortwave_direct_downward_at_surface'
 jobs=[(url(run,h,field),raw/name(run,h,field)) for h in range(55)]
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(download,jobs))
 sample=Sampler(jobs[0][1]);values=[sample.sample(read(p,'W m-2',run,h)) for h,(_,p) in enumerate(jobs)]
 hourly=np.maximum((np.stack(values[:-1])+np.stack(values[1:]))*.5,0).astype('float32')
 filename='ukv_native_data_straling_direct.bin';write_bin(out/filename,(hourly,))
 return dict(file=f'ukv-native/{run:%Y%m%d%H}/{filename}',components=1,label='Geschatte uurgemiddelde directe straling (W/m²)',source='Met Office UKV direct horizontal flux; trapezoidal average of hourly instantaneous values; Crown copyright, CC BY-SA 4.0')

def build(run,folder):
 raw=folder/'raw';raw.mkdir(parents=True,exist_ok=True);out=folder/'processed';out.mkdir(exist_ok=True)
 jobs=[(url(run,h,field),raw/name(run,h,field)) for h in range(1,55) for field,unit,label in FIELDS.values()]
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  for i,_ in enumerate(pool.map(download,jobs),1):
   if i%50==0 or i==len(jobs):print(f'UKV opgehaald: {i}/{len(jobs)}',flush=True)
 sample=Sampler(jobs[0][1]);fields={}
 for h in range(1,55):
  native={k:read(raw/name(run,h,field),unit,run,h,'PT01H' in field) for k,(field,unit,label) in FIELDS.items()}
  u,v=wind_components(native.pop('speed'),native.pop('direction'));native.update(u=u,v=v)
  for k,a in native.items():
   if k in ['temp','dauwpunt']:a=a-273.15
   if k=='neerslag':a=a*1000
   if k in ['low','mid','high']:a=np.clip(a,0,1)
   if k=='rv':a=np.clip(a*100,0,100)
   if k not in fields:fields[k]=np.full((54,len(LATS),len(LONS)),np.nan,dtype='float32')
   fields[k][h-1]=sample.sample(a,nearest=k=='neerslag')
  if h%6==0:print(f'UKV verwerkt: +{h} uur',flush=True)
 # Out-of-domain areas remain missing. Every hour at five NL stations is checked.
 stations={'Vlissingen':(51.44,3.6),'De Bilt':(52.1,5.18),'Groningen':(53.13,6.58),'Maastricht':(50.91,5.77),'Enschede':(52.22,6.9)}
 for city,(lat,lon) in stations.items():
  iy=np.argmin(abs(LATS-lat));ix=np.argmin(abs(LONS-lon))
  for k,a in fields.items():
   if k=='wolkenbasis':continue  # A valid clear-sky cloud-base value is missing, not zero.
   if not np.isfinite(a[:,iy,ix]).all():raise ValueError(f'{city}: onvolledig {k}')
 specs={k:((fields[k],),label,field) for k,(field,unit,label) in FIELDS.items() if k not in ['speed','direction','low','mid','high']}
 specs['wind']=((fields['u'],fields['v']),'Wind 10m','wind_speed_at_10m + wind_direction_at_10m')
 specs['windstoten']=((fields['windstoten'],np.where(np.isfinite(fields['windstoten']),0,np.nan).astype('float32')),FIELDS['windstoten'][2],FIELDS['windstoten'][0])
 specs['bewolking']=((fields['high'],fields['mid'],fields['low']),'Bewolking hoog/midden/laag','cloud_amount_of_high/medium/low_cloud')
 specs['cumul']=((np.cumsum(fields['neerslag'],axis=0),),'Neerslagsom vanaf modelstart (mm)','Som volledige uurneerslag vanaf +1 uur')
 params={}
 for k,(arrays,label,source) in specs.items():
  filename=f'ukv_native_data_{k}.bin';write_bin(out/filename,arrays)
  params[k]=dict(file=f'ukv-native/{run:%Y%m%d%H}/{filename}',components=len(arrays),label=label,source='Met Office UKV 2 km (Crown copyright; CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/; uitgesneden en omgeroosterd): '+source)
 params['straling_direct']=solar_parameter(run,folder)
 for k in ['temp','rv','dauwpunt']:params[k]['height_m']=1.5
 params['wolkenbasis']['kind']='ukv_cbh'
 meta=dict(model='Met Office UKV 2 km',run_utc=run.isoformat().replace('+00:00','Z'),run=run.astimezone(LOCAL).strftime('%d.%m.%Y %H:%M LT'),bijgewerkt=datetime.now(LOCAL).strftime('%d-%m-%Y %H:%M'),uren=54,tijden=[(run+timedelta(hours=h)).astimezone(LOCAL).isoformat() for h in range(1,55)],grid=GRID,parameters=params,overlay='harmonie_overlay.png',native_resolution_km=2,export_grid_step_degrees=.02,source='Met Office UKV, rechtstreeks via ASDI open data',attribution='British Crown copyright, Met Office; CC BY-SA 4.0',license='https://creativecommons.org/licenses/by-sa/4.0/',source_url='https://registry.opendata.aws/met-office-uk-deterministic/',schema_version=1)
 qa={k:dict(min=float(np.nanmin(a)),max=float(np.nanmax(a))) for k,a in fields.items()};qa['stations']=list(stations)
 (out/'validation.json').write_text(json.dumps(qa,indent=2))
 (out/'ukv_native_canvas_meta.json').write_text(json.dumps(meta,indent=2,ensure_ascii=False)+'\n')
 print('UKV validatie:',json.dumps(qa),flush=True)
 return out,meta

def publish(out,meta):
 for name in [p['file'] for p in meta['parameters'].values()]+['ukv_native_canvas_meta.json']:
  subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(out/Path(name).name),'r2:weerlab-harmonie/'+name,'--header-upload','Cache-Control: public, max-age=30','--header-upload','Content-Type: '+('application/json' if name.endswith('.json') else 'application/octet-stream'),'--no-traverse'],check=True)
  print('UKV gepubliceerd:',name,flush=True)


def cleanup(current):
 runs=ROOT/'runs'
 if runs.is_symlink() or not runs.resolve().is_relative_to(ROOT.resolve()):raise RuntimeError('Onveilige UKV-runmap')
 local={p.name:p for p in runs.iterdir() if p.is_dir() and not p.is_symlink()}
 for name in old_runs(local,8,current):shutil.rmtree(local[name]);print('Oude lokale UKV-run verwijderd:',name,flush=True)
 result=subprocess.run(['/opt/homebrew/bin/rclone','lsf','r2:weerlab-harmonie/ukv-native/','--dirs-only'],capture_output=True,text=True,check=True)
 for name in old_runs([x.removesuffix('/') for x in result.stdout.splitlines()],2,current):
  subprocess.run(['/opt/homebrew/bin/rclone','purge',f'r2:weerlab-harmonie/ukv-native/{name}/'],check=True)
  print('Oude online UKV-run verwijderd:',name,flush=True)

def cleanup_safely(current):
 try:cleanup(current)
 except Exception as exc:print('UKV-opruimfout:',exc,flush=True)


def main():
 parser=argparse.ArgumentParser();parser.add_argument('--run');parser.add_argument('--publish',action='store_true');args=parser.parse_args();assert_volume()
 lock=(ROOT/'update.lock').open('w')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:print('UKV is al bezig');return
 run=choose_run(args.run);folder=ROOT/'runs'/run.strftime('%Y%m%d%H');state=ROOT/'published.json'
 if args.publish and state.exists():
  previous=json.loads(state.read_text())['run_utc']
  if previous>=run.isoformat().replace('+00:00','Z'):
   cleanup_safely(datetime.fromisoformat(previous.replace('Z','+00:00')).strftime('%Y%m%d%H'));print('UKV-run is al gepubliceerd');return
 out=folder/'processed';mp=out/'ukv_native_canvas_meta.json'
 if mp.exists():meta=json.loads(mp.read_text())
 else:out,meta=build(run,folder)
 if args.publish:
  publish(out,meta);tmp=state.with_suffix('.tmp');tmp.write_text(json.dumps(dict(run_utc=meta['run_utc'],published_at=datetime.now(UTC).isoformat())));tmp.replace(state)
  cleanup_safely(run.strftime('%Y%m%d%H'))
 print('UKV klaar:',out,flush=True)
if __name__=='__main__':main()
