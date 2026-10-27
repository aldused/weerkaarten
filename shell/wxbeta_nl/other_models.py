"""Detailed Netherlands charts for every remaining model in the Europe viewer."""
import argparse,concurrent.futures,datetime as dt,fcntl,hashlib,importlib.util,json,subprocess
from pathlib import Path
import numpy as np
import layers as nl
from layers import BOUNDS,MODEL_INFO,REV,UTC,parse,iso
PROJECT=Path('/Users/aldus/KNMI_Project')
def chart_revision(model,layer):return nl.revision(layer)+('-gfs2' if model=='gfs_global' else '')
MODELS={'gfs':'gfs_global','ens':'ecmwf_ens','cams':'cams'}

def load_ensemble(source):
 import cfgrib
 run=nl.parse(source['run_utc']);leads=[f['lead'] for f in source['frames']]
 columns=[];coords=None;identity=hashlib.sha256()
 for filename,var,key,unit,scale,offset in [('msl','msl','pressure_msl','Pa',.01,0),('gh','gh','geopotential_height_500hPa','gpm',1,0),('t','t','temperature_850hPa','K',1,-273.15)]:
  path=PROJECT/'grib_cache'/f'wx_ens_{filename}.grib2';before=path.stat()
  with cfgrib.open_dataset(path,backend_kwargs={'indexpath':''}) as ds:
   if nl.parse(str(ds.time.values)[:19]+'Z')!=run:raise ValueError('ENS-cache hoort bij een andere run')
   attrs=ds[var].attrs
   if attrs.get('units')!=unit or attrs.get('GRIB_dataType')!='em':raise ValueError('Geen ensemblegemiddelde met juiste eenheden')
   hrs=[int(h/np.timedelta64(1,'h')) for h in np.atleast_1d(ds.step.values)]
   if any(h not in hrs for h in leads):raise ValueError('ENS-cache mist tijdstappen')
   lat=ds.latitude.values;lon=(ds.longitude.values+180)%360-180
   iy=np.flatnonzero((lat>=BOUNDS[2]-.5)&(lat<=BOUNDS[3]+.5));ix=np.flatnonzero((lon>=BOUNDS[0]-.5)&(lon<=BOUNDS[1]+.5));lo,la=np.meshgrid(lon[ix],lat[iy]);actual=np.column_stack([la.ravel(),lo.ravel()])
   if coords is not None and not np.array_equal(coords,actual):raise ValueError('Gemengde ENS-roosters')
   coords=actual;values=ds[var].isel(step=[hrs.index(h) for h in leads],latitude=iy,longitude=ix).values.reshape(len(leads),-1)*scale+offset
   if not np.isfinite(values).all():raise ValueError('ENS bevat ontbrekende waarden')
   columns.append(values.astype('float32'))
  if path.stat().st_mtime_ns!=before.st_mtime_ns or path.stat().st_size!=before.st_size:raise ValueError('ENS-cache werd gewijzigd tijdens lezen')
  identity.update(path.read_bytes())
 return coords,np.stack(columns,axis=2),['pressure_msl','geopotential_height_500hPa','temperature_850hPa'],identity.hexdigest()[:10]

def load_gfs_cache(source,cache):
 """Use the exact NOAA GRIBs already fetched for Europe if the API lags."""
 import eccodes as ec
 run=parse(source['run_utc']);leads=[f['lead'] for f in source['frames']]
 folder=cache/f'gfs025-{run:%Y%m%d%H}-{hashlib.sha256(str(leads).encode()).hexdigest()[:10]}';saved=folder/'complete.npz'
 if saved.exists():
  with np.load(saved) as d:return d['coordinates'],d['values'],d['keys'].tolist(),str(d['identity'])
 specs={'prmsl':('pressure_msl','meanSea',None,'Pa',.01,0),'2t':('temperature_2m','heightAboveGround',2,'K',1,-273.15),'t':('temperature_850hPa','isobaricInhPa',850,'K',1,-273.15),'gh':('geopotential_height_500hPa','isobaricInhPa',500,'gpm',1,0),'10u':('u','heightAboveGround',10,'m s**-1',1,0),'10v':('v','heightAboveGround',10,'m s**-1',1,0),'cape':('cape','surface',None,'J kg**-1',1,0),'tcc':('cloud_cover','atmosphere',None,'%',1,0),'tp':('rain6','surface',None,'kg m**-2',1,0)}
 records=[];coordinates=None;signature=None
 for lead in leads:
  path=PROJECT/'grib_cache'/f'gfs_f{lead:03d}.grib2';before=path.stat();record={}
  with path.open('rb') as stream:
   while (g:=ec.codes_grib_new_from_file(stream)) is not None:
    try:
     short=ec.codes_get(g,'shortName')
     if short not in specs:continue
     key,kind,level,unit,scale,offset=specs[short]
     if ec.codes_get(g,'typeOfLevel')!=kind or level is not None and ec.codes_get(g,'level')!=level:continue
     if short=='tp':
      if ec.codes_get(g,'stepType')!='accum' or ec.codes_get(g,'startStep')!=lead-6:continue
     elif ec.codes_get(g,'stepType')!='instant':continue
     if (ec.codes_get(g,'dataDate')!=int(run.strftime('%Y%m%d')) or ec.codes_get(g,'dataTime')!=run.hour*100 or ec.codes_get(g,'endStep')!=lead or ec.codes_get(g,'stepUnits')!=1 or ec.codes_get(g,'units')!=unit or ec.codes_get(g,'numberOfMissing')):raise ValueError('NOAA-cache: verkeerde run, tijd, eenheid of ontbrekende data')
     if ec.codes_get(g,'gridType')!='regular_ll':raise ValueError('Onverwacht NOAA-rooster')
     ni,nj=ec.codes_get(g,'Ni'),ec.codes_get(g,'Nj');actual=tuple(ec.codes_get(g,k) for k in ['Ni','Nj','latitudeOfFirstGridPointInDegrees','longitudeOfFirstGridPointInDegrees','latitudeOfLastGridPointInDegrees','longitudeOfLastGridPointInDegrees'])
     if signature is None:
      signature=actual;la=ec.codes_get_array(g,'latitudes').reshape(nj,ni)[:,0];lo=(ec.codes_get_array(g,'longitudes').reshape(nj,ni)[0]+180)%360-180
      iy=np.flatnonzero((la>=BOUNDS[2]-.5)&(la<=BOUNDS[3]+.5));ix=np.flatnonzero((lo>=BOUNDS[0]-.5)&(lo<=BOUNDS[1]+.5));xx,yy=np.meshgrid(lo[ix],la[iy]);coordinates=np.column_stack([yy.ravel(),xx.ravel()])
     if actual!=signature:raise ValueError('NOAA-roosters verschillen')
     values=ec.codes_get_values(g).reshape(nj,ni)[np.ix_(iy,ix)].ravel()*scale+offset
     if not np.isfinite(values).all():raise ValueError('NOAA bevat ontbrekende waarden')
     if key in record and not np.array_equal(record[key],values):raise ValueError('Tegenstrijdige NOAA-velden')
     record[key]=values
    finally:ec.codes_release(g)
  after=path.stat()
  if before.st_mtime_ns!=after.st_mtime_ns or before.st_size!=after.st_size:raise ValueError('NOAA-cache wijzigde tijdens lezen')
  if len(record)!=len(specs):raise ValueError('NOAA-cache mist benodigde velden: '+str(set(v[0] for v in specs.values())-record.keys()))
  u=record.pop('u');v=record.pop('v');record['wind_speed_10m']=np.hypot(u,v);record['wind_direction_10m']=(np.degrees(np.arctan2(-u,-v))+360)%360
  records.append(record)
 # Sum only complete four-bucket windows for the 24-hour precipitation map.
 rain6={h:r['rain6'] for h,r in zip(leads,records)};output=[]
 for lead,record in zip(leads,records):
  record['rain_rate']=record['rain6']/6
  record['rain24']=sum(rain6[h] for h in range(lead-18,lead+1,6)) if lead>=24 and all(h in rain6 for h in range(lead-18,lead+1,6)) else np.full_like(record['rain6'],np.nan)
  record.pop('rain6');output.append(record)
 keys=list(output[0]);values=np.array([[r[k] for k in keys] for r in output],dtype='float32').transpose(0,2,1)
 identity=hashlib.sha256(coordinates.tobytes()+np.nan_to_num(values).tobytes()+str(leads).encode()).hexdigest()[:10]
 folder.mkdir(parents=True,exist_ok=True);tmp=saved.with_suffix('.tmp.npz');np.savez(tmp,coordinates=coordinates,values=values,keys=keys,identity=identity);tmp.replace(saved)
 return coordinates,values,keys,identity

def load_dust(source):
 run=parse(source['run_utc']);leads=[f['lead'] for f in source['frames']];paths=list((PROJECT/'grib_cache/cams').glob(f'cams_duaod550_{run:%Y%m%d%H}_*.grib'))
 if len(paths)!=1:raise ValueError('Geen unieke oorspronkelijke CAMS-GRIB beschikbaar')
 path=paths[0];digest=hashlib.sha256(path.read_bytes()).hexdigest()
 if source.get('grib_sha256') and source['grib_sha256']!=digest:raise ValueError('CAMS-cache wijkt af van de gepubliceerde bron')
 spec=importlib.util.spec_from_file_location('cams_nl_source',PROJECT/'cams_native.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 (lat,lon),fields=module.read_grib(path,run,leads)
 iy=np.flatnonzero((lat>=BOUNDS[2]-.5)&(lat<=BOUNDS[3]+.5));ix=np.flatnonzero((lon>=BOUNDS[0]-.5)&(lon<=BOUNDS[1]+.5));lo,la=np.meshgrid(lon[ix],lat[iy]);coords=np.column_stack([la.ravel(),lo.ravel()]);values=np.stack([fields[h][np.ix_(iy,ix)].ravel() for h in leads])[:,:,None]
 return coords,values,['dust'],digest[:10]

def publish(state,modelkey,cc,source,layer,entry,publish):
 path=state/'current.json'
 with (state/'publish.lock').open('w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);manifest=json.loads(path.read_text());runs=manifest['runs'] if modelkey=='ens' else manifest.setdefault('models',{}).setdefault(modelkey,{}).setdefault('runs',{})
  previous=runs.get(cc,{})
  if previous.get('run_utc')!=source['run_utc']:previous=dict(run_utc=source['run_utc'],layers={})
  previous.setdefault('layers',{})[layer]=entry
  if layer=='t2m':previous['layers']['t2m_grid']={**entry,'files':{'t2m_grid':entry['files']['t2m']}}
  if layer=='dust_europe':
   for alias in ['dust_sahara','dust_atlantic']:previous['layers'][alias]={**entry,'files':{alias:entry['files'][layer]}}
  runs[cc]=previous;manifest['updated']=iso(dt.datetime.now(UTC));tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(manifest));tmp.replace(path)
  if publish:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(path),'r2:weerlab-data/wxbeta-nl/current.json','--header-upload','Cache-Control: no-cache'],check=True)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--state',type=Path,required=True);ap.add_argument('--publish',action='store_true');ap.add_argument('--models',nargs='+',default=list(MODELS));ap.add_argument('--cycles',nargs='+',default=['18','12','06','00']);ap.add_argument('--grib-only',action='store_true');args=ap.parse_args();args.state.mkdir(parents=True,exist_ok=True)
 lock=(args.state/'others.lock').open('w')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 metadata=nl.public_meta();errors=[]
 for modelkey in args.models:
  model=MODELS[modelkey];runs=metadata['data']['ecmwf']['runs'] if modelkey=='ens' else metadata['data'][modelkey]['runs'];cycles=['ens'] if modelkey=='ens' else [cc for cc in args.cycles if cc in runs]
  cycles.sort(key=lambda cc:parse(runs[cc]['run_utc']),reverse=True)
  for cc in cycles:
   try:
    model=MODELS[modelkey]
    source=runs[cc];run=parse(source['run_utc']);leads=[f['lead'] for f in source['frames']];manifest=json.loads((args.state/'current.json').read_text());oldruns=manifest['runs'] if modelkey=='ens' else manifest.get('models',{}).get(modelkey,{}).get('runs',{});old=oldruns.get(cc,{})
    selected=[key for key in source['files'] if key!='t2m_grid' and (modelkey!='cams' or key=='dust_europe')]
    if old.get('run_utc')==source['run_utc'] and all(old.get('layers',{}).get(k,{}).get('renderer')==chart_revision(model,k) and old['layers'][k].get('resolution')==nl.resolution_for(model,k) for k in selected):print(modelkey,cc,'al compleet',flush=True);continue
    if modelkey=='ens':coords,values,keys,identity=load_ensemble(source)
    elif modelkey=='cams':coords,values,keys,identity=load_dust(source)
    else:
     try:
      if args.grib_only and modelkey=='gfs':raise RuntimeError('NOAA-bron expliciet geselecteerd')
      coords,values,keys,identity=nl.retrieve(model,run,args.state/'cache',leads)
     except Exception:
      if modelkey!='gfs':raise
      coords,values,keys,identity=load_gfs_cache(source,args.state/'cache');model='gfs025';print('GFS: exacte NOAA-bron van 0,25° gebruikt',flush=True)
    for layer in selected:
     if old.get('run_utc')==source['run_utc'] and old.get('layers',{}).get(layer,{}).get('renderer')==chart_revision(model,layer) and old['layers'][layer].get('resolution')==nl.resolution_for(model,layer):continue
     chosen=[(i,h) for i,h in enumerate(leads) if layer!='precip24' or h>=24];folder=f'{run:%Y%m%d%H}-{model}-{identity}-{chart_revision(model,layer)}'
     tasks=[(run,h,coords,values[i],keys,layer,model,args.state/'maps'/folder/f'{layer}_{h:03d}.png') for i,h in chosen]
     with concurrent.futures.ProcessPoolExecutor(max_workers=4) as pool:
      for i,_ in enumerate(pool.map(nl.render,tasks)):
       if i%12==0:print(f'{modelkey} {cc} {layer} {i+1}/{len(tasks)}',flush=True)
     if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copy',str(args.state/'maps'/folder),f'r2:weerlab-data/wxbeta-nl/{folder}','--transfers','8','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
     label,_,_=MODEL_INFO[model];resolution=nl.resolution_for(model,layer);entry=dict(renderer=chart_revision(model,layer),modelLabel=label,resolution=resolution,base=manifest['base'],frames=[source['frames'][i] for i,h in chosen],files={layer:[f'{folder}/{layer}_{h:03d}.png' for _,h in chosen]})
     publish(args.state,modelkey,cc,source,layer,entry,args.publish);print(modelkey,cc,layer,'Nederland gepubliceerd',flush=True)
   except Exception as e:errors.append(f'{modelkey} {cc}: {e}');print(errors[-1],flush=True)
 if errors:raise SystemExit('; '.join(errors))
if __name__=='__main__':main()
