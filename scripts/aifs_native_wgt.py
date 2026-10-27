"""Official ECMWF AIFS Single data for the existing WGT/TX model component."""
import concurrent.futures,fcntl,json,shutil
from datetime import datetime,timedelta,timezone
from pathlib import Path
import eccodes as ec
import numpy as np
from arome_native_update import write_bin,old_runs
from ecmwf_native_update import assert_volume,curl,deaccumulate
ROOT=Path('/Volumes/WEERLAB/Modeldata/ECMWF/AIFS-WGT')
BASE='https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com'
PARAMS=['2t','2d','10u','10v','lcc','mcc','hcc','tcc','tp','ssrd','msl','skt']
LAT=np.arange(49,56.001,.25);LON=np.arange(.5,11.501,.25)
STEPS=np.arange(0,241,6)
def stem(run,h):return f'{BASE}/{run:%Y%m%d}/{run:%H}z/aifs-single/0p25/oper/{run:%Y%m%d%H}0000-{h}h-oper-fc'
def message(path,run,h,param):
 with path.open('rb') as f:g=ec.codes_grib_new_from_file(f)
 try:
  if ec.codes_get(g,'shortName')!=param or int(ec.codes_get(g,'dataDate'))!=int(run.strftime('%Y%m%d')) or int(ec.codes_get(g,'dataTime'))!=run.hour*100 or int(ec.codes_get(g,'endStep'))!=h:raise ValueError('AIFS-bronidentiteit wijkt af')
  if (ec.codes_get(g,'Ni'),ec.codes_get(g,'Nj'))!=(1440,721) or ec.codes_get(g,'iScansNegatively') or ec.codes_get(g,'jScansPositively'):raise ValueError('Onverwacht AIFS-rooster')
  a=ec.codes_get_values(g).reshape(721,1440)
  yi=np.rint((ec.codes_get(g,'latitudeOfFirstGridPointInDegrees')-LAT)/.25).astype(int)
  xi=np.rint(((LON-ec.codes_get(g,'longitudeOfFirstGridPointInDegrees'))%360)/.25).astype(int)
  v=a[np.ix_(yi,xi)];unit=ec.codes_get(g,'units');err=float(ec.codes_get(g,'packingError'))
  if not np.isfinite(v).all() or np.any(v==ec.codes_get(g,'missingValue')):raise ValueError('Ontbrekende AIFS-bronwaarden')
  if param in ['tp','ssrd'] and (int(ec.codes_get(g,'startStep'))!=0 or ec.codes_get(g,'stepType')!='accum'):raise ValueError('Onverwacht AIFS-accumulatie-interval')
  if param in ['2t','2d','skt']:
   if unit!='K':raise ValueError('Onverwachte AIFS-temperatuureenheid')
   v=v-273.15
  if param in ['lcc','mcc','hcc','tcc']:
   if unit=='%':v=v/100
   elif unit not in ['(0 - 1)','1','0-1']:raise ValueError('Onverwachte AIFS-wolkeneenheid '+unit)
   v=np.clip(v,0,1)
  if param=='tp':
   if unit=='m':v=v*1000;err*=1000
   elif unit not in ['kg m**-2','kg m-2','mm']:raise ValueError('Onverwachte AIFS-neerslageenheid '+unit)
  if param=='ssrd' and unit!='J m**-2':raise ValueError('Onverwachte AIFS-stralingseenheid')
  if param in ['10u','10v'] and unit!='m s**-1':raise ValueError('Onverwachte AIFS-windeenheid')
  return v,err
 finally:ec.codes_release(g)
def build(run,folder):
 raw=folder/'raw';raw.mkdir(parents=True,exist_ok=True);jobs=[]
 for h in STEPS:
  index=raw/f'{h:03d}.index'
  if not index.exists():curl(stem(run,h)+'.index',index)
  rows=[json.loads(l) for l in index.read_text().splitlines()]
  for p in PARAMS:
   if h==0 and p in ['tp','ssrd']:continue
   candidates=[r for r in rows if r['param']==p and r.get('levtype')=='sfc']
   if len(candidates)!=1:raise ValueError(f'AIFS mist uniek veld {p} +{h}')
   r=candidates[0];jobs.append((h,p,r))
 def fetch(job):
  h,p,r=job;path=raw/f'{h:03d}-{p}.grib2'
  if path.exists() and path.stat().st_size==r['_length']:return
  temp=path.with_suffix('.part');curl(stem(run,h)+'.grib2',temp,['-H',f"Range: bytes={r['_offset']}-{r['_offset']+r['_length']-1}"])
  if temp.stat().st_size!=r['_length']:raise ValueError('Onvolledig AIFS-bericht')
  temp.replace(path)
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  for i,_ in enumerate(pool.map(fetch,jobs),1):
   if i%60==0:print(f'AIFS eigen bron: {i}/{len(jobs)} velden',flush=True)
 fields={p:np.zeros((len(STEPS),len(LAT),len(LON))) for p in PARAMS};errors={p:np.zeros(len(STEPS)) for p in ['tp','ssrd']}
 for i,h in enumerate(STEPS):
  for p in PARAMS:
   if h==0 and p in errors:continue
   fields[p][i],err=message(raw/f'{h:03d}-{p}.grib2',run,int(h),p)
   if p in errors:errors[p][i]=err
 hours=np.arange(int(STEPS[-1])+1)
 def interp(a):
  from scipy.interpolate import interp1d
  return interp1d(STEPS,a,axis=0)(hours)
 _,total=deaccumulate(fields['tp'],errors['tp'],STEPS,return_cumulative=True)
 rain=np.diff(interp(total),axis=0,prepend=np.zeros_like(total[:1]))
 energy=deaccumulate(fields['ssrd'],errors['ssrd'],STEPS,1/3600)
 solar=np.zeros_like(rain)
 for i in range(len(STEPS)-1):solar[STEPS[i]+1:STEPS[i+1]+1]=energy[i]
 specs={'temp':[interp(fields['2t'])],'dauwpunt':[interp(fields['2d'])],'wind':[interp(fields['10u']),interp(fields['10v'])],'bewolking':[interp(fields[p]) for p in ['hcc','mcc','lcc']],'cloud_total':[interp(fields['tcc'])*100],'neerslag':[rain],'straling':[solar],'druk':[interp(fields['msl'])],'surface_temperature':[interp(fields['skt'])]}
 out=folder/'processed';out.mkdir(exist_ok=True);parameters={}
 for key,arrays in specs.items():
  name=f'aifs_wgt_{key}.bin';write_bin(out/name,arrays);parameters[key]={'file':name,'components':len(arrays),'source':'ECMWF AIFS Single Open Data, CC-BY-4.0'}
 meta={'schema_version':1,'model':'ECMWF AIFS 0,25°','run_utc':run.isoformat(),'native_resolution_km':31,'export_grid_step_degrees':.25,'tijden':[(run+timedelta(hours=int(h))).isoformat() for h in hours],'grid':dict(n_lat=len(LAT),n_lon=len(LON),lat_min=float(LAT[0]),lat_max=float(LAT[-1]),lon_min=float(LON[0]),lon_max=float(LON[-1])),'parameters':parameters,'source':'ECMWF Open Data direct via AWS','attribution':'© ECMWF 2026, CC-BY-4.0','interpolation':'native 6h -> hourly; wind vectors; precipitation and solar totals conserved','missing_fields':['snow_depth','wind_gusts_10m','soil_temperature_0cm','temperature_850hPa','temperature_925hPa']}
 path=out/'meta.json';temp=path.with_suffix('.tmp');temp.write_text(json.dumps(meta));temp.replace(path);return path

def publish_points(meta):
 import subprocess
 from build_point_source import build_point_source
 folder=meta.parent.parent
 stamp=folder/'point-source-published.txt'
 identity=meta.read_text()
 if stamp.exists() and stamp.read_text()==identity:return
 path,files=build_point_source('aifs',meta,folder/'point-source')
 for file in sorted(files,key=lambda f:f.name=='meta.json'):
  subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(file),'r2:weerlab-harmonie/point-source/aifs/'+file.name,'--header-upload','Cache-Control: public, max-age=60'],check=True)
 stamp.write_text(identity)

def ensure():
 assert_volume();ROOT.mkdir(parents=True,exist_ok=True)
 with (ROOT/'update.lock').open('w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  now=datetime.now(timezone.utc)-timedelta(hours=7);run=now.replace(hour=now.hour//6*6,minute=0,second=0,microsecond=0)
  for _ in range(4):
   folder=ROOT/run.strftime('%Y%m%d%H');meta=folder/'processed/meta.json'
   if meta.exists() and len(json.loads(meta.read_text()).get('tijden', [])) >= 240:
    m=json.loads(meta.read_text())
    if m.get('native_resolution_km')!=31 or m.get('model')!='ECMWF AIFS 0,25°':
     m.update(model='ECMWF AIFS 0,25°',native_resolution_km=31,export_grid_step_degrees=.25);tmp=meta.with_suffix('.tmp');tmp.write_text(json.dumps(m));tmp.replace(meta)
    try:publish_points(meta)
    except Exception as error:print("AIFS-puntpublicatie uitgesteld; WGT gebruikt eigen bestanden:",error,flush=True)
    return meta
   import requests
   r=requests.head(stem(run,240)+'.index',timeout=20)
   if r.status_code==200:
    result=build(run,folder)
    for old in old_runs([p.name for p in ROOT.iterdir() if p.is_dir()],8,folder.name):shutil.rmtree(ROOT/old)
    try:publish_points(result)
    except Exception as error:print("AIFS-puntpublicatie uitgesteld; WGT gebruikt eigen bestanden:",error,flush=True)
    return result
   if r.status_code!=404:r.raise_for_status()
   run-=timedelta(hours=6)
 raise RuntimeError('Geen actuele complete AIFS-bron beschikbaar')
if __name__=='__main__':print(ensure())
