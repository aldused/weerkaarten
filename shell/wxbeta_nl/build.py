"""Native 9 km ECMWF Netherlands gust maps, pinned to the Europe viewer's runs."""
import argparse,datetime as dt,gzip,hashlib,json,os,sys,urllib.parse,urllib.request,concurrent.futures
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from om_common import fetch,parse,iso,UTC
sys.path.insert(0,str(Path(__file__).resolve().parent))
from basemap import BOUNDS,setup as map_setup,outlines as map_outlines
from presentation import header as map_header,footer as map_footer
REV='nl-ecmwf-direct-10day-1'
ROOT=Path(__file__).resolve().parents[2]

def steps(cycle):return list(range(3,145,3))+(list(range(150,241,6)) if cycle in (0,12) else [])
def source_meta(run):return fetch(f'https://api.open-meteo.com/data_run/ecmwf_ifs/{run:%Y/%m/%d/%H%M}Z/meta.json')
def sample_point(p,run,leads):
 h=p['hourly'];lookup={parse(t):i for i,t in enumerate(h['time'])}
 if p['hourly_units'].get('wind_gusts_10m')!='m/s' or p['hourly_units'].get('pressure_msl')!='hPa':raise ValueError('Verkeerde broneenheden')
 gust=np.array([np.nan if v is None else v for v in h['wind_gusts_10m']],float);pressure=np.array([np.nan if v is None else v for v in h['pressure_msl']],float)
 result=[]
 for lead in leads:
  valid=run+dt.timedelta(hours=lead);i=lookup.get(valid)
  if i is None:raise ValueError('Ontbrekende prognosetermijn')
  indices=[lookup.get(valid-dt.timedelta(hours=j)) for j in range(3)] if lead<=90 else [i]
  if None in indices:raise ValueError('Onvolledig windstootinterval')
  g=gust[indices].max();pr=pressure[i]
  if not np.isfinite([g,pr]).all() or not 0<=g<=150 or not 850<=pr<=1100:raise ValueError('Ongeldige windstoot of luchtdruk')
  result.append([g*3.6,pr])
 return np.asarray(result,dtype='float32')
def retrieve(run,cache):
 before=source_meta(run)
 if parse(before['reference_time'])!=run:raise ValueError('Verkeerde modelrun')
 leads=steps(run.hour);available={parse(t) for t in before['valid_times']}
 if any(run+dt.timedelta(hours=h) not in available for h in leads):raise ValueError('Native run nog onvolledig')
 identity=hashlib.sha256(json.dumps(before,sort_keys=True).encode()).hexdigest()[:10]
 domain=hashlib.sha256(json.dumps(BOUNDS).encode()).hexdigest()[:8]
 root=cache/f'{run:%Y%m%d%H}-{identity}-{domain}';root.mkdir(parents=True,exist_ok=True)
 saved=root/'complete.npz'
 if saved.exists():
  with np.load(saved) as data:return data['coordinates'],data['values'],identity
 points=[(round(float(lat),4),round(float(lon),4)) for lat in np.arange(BOUNDS[2]-.14,BOUNDS[3]+.15,.07) for lon in np.arange(BOUNDS[0]-.22,BOUNDS[1]+.23,.11)]
 unique={}
 for batch,start in enumerate(range(0,len(points),60)):
  subset=points[start:start+60];path=root/f'{batch}.json.gz'
  if path.exists():responses=json.loads(gzip.decompress(path.read_bytes()))
  else:
   params=dict(latitude=','.join(str(p[0]) for p in subset),longitude=','.join(str(p[1]) for p in subset),hourly='wind_gusts_10m,pressure_msl',models='ecmwf_ifs',run=run.strftime('%Y-%m-%dT%H:%M'),forecast_days=16 if run.hour in (0,12) else 7,timezone='GMT',wind_speed_unit='ms',elevation=','.join('nan' for _ in subset),cell_selection='nearest')
   responses=fetch('https://customer-single-runs-api.open-meteo.com/v1/forecast?'+urllib.parse.urlencode(params))
   if not isinstance(responses,list):responses=[responses]
   if len(responses)!=len(subset):raise ValueError('Onvolledige roosterbatch')
   tmp=path.with_suffix('.tmp');tmp.write_bytes(gzip.compress(json.dumps(responses).encode()));tmp.replace(path)
  for point in responses:unique[(point['latitude'],point['longitude'])]=sample_point(point,run,leads)
  print(f'{run:%H}Z native batch {batch+1}/{(len(points)+59)//60}',flush=True)
 after=source_meta(run)
 if before!=after:raise ValueError('Bron veranderde tijdens ophalen')
 coordinates=np.asarray(sorted(unique));values=np.stack([unique[tuple(p)] for p in coordinates],axis=1)
 temporary=saved.with_suffix('.tmp.npz');np.savez(temporary,coordinates=coordinates,values=values);temporary.replace(saved)
 return coordinates,values,identity

def render(task):
 import matplotlib
 matplotlib.use('Agg')
 import matplotlib.pyplot as plt
 import matplotlib.patheffects as pe
 from matplotlib.colors import ListedColormap,BoundaryNorm
 from matplotlib.collections import LineCollection
 from scipy.interpolate import LinearNDInterpolator
 from scipy.spatial import Delaunay
 run,lead,coords,values,out=task
 if out.exists():return
 x=np.linspace(BOUNDS[0],BOUNDS[1],360);y=np.linspace(BOUNDS[2],BOUNDS[3],410);xx,yy=np.meshgrid(x,y)
 z=LinearNDInterpolator(Delaunay(coords[:,[1,0]]),values)(xx,yy)
 if not np.isfinite(z).all():raise ValueError('Native rooster dekt kaart niet volledig')
 levels=[0,20,40,50,60,70,80,90,100,120,140,160]
 colors=['#e6f0fa','#c1def0','#88c1df','#7bc677','#bbd85b','#f0e65b','#f6ba48','#f78c3d','#e85127','#c92c24','#8a1d68']
 fig=plt.figure(figsize=(12.5,12.5),dpi=288);ax=fig.add_axes([.025,.135,.95,.75]);ax.set_xlim(BOUNDS[:2]);ax.set_ylim(BOUNDS[2:]);ax.set_aspect(1/np.cos(np.radians(52.2)))
 clip=map_setup(ax)
 cf=ax.contourf(xx,yy,z[:,:,0],levels=levels,cmap=ListedColormap(colors),norm=BoundaryNorm(levels,len(colors)),extend='max',antialiased=True);cf.set_clip_path(clip)
 pressure=z[:,:,1];lo=int(np.floor(pressure.min()/2)*2);hi=int(np.ceil(pressure.max()/2)*2)
 if hi>lo:
  cs=ax.contour(xx,yy,pressure,levels=np.arange(lo,hi+1,2),colors='#526779',linewidths=.85,alpha=.95)
  for label in ax.clabel(cs,inline=True,fontsize=10,fmt='%d'):label.set_path_effects([pe.withStroke(linewidth=2,foreground='#ffffffdc')])
 map_outlines(ax)
 # Exact native cell values; thin labels in both directions to avoid overlap.
 rows=np.unique(coords[:,0]);chosen=rows[::2]
 for lat in chosen:
  ids=np.flatnonzero(coords[:,0]==lat);ids=ids[np.argsort(coords[ids,1])][::2]
  for i in ids:
   la,lon=coords[i]
   if not BOUNDS[0]+.04<lon<BOUNDS[1]-.04 or not BOUNDS[2]+.035<la<BOUNDS[3]-.035:continue
   text=ax.text(lon,la,str(round(float(values[i,0]))),ha='center',va='center',fontsize=7.8,fontweight='bold',color='#17353e',zorder=6)
   text.set_path_effects([pe.withStroke(linewidth=2,foreground='#ffffffdc')])
 ax.set_xticks([]);ax.set_yticks([])
 for spine in ax.spines.values():spine.set_visible(False)
 valid=run+dt.timedelta(hours=lead);interval=3 if lead<=144 else 6
 map_header(fig,'Maximale windstoten op 10 m',run,valid,f'ECMWF IFS · native 9 km · maximum over {interval} uur · km/u')
 cax=fig.add_axes([.08,.075,.84,.016]);cb=fig.colorbar(cf,cax=cax,orientation='horizontal',ticks=levels,spacing='proportional');cb.ax.tick_params(labelsize=9);cb.set_label('Maximale windstoot 10 m (km/u) · lijnen: luchtdruk (hPa)',fontsize=10)
 map_footer(fig,'Modelwaarden · kleuren op land, cijfers ook op zee · ECMWF Open Data rechtstreeks, CC BY 4.0')
 out.parent.mkdir(parents=True,exist_ok=True);temporary=out.with_suffix('.tmp.png');fig.savefig(temporary,facecolor='white',dpi=288);plt.close(fig);temporary.replace(out)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--state',type=Path,required=True);ap.add_argument('--cycles',nargs='+',type=int,default=[18,12,6,0]);ap.add_argument('--publish',action='store_true');args=ap.parse_args();args.state.mkdir(parents=True,exist_ok=True)
 import fcntl,subprocess
 lock=(args.state/'build.lock').open('w')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 meta=json.load(urllib.request.urlopen(urllib.request.Request('https://data.weerlab.nl/wxbeta_meta.json',headers={'User-Agent':'Weerlab Netherlands charts/1.0','Cache-Control':'no-cache'}),timeout=30));manifest_path=args.state/'current.json';manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else dict(base='https://data.weerlab.nl/wxbeta-nl/',runs={})
 errors=[]
 for cycle in sorted(args.cycles,key=lambda c:parse(meta['data']['ecmwf']['runs'].get(f'{c:02d}',{}).get('run_utc','1970-01-01T00:00Z')),reverse=True):
  key=f'{cycle:02d}';source=meta['data']['ecmwf']['runs'].get(key)
  if not source:continue
  run=parse(source['run_utc']);old=manifest['runs'].get(key)
  if old and parse(old['run_utc'])==run and old.get('renderer')==REV:print(key,'NL al compleet',flush=True);continue
  try:
   coords,values,identity=retrieve(run,args.state/'cache');leads=steps(cycle);folder=f'{run:%Y%m%d%H}-{identity}-{REV}'
   tasks=[(run,lead,coords,values[i],args.state/'maps'/folder/f'gust_{lead:03d}.png') for i,lead in enumerate(leads)]
   with concurrent.futures.ProcessPoolExecutor(max_workers=4) as pool:
    for i,_ in enumerate(pool.map(render,tasks)):print(f'{key}Z kaart {i+1}/{len(tasks)}',flush=True)
   if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copy',str(args.state/'maps'/folder),f'r2:weerlab-data/wxbeta-nl/{folder}','--transfers','8','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
   entry=dict(run_utc=iso(run),base=manifest['base'],renderer=REV,maxlead=leads[-1],frames=[dict(lead=h,valid_utc=iso(run+dt.timedelta(hours=h)),valid_label=(run+dt.timedelta(hours=h)).strftime('%d-%m-%Y %H:%M UTC')) for h in leads],files={'gust':[f'{folder}/gust_{h:03d}.png' for h in leads]})
   with (args.state/'publish.lock').open('w') as publication:
    fcntl.flock(publication,fcntl.LOCK_EX)
    manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else dict(base='https://data.weerlab.nl/wxbeta-nl/',runs={})
    previous=manifest['runs'].get(key,{})
    if previous.get('run_utc')==entry['run_utc'] and previous.get('layers'):entry['layers']=previous['layers']
    entry['resolution']='9 km';manifest['runs'][key]=entry
    manifest['updated']=iso(dt.datetime.now(UTC));tmp=manifest_path.with_suffix('.tmp');tmp.write_text(json.dumps(manifest));tmp.replace(manifest_path)
    if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(manifest_path),'r2:weerlab-data/wxbeta-nl/current.json','--header-upload','Cache-Control: no-cache'],check=True)
   print(key,'Nederland gepubliceerd',flush=True)
  except Exception as e:errors.append(key+': '+str(e));print(errors[-1],flush=True)
 if errors:raise SystemExit('; '.join(errors))
if __name__=='__main__':main()
