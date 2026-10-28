"""Publish genuine ECMWF 0.25/0.1 regular grids for the interactive Europe map.

Independent from OM services. Packets contain normalised physical units and
native cumulative tp/sf; immutable gzip files are reused across map viewports.
"""
from __future__ import annotations
import argparse,concurrent.futures,datetime as dt,fcntl,gzip,importlib.util,json,struct,subprocess,sys
from pathlib import Path
import numpy as np
import eccodes as ec
REPO=Path('/Users/aldus/KNMI_Project/weerlab');PROJECT=REPO.parent
sys.path[:0]=[str(REPO/'scripts'),str(REPO/'shell')]
import ecmwf_native_update as native
UTC=dt.timezone.utc;REV='direct-1';BOUNDS=[-26,29,46,73]
PARAMS=['2t','2d','msl','10u','10v','tp','sf','lcc','mcc','hcc','tcc','mucape','10fg','t850','t500']
EXTRA={**native.EXTRA,'t500':('t',500,'pl')}
UNITS={'2t':'K','2d':'K','msl':'Pa','10u':'m s**-1','10v':'m s**-1','tp':'m','sf':'m of water equivalent','lcc':'(0 - 1)','mcc':'(0 - 1)','hcc':'(0 - 1)','tcc':'(0 - 1)','mucape':'J kg**-1','10fg':'m s**-1','t850':'K','t500':'K'}
VARS=['temperature_2m','dew_point_2m','pressure_msl','cloud_cover','wind_u_component_10m','wind_gusts_10m','precipitation','snowfall_water_equivalent','precipitation_total','snowfall_total','temperature_850hPa','temperature_500hPa','cape']
def axes(res):
 step=.1 if res=='0p1' else .25
 return np.round(np.arange(BOUNDS[1],BOUNDS[3]+step/2,step),6),np.round(np.arange(BOUNDS[0],BOUNDS[2]+step/2,step),6)
def stem(run,h,res,group):
 suffix='-'+group if res=='0p1' else ''
 return f'{native.BASE}/{run:%Y%m%d}/{run:%H}z/ifs/{res}/oper/{run:%Y%m%d%H}0000-{h}h-oper-fc{suffix}'
def catalogue(run,folder):
 output={}
 parent=Path('/Users/aldus/Library/Application Support/Weerlab/wxbeta-northsea/cache')
 paths=list(parent.glob(f'{run:%Y%m%d%H}-elements-*/*.grib2'))+list((PROJECT/'grib_cache').glob('wx_*.grib2'))
 for path in paths:
  before=path.stat()
  with path.open('rb') as f:
   first=True
   while (g:=ec.codes_grib_new_from_file(f)) is not None:
    try:
     actual=dt.datetime.strptime(str(ec.codes_get(g,'dataDate'))+str(ec.codes_get(g,'dataTime')).zfill(4),'%Y%m%d%H%M').replace(tzinfo=UTC)
     if first and actual!=run:break
     first=False
     if actual!=run or ec.codes_get(g,'dataType')!='fc' or ec.codes_get(g,'Ni')!=1440:continue
     name=ec.codes_get(g,'shortName');h=int(ec.codes_get(g,'endStep'));level=int(ec.codes_get(g,'level'))
     for p in PARAMS:
      short,wanted,_=EXTRA.get(p,(p,None,'sfc'))
      if (name==short or p=='10fg' and name in ('10fg3','10fg6')) and (wanted is None or wanted==level):output[f'{h}:{p}']=[str(path),int(ec.codes_get_message_offset(g)),before.st_mtime_ns]
    finally:ec.codes_release(g)
  if path.stat().st_mtime_ns!=before.st_mtime_ns:raise ValueError('Bron wijzigde tijdens indexeren')
 folder.mkdir(parents=True,exist_ok=True);(folder/'catalogue.json').write_text(json.dumps(output));print('Hergebruik',len(output),'bestaande 0,25°-velden',flush=True)

def source(run,h,p,res,folder):
 if res=='0p25' and (folder/'catalogue.json').exists():
  match=json.loads((folder/'catalogue.json').read_text()).get(f'{h}:{p}')
  if match and Path(match[0]).stat().st_mtime_ns==match[2]:return Path(match[0]),match[1]
 if res=='0p1':
  existing=native.ROOT/'runs'/f'{run:%Y%m%d%H}'/'raw'/f'{h:03d}-{p}.grib2'
  if existing.exists():return existing,0
 raw=folder/'raw';raw.mkdir(parents=True,exist_ok=True);path=raw/f'{h:03d}-{p}.grib2'
 if path.exists():return path,0
 actual,level,group=EXTRA.get(p,(p,None,'sfc'));index=raw/f'{h:03d}-{group if res=="0p1" else "all"}.index'
 if not index.exists():native.curl(stem(run,h,res,group)+'.index',index)
 rows=[json.loads(line) for line in index.read_text().splitlines()];names=['10fg','10fg3','10fg6'] if p=='10fg' else [actual]
 choices=[r for r in rows if r['param'] in names and (level is None or str(r.get('levelist'))==str(level))]
 if len(choices)!=1:raise ValueError(f'Geen uniek {res} {p} +{h}')
 r=choices[0];native.fetch((stem(run,h,res,group)+'.grib2',path,r['_offset'],r['_length']));return path,0

def decode(path,offset,run,h,p,res):
 with path.open('rb') as f:f.seek(offset);g=ec.codes_grib_new_from_file(f)
 try:
  actual,level,_=EXTRA.get(p,(p,None,'sfc'));name=ec.codes_get(g,'shortName')
  if p=='10fg':name={'10fg3':'10fg','10fg6':'10fg'}.get(name,name)
  if name!=actual or ec.codes_get(g,'dataType')!='fc' or ec.codes_get(g,'centre')!='ecmf':raise ValueError('Verkeerd model/veld')
  if int(ec.codes_get(g,'dataDate'))!=int(run.strftime('%Y%m%d')) or int(ec.codes_get(g,'dataTime'))!=run.hour*100 or int(ec.codes_get(g,'endStep'))!=h:raise ValueError('Verkeerde run/tijd')
  if level is not None and int(ec.codes_get(g,'level'))!=level:raise ValueError('Verkeerd drukvlak')
  ni,nj=ec.codes_get(g,'Ni'),ec.codes_get(g,'Nj');step=.1 if res=='0p1' else .25
  if (ni,nj)!=((3600,1801) if res=='0p1' else (1440,721)) or ec.codes_get(g,'gridType')!='regular_ll' or abs(ec.codes_get(g,'iDirectionIncrementInDegrees')-step)>1e-6:raise ValueError('Verkeerde bronresolutie')
  if ec.codes_get(g,'numberOfMissing') or ec.codes_get(g,'iScansNegatively') or ec.codes_get(g,'jScansPositively'):raise ValueError('Onvolledig/afwijkend rooster')
  unit=ec.codes_get(g,'units')
  if unit!=UNITS[p]:raise ValueError(f'Verkeerde eenheid {p}: {unit}')
  start=int(ec.codes_get(g,'startStep'));kind=ec.codes_get(g,'stepType')
  if p in ('tp','sf') and (start!=0 or kind!='accum'):raise ValueError('Geen echte modelrun-accumulatie')
  if p=='10fg' and (kind!='max' or not 0<=start<h):raise ValueError('Geen windstootmaximum')
  if p not in ('tp','sf','10fg') and kind!='instant':raise ValueError('Geen momentwaarde')
  lat,lon=axes(res);y0=ec.codes_get(g,'latitudeOfFirstGridPointInDegrees');x0=ec.codes_get(g,'longitudeOfFirstGridPointInDegrees')
  iy=np.rint((y0-lat)/step).astype(int);ix=np.rint(((lon-x0)%360)/step).astype(int)%ni
  values=ec.codes_get_values(g).reshape(nj,ni)[np.ix_(iy,ix)].astype('float32')
  if not np.isfinite(values).all():raise ValueError('Niet-eindige bron')
  return values,{'error':float(ec.codes_get(g,'packingError')),'start':start,'end':h,'units':unit}
 finally:ec.codes_release(g)

def field(run,h,p,res,folder):
 lat,lon=axes(res)
 if h==0 and p in ('tp','sf'):return np.zeros((len(lat),len(lon)),dtype='float32'),{'error':0,'start':0,'end':0,'units':'m'}
 cells=folder/'cells';cells.mkdir(parents=True,exist_ok=True);path=cells/f'{h:03d}-{p}.npz'
 with path.with_suffix('.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  if path.exists():
   with np.load(path) as d:return d['values'],json.loads(str(d['info']))
  cached=Path('/Volumes/WEERLAB/Modeldata/ECMWF/europa-01/cache')/f'{run:%Y%m%d%H}'/'cells'/f'{h:03d}-{p}.npz'
  if res=='0p1' and cached.exists():
   with np.load(cached) as d:
    iy=np.rint((84-lat)/.1).astype(int);ix=np.rint((lon+62)/.1).astype(int);a=d['values'][np.ix_(iy,ix)];info=json.loads(str(d['info']))
  else:a,info=decode(*source(run,h,p,res,folder),run,h,p,res)
  temp=path.with_suffix('.tmp.npz');np.savez_compressed(temp,values=a,info=json.dumps(info));temp.replace(path);return a,info

def difference(now,before,errors,hours):
 delta=(now.astype('float64')-before)*1000;error=sum(errors)*1000+1e-5
 if np.min(delta)<-error:raise ValueError('Cumulatie daalt buiten bronprecisie')
 return (np.maximum(delta,0)/hours).astype('float32')
def packet(dest,name,values,run,h,res,directions=None,layers=None,total=False):
 dest.mkdir(parents=True,exist_ok=True);path=dest/f'{h:03d}_{name}.bin.gz'
 if path.exists():return
 lat,lon=axes(res);grid={'n_lat':len(lat),'n_lon':len(lon),'lat_min':float(lat[0]),'lat_max':float(lat[-1]),'lon_min':float(lon[0]),'lon_max':float(lon[-1])}
 meta={'schema':1,'kind':'regular','source':f'/ifs-interactive/{res}/{run:%Y%m%d%H}-{REV}/{h:03d}.bin','variable':'cloud_layers' if name=='cloud_cover' else name,'bounds':BOUNDS,'grid':grid,'model':res,'resolution_degrees':.1 if res=='0p1' else .25}
 if directions is not None:meta['directions']=True
 if layers is not None:meta['cloudLayers']=True
 if total:meta['accumulation']={'run':int(run.timestamp()*1000),'start':int(run.timestamp()*1000),'end':int((run+dt.timedelta(hours=h)).timestamp()*1000)}
 b=json.dumps(meta,separators=(',',':')).encode();offset=12+(len(b)+3)//4*4
 raw=struct.pack('<III',0x31524c57,len(b),values.size)+b+b'\0'*(offset-12-len(b))+np.asarray(values,dtype='<f4').tobytes()
 if directions is not None:raw+=np.asarray(directions,dtype='<f4').tobytes()
 for a in layers or []:raw+=np.asarray(a,dtype='<f4').tobytes()
 tmp=path.with_suffix('.tmp.gz');tmp.write_bytes(gzip.compress(raw,compresslevel=5,mtime=0));tmp.replace(path)

def export_lead(job):
 run,h,res,cache,dest=job
 expected=[dest/f'{h:03d}_{v}.bin.gz' for v in VARS]
 if all(p.exists() for p in expected):return
 a={};info={}
 for p in PARAMS:a[p],info[p]=field(run,h,p,res,cache)
 hours=3 if h<=144 else 6
 rain_before,rain_error=field(run,h-hours,'tp',res,cache);snow_before,snow_error=field(run,h-hours,'sf',res,cache)
 values={'temperature_2m':a['2t']-273.15,'dew_point_2m':a['2d']-273.15,'pressure_msl':a['msl']/100,'wind_u_component_10m':np.hypot(a['10u'],a['10v'])*3.6,'wind_gusts_10m':a['10fg']*3.6,'cloud_cover':a['tcc']*100,'cape':a['mucape'],'temperature_850hPa':a['t850']-273.15,'temperature_500hPa':a['t500']-273.15,'precipitation':difference(a['tp'],rain_before,[info['tp']['error'],rain_error['error']],hours),'snowfall_water_equivalent':difference(a['sf'],snow_before,[info['sf']['error'],snow_error['error']],hours),'precipitation_total':a['tp']*1000,'snowfall_total':a['sf']*1000}
 direction=(np.degrees(np.arctan2(-a['10u'],-a['10v']))+360)%360
 for variable,v in values.items():packet(dest,variable,v,run,h,res,directions=direction if variable=='wind_u_component_10m' else None,layers=[a[p]*100 for p in ['lcc','mcc','hcc']] if variable=='cloud_cover' else None,total=variable.endswith('_total'))
 print(f'{res} +{h:03d} interactieve velden gereed',flush=True)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--state',type=Path,required=True);ap.add_argument('--resolutions',nargs='+',choices=['0p25','0p1'],default=['0p25','0p1']);ap.add_argument('--publish',action='store_true');ap.add_argument('--test-lead',type=int);ap.add_argument('--workers',type=int,default=4);args=ap.parse_args();args.state.mkdir(parents=True,exist_ok=True)
 lock=(args.state/'export.lock').open('a')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:print('Interactieve export draait al');return
 native.assert_volume()
 source=json.loads(subprocess.check_output(['/opt/homebrew/bin/rclone','cat','r2:weerlab-data/wxbeta_meta.json']))['data']['ecmwf']['runs']
 for res in args.resolutions:
  candidates=sorted([r for cc,r in source.items() if cc in ('00','12') and r['maxlead']==360],key=lambda r:r['run_utc'],reverse=True)
  chosen=None
  for entry in candidates:
   run=dt.datetime.fromisoformat(entry['run_utc']);r=subprocess.run(['curl','-fSsI','--connect-timeout','10','--max-time','20',stem(run,360,res,'sfc')+'.index'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   if r.returncode==0:chosen=entry;break
  if chosen is None:print(res,'geen volledige bron beschikbaar');continue
  run=dt.datetime.fromisoformat(chosen['run_utc']);leads=[f['lead'] for f in chosen['frames']];folder=f'{run:%Y%m%d%H}-{REV}';cache=args.state/res/'cache'/folder;dest=args.state/res/'packets'/folder;current=args.state/res/'current.json'
  if current.exists() and not args.test_lead:
   old=json.loads(current.read_text())
   if old.get('reference_time')==chosen['run_utc'] and old.get('version')==folder:continue
  if res=='0p25':catalogue(run,cache)
  jobs=[(run,h,res,cache,dest) for h in ([args.test_lead] if args.test_lead else leads)]
  with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
   for _ in pool.map(export_lead,jobs):pass
  if args.test_lead or not args.publish:continue
  for h in leads:
   for v in VARS:
    with gzip.open(dest/f'{h:03d}_{v}.bin.gz','rb') as f:assert f.read(4)==struct.pack('<I',0x31524c57)
  subprocess.run(['/opt/homebrew/bin/rclone','copy',str(dest),f'r2:weerlab-data/ifs-interactive/{res}/{folder}','--transfers','12','--exclude','*.tmp.*','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
  manifest={'schema':1,'model':res,'reference_time':chosen['run_utc'],'version':folder,'resolution_degrees':.1 if res=='0p1' else .25,'bounds':BOUNDS,'variables':VARS,'valid_times':[f['valid_utc'] for f in chosen['frames']],'leads':leads,'base':f'https://data.weerlab.nl/ifs-interactive/{res}/{folder}/','updated':dt.datetime.now(UTC).isoformat()}
  tmp=current.with_suffix('.tmp');tmp.write_text(json.dumps(manifest));tmp.replace(current)
  subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(current),f'r2:weerlab-data/ifs-interactive/{res}/current.json','--header-upload','Cache-Control: no-cache'],check=True)
  print('GEPUBLICEERD interactief',res,chosen['run_utc'],'t/m +360',flush=True)
if __name__=='__main__':main()
