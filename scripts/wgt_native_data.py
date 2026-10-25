"""Read pinned native model grids for WGT/TX; no Open-Meteo fallback."""
import json,shutil,struct
from datetime import datetime,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np
import pandas as pd
from ecmwf_native_update import assert_volume
ROOT=Path('/Volumes/WEERLAB/Modeldata/ECMWF/WGT-cache')
LIVE=Path('/Users/aldus/KNMI_Project/weerlab')
PINNED={}
SUPPORTED=('harmonie_nl','icon_d2','ecmwf_ifs','ecmwf_aifs')
FIELDS={'temperature_2m':('temp',0,1),'dew_point_2m':('dauwpunt',0,1),'relative_humidity_2m':('rv',0,1),'precipitation':('neerslag',0,1),'shortwave_radiation':('straling',0,1),'pressure_msl':('druk',0,.01),'snow_depth':('snow_depth',0,1),'surface_temperature':('surface_temperature',0,1),'temperature_925hPa':('temperature_925hPa',0,1),'temperature_850hPa':('temperature_850hPa',0,1),'cloud_cover':('cloud_total',0,1),'cloud_cover_high':('bewolking',0,100),'cloud_cover_mid':('bewolking',1,100),'cloud_cover_low':('bewolking',2,100)}

def times_utc(meta):
 """Resolve repeated local autumn hours by their UTC order, never drop an hour."""
 out=[];previous=datetime.fromisoformat(meta['run_utc'].replace('Z','+00:00'))
 for value in meta['tijden']:
  d=datetime.fromisoformat(value.replace('Z','+00:00'))
  if d.tzinfo is None:
   candidates=sorted({d.replace(tzinfo=ZoneInfo('Europe/Amsterdam'),fold=f).astimezone(timezone.utc) for f in [0,1]})
   d=next((c for c in candidates if c>previous),None)
   if d is None:raise ValueError('Niet-eenduidige lokale modeltijd')
  else:d=d.astimezone(timezone.utc)
  if out and d<=previous:raise ValueError('Niet-oplopende modeltijdas')
  out.append(d);previous=d
 return pd.DatetimeIndex(out)

def prepare(model,required_until=None):
 assert_volume()
 if model not in SUPPORTED:raise ValueError('Geen eigen actuele bron voor '+model)
 if model=='ecmwf_ifs':
  candidates=[]
  for p in Path('/Volumes/WEERLAB/Modeldata/ECMWF/kaarten/runs').glob('*/processed/ecmwf_native_canvas_meta.json'):
   m=json.loads(p.read_text())
   if m.get('schema_version')!=3:continue
   init=pd.Timestamp(m['run_utc']);age=(pd.Timestamp.now(tz='UTC')-init).total_seconds()/3600
   if age<=18:candidates.append((init,p,m))
  if not candidates:raise ValueError('Geen actuele eigen IFS-run')
  candidates.sort(reverse=True,key=lambda x:x[0]);cover=[c for c in candidates if required_until is None or times_utc(c[2])[-1]>=required_until]
  _,path,meta=(cover or candidates)[0];base=path.parent
 elif model=='ecmwf_aifs':
  from aifs_native_wgt import ensure
  path=ensure();meta=json.loads(path.read_text());base=path.parent
 else:
  name={'harmonie_nl':'harmonie_canvas_meta.json','icon_d2':'icond2_canvas_meta.json'}[model];source=LIVE/name;before=source.read_text();meta=json.loads(before)
  if not meta.get('run_utc'):raise ValueError('Eigen model mist echte run-initialisatie')
  base=ROOT/model/pd.Timestamp(meta['run_utc']).strftime('%Y%m%d%H');base.mkdir(parents=True,exist_ok=True);path=base/'meta.json'
  complete_snapshot=path.exists() and path.read_text()==before
  needed={'temp','dauwpunt','wind','windstoten','bewolking','straling','neerslag','rv','druk'}
  for key in needed&meta['parameters'].keys():
   item=meta['parameters'][key];dest=base/Path(item['file']).name
   if not complete_snapshot or not dest.exists():
    temp=dest.with_suffix('.part');shutil.copyfile(LIVE/item['file'],temp);temp.replace(dest)
  if source.read_text()!=before:raise ValueError('Modelrun wisselde tijdens het vastzetten van de invoer')
  temp=path.with_suffix('.tmp');temp.write_text(before);temp.replace(path)
  # Only the new disposable WGT snapshots are retained here, never model/back-up folders.
  from arome_native_update import old_runs
  for old in old_runs([p.name for p in base.parent.iterdir() if p.is_dir()],8,base.name):shutil.rmtree(base.parent/old)
 PINNED[model]=(base,meta)
 return {'last_run_initialisation_time':pd.Timestamp(meta['run_utc']).timestamp(),'last_run_availability_time':path.stat().st_mtime,'native_source':{'provider':meta.get('model',model),'access':'eigen modelbestanden','run_utc':meta['run_utc'],'resolution_km':meta.get('native_resolution_km',2.5 if model=='harmonie_nl' else 2.2),'hourly_interpolated':model.startswith('ecmwf'),'open_meteo_api_calls':0}}

def bilinear(a,grid,lats,lons):
 y=(np.asarray(lats)-grid['lat_min'])/(grid['lat_max']-grid['lat_min'])*(grid['n_lat']-1)
 x=(np.asarray(lons)-grid['lon_min'])/(grid['lon_max']-grid['lon_min'])*(grid['n_lon']-1)
 valid=(y>=0)&(y<=grid['n_lat']-1)&(x>=0)&(x<=grid['n_lon']-1)
 y=np.clip(y,0,grid['n_lat']-1);x=np.clip(x,0,grid['n_lon']-1);iy=np.minimum(y.astype(int),grid['n_lat']-2);ix=np.minimum(x.astype(int),grid['n_lon']-2);fy=y-iy;fx=x-ix
 v=(a[:,iy,ix]*(1-fx)*(1-fy)+a[:,iy+1,ix]*(1-fx)*fy+a[:,iy,ix+1]*fx*(1-fy)+a[:,iy+1,ix+1]*fx*fy).T
 v[~valid]=np.nan;return v

def decode_packed(a,info):
 if info.get('dtype')=='u8sqrt':
  scale=float(info.get('scale',10));power=float(info.get('power',2))
  if scale<=0 or power<=0:raise ValueError('Ongeldige neerslagcodering')
  return np.power(a.astype('float32')/scale,power)
 return a

def sample(model,lats,lons,t0,n_uur,variables):
 base,meta=PINNED[model];source_times=times_utc(meta);wanted=pd.date_range(t0,periods=n_uur+1,freq='1h');out={v:np.full((len(lats),len(wanted)),np.nan,dtype=np.float32) for v in variables};cache={}
 def read(key):
  if key in cache:return cache[key]
  p=meta['parameters'].get(key)
  if not p:return None
  file=base/Path(p['file']).name
  with file.open('rb') as f:ny,nx,nt,nc=struct.unpack('<4H',f.read(8))
  grid=p.get('grid',meta['grid']);packed=p.get('dtype')=='u8sqrt';size=1 if packed else 4
  if (ny,nx,nt,nc)!=(grid['n_lat'],grid['n_lon'],len(source_times),p['components']) or file.stat().st_size!=16+ny*nx*nt*nc*size:raise ValueError('Ongeldig modelbestand '+key)
  a=np.memmap(file,dtype='u1' if packed else '<f4',mode='r',offset=16,shape=(nt,nc,ny,nx));cache[key]=[bilinear(decode_packed(a[:,c],p),grid,lats,lons) for c in range(nc)];return cache[key]
 pos=wanted.get_indexer(source_times);keep=pos>=0
 for name in variables:
  value=None
  if name in FIELDS:
   key,c,factor=FIELDS[name];v=read(key)
   if v is not None:value=v[c]*factor
   elif name=='cloud_cover':
    clouds=read('bewolking')
    if clouds is not None:value=(1-np.prod([1-np.clip(a,0,1) for a in clouds],axis=0))*100
  elif name in ['wind_speed_10m','wind_direction_10m']:
   v=read('wind')
   if v is not None:value=np.hypot(*v) if name=='wind_speed_10m' else (np.degrees(np.arctan2(-v[0],-v[1]))+360)%360
  elif name=='wind_gusts_10m':
   v=read('windstoten')
   if v is not None:value=np.hypot(*v) if len(v)==2 else v[0]
  if value is not None:out[name][:,pos[keep]]=value[:,keep]
 return out,wanted
