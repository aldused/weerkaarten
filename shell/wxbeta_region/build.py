"""Independent high-resolution North Sea gust charts from exact ECMWF GRIB runs.

Uses the same Dutch presentation as Netherlands charts. Each publication has
its own immutable files; a missing run never falls back to another cycle.
"""
import os
import argparse,concurrent.futures,datetime as dt,fcntl,json,sys,subprocess
from functools import lru_cache
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'shell'))
from wxbeta_network import configure
configure()
sys.path.insert(0,str(ROOT/'shell/wxbeta_nl'))
from presentation import header,footer
from basemap import geometry_path
BOUNDS=(-13,14,46,61.5)
REV='northsea-local-1'
UTC=dt.timezone.utc
PROJECT=Path('/Users/aldus/KNMI_Project')


def load(path,run,leads):
 import eccodes as ec
 before=path.stat();records={};grid=None;coordinates=None
 with path.open('rb') as stream:
  while (g:=ec.codes_grib_new_from_file(stream)) is not None:
   try:
    name=ec.codes_get(g,'shortName');lead=int(ec.codes_get(g,'endStep'))
    if name not in ('msl','10fg','10fg3','10fg6') or lead not in leads:continue
    actual=dt.datetime.strptime(str(ec.codes_get(g,'dataDate'))+str(ec.codes_get(g,'dataTime')).zfill(4),'%Y%m%d%H%M').replace(tzinfo=UTC)
    if actual!=run:raise ValueError('GRIB hoort bij een andere run')
    if ec.codes_get(g,'centre')!='ecmf' or ec.codes_get(g,'dataType')!='fc' or ec.codes_get(g,'gridType')!='regular_ll':raise ValueError('Geen operationeel ECMWF-rooster')
    if ec.codes_get(g,'stepUnits')!=1 or ec.codes_get(g,'numberOfMissing'):raise ValueError('Ontbrekende waarden of verkeerde tijdseenheid')
    ni,nj=ec.codes_get(g,'Ni'),ec.codes_get(g,'Nj');signature=ec.codes_get(g,'md5GridSection')
    if grid is None:
     grid=signature;lat=ec.codes_get_array(g,'latitudes').reshape(nj,ni)[:,0];lon=(ec.codes_get_array(g,'longitudes').reshape(nj,ni)[0]+180)%360-180
     iy=np.flatnonzero((lat>=BOUNDS[2]-.5)&(lat<=BOUNDS[3]+.5));ix=np.flatnonzero((lon>=BOUNDS[0]-.5)&(lon<=BOUNDS[1]+.5));xx,yy=np.meshgrid(lon[ix],lat[iy]);coordinates=np.column_stack([yy.ravel(),xx.ravel()])
    if signature!=grid:raise ValueError('Gemengde roosters')
    values=ec.codes_get_values(g).reshape(nj,ni)[np.ix_(iy,ix)].astype('float32')
    slot=records.setdefault(lead,{})
    if name=='msl':
     if ec.codes_get(g,'units')!='Pa':raise ValueError('Verkeerde luchtdrukeenheid')
     slot['pressure']=values/100
    else:
     start=int(ec.codes_get(g,'startStep'))
     if ec.codes_get(g,'units')!='m s**-1' or ec.codes_get(g,'stepType')!='max' or not 0<=start<lead:raise ValueError('Ongeldig windstootinterval')
     slot['gust']=values*3.6;slot['interval']=(start,lead)
   finally:ec.codes_release(g)
 if path.stat().st_mtime_ns!=before.st_mtime_ns or path.stat().st_size!=before.st_size:raise ValueError('Bron wijzigde tijdens lezen')
 for lead in leads:
  record=records.get(lead,{})
  if set(record)!= {'pressure','gust','interval'}:raise ValueError('Onvolledige geldigheid '+str(lead))
  if not np.isfinite(record['gust']).all() or not np.isfinite(record['pressure']).all():raise ValueError('Niet-eindige waarden')
  if record['gust'].min()<0 or record['gust'].max()>540 or record['pressure'].min()<850 or record['pressure'].max()>1100:raise ValueError('Onmogelijke modelwaarde')
 return lon[ix],lat[iy],records


@lru_cache(maxsize=1)
def geography():
 from shapely.geometry import shape
 return [shape(f['geometry']) for f in json.loads((ROOT/'noordzee_omgeving_detail.geojson').read_text())['features']]


def render(task):
 import matplotlib
 matplotlib.use('Agg')
 import matplotlib.pyplot as plt
 import matplotlib.patheffects as pe
 from matplotlib.colors import ListedColormap,BoundaryNorm
 from matplotlib.patches import PathPatch
 from scipy.ndimage import minimum_filter,maximum_filter
 run,lead,lon,lat,record,out=task
 if out.exists():return
 fig=plt.figure(figsize=(12.5,12.5),dpi=288);ax=fig.add_axes([.025,.135,.95,.75]);ax.set_xlim(BOUNDS[:2]);ax.set_ylim(BOUNDS[2:]);ax.set_aspect(1/np.cos(np.radians(54)))
 levels=[0,20,40,50,60,70,80,90,100,120,140,160]
 colors=['#e6f0fa','#c1def0','#88c1df','#7bc677','#bbd85b','#f0e65b','#f6ba48','#f78c3d','#e85127','#c92c24','#8a1d68']
 cf=ax.contourf(lon,lat,record['gust'],levels=levels,cmap=ListedColormap(colors),norm=BoundaryNorm(levels,len(colors)),extend='max',antialiased=True)
 p=record['pressure'];cs=ax.contour(lon,lat,p,levels=np.arange(880,1081,4),colors='#fff',linewidths=1,zorder=4)
 for label in ax.clabel(cs,inline=True,fontsize=10,fmt='%d'):label.set_path_effects([pe.withStroke(linewidth=2,foreground='#294452b0')])
 for land in geography():ax.add_patch(PathPatch(geometry_path(land),facecolor='none',edgecolor='#243e49',linewidth=.85,zorder=5))
 # Actual 0.25-degree cells, evenly thinned to approximately 300 labels.
 for iy in range(0,len(lat),4):
  for ix in range(0,len(lon),5):
   x,y=lon[ix],lat[iy]
   if not BOUNDS[0]+.3<x<BOUNDS[1]-.3 or not BOUNDS[2]+.2<y<BOUNDS[3]-.2:continue
   t=ax.text(x,y,str(round(float(record['gust'][iy,ix]))),ha='center',va='center',fontsize=7.2,weight='bold',color='#19333f',zorder=6)
   t.set_path_effects([pe.withStroke(linewidth=2,foreground='#ffffffdd')])
 # A pressure centre must be interior and a genuine neighbourhood extremum.
 for kind,filtered in [('L',minimum_filter(p,size=17)),('H',maximum_filter(p,size=17))]:
  candidates=np.argwhere((p==filtered)&(p<1008 if kind=='L' else p>1020));placed=[]
  candidates=sorted(candidates,key=lambda q:float(p[tuple(q)]),reverse=kind=='H')
  for iy,ix in candidates:
   x,y=lon[ix],lat[iy]
   if not BOUNDS[0]+1<x<BOUNDS[1]-1 or not BOUNDS[2]+.7<y<BOUNDS[3]-.7 or any(np.hypot((x-a)*.6,y-b)<4 for a,b in placed):continue
   placed.append((x,y));t=ax.text(x,y,kind+'\n'+str(round(float(p[iy,ix]))),ha='center',va='center',fontsize=19,weight='bold',color='#17313d',zorder=9);t.set_path_effects([pe.withStroke(linewidth=4,foreground='white')])
 ax.set_xticks([]);ax.set_yticks([])
 for spine in ax.spines.values():spine.set_visible(False)
 start,end=record['interval']
 header(fig,'Maximale windstoten op 10 m',run,run+dt.timedelta(hours=lead),f'ECMWF IFS · 0,25° / circa 25 km · maximum over {end-start} uur · km/u',region='NOORDZEE & BRITSE EILANDEN')
 cax=fig.add_axes([.08,.075,.84,.016]);bar=fig.colorbar(cf,cax=cax,orientation='horizontal',ticks=levels,spacing='proportional');bar.ax.tick_params(labelsize=9);bar.set_label('Maximale windstoot (km/u) · witte lijnen: luchtdruk (hPa)',fontsize=10)
 footer(fig,'Oorspronkelijke modelwaarden · ECMWF Open Data · kustlijnen: Natural Earth')
 out.parent.mkdir(parents=True,exist_ok=True);tmp=out.with_suffix('.tmp.png');fig.savefig(tmp,facecolor='white',dpi=288);plt.close(fig);tmp.replace(out)


def main():
 ap=argparse.ArgumentParser();ap.add_argument('--state',type=Path,required=True);ap.add_argument('--publish',action='store_true');ap.add_argument('--cycles',nargs='+',default=['00','18','12','06']);args=ap.parse_args();args.state.mkdir(parents=True,exist_ok=True)
 lock=(args.state/'build.lock').open('a')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 import urllib.request
 meta=json.load(urllib.request.urlopen(urllib.request.Request('https://data.weerlab.nl/wxbeta_meta.json',headers={'User-Agent':'Weerlab North Sea charts/1.0','Cache-Control':'no-cache'}),timeout=30));manifest_path=args.state/'current.json';manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {'base':'https://data.weerlab.nl/wxbeta-northsea/','runs':{}}
 for cycle in args.cycles:
  source=meta['data']['ecmwf']['runs'].get(cycle)
  if not source:continue
  run=dt.datetime.fromisoformat(source['run_utc'].replace('Z','+00:00'));leads=[f['lead'] for f in source['frames']]
  if manifest['runs'].get(cycle,{}).get('run_utc')==source['run_utc'] and manifest['runs'][cycle].get('renderer')==REV:continue
  cache=args.state/'cache';cache.mkdir(exist_ok=True);npz=cache/f'{run:%Y%m%d%H}.npz'
  if npz.exists():
   with np.load(npz,allow_pickle=False) as d:lon=d['lon'];lat=d['lat'];records={h:{'gust':d['gust'][i],'pressure':d['pressure'][i],'interval':d['interval'][i]} for i,h in enumerate(leads)}
  else:
   raw=cache/f'{run:%Y%m%d%H}.grib2'
   if not raw.exists():
    try:lon,lat,records=load(PROJECT/'grib_cache/wx_gust.grib2',run,leads)
    except ValueError:
     from ecmwf.opendata import Client
     tmp=raw.with_suffix('.tmp.grib2');Client(os.environ.get('ECMWF_OPEN_DATA_SOURCE','google')).retrieve(date=run.strftime('%Y%m%d'),time=run.hour,stream='oper',type='fc',step=leads,param=['msl','10fg','10fg3'],target=str(tmp));tmp.replace(raw)
     lon,lat,records=load(raw,run,leads)
   else:lon,lat,records=load(raw,run,leads)
   np.savez_compressed(npz,lon=lon,lat=lat,gust=np.stack([records[h]['gust'] for h in leads]),pressure=np.stack([records[h]['pressure'] for h in leads]),interval=np.array([records[h]['interval'] for h in leads]))
  folder=f'{run:%Y%m%d%H}-{REV}';dest=args.state/'maps'/folder
  tasks=[(run,h,lon,lat,records[h],dest/f'gust_{h:03d}.png') for h in leads]
  with concurrent.futures.ProcessPoolExecutor(max_workers=3) as pool:
   for i,_ in enumerate(pool.map(render,tasks)):
    if i%12==0:print(cycle,'Noordzee',i+1,'/',len(tasks),flush=True)
  if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copy',str(dest),f'r2:weerlab-data/wxbeta-northsea/{folder}','--transfers','8','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
  with (args.state/'publish.lock').open('a') as publication:
   fcntl.flock(publication,fcntl.LOCK_EX)
   manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {'base':'https://data.weerlab.nl/wxbeta-northsea/','runs':{}}
   previous=manifest['runs'].get(cycle,{})
   layers=previous.get('layers',{}) if previous.get('run_utc')==source['run_utc'] else {}
   manifest['runs'][cycle]={'run_utc':source['run_utc'],'renderer':REV,'resolution':'0,25° · circa 25 km','frames':source['frames'],'files':{'gust':[f'{folder}/gust_{h:03d}.png' for h in leads]},'layers':layers}
   manifest['updated']=dt.datetime.now(UTC).isoformat();tmp=manifest_path.with_suffix('.tmp');tmp.write_text(json.dumps(manifest));tmp.replace(manifest_path)
   if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(manifest_path),'r2:weerlab-data/wxbeta-northsea/current.json','--header-upload','Cache-Control: no-cache'],check=True)
  print(cycle,'Noordzeekaarten gepubliceerd',flush=True)
if __name__=='__main__':main()
