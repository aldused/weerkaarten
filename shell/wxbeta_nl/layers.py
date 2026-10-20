"""Render Netherlands charts from exact-run model cells, never enlarged Europe PNGs."""
import sys,argparse,concurrent.futures,datetime as dt,fcntl,gzip,hashlib,json,subprocess,urllib.parse,urllib.request
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'wind_six'))
from build import fetch,parse,iso,UTC
sys.path.insert(0,str(Path(__file__).resolve().parent))
from basemap import BOUNDS,setup as map_setup,outlines as map_outlines
from presentation import header as map_header,footer as map_footer
ROOT=Path(__file__).resolve().parents[2]
def steps(cycle):return list(range(3,145,3))+(list(range(150,361,6)) if cycle in (0,12) else [])
REV='nl-mosmap-local-3'
def revision(layer):return REV+'-cloud4' if layer=='overview' else REV+'-bft2' if layer=='mslp_bft' else REV
SURFACE={'temperature_2m':'°C','pressure_msl':'hPa','wind_speed_10m':'m/s','wind_direction_10m':'°','cloud_cover':'%','precipitation':'mm','cape':'J/kg'}
UPPER={'temperature_850hPa':'°C','geopotential_height_500hPa':'m','wind_speed_300hPa':'m/s','wind_direction_300hPa':'°','pressure_msl':'hPa'}
MODEL_INFO={'ecmwf_ifs':('ECMWF IFS','native 9 km',2),'ecmwf_ifs025':('ECMWF IFS','0,25° · circa 25 km',1),'gfs025':('GFS','0,25° · circa 25 km',1),'gfs_global':('GFS','native circa 13 km',2),'icon_eu':('ICON-EU','native circa 7 km',3),'ecmwf_ens':('ECMWF ENS-gemiddelde','0,25° · circa 25 km',1),'cams':('CAMS · Saharastof','native circa 40 km',1)}
def resolution_for(model,layer):return '0,25° · circa 25 km' if model=='gfs_global' and layer in ('t850','z500') else MODEL_INFO[model][1]
DOMAINS={'gfs_global':'ncep_gfs013','icon_eu':'dwd_icon_eu'}
def fields_for(model):
 if model=='ecmwf_ifs':return SURFACE
 if model=='ecmwf_ifs025':return UPPER
 return {**SURFACE,**{k:v for k,v in UPPER.items() if not k.startswith('wind_')}}
LAYERS={'ecmwf_ifs':['mslp_bft','overview','t2m','wind','cape','precip24'],'ecmwf_ifs025':['t850','z500','jetstream']}
LABELS={'t2m':('Temperatuur op 2 meter','°C'),'overview':('Temperatuur, bewolking en neerslag','°C'),'wind':('Wind op 10 meter','km/u'),'mslp_bft':('Windkracht en luchtdruk','Bft'),'cape':('CAPE','J/kg'),'precip24':('Neerslag in de voorgaande 24 uur','mm'),'t850':('Temperatuur op 850 hPa','°C'),'z500':('Geopotentiële hoogte op 500 hPa','dam'),'jetstream':('Wind op 300 hPa','kn'),'dust_europe':('Saharastof · optische dikte op 550 nm','AOD')}
BFT=np.array([.3,1.6,3.4,5.5,8,10.8,13.9,17.2,20.8,24.5,28.5,32.7])
def bft(v):return np.searchsorted(BFT,v,side='right')
def public_meta():
 return json.load(urllib.request.urlopen(urllib.request.Request('https://data.weerlab.nl/wxbeta_meta.json',headers={'User-Agent':'Weerlab Netherlands charts/2.0','Cache-Control':'no-cache'}),timeout=30))
def source_meta(model,run):return fetch(f'https://api.open-meteo.com/data_run/{DOMAINS.get(model,model)}/{run:%Y/%m/%d/%H%M}Z/meta.json')
def point_values(p,run,leads,model):
 fields=fields_for(model)
 if any(p['hourly_units'].get(k)!=unit for k,unit in fields.items()):raise ValueError('Onjuiste broneenheden')
 h=p['hourly'];lookup={parse(t):i for i,t in enumerate(h['time'])}
 arrays={k:np.asarray([np.nan if v is None else v for v in h[k]],float) for k in fields}
 records=[]
 for lead in leads:
  valid=run+dt.timedelta(hours=lead)
  if valid not in lookup:raise ValueError('Ontbrekende geldigheid')
  i=lookup[valid];record={k:float(a[i]) for k,a in arrays.items()}
  # API precipitation is an hourly sum, including conservatively distributed
  # native 3/6-hour intervals. Sum complete equal windows, never missing hours.
  if model!='ecmwf_ifs025':
   for hours,key in [(3,'rain3'),(24,'rain24')]:
    ids=[lookup.get(valid-dt.timedelta(hours=j)) for j in range(hours)]
    record[key]=float(arrays['precipitation'][ids].sum()) if None not in ids and lead>=hours else np.nan
   if not np.isfinite(record['rain3']):raise ValueError('Onvolledige neerslagperiode')
  if not all(np.isfinite(record[k]) for k in fields if k!='precipitation'):raise ValueError('Ontbrekende modelwaarde')
  if not 850<=record['pressure_msl']<=1100:raise ValueError('Onmogelijke luchtdruk')
  records.append(record)
 keys=list(records[0]);return keys,np.array([[r[k] for k in keys] for r in records],dtype='float32')
def retrieve(model,run,cache,leads=None):
 before=source_meta(model,run)
 if parse(before['reference_time'])!=run:raise ValueError('Verkeerde bronrun')
 leads=leads or steps(run.hour);available={parse(t) for t in before['valid_times']}
 if any(run+dt.timedelta(hours=h) not in available for h in leads):raise ValueError('Bronrun nog onvolledig')
 identity=hashlib.sha256(json.dumps(before,sort_keys=True).encode()).hexdigest()[:10]
 root=cache/f'{model}-{run:%Y%m%d%H}-{identity}-1';root.mkdir(parents=True,exist_ok=True);saved=root/'complete.npz'
 if saved.exists():
  with np.load(saved) as d:return d['coordinates'],d['values'],d['keys'].tolist(),identity
 dy,dx=(.07,.11) if model=='ecmwf_ifs' else (.09,.12) if model=='gfs_global' else (.06,.06) if model=='icon_eu' else (.25,.25)
 points=[(round(float(y),4),round(float(x),4)) for y in np.arange(BOUNDS[2]-.3,BOUNDS[3]+.31,dy) for x in np.arange(BOUNDS[0]-.4,BOUNDS[1]+.41,dx)]
 fields=fields_for(model);unique={};keys=None
 for batch,start in enumerate(range(0,len(points),60)):
  subset=points[start:start+60];path=root/f'{batch}.json.gz'
  if path.exists():responses=json.loads(gzip.decompress(path.read_bytes()))
  else:
   params=dict(latitude=','.join(str(p[0]) for p in subset),longitude=','.join(str(p[1]) for p in subset),hourly=','.join(fields),models=model,run=run.strftime('%Y-%m-%dT%H:%M'),forecast_days=16 if model=='gfs_global' or run.hour in (0,12) else 7,timezone='GMT',wind_speed_unit='ms',elevation=','.join('nan' for _ in subset),cell_selection='nearest')
   responses=fetch('https://customer-single-runs-api.open-meteo.com/v1/forecast?'+urllib.parse.urlencode(params))
   if not isinstance(responses,list):responses=[responses]
   if len(responses)!=len(subset):raise ValueError('Onvolledige roosterbatch')
   tmp=path.with_suffix('.tmp');tmp.write_bytes(gzip.compress(json.dumps(responses).encode()));tmp.replace(path)
  for p in responses:
   keys,values=point_values(p,run,leads,model);unique[(p['latitude'],p['longitude'])]=values
  print(f'{run:%H}Z {model} batch {batch+1}/{(len(points)+59)//60}',flush=True)
 if source_meta(model,run)!=before:raise ValueError('Bronrun wijzigde tijdens ophalen')
 coords=np.array(sorted(unique));values=np.stack([unique[tuple(p)] for p in coords],axis=1)
 tmp=saved.with_suffix('.tmp.npz');np.savez(tmp,coordinates=coords,values=values,keys=keys);tmp.replace(saved)
 return coords,values,keys,identity

def rings(g):
 if g['type']=='Polygon':return g['coordinates']
 if g['type']=='MultiPolygon':return [ring for poly in g['coordinates'] for ring in poly]
 return []
def chart_values(layer,data):
 if layer in ('t2m','overview'):return data['temperature_2m']
 if layer=='t850':return data['temperature_850hPa']
 if layer=='z500':return data['geopotential_height_500hPa']/10
 if layer=='wind':return data['wind_speed_10m']*3.6
 if layer=='mslp_bft':return bft(data['wind_speed_10m'])
 if layer=='jetstream':return data['wind_speed_300hPa']*1.94384449
 if layer=='cape':return data['cape']
 if layer=='precip24':return data['rain24']
 if layer=='dust_europe':return data['dust']
 raise ValueError(layer)
def palette(layer):
 if layer=='dust_europe':return np.array([0,.005,.01,.025,.05,.1,.2,.3,.5,.75,1,1.5,2,3]),'YlOrBr'
 if layer in ('t2m','overview','t850'):return np.arange(-24,37,1),'turbo'
 if layer=='z500':return np.arange(472,605,4),'turbo'
 if layer=='mslp_bft':return np.arange(-.5,13.5,1),'Spectral_r'
 if layer=='wind':return np.array([0,5,10,15,20,30,40,50,60,70,80,100,120]),'Spectral_r'
 if layer=='jetstream':return np.arange(0,201,10),'turbo'
 if layer=='cape':return np.array([0,50,100,200,300,500,750,1000,1500,2000,3000,4000]),'YlOrRd'
 return np.array([0,.1,.5,1,2,5,10,20,30,50,75,100,150]),'YlGnBu'
def render(task):
 import matplotlib
 matplotlib.use('Agg')
 import matplotlib.pyplot as plt
 import matplotlib.patheffects as pe
 from matplotlib.collections import LineCollection
 from scipy.interpolate import LinearNDInterpolator
 from scipy.spatial import Delaunay
 run,lead,coords,values,keys,layer,model,out=task
 if out.exists():return
 data=dict(zip(keys,values.T));samples=chart_values(layer,data)
 if not np.isfinite(samples).all():raise ValueError('Ontbrekende kaartwaarde')
 x=np.linspace(BOUNDS[0],BOUNDS[1],450);y=np.linspace(BOUNDS[2],BOUNDS[3],500);xx,yy=np.meshgrid(x,y)
 tri=Delaunay(coords[:,[1,0]])
 # Render the actual grid at export resolution, and label actual cells below.
 field=LinearNDInterpolator(tri,samples)(xx,yy)
 if not np.isfinite(field).all():raise ValueError('Rooster dekt Nederland niet')
 fig=plt.figure(figsize=(12.5,12.5),dpi=288);ax=fig.add_axes([.025,.135,.95,.75]);ax.set_xlim(BOUNDS[:2]);ax.set_ylim(BOUNDS[2:]);ax.set_aspect(1/np.cos(np.radians(52.2)))
 clip=map_setup(ax)
 levels,cmap=palette(layer);cf=ax.contourf(xx,yy,field,levels=levels,cmap=cmap,extend='both',antialiased=True);cf.set_clip_path(clip)
 if layer=='overview':
  cloud=LinearNDInterpolator(tri,data['cloud_cover'])(xx,yy)/100
  cloud_image=ax.imshow(np.dstack([np.ones_like(cloud)]*3+[np.clip(cloud*.7,0,.7)]),extent=BOUNDS,origin='lower',aspect='auto',zorder=2);cloud_image.set_clip_path(clip)
  rain=LinearNDInterpolator(tri,data['rain_rate'] if 'rain_rate' in data else data['rain3']/3)(xx,yy)
  rain_cf=ax.contourf(xx,yy,np.ma.masked_less(rain,.1),levels=[.1,.5,1,2,4,8,16,32,64],colors=['#a3d9ee','#77c4e8','#4fa4d6','#347cc1','#2856a5','#243b8c','#4c287a','#812b73'],extend='max',zorder=3,alpha=.9);rain_cf.set_clip_path(clip)
 ax.set_aspect(1/np.cos(np.radians(52.2)))
 if layer not in ('precip24','cape','jetstream','dust_europe'):
  p=np.round(LinearNDInterpolator(tri,data['pressure_msl'])(xx,yy),3);lo=np.floor(p.min()/2)*2;hi=np.ceil(p.max()/2)*2
  if hi>lo:
   cs=ax.contour(xx,yy,p,levels=np.arange(lo,hi+1,2),colors='#526779',linewidths=.7,zorder=4)
   for t in ax.clabel(cs,inline=True,fontsize=9,fmt='%d'):t.set_path_effects([pe.withStroke(linewidth=2,foreground='#ffffffdc')])
 map_outlines(ax)
 # About 300 real native values, including coast, sea and Wadden; no city labels.
 count=0;stride=MODEL_INFO[model][2]
 for lat in np.unique(coords[:,0])[::stride]:
  ids=np.flatnonzero(coords[:,0]==lat);ids=ids[np.argsort(coords[ids,1])][::stride]
  for i in ids:
   la,lon=coords[i]
   if not BOUNDS[0]+.045<lon<BOUNDS[1]-.045 or not BOUNDS[2]+.035<la<BOUNDS[3]-.035:continue
   value=samples[i];label=f'{value:.3f}'.replace('.',',') if layer=='dust_europe' else f'{value:.1f}'.replace('.',',') if layer in ('t2m','t850','overview') else f'{value:.1f}'.replace('.',',') if layer=='precip24' and value<10 else str(round(float(value)))
   t=ax.text(lon,la,label,ha='center',va='center',fontsize=7.4 if stride>1 else 9,color='#17353e',weight='bold',zorder=8);t.set_path_effects([pe.withStroke(linewidth=2.1,foreground='#ffffffed')]);count+=1
   direction='wind_direction_300hPa' if layer=='jetstream' else 'wind_direction_10m' if layer in ('wind','mslp_bft') else None
   if direction:
    a=np.radians(float(data[direction][i]));u=-np.sin(a);v=-np.cos(a)
    ax.annotate('',xy=(lon+u*.06,la+.045+v*.038),xytext=(lon-u*.06,la+.045-v*.038),arrowprops=dict(arrowstyle='->',color='#244354',lw=.7),zorder=7)
 ax.set_xticks([]);ax.set_yticks([])
 for spine in ax.spines.values():spine.set_visible(False)
 valid=run+dt.timedelta(hours=lead);title,unit=LABELS[layer];model_label,_,_=MODEL_INFO[model];resolution=resolution_for(model,layer)
 interval=6 if model=='gfs025' else 3
 note=f' · wit: bewolking · neerslag: gemiddelde over {interval} uur' if layer=='overview' else ''
 map_header(fig,title,run,valid,f'{model_label} · {resolution} · {unit}'+note)
 cax=fig.add_axes([.06,.075,.42,.016] if layer=='overview' else [.08,.075,.84,.016]);cb=fig.colorbar(cf,cax=cax,orientation='horizontal',spacing='proportional');cb.ax.tick_params(labelsize=9);cb.set_ticks(np.arange(13)) if layer=='mslp_bft' else None;cb.set_label(('Temperatuur op 2 meter' if layer=='overview' else 'Windkracht' if layer=='mslp_bft' else title)+' ('+unit+')',fontsize=10)
 if layer=='overview':
  rain_axis=fig.add_axes([.55,.075,.40,.016]);rain_bar=fig.colorbar(rain_cf,cax=rain_axis,orientation='horizontal',spacing='uniform',ticks=[.1,.5,1,2,4,8,16,32,64]);rain_bar.ax.tick_params(labelsize=8);rain_bar.set_label(f'Neerslag · mm/uur · gemiddelde over {interval} uur',fontsize=9)
 credit='NOAA/NCEP GFS Open Data' if model=='gfs025' else 'Copernicus CAMS / ADS' if model=='cams' else 'ECMWF' if model=='ecmwf_ens' else model_label+' / Open-Meteo CC BY 4.0'
 description='modelwaarden' if model=='gfs_global' else 'waarden van oorspronkelijke modelcellen'
 map_footer(fig,f'{count} modelcellen · kleuren op land, cijfers ook op zee · '+credit)
 out.parent.mkdir(parents=True,exist_ok=True);tmp=out.with_suffix('.tmp.png');fig.savefig(tmp,facecolor='white',dpi=288);plt.close(fig);tmp.replace(out)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--state',type=Path,required=True);ap.add_argument('--cycles',nargs='+',type=int,default=[18,12,6,0]);ap.add_argument('--publish',action='store_true');ap.add_argument('--models',nargs='+',default=list(LAYERS));args=ap.parse_args();args.state.mkdir(parents=True,exist_ok=True)
 lock=(args.state/'layers.lock').open('w')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:return
 meta=public_meta();manifest_path=args.state/'current.json';errors=[]
 for cycle in sorted(args.cycles,key=lambda c:parse(meta['data']['ecmwf']['runs'].get(f'{c:02d}',{}).get('run_utc','1970-01-01T00:00Z')),reverse=True):
  key=f'{cycle:02d}';source=meta['data']['ecmwf']['runs'].get(key)
  if not source:continue
  run=parse(source['run_utc'])
  for model in args.models:
   try:
    manifest=json.loads(manifest_path.read_text());entry=manifest['runs'].get(key,{})
    if parse(entry.get('run_utc','1970-01-01T00:00Z'))!=run:raise ValueError('Nederland windstootrun nog niet gereed')
    if all(entry.get('layers',{}).get(layer,{}).get('renderer')==revision(layer) for layer in LAYERS[model]):print(key,model,'al compleet',flush=True);continue
    coords,values,keys,identity=retrieve(model,run,args.state/'cache');leads=steps(cycle);basefolder=f'{run:%Y%m%d%H}-{model}-{identity}'
    for layer in LAYERS[model]:
     if entry.get('layers',{}).get(layer,{}).get('renderer')==revision(layer):continue
     folder=basefolder+'-'+revision(layer)
     selected=[(i,h) for i,h in enumerate(leads) if layer!='precip24' or h>=24]
     tasks=[(run,h,coords,values[i],keys,layer,model,args.state/'maps'/folder/f'{layer}_{h:03d}.png') for i,h in selected]
     with concurrent.futures.ProcessPoolExecutor(max_workers=4) as pool:
      for i,_ in enumerate(pool.map(render,tasks)):
       if i%12==0:print(f'{key}Z {layer} kaart {i+1}/{len(tasks)}',flush=True)
     if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copy',str(args.state/'maps'/folder),f'r2:weerlab-data/wxbeta-nl/{folder}','--transfers','8','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
     with (args.state/'publish.lock').open('w') as publication:
      fcntl.flock(publication,fcntl.LOCK_EX)
      # Re-read before each atomic publication, preserving the gust updater.
      manifest=json.loads(manifest_path.read_text());entry=manifest['runs'][key]
      if parse(entry['run_utc'])!=run:raise ValueError('Nederlandrun wijzigde tijdens renderen')
      entry.setdefault('layers',{})[layer]=dict(renderer=revision(layer),resolution='9 km' if model=='ecmwf_ifs' else '0,25° · circa 25 km',base=manifest['base'],frames=[dict(lead=h,valid_utc=iso(run+dt.timedelta(hours=h)),valid_label=(run+dt.timedelta(hours=h)).strftime('%d-%m-%Y %H:%M UTC')) for _,h in selected],files={layer:[f'{folder}/{layer}_{h:03d}.png' for _,h in selected]})
      if layer=='t2m':entry['layers']['t2m_grid']={**entry['layers'][layer],'files':{'t2m_grid':entry['layers'][layer]['files'][layer]}}
      manifest['updated']=iso(dt.datetime.now(UTC));tmp=manifest_path.with_suffix('.tmp');tmp.write_text(json.dumps(manifest));tmp.replace(manifest_path)
      if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(manifest_path),'r2:weerlab-data/wxbeta-nl/current.json','--header-upload','Cache-Control: no-cache'],check=True)
     print(key,layer,'Nederland gepubliceerd',flush=True)
   except Exception as e:errors.append(f'{key} {model}: {e}');print(errors[-1],flush=True)
 if errors:raise SystemExit('; '.join(errors))
if __name__=='__main__':main()
