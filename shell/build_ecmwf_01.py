"""Independent 0.1-degree ECMWF Europe charts; never relabel 0.25-degree data.

Uses the original IFS GRIB messages and existing chart renderers. Source and PNG
caches, locks and metadata are separate from the earlier 0.25-degree pipeline.
Only complete runs are exposed. Run alongside (not inside) the 0.25 producer.
"""
from __future__ import annotations
import argparse, concurrent.futures, datetime as dt, fcntl, importlib.util
import json, os, subprocess, sys
from pathlib import Path
import numpy as np
import eccodes as ec
REPO=Path('/Users/aldus/KNMI_Project/weerlab')
PROJECT=REPO.parent
sys.path[:0]=[str(PROJECT),str(REPO/'scripts'),str(REPO/'shell')]
import ecmwf_native_update as native
UTC=dt.timezone.utc
REV='ifs-0p1-europe-1'
FIELDS=['2t','msl','10u','10v','tp','tcc','mucape','10fg','t850','gh500','u300','v300','ptype']
LAYERS=['overview','t2m','t2m_grid','t850','z500','mslp_bft','gust','wind','jetstream','precip24','cape','precip_total']
# Preserve the existing Lambert projection, including its corners.
LAT=np.round(np.arange(18,84.001,.1)[::-1],5)
LON=np.round(np.arange(-62,86.001,.1),5)
UNITS={'2t':'K','msl':'Pa','10u':'m s**-1','10v':'m s**-1','tp':'m','tcc':'(0 - 1)','mucape':'J kg**-1','10fg':'m s**-1','t850':'K','gh500':'gpm','u300':'m s**-1','v300':'m s**-1','ptype':'(Code table 4.201)'}

def load_module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod

def source_path(run,h,p,folder):
 # Native NL exports retain whole original GRIB messages, safe to reuse here.
 existing=native.ROOT/'runs'/f'{run:%Y%m%d%H}'/'raw'/f'{h:03d}-{p}.grib2'
 if existing.exists():return existing
 raw=folder/'raw';raw.mkdir(parents=True,exist_ok=True)
 path=raw/f'{h:03d}-{p}.grib2'
 if path.exists():return path
 actual,level,group=native.EXTRA.get(p,(p,None,'sfc'))
 index=raw/f'{h:03d}-{group}.index'
 if not index.exists():native.curl(native.stem(run,h,group)+'.index',index)
 rows=[json.loads(line) for line in index.read_text().splitlines()]
 names=['10fg','10fg3','10fg6'] if p=='10fg' else [actual]
 choices=[r for r in rows if r['param'] in names and (level is None or str(r.get('levelist'))==str(level))]
 if len(choices)!=1:raise ValueError(f'Geen uniek 0,1°-veld {p} op +{h}')
 row=choices[0];native.fetch((native.stem(run,h,group)+'.grib2',path,row['_offset'],row['_length']))
 return path

def decode(path,run,h,p):
 with path.open('rb') as f:g=ec.codes_grib_new_from_file(f)
 try:
  actual,level,_=native.EXTRA.get(p,(p,None,'sfc'))
  name=ec.codes_get(g,'shortName')
  if p=='10fg':name={'10fg3':'10fg','10fg6':'10fg'}.get(name,name)
  if name!=actual or ec.codes_get(g,'dataType')!='fc' or ec.codes_get(g,'centre')!='ecmf':raise ValueError('Verkeerd model/veld')
  if int(ec.codes_get(g,'dataDate'))!=int(run.strftime('%Y%m%d')) or int(ec.codes_get(g,'dataTime'))!=run.hour*100 or int(ec.codes_get(g,'endStep'))!=h:raise ValueError('Gemengde run/tijd')
  if level is not None and int(ec.codes_get(g,'level'))!=level:raise ValueError('Verkeerd drukniveau')
  if ec.codes_get(g,'gridType')!='regular_ll' or (ec.codes_get(g,'Ni'),ec.codes_get(g,'Nj'))!=(3600,1801):raise ValueError('Geen oorspronkelijk 0,1°-rooster')
  if abs(ec.codes_get(g,'iDirectionIncrementInDegrees')-.1)>1e-6 or abs(ec.codes_get(g,'jDirectionIncrementInDegrees')-.1)>1e-6:raise ValueError('Verkeerde roosterafstand')
  if ec.codes_get(g,'iScansNegatively') or ec.codes_get(g,'jScansPositively') or ec.codes_get(g,'numberOfMissing'):raise ValueError('Afwijkend/onvolledig bronrooster')
  unit=ec.codes_get(g,'units')
  if unit!=UNITS[p]:raise ValueError(f'Verkeerde eenheid {p}: {unit}')
  start=int(ec.codes_get(g,'startStep'));kind=ec.codes_get(g,'stepType')
  if p=='tp' and (start!=0 or kind!='accum'):raise ValueError('Neerslag begint niet bij modelstart')
  if p=='10fg' and (kind!='max' or not 0<=start<h):raise ValueError('Geen windstootmaximum')
  if p not in ('tp','10fg') and kind!='instant':raise ValueError('Geen momentwaarde')
  y0=ec.codes_get(g,'latitudeOfFirstGridPointInDegrees');x0=ec.codes_get(g,'longitudeOfFirstGridPointInDegrees')
  iy=np.rint((y0-LAT)/.1).astype(int);ix=np.rint(((LON-x0)%360)/.1).astype(int)%3600
  a=ec.codes_get_values(g).reshape(1801,3600)[np.ix_(iy,ix)].astype('float32')
  if not np.isfinite(a).all():raise ValueError('Niet-eindige bronwaarden')
  return a,{'error':float(ec.codes_get(g,'packingError')),'start':start,'end':h,'units':unit}
 finally:ec.codes_release(g)

def field(run,h,p,folder):
 if h==0 and p=='tp':return np.zeros((len(LAT),len(LON)),dtype='float32'),{'error':0,'start':0,'end':0,'units':'m'}
 path=folder/'cells'/f'{h:03d}-{p}.npz'
 if path.exists():
  with np.load(path) as d:return d['values'],json.loads(str(d['info']))
 a,info=decode(source_path(run,h,p,folder),run,h,p)
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp.npz');np.savez_compressed(tmp,values=a,info=json.dumps(info));tmp.replace(path)
 return a,info

def rain_window(now,before,errors):
 delta=(now.astype('float64')-before)*1000
 allowed=sum(errors)*1000+1e-5
 if np.min(delta)<-allowed:raise ValueError('Dalende neerslag buiten de GRIB-pakprecisie')
 return np.maximum(delta,0).astype('float32')

def screen_versions(files):
 from PIL import Image
 for path in files.values():
  target=path.with_suffix('.webp')
  if target.exists():continue
  with Image.open(path) as image:
   image.thumbnail((1800,1800),Image.Resampling.LANCZOS)
   temp=target.with_suffix('.tmp.webp');image.save(temp,format='WEBP',quality=90,method=4);temp.replace(target)


def render_lead(job):
 run,h,folder,dest=job
 import build_wxbeta as charts
 # Project the regular mesh once, rather than every contour polygon.
 from cartopy.mpl.geoaxes import GeoAxes
 from functools import wraps
 for name in ('contourf','contour'):
  original=getattr(GeoAxes,name)
  if getattr(original,'_ifs01_fast',False):continue
  def fast_contour(self,*args,_original=original,**kwargs):
   if len(args)>=3 and np.ndim(args[0])==2 and np.ndim(args[1])==2 and kwargs.get('transform') is not None:kwargs.setdefault('transform_first',True)
   return _original(self,*args,**kwargs)
  fast_contour._ifs01_fast=True
  setattr(GeoAxes,name,fast_contour)
 # Same layout/palettes as 0.25; the source grid is actually different.
 for m in (charts.m_z500,charts.m_over,charts.m_t850,charts.m_t2m,charts.m_wind,charts.m_gust,charts.m_jet,charts.m_precip,charts.m_cape):m.MAP_EXTENT=charts.EU_EXTENT
 files={layer:dest/f'{layer}_{h:03d}.png' for layer in LAYERS if layer!='precip24' or h>=24}
 if all(p.exists() for p in files.values()):screen_versions(files);return h
 a={};info={}
 for p in FIELDS:a[p],info[p]=field(run,h,p,folder)
 prev=max(0,h-6);before,err=field(run,prev,'tp',folder)
 rate=rain_window(a['tp'],before,[info['tp']['error'],err['error']])/min(h,6)
 snow=np.isin(a['ptype'],[5,6,7,8]);rain=np.where(snow,0,rate);snow=np.where(snow,rate,0)
 valid=run+dt.timedelta(hours=h);base=(h,run.replace(tzinfo=None),valid.replace(tzinfo=None),LAT,LON)
 pressure=a['msl']/100;temp=a['2t']-273.15
 renderers={
  'overview':(charts.m_over.plot_chart,(pressure,temp,a['tcc'],rain,snow)),
  't2m':(charts.m_t2m.plot_chart,(pressure,temp)),
  't2m_grid':(charts.functools.partial(charts.m_t2m.plot_chart,grid=True),(pressure,temp)),
  't850':(charts.m_t850.plot_chart,(pressure,a['t850']-273.15)),
  'z500':(charts.m_z500.plot_chart,(pressure,a['gh500'])),
  'mslp_bft':(charts.functools.partial(charts.m_wind.plot_chart,pressure_bft=True),(pressure,a['10u'],a['10v'])),
  'gust':(charts.m_gust.plot_chart,(pressure,a['10fg'],(info['10fg']['start'],h))),
  'wind':(charts.m_wind.plot_chart,(pressure,a['10u'],a['10v'])),
  'jetstream':(charts.m_jet.plot_chart,(a['u300'],a['v300'])),
  'cape':(charts.m_cape.plot_chart,(pressure,a['mucape']))}
 if h>=24:
  before,err=field(run,h-24,'tp',folder)
  renderers['precip24']=(charts.m_precip.plot_chart,(rain_window(a['tp'],before,[info['tp']['error'],err['error']]),))
 from wxbeta_render import render_task
 for layer,(renderer,args) in renderers.items():
  render_task((charts.functools.partial(renderer,model='ECMWF IFS 0,1° · circa 9 km'),(*base,*args,str(files[layer]))))
 cumulative=load_module('cumulative_01',REPO/'shell/wxbeta_region/cumulative.py')
 cumulative.render(('ecmwf',run,h,'europe',LON,LAT,a['tp']*1000,'0,1° · circa 9 km',files['precip_total']))
 screen_versions(files)
 print(f'0,1° {run:%Y%m%d%H} +{h:03d}: {len(files)} kaarten gereed',flush=True)
 return h

def ready(run,lead):
 result=subprocess.run(['curl','-fSsI','--connect-timeout','10','--max-time','20',native.stem(run,lead)+'.index'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 return result.returncode==0

def publish(state,run,source,leads,dest):
 from PIL import Image
 folder=dest.name
 files={layer:[f'{folder}/{layer}_{h:03d}.png' for h in leads if layer!='precip24' or h>=24] for layer in LAYERS}
 for rels in files.values():
  for rel in rels:
   with Image.open(state/'maps'/rel) as image:image.verify()
   with Image.open((state/'maps'/rel).with_suffix('.webp')) as image:image.verify()
 subprocess.run(['/opt/homebrew/bin/rclone','copy',str(dest),f'r2:weerlab-data/wxbeta-01/{folder}','--transfers','8','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
 frames=[f for f in source['frames'] if f['lead'] in leads]
 display={k:[str(Path(f).with_suffix('.webp')) for f in v] for k,v in files.items()}
 entry={**source,'display_files':display,'renderer':REV,'resolution':'0,1° · circa 9 km','resolution_degrees':.1,'files':files,'base':'https://data.weerlab.nl/wxbeta-01/','frames':frames,'maxlead':leads[-1]}
 entry.pop('layers',None)
 # Precip24 begins at +24; preserve its exact frame/file alignment.
 entry['layers']={'precip24':{'frames':[f for f in frames if f['lead']>=24],'files':files['precip24'],'display_files':display['precip24']}}
 path=state/'current.json';meta=json.loads(path.read_text()) if path.exists() else {'base':entry['base'],'cycles':[],'runs':{}}
 cc=f'{run.hour:02d}';meta['runs'][cc]=entry;meta['cycles']=list(meta['runs']);meta['updated']=dt.datetime.now(UTC).isoformat()
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(meta));tmp.replace(path)
 subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(path),'r2:weerlab-data/wxbeta-01/current.json','--header-upload','Cache-Control: no-cache'],check=True)
 print(f'GEPUBLICEERD 0,1° {run:%Y%m%d%H}: {len(frames)} termijnen tot +{leads[-1]}',flush=True)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--state',type=Path,required=True);ap.add_argument('--cycles',nargs='+',default=['00','12','06','18']);ap.add_argument('--publish',action='store_true');ap.add_argument('--test-lead',type=int);ap.add_argument('--workers',type=int,default=2);args=ap.parse_args()
 args.state.mkdir(parents=True,exist_ok=True);lock=(args.state/'build.lock').open('a')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:print('0,1° bouw draait al',flush=True);return
 native.assert_volume()
 import urllib.request
 source=json.loads(subprocess.check_output(['/opt/homebrew/bin/rclone','cat','r2:weerlab-data/wxbeta_meta.json']))['data']['ecmwf']['runs']
 errors=[]
 for cc in args.cycles:
  if cc not in source:continue
  entry=source[cc];run=dt.datetime.fromisoformat(entry['run_utc']);leads=[f['lead'] for f in entry['frames']]
  dest=args.state/'maps'/f'{run:%Y%m%d%H}-{REV}'
  if not ready(run,leads[-1]):print(f'0,1° {run:%Y%m%d%H}: bron nog niet compleet; 0,25° blijft beschikbaar',flush=True);continue
  manifest=args.state/'current.json'
  if not args.test_lead and manifest.exists():
   old=json.loads(manifest.read_text()).get('runs',{}).get(cc,{})
   if old.get('run_utc')==entry['run_utc'] and old.get('renderer')==REV:continue
  dest.mkdir(parents=True,exist_ok=True);folder=args.state/'cache'/f'{run:%Y%m%d%H}'
  jobs=[(run,h,folder,dest) for h in ([args.test_lead] if args.test_lead else leads)]
  try:
   with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
    for _ in pool.map(render_lead,jobs):pass
   if args.publish and not args.test_lead:publish(args.state,run,entry,leads,dest)
  except Exception as e:errors.append(f'{cc}: {e}');print(errors[-1],flush=True)
 if errors:raise SystemExit('; '.join(errors))
if __name__=='__main__':main()
