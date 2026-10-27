"""Exact-run cumulative precipitation for Europe, Netherlands and North Sea."""
import os
import argparse,bz2,concurrent.futures,datetime as dt,fcntl,gzip,importlib.util,json,sys,subprocess,time,urllib.parse,urllib.request
from functools import lru_cache
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'shell'))
from wxbeta_network import configure
configure()
sys.path.insert(0,str(ROOT/'shell/wxbeta_nl'))
import layers as nl
from basemap import geometry_path
from presentation import header,footer
spec=importlib.util.spec_from_file_location('northsea_elements',Path(__file__).with_name('layers.py'));elements=importlib.util.module_from_spec(spec);spec.loader.exec_module(elements)
EU=(-24,45,28,72);NL=(3.3,7.4,50.45,53.8);NS=elements.BOUNDS
REV='cumulative-local-2'
def revision(area):return REV+'-labels2' if area=='northsea' else REV


def download(url,path,compressed=False):
 path.parent.mkdir(parents=True,exist_ok=True)
 if path.exists():return
 request=urllib.request.Request(url,headers={'User-Agent':'Weerlab cumulative precipitation/1.0'})
 for attempt in range(3):
  try:
   raw=urllib.request.urlopen(request,timeout=60).read();raw=bz2.decompress(raw) if compressed else raw;break
  except (OSError,EOFError):
   if attempt==2:raise
   time.sleep(2+attempt*3)
 if not raw.startswith(b'GRIB'):raise ValueError('Geen GRIB ontvangen')
 tmp=path.with_suffix('.tmp.grib2');tmp.write_bytes(raw);tmp.replace(path)


def bucket_total(buckets,leads):
 if leads!=list(range(6,leads[-1]+1,6)):raise ValueError('Cumulatief GFS mist zesuursperioden vanaf de run')
 return np.cumsum(np.stack([buckets[h] for h in leads]),axis=0,dtype=np.float64).astype('float32')


def total_cells(path,run,lead,model,bounds=EU):
 import eccodes as ec
 before=path.stat()
 with path.open('rb') as stream:
  while (g:=ec.codes_grib_new_from_file(stream)) is not None:
   try:
    if ec.codes_get(g,'shortName') not in ('tp','tot_prec'):continue
    start=int(ec.codes_get(g,'startStep'));end=int(ec.codes_get(g,'endStep'))
    if end!=lead or model=='gfs' and start!=lead-6:continue
    actual=dt.datetime.strptime(str(ec.codes_get(g,'dataDate'))+str(ec.codes_get(g,'dataTime')).zfill(4),'%Y%m%d%H%M').replace(tzinfo=dt.timezone.utc)
    if actual!=run:raise ValueError('Neerslag hoort bij een andere run')
    if ec.codes_get(g,'stepType')!='accum' or ec.codes_get(g,'stepUnits')!=1 or ec.codes_get(g,'units')!='kg m**-2' or ec.codes_get(g,'numberOfMissing'):raise ValueError('Verkeerd neerslaginterval/eenheid')
    if model=='iconeu' and start!=0:raise ValueError('ICON-neerslag niet cumulatief vanaf run')
    ni,nj=ec.codes_get(g,'Ni'),ec.codes_get(g,'Nj');lat=ec.codes_get_array(g,'latitudes').reshape(nj,ni)[:,0];lon=(ec.codes_get_array(g,'longitudes').reshape(nj,ni)[0]+180)%360-180
    iy=np.flatnonzero((lat>=bounds[2]-.5)&(lat<=bounds[3]+.5));ix=np.flatnonzero((lon>=bounds[0]-.5)&(lon<=bounds[1]+.5));values=ec.codes_get_values(g).reshape(nj,ni)[np.ix_(iy,ix)].astype('float32')
    if not np.isfinite(values).all() or values.min()<-.05:raise ValueError('Ongeldige neerslagwaarden')
    if path.stat().st_mtime_ns!=before.st_mtime_ns or path.stat().st_size!=before.st_size:raise ValueError('Bron wijzigde tijdens lezen')
    return lon[ix],lat[iy],np.maximum(values,0)
   finally:ec.codes_release(g)
 raise ValueError('Benodigd neerslagtijdvak ontbreekt')


def validate_totals(values,packing_errors=None):
 """Retain decoded source totals; allow only their documented GRIB uncertainty."""
 if not np.isfinite(values).all() or np.min(values)<0:raise ValueError('Ongeldige cumulatieve neerslag')
 errors=np.asarray(packing_errors if packing_errors is not None else np.full(len(values),.025),dtype=float)
 if errors.shape!=(len(values),) or not np.isfinite(errors).all() or np.any(errors<0):raise ValueError('Ongeldige GRIB-pakprecisie')
 tolerance=(errors[:-1]+errors[1:]).reshape((-1,)+(1,)*(values.ndim-1))
 if np.any(np.diff(values,axis=0)<-tolerance-1e-5):raise ValueError('Cumulatieve neerslag neemt af buiten GRIB-pakprecisie')


def global_data(state,model,run,leads):
 folder=state/'cache'/f'{model}-{run:%Y%m%d%H}';folder.mkdir(parents=True,exist_ok=True);saved=folder/'complete.npz'
 if saved.exists():
  with np.load(saved) as d:
   if not np.array_equal(d['leads'],leads):raise ValueError('Neerslagcache heeft andere tijdas')
   lon,lat,values=d['lon'],d['lat'],d['values'];ix=np.argsort(lon);iy=np.argsort(lat);return lon[ix],lat[iy],values[:,iy][:,:,ix]
 packing_errors=None
 if model=='ecmwf':
  errors={}
  source=state.parent/'wxbeta-northsea/cache'/f'{run:%Y%m%d%H}-elements-1';source.mkdir(parents=True,exist_ok=True);path=source/'tp.grib2'
  with (source/'tp.lock').open('a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX)
   try:coords,records=elements.read(elements.region.PROJECT/'grib_cache/wx_precip24.grib2',run,leads,['tp'],EU,packing_errors=errors)
   except ValueError:
    if not path.exists():
     from ecmwf.opendata import Client
     tmp=path.with_suffix('.tmp.grib2');Client(os.environ.get('WXBETA_REGIONAL_SOURCE','azure')).retrieve(date=run.strftime('%Y%m%d'),time=run.hour,stream='oper',type='fc',step=sorted(set([0]+leads+[h-24 for h in leads if h>=24])),param=['tp'],target=str(tmp));tmp.replace(path)
    coords,records=elements.read(path,run,leads,['tp'],EU,packing_errors=errors)
  packing_errors=[errors['tp'][h] for h in leads]
  lon=np.unique(coords[:,1]);lat=np.unique(coords[:,0])[::-1]
  # Reader preserves latitude/longitude ordering of the original GRIB.
  lon=coords[:len(lon),1];lat=coords[::len(lon),0];values=np.stack([records['tp'][h].reshape(len(lat),len(lon)) for h in leads])
 else:
  records={};lon=lat=None
  for h in leads:
   path=folder/f'{h:03d}.grib2'
   if not path.exists():
    if model=='gfs':
     try:lo,la,v=total_cells(elements.region.PROJECT/'grib_cache'/f'gfs_f{h:03d}.grib2',run,h,model)
     except (ValueError,FileNotFoundError):
      params={'file':f'gfs.t{run.hour:02d}z.pgrb2.0p25.f{h:03d}','dir':f'/gfs.{run:%Y%m%d}/{run.hour:02d}/atmos','subregion':'','var_APCP':'on','lev_surface':'on','leftlon':EU[0]-1,'rightlon':EU[1]+1,'toplat':EU[3]+1,'bottomlat':EU[2]-1}
      download('https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?'+urllib.parse.urlencode(params),path);lo,la,v=total_cells(path,run,h,model)
    else:
     download(f'https://opendata.dwd.de/weather/nwp/icon-eu/grib/{run.hour:02d}/tot_prec/icon-eu_europe_regular-lat-lon_single-level_{run:%Y%m%d%H}_{h:03d}_TOT_PREC.grib2.bz2',path,True);lo,la,v=total_cells(path,run,h,model)
   else:lo,la,v=total_cells(path,run,h,model)
   if lon is not None and (not np.array_equal(lo,lon) or not np.array_equal(la,lat)):raise ValueError('Neerslagrooster wijzigde')
   lon,lat=lo,la;records[h]=v
   if h==leads[0] or h%48==0:print(model,run.strftime('%H'),'cumulatieve bron +',h,flush=True)
  values=bucket_total(records,leads) if model=='gfs' else np.stack([records[h] for h in leads])
 ix=np.argsort(lon);iy=np.argsort(lat);lon=lon[ix];lat=lat[iy];values=values[:,iy][:,:,ix]
 validate_totals(values,packing_errors)
 tmp=saved.with_suffix('.tmp.npz');np.savez_compressed(tmp,lon=lon,lat=lat,values=values,leads=leads);tmp.replace(saved)
 return lon,lat,values


def native_netherlands(state,model,run,leads):
 """Reuse validated exact-run hourly caches, without another point-API request."""
 domain={'ecmwf':'ecmwf_ifs','gfs':'gfs_global','iconeu':'icon_eu'}[model];cache=state.parent/'wxbeta-nl/cache';folders=list(cache.glob(f'{domain}-{run:%Y%m%d%H}-*-1'))
 if len(folders)!=1:raise ValueError('Geen unieke native Nederlandcache')
 points={}
 for path in sorted(folders[0].glob('*.json.gz')):
  responses=json.loads(gzip.decompress(path.read_bytes()))
  if not isinstance(responses,list):responses=[responses]
  for p in responses:
   if p['hourly_units'].get('precipitation')!='mm':raise ValueError('Verkeerde neerslageenheid')
   times={nl.parse(t):i for i,t in enumerate(p['hourly']['time'])};raw=p['hourly']['precipitation'];hours=[run+dt.timedelta(hours=h) for h in range(1,max(leads)+1)]
   if any(t not in times or raw[times[t]] is None for t in hours):raise ValueError('Native neerslag mist uren vanaf de run')
   totals=np.cumsum([raw[times[t]] for t in hours]);points[(p['latitude'],p['longitude'])]=totals[np.asarray(leads)-1]
 if not points:raise ValueError('Lege native neerslagcache')
 coords=np.array(sorted(points));values=np.stack([points[tuple(p)] for p in coords],axis=1).astype('float32')
 if not np.isfinite(values).all() or np.min(np.diff(values,axis=0))<-.05:raise ValueError('Ongeldige native totalen')
 from scipy.spatial import Delaunay,QhullError
 corners=np.array([[NL[0],NL[2]],[NL[1],NL[2]],[NL[0],NL[3]],[NL[1],NL[3]]])
 if len(coords)<4:raise ValueError('Native cache dekt Nederland niet volledig')
 try:covered=np.all(Delaunay(coords[:,[1,0]]).find_simplex(corners)>=0)
 except QhullError:covered=False
 if not covered:raise ValueError('Native cache dekt Nederland niet volledig')
 return coords,values,{'ecmwf':'native 9 km','gfs':'native circa 13 km','iconeu':'native circa 7 km'}[model]


@lru_cache(maxsize=2)
def geography(area):
 from shapely.geometry import shape
 path=ROOT/('noordzee_omgeving_detail.geojson' if area=='northsea' else 'europa_omgeving_detail.geojson')
 return [shape(f['geometry']) for f in json.loads(path.read_text())['features']]


def render(task):
 import matplotlib
 matplotlib.use('Agg')
 import matplotlib.pyplot as plt
 import matplotlib.patheffects as pe
 from matplotlib.colors import BoundaryNorm
 from matplotlib.ticker import FuncFormatter
 from matplotlib.patches import PathPatch
 from scipy.interpolate import RegularGridInterpolator,LinearNDInterpolator
 model,run,lead,area,lon,lat,values,resolution,out=task
 if out.exists():return
 bounds={'europe':EU,'netherlands':NL,'northsea':NS}[area]
 if model=='iconeu' and area=='europe' and lat is not None:bounds=(max(bounds[0],float(lon.min())),min(bounds[1],float(lon.max())),max(bounds[2],float(lat.min())),min(bounds[3],float(lat.max())))
 middle=(bounds[2]+bounds[3])/2
 xx,yy=np.meshgrid(np.linspace(bounds[0],bounds[1],550),np.linspace(bounds[2],bounds[3],600))
 if lat is None:
  coords=lon;field=LinearNDInterpolator(coords[:,[1,0]],values)(xx,yy);samples=coords[::max(1,len(coords)//350)];labels=LinearNDInterpolator(coords[:,[1,0]],values)(samples[:,1],samples[:,0])
 else:
  interpolate=RegularGridInterpolator((lat,lon),values,bounds_error=True);field=interpolate(np.stack([yy,xx],axis=-1));xids=np.flatnonzero((lon>bounds[0])&(lon<bounds[1]));yids=np.flatnonzero((lat>bounds[2])&(lat<bounds[3]));ix=np.unique(np.linspace(xids[0],xids[-1],min(22,len(xids))).astype(int));iy=np.unique(np.linspace(yids[0],yids[-1],min(16,len(yids))).astype(int));sx,sy=np.meshgrid(lon[ix],lat[iy]);samples=np.column_stack([sy.ravel(),sx.ravel()]);labels=values[np.ix_(iy,ix)].ravel()
 if not np.isfinite(field).all():raise ValueError('Neerslagrooster dekt kaart niet')
 fig=plt.figure(figsize=(12.5,12.5),dpi=288);ax=fig.add_axes([.025,.135,.95,.75]);ax.set_xlim(bounds[:2]);ax.set_ylim(bounds[2:]);ax.set_aspect(1/np.cos(np.radians(middle)))
 levels=[0,.1,1,2,5,10,20,30,50,75,100,150,200,300,500];cf=ax.contourf(xx,yy,field,levels=levels,cmap=plt.get_cmap('YlGnBu',len(levels)-1),norm=BoundaryNorm(levels,len(levels)-1),extend='max',antialiased=True)
 if area=='netherlands':
  from basemap import setup,outlines
  clip=setup(ax);cf.set_clip_path(clip);outlines(ax)
 else:
  for land in geography(area):ax.add_patch(PathPatch(geometry_path(land),facecolor='none',edgecolor='#294652',linewidth=.85,zorder=5))
 for (y,x),v in zip(samples,labels):
  if not bounds[0]+(bounds[1]-bounds[0])*.015<x<bounds[1]-(bounds[1]-bounds[0])*.015 or not bounds[2]+(bounds[3]-bounds[2])*.015<y<bounds[3]-(bounds[3]-bounds[2])*.015:continue
  t=ax.text(x,y,(f'{v:.1f}' if v<10 else str(round(float(v)))).replace('.',','),ha='center',va='center',fontsize=7.3,weight='bold',color='#183846',zorder=7);t.set_path_effects([pe.withStroke(linewidth=2,foreground='#ffffffeb')])
 ax.set_xticks([]);ax.set_yticks([])
 for spine in ax.spines.values():spine.set_visible(False)
 title={'europe':'EUROPA','netherlands':'NEDERLAND','northsea':'NOORDZEE & BRITSE EILANDEN'}[area];name={'ecmwf':'ECMWF IFS','gfs':'GFS','iconeu':'ICON-EU'}[model]
 header(fig,'Cumulatieve neerslag vanaf modelrun',run,run+dt.timedelta(hours=lead),f'{name} · {resolution} · opgeteld vanaf +0 tot +{lead} uur · mm',region=title)
 cax=fig.add_axes([.08,.075,.84,.016]);cb=fig.colorbar(cf,cax=cax,orientation='horizontal',ticks=levels,spacing='uniform');cb.ax.tick_params(labelsize=9);cb.ax.xaxis.set_major_formatter(FuncFormatter(lambda value,pos:f'{value:g}'.replace('.',',')));cb.set_label('Totale neerslag sinds de modelrun (mm) · inclusief water-equivalent van sneeuw',fontsize=10)
 footer(fig,'Modelwaarden · '+{'ecmwf':'ECMWF Open Data','gfs':'NOAA/NCEP GFS Open Data','iconeu':'DWD ICON-EU Open Data'}[model]);out.parent.mkdir(parents=True,exist_ok=True);tmp=out.with_suffix('.tmp.png');fig.savefig(tmp,facecolor='white',dpi=288);plt.close(fig);tmp.replace(out)


def main():
 ap=argparse.ArgumentParser();ap.add_argument('--state',type=Path,required=True);ap.add_argument('--publish',action='store_true');ap.add_argument('--regions',nargs='+',choices=['europe','netherlands','northsea']);ap.add_argument('--models',nargs='+',default=['ecmwf','gfs']);ap.add_argument('--cycles',nargs='+',default=['00','18','12','06']);args=ap.parse_args();args.models=[m for m in args.models if m not in ("iconeu","icon_eu")];args.state.mkdir(parents=True,exist_ok=True)
 lock=(args.state/'build.lock').open('a')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 meta=nl.public_meta();path=args.state/'current.json';manifest=json.loads(path.read_text()) if path.exists() else {'base':'https://data.weerlab.nl/wxbeta-cumulative/','regions':{}};errors=[]
 for model in args.models:
  for cc in args.cycles:
   source=meta['data'][model]['runs'].get(cc)
   if not source or 'precip24' not in source['files']:continue
   run=nl.parse(source['run_utc']);leads=[f['lead'] for f in source['frames']];areas=['europe','netherlands']+(['northsea'] if model=='ecmwf' else []);areas=[area for area in areas if not args.regions or area in args.regions]
   try:
    if all(manifest.get('regions',{}).get(area,{}).get('models',{}).get(model,{}).get('runs',{}).get(cc,{}).get('run_utc')==source['run_utc'] and manifest['regions'][area]['models'][model]['runs'][cc].get('renderer')==revision(area) for area in areas):continue
    lon,lat,values=global_data(args.state,model,run,leads)
    for area in areas:
     old=manifest.get('regions',{}).get(area,{}).get('models',{}).get(model,{}).get('runs',{}).get(cc,{})
     if old.get('run_utc')==source['run_utc'] and old.get('renderer')==revision(area):continue
     xx,yy,vv=lon,lat,values;resolution='0,25° · circa 25 km' if model!='iconeu' else 'native circa 7 km'
     if area=='netherlands':
      try:xx,vv,resolution=native_netherlands(args.state,model,run,leads);yy=None
      except ValueError as e:print(model,cc,'Nederland:',str(e),'· exact globaal rooster gebruikt',flush=True)
     folder=f'{model}-{run:%Y%m%d%H}-{area}-{revision(area)}';dest=args.state/'maps'/folder
     tasks=[(model,run,h,area,xx,yy,vv[i],resolution,dest/f'precip_total_{h:03d}.png') for i,h in enumerate(leads)]
     with concurrent.futures.ProcessPoolExecutor(max_workers=3) as pool:
      for i,_ in enumerate(pool.map(render,tasks)):
       if i%24==0:print(model,cc,area,'cumulatief',i+1,'/',len(tasks),flush=True)
     if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copy',str(dest),f'r2:weerlab-data/wxbeta-cumulative/{folder}','--transfers','8','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
     with (args.state/'publish.lock').open('a') as publication:
      fcntl.flock(publication,fcntl.LOCK_EX)
      if path.exists():manifest=json.loads(path.read_text())
      target=manifest['regions'].setdefault(area,{}).setdefault('models',{}).setdefault(model,{}).setdefault('runs',{})
      target[cc]={'run_utc':source['run_utc'],'renderer':revision(area),'resolution':resolution,'modelLabel':{'ecmwf':'ECMWF IFS','gfs':'GFS','iconeu':'ICON-EU'}[model],'frames':source['frames'],'files':{'precip_total':[f'{folder}/precip_total_{h:03d}.png' for h in leads]}}
      manifest['updated']=dt.datetime.now(dt.timezone.utc).isoformat();tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(manifest));tmp.replace(path)
      if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(path),'r2:weerlab-data/wxbeta-cumulative/current.json','--header-upload','Cache-Control: no-cache'],check=True)
     print(model,cc,area,'cumulatieve neerslag gepubliceerd',flush=True)
   except Exception as e:errors.append(model+' '+cc+': '+str(e));print(errors[-1],flush=True)
 if errors:raise SystemExit('; '.join(errors))
if __name__=='__main__':main()
