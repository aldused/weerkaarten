"""Exact-cycle native ECMWF input for the existing Netherlands chart renderers."""
import json,re,struct
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
import numpy as np
from datetime import datetime,timezone
ROOT=Path('/Volumes/WEERLAB/Modeldata/ECMWF/kaarten/runs')
FIELDS={'temperature_2m':('temp',0,1,'°C'),'pressure_msl':('druk',0,.01,'hPa'),'cloud_cover':('cloud_total',0,1,'%'),'precipitation':('neerslag',0,1,'mm'),'cape':('cape',0,1,'J/kg'),'temperature_850hPa':('temperature_850hPa',0,1,'°C'),'geopotential_height_500hPa':('geopotential_height_500hPa',0,1,'m')}

def source(run):
 stamp=run.strftime('%Y%m%d%H');path=ROOT/stamp/'processed/ecmwf_native_canvas_meta.json'
 if not path.exists():raise ValueError('Eigen exacte ECMWF-kaartbron ontbreekt: '+stamp)
 m=json.loads(path.read_text())
 if datetime.fromisoformat(m['run_utc'].replace('Z','+00:00'))!=run:raise ValueError('Eigen bronrun wijkt af')
 return path,m

def fetch_native(url):
 u=urlsplit(url);q=parse_qs(u.query);match=re.search(r'/data_run/(ecmwf_ifs(?:025)?)/(\d{4})/(\d\d)/(\d\d)/(\d\d)00Z/meta.json',u.path)
 if match:
  _,y,m,d,h=match.groups();run=datetime(int(y),int(m),int(d),int(h),tzinfo=timezone.utc);path,meta=source(run)
  return {'reference_time':run.isoformat(),'valid_times':[datetime.fromisoformat(t).astimezone(timezone.utc).isoformat() for t in meta['tijden']],'source':'ECMWF Open Data direct, own 0.1 degree archive','schema':3,'fields':sorted(meta['parameters'])}
 if u.path!='/v1/forecast' or q.get('models',[''])[0] not in ('ecmwf_ifs','ecmwf_ifs025'):return None
 run=datetime.fromisoformat(q['run'][0].replace('Z','+00:00'));run=run.replace(tzinfo=timezone.utc) if run.tzinfo is None else run
 path,m=source(run);base=path.parent;times=[datetime.fromisoformat(t).astimezone(timezone.utc).isoformat() for t in m['tijden']];nt=len(times)
 lats=np.array([float(v) for v in q['latitude'][0].split(',')]);lons=np.array([float(v) for v in q['longitude'][0].split(',')]);params=q['hourly'][0].split(',');cache={}
 import sys
 sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
 from wgt_native_data import bilinear
 def read(key):
  if key in cache:return cache[key]
  p=m['parameters'].get(key)
  if not p:raise ValueError('Eigen ECMWF-veld ontbreekt: '+key)
  g=p.get('grid',m['grid']);file=base/Path(p['file']).name
  with file.open('rb') as handle:ny,nx,steps,nc=struct.unpack('<4H',handle.read(8))
  if (ny,nx,steps,nc)!=(g['n_lat'],g['n_lon'],nt,p['components']):raise ValueError('Afwijkend raster '+key)
  a=np.memmap(file,dtype='<f4',mode='r',offset=16,shape=(nt,nc,ny,nx));cache[key]=[bilinear(a[:,c],g,lats,lons) for c in range(nc)];return cache[key]
 fields={};units={}
 for field in params:
  if field in FIELDS:
   key,c,factor,unit=FIELDS[field];values=read(key)[c]*factor
  elif field in ('wind_speed_10m','wind_direction_10m','wind_gusts_10m','wind_speed_300hPa','wind_direction_300hPa'):
   key='wind_300hPa' if '300hPa' in field else 'windstoten' if field=='wind_gusts_10m' else 'wind';u,v=read(key)
   values=(np.degrees(np.arctan2(-u,-v))+360)%360 if field.startswith('wind_direction') else np.hypot(u,v);unit='°' if field.startswith('wind_direction') else 'm/s'
  else:raise ValueError('Geen eigen ECMWF-veld voor '+field)
  if not np.isfinite(values).all():raise ValueError('Onvolledig eigen kaartveld '+field)
  fields[field]=values;units[field]=unit
 responses=[{'latitude':float(y),'longitude':float(x),'hourly':{'time':times,**{field:a[i].tolist() for field,a in fields.items()}},'hourly_units':units,'run_utc':run.isoformat(),'source':'ECMWF Open Data direct 0.1 degree, own archive'} for i,(y,x) in enumerate(zip(lats,lons))]
 return responses if len(responses)>1 else responses[0]
