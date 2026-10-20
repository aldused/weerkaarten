"""All remaining ECMWF layers for the independent North Sea map."""
import os
import argparse,concurrent.futures,datetime as dt,fcntl,json,sys,subprocess
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'wxbeta_nl'))
import layers as nl
import importlib.util
spec=importlib.util.spec_from_file_location('northsea_gust',Path(__file__).with_name('build.py'));region=importlib.util.module_from_spec(spec);spec.loader.exec_module(region)
region.configure()
BOUNDS=region.BOUNDS
REV='northsea-elements-local-1'
def revision(layer):return REV+'-rain-period-2' if layer=='overview' else REV
LAYERS=['mslp_bft','overview','t2m','wind','cape','precip24','t850','z500','jetstream']
# short name, pressure level, required GRIB units, scaling, offset
SPECS={'msl':(None,'Pa',.01,0),'2t':(None,'K',1,-273.15),'10u':(None,'m s**-1',1,0),'10v':(None,'m s**-1',1,0),'tcc':(None,'(0 - 1)',100,0),'mucape':(None,'J kg**-1',1,0),'tp':(None,'m',1000,0),'t':(850,'K',1,-273.15),'gh':(500,'gpm',1,0),'u':(300,'m s**-1',1,0),'v':(300,'m s**-1',1,0)}


def read(path,run,leads,fields,bounds=BOUNDS):
 """Validate exact time/unit/interval before extracting a regional grid."""
 import eccodes as ec
 before=path.stat();grid=None;records={};coords=None
 with path.open('rb') as stream:
  while (g:=ec.codes_grib_new_from_file(stream)) is not None:
   try:
    name=ec.codes_get(g,'shortName');h=int(ec.codes_get(g,'endStep'))
    if name not in fields or h not in leads:continue
    level,unit,scale,offset=SPECS[name]
    if level is not None and (ec.codes_get(g,'typeOfLevel')!='isobaricInhPa' or ec.codes_get(g,'level')!=level):continue
    if level is None and ec.codes_get(g,'typeOfLevel')=='isobaricInhPa':continue
    actual=dt.datetime.strptime(str(ec.codes_get(g,'dataDate'))+str(ec.codes_get(g,'dataTime')).zfill(4),'%Y%m%d%H%M').replace(tzinfo=dt.timezone.utc)
    if actual!=run:raise ValueError('GRIB hoort bij een andere run')
    if ec.codes_get(g,'centre')!='ecmf' or ec.codes_get(g,'dataType')!='fc' or ec.codes_get(g,'gridType')!='regular_ll':raise ValueError('Geen operationeel ECMWF-rooster')
    if ec.codes_get(g,'units')!=unit or ec.codes_get(g,'stepUnits')!=1 or ec.codes_get(g,'numberOfMissing'):raise ValueError('Verkeerde eenheid of ontbrekende waarden: '+name)
    if name=='tp':
     if ec.codes_get(g,'stepType')!='accum' or int(ec.codes_get(g,'startStep'))!=0:raise ValueError('Neerslag is geen accumulatie vanaf de run')
    elif ec.codes_get(g,'stepType')!='instant':raise ValueError('Geen momentwaarde: '+name)
    signature=ec.codes_get(g,'md5GridSection');ni,nj=ec.codes_get(g,'Ni'),ec.codes_get(g,'Nj')
    if grid is None:
     grid=signature;la=ec.codes_get_array(g,'latitudes').reshape(nj,ni)[:,0];lo=(ec.codes_get_array(g,'longitudes').reshape(nj,ni)[0]+180)%360-180
     iy=np.flatnonzero((la>=bounds[2]-.5)&(la<=bounds[3]+.5));ix=np.flatnonzero((lo>=bounds[0]-.5)&(lo<=bounds[1]+.5));xx,yy=np.meshgrid(lo[ix],la[iy]);coords=np.column_stack([yy.ravel(),xx.ravel()])
    if signature!=grid:raise ValueError('Roosters verschillen')
    values=ec.codes_get_values(g).reshape(nj,ni)[np.ix_(iy,ix)].ravel()*scale+offset
    if not np.isfinite(values).all():raise ValueError('Niet-eindige waarden')
    records.setdefault(name,{})[h]=values.astype('float32')
   finally:ec.codes_release(g)
 if path.stat().st_mtime_ns!=before.st_mtime_ns or path.stat().st_size!=before.st_size:raise ValueError('Bron wijzigde tijdens lezen')
 if any(set(records.get(f,{}))!=set(leads) for f in fields):raise ValueError('Onvolledige bronvelden/tijdstappen')
 return coords,records


def precipitation(total,lead,window):
 if lead<window:return np.full_like(total[lead],np.nan)
 previous=total[lead-window] if lead>window else np.zeros_like(total[lead])
 amount=total[lead]-previous
 if np.nanmin(amount)<-.05:raise ValueError('Neerslagaccumulatie neemt af')
 return np.maximum(amount,0)


def retrieve(run,leads,cache):
 folder=cache/f'{run:%Y%m%d%H}-elements-2';folder.mkdir(parents=True,exist_ok=True);saved=folder/'complete.npz'
 if saved.exists():
  with np.load(saved) as d:
   if not np.array_equal(d['leads'],leads):raise ValueError('Cache-tijdas verschilt')
   return d['coords'],d['values'],d['keys'].tolist()
 groups=[(['msl','2t','10u','10v','tcc','mucape'],{},['wx_ov_sfc.grib2','wx_t2m_t.grib2','wx_wind.grib2','wx_cape.grib2']),(['tp'],{},['wx_precip24.grib2']),(['t'],{'levtype':'pl','levelist':[850]},['wx_t850_t.grib2']),(['gh'],{'levtype':'pl','levelist':[500]},['wx_z500.grib2']),(['u','v'],{'levtype':'pl','levelist':[300]},[f'wx_jetstream_{run:%Y%m%d%H}_{min(leads):03d}_{max(leads):03d}.grib2'])]
 records={};coords=None
 for fields,options,candidates in groups:
  expected=sorted(set(leads)|{h-24 for h in leads if h>=24}) if fields==['tp'] else leads
  local={};actual_coords=None
  for path in [region.PROJECT/'grib_cache'/candidate for candidate in candidates]+list((cache/f'{run:%Y%m%d%H}-elements-1').glob('*.grib2'))+list(folder.glob('*.grib2')):
   if not path.exists():continue
   for field in fields:
    if field in local:continue
    try:c,r=read(path,run,expected,[field])
    except ValueError:continue
    if actual_coords is not None and not np.array_equal(c,actual_coords):raise ValueError('Roosters verschillen')
    actual_coords=c;local.update(r)
  missing=[f for f in fields if f not in local]
  if missing:
   from ecmwf.opendata import Client
   path=folder/('-'.join(missing)+'.grib2')
   with (folder/('tp.lock' if missing==['tp'] else 'download.lock')).open('a') as download_lock:
    fcntl.flock(download_lock,fcntl.LOCK_EX)
    if not path.exists():
     tmp=path.with_suffix('.tmp.grib2');Client(os.environ.get('ECMWF_OPEN_DATA_SOURCE','google')).retrieve(date=run.strftime('%Y%m%d'),time=run.hour,stream='oper',type='fc',step=expected,param=missing,target=str(tmp),**options);tmp.replace(path)
   c,r=read(path,run,expected,missing)
   if actual_coords is not None and not np.array_equal(c,actual_coords):raise ValueError('Roosters verschillen')
   actual_coords=c;local.update(r)
  if coords is not None and not np.array_equal(coords,actual_coords):raise ValueError('Oppervlakte- en hoogtevelden hebben verschillende roosters')
  coords=actual_coords;records.update(local);print(run.strftime('%H'),'Noordzee bronvelden',','.join(fields),'gereed',flush=True)
 output=[]
 for lead in leads:
  u=records['10u'][lead];v=records['10v'][lead];u3=records['u'][lead];v3=records['v'][lead];interval=3 if lead<=144 else 6
  output.append({'pressure_msl':records['msl'][lead],'temperature_2m':records['2t'][lead],'wind_speed_10m':np.hypot(u,v),'wind_direction_10m':(np.degrees(np.arctan2(-u,-v))+360)%360,'cloud_cover':records['tcc'][lead],'cape':records['mucape'][lead],'rain_rate':precipitation(records['tp'],lead,interval)/interval,'rain24':precipitation(records['tp'],lead,24),'temperature_850hPa':records['t'][lead],'geopotential_height_500hPa':records['gh'][lead],'wind_speed_300hPa':np.hypot(u3,v3),'wind_direction_300hPa':(np.degrees(np.arctan2(-u3,-v3))+360)%360,'interval':np.full_like(u,interval)})
 keys=list(output[0]);values=np.stack([np.stack([r[k] for k in keys],axis=1) for r in output]);tmp=saved.with_suffix('.tmp.npz');np.savez_compressed(tmp,coords=coords,values=values,keys=keys,leads=leads);tmp.replace(saved)
 return coords,values,keys


def render(task):
 from matplotlib.patches import Rectangle,PathPatch
 from presentation import header,footer
 run,lead,coords,values,keys,layer,model,out=task
 nl.BOUNDS=BOUNDS;nl.MAP_LATITUDE=54
 nl.LABELS['cape']=('CAPE · meest onstabiele lucht','J/kg')
 nl.MODEL_INFO[model]=('ECMWF IFS','0,25° · circa 25 km',4)
 def setup(ax):return Rectangle((BOUNDS[0],BOUNDS[2]),BOUNDS[1]-BOUNDS[0],BOUNDS[3]-BOUNDS[2],transform=ax.transData)
 def outlines(ax):
  for land in region.geography():ax.add_patch(PathPatch(region.geometry_path(land),facecolor='none',edgecolor='#243e49',linewidth=.85,zorder=5))
 nl.map_setup=setup;nl.map_outlines=outlines
 def chart_header(fig,title,run,valid,source):
  if layer=='overview':source=source.replace('over 3 uur',f'over {3 if lead<=144 else 6} uur')
  header(fig,title,run,valid,source,region='NOORDZEE & BRITSE EILANDEN')
 nl.map_header=chart_header
 nl.map_footer=lambda fig,credit:footer(fig,'Oorspronkelijke modelwaarden · ECMWF Open Data · kustlijnen: Natural Earth')
 nl.render(task)


def process_cycle(args,meta,cc):
 path=args.state/'current.json'
 source=meta['data']['ecmwf']['runs'].get(cc)
 if not source:return
 run=nl.parse(source['run_utc']);leads=[f['lead'] for f in source['frames']]
 manifest=json.loads(path.read_text());old=manifest['runs'].get(cc,{})
 if old.get('run_utc')!=source['run_utc']:raise ValueError('Windstootrun moet eerst gereed zijn')
 if all(old.get('layers',{}).get(k,{}).get('renderer')==revision(k) for k in args.layers):return
 coords,values,keys=retrieve(run,leads,args.state/'cache')
 for layer in args.layers:
  if old.get('layers',{}).get(layer,{}).get('renderer')==revision(layer):continue
  selected=[(i,h) for i,h in enumerate(leads) if layer!='precip24' or h>=24];folder=f'{run:%Y%m%d%H}-{revision(layer)}-{layer}-bounded';dest=args.state/'maps'/folder
  tasks=[(run,h,coords,values[i],keys,layer,'ecmwf_ifs025',dest/f'{layer}_{h:03d}.png') for i,h in selected]
  with concurrent.futures.ProcessPoolExecutor(max_workers=3) as pool:
   for i,_ in enumerate(pool.map(render,tasks)):
    if i%24==0:print(cc,'Noordzee',layer,i+1,'/',len(tasks),flush=True)
  if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copy',str(dest),f'r2:weerlab-data/wxbeta-northsea/{folder}','--transfers','8','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
  with (args.state/'publish.lock').open('a') as publication:
   fcntl.flock(publication,fcntl.LOCK_EX);manifest=json.loads(path.read_text());entry=manifest['runs'][cc]
   if entry['run_utc']!=source['run_utc']:raise ValueError('Run wijzigde tijdens opbouwen')
   entry.setdefault('layers',{})[layer]={'renderer':revision(layer),'resolution':'0,25° · circa 25 km','frames':[source['frames'][i] for i,h in selected],'files':{layer:[f'{folder}/{layer}_{h:03d}.png' for i,h in selected]}}
   if layer=='t2m':entry['layers']['t2m_grid']={**entry['layers'][layer],'files':{'t2m_grid':entry['layers'][layer]['files'][layer]}}
   manifest['updated']=dt.datetime.now(dt.timezone.utc).isoformat();tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(manifest));tmp.replace(path)
   if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(path),'r2:weerlab-data/wxbeta-northsea/current.json','--header-upload','Cache-Control: no-cache'],check=True)
  print(cc,layer,'Noordzee gepubliceerd',flush=True)


def main():
 ap=argparse.ArgumentParser();ap.add_argument('--state',type=Path,required=True);ap.add_argument('--publish',action='store_true');ap.add_argument('--cycles',nargs='+',default=['00','18','12','06']);ap.add_argument('--layers',nargs='+',default=LAYERS);args=ap.parse_args();args.state.mkdir(parents=True,exist_ok=True)
 lock=(args.state/'layers-bounded.lock').open('a')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 meta=nl.public_meta();path=args.state/'current.json';errors=[]
 for cc in args.cycles:
  try:process_cycle(args,meta,cc)
  except Exception as e:errors.append(cc+': '+str(e));print(errors[-1],flush=True)
 if errors:raise SystemExit('; '.join(errors))
if __name__=='__main__':main()
