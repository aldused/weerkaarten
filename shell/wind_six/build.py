"""Pin exact IFS runs, sample native cells and publish six wind statistics atomically."""
import sys
import argparse,base64,concurrent.futures,datetime as dt,gzip,hashlib,json,math,os,subprocess,time,urllib.parse,urllib.request
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from open_meteo import upgrade_url,has_key,bulk_sessie
UTC=dt.timezone.utc
API='https://ensemble-api.open-meteo.com'
FIELDS=('wind_speed_10m','wind_gusts_10m')
BOUNDS=[2.6,8.0,50.35,54.15]
def fetch(url):
 url=upgrade_url(url)
 for attempt in range(3):
  try:
   response=bulk_sessie().get(url,headers={'User-Agent':'Weerlab wind comparison/1.0','Cache-Control':'no-cache'},timeout=90)
   if response.status_code in (400,401,403,429):
    raise ValueError(f'Bron {response.status_code}: {response.json().get("reason","aanvraag geweigerd")}')
   response.raise_for_status();return response.json()
  except ValueError:raise
  except Exception:
   if attempt==2:raise RuntimeError('De bronverbinding is na drie pogingen mislukt') from None
   time.sleep(2*(attempt+1))

def parse(s):return dt.datetime.fromisoformat(s.replace('Z','+00:00')).replace(tzinfo=UTC)
def iso(t):return t.isoformat().replace('+00:00','Z')
def metadata(model,run=None):
 if model=='ecmwf_ifs_europe_ensemble':
  path=f'{run:%Y/%m/%d/%H%M}Z/meta.json' if run else 'latest.json'
  return fetch(f'{API}/data_run/{model}/{path}')
 return fetch(f'{API}/data/{model}/static/meta.json')
def run_of(meta):return parse(meta['reference_time']) if 'reference_time'in meta else dt.datetime.fromtimestamp(meta['last_run_initialisation_time'],UTC)
def statistics(p,run):
 h=p['hourly'];times=[parse(t) for t in h['time']];lookup={t:i for i,t in enumerate(times)}
 arrays=[]
 for field in FIELDS:
  keys=[field]+[f'{field}_member{i:02d}' for i in range(1,51)]
  if any(key not in h for key in keys):raise ValueError('Geen compleet ensemble van 51 leden')
  if any(p['hourly_units'].get(key)!='m/s' for key in keys):raise ValueError('Onverwachte windeenheden')
  arrays.append(np.array([[np.nan if x is None else x for x in h[key]] for key in keys],float))
 rows=[];valid=[]
 for lead in range(3,145,3):
  target=run+dt.timedelta(hours=lead)
  if target not in lookup:break
  index=lookup[target];wind=arrays[0][:,index];gust=arrays[1][:,index]
  # Native Europe gusts are hourly intervals. Compare equal three-hour windows.
  if p.get('_native') and lead<=90:
   indices=[lookup.get(target-dt.timedelta(hours=j)) for j in range(3)]
   if None in indices:break
   sample=arrays[1][:,indices]
   if not np.isfinite(sample).all():break
   gust=sample.max(axis=1)
  if not np.isfinite(wind).all() or not np.isfinite(gust).all():break
  if np.any(wind<0) or np.any(wind>120) or np.any(gust<0) or np.any(gust>150):raise ValueError('Onmogelijke windsnelheid')
  valid.append(iso(target));rows.append([wind[0],gust[0],wind.mean(),gust.mean(),wind.max(),gust.max()])
 if len(rows)!=48:raise ValueError(f'Onvolledige run: {len(rows)}/48 geldigheden')
 return valid,np.array(rows,dtype='float32')
def build(model,run,cache):
 native=model=='ecmwf_ifs_europe_ensemble';before=metadata(model,run if native else None)
 if run_of(before)!=run:raise ValueError('Bronrun wijkt af van de gekozen run')
 # Sample at least as densely as the source. Retain actual returned cell coordinates.
 dy,dx=(.07,.11) if native else (.25,.25)
 points=[(round(float(lat),4),round(float(lon),4)) for lat in np.arange(BOUNDS[2],BOUNDS[3]+dy/2,dy) for lon in np.arange(BOUNDS[0],BOUNDS[1]+dx/2,dx)]
 batches=[points[i:i+40] for i in range(0,len(points),40)]
 identity=hashlib.sha256(json.dumps(before,sort_keys=True).encode()).hexdigest()[:10]
 root=cache/f'{run:%Y%m%d%H}-{model}-{identity}';root.mkdir(parents=True,exist_ok=True)
 (root/'source.json').write_text(json.dumps(before))
 def batch(item):
  i,locations=item;file=root/f'{i}.json.gz'
  if file.exists():responses=json.loads(gzip.decompress(file.read_bytes()))
  else:
   params=dict(latitude=','.join(str(p[0]) for p in locations),longitude=','.join(str(p[1]) for p in locations),hourly=','.join(FIELDS),models=model,forecast_days=7,timezone='GMT',wind_speed_unit='ms',elevation=','.join('nan' for p in locations),cell_selection='nearest')
   if native:params['run']=run.strftime('%Y-%m-%dT%H:%M')
   else:params['past_days']=1
   responses=fetch(f'{API}/v1/ensemble?{urllib.parse.urlencode(params)}')
   if not isinstance(responses,list):responses=[responses]
   if len(responses)!=len(locations):raise ValueError('Onvolledige roosterrespons')
   temporary=file.with_suffix('.tmp');temporary.write_bytes(gzip.compress(json.dumps(responses).encode()));temporary.replace(file)
  results=[]
  for p in responses:
   p['_native']=native;valid,values=statistics(p,run);results.append(((p['latitude'],p['longitude']),valid,values))
  print(f'{run:%H}Z roosterbatch {i+1}/{len(batches)}',flush=True);return results
 unique={};valid=None
 with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
  for results in pool.map(batch,enumerate(batches)):
   for coordinate,times,values in results:
    if valid is not None and valid!=times:raise ValueError('Gemengde geldigheidstijden')
    valid=times;unique[coordinate]=values
 after=metadata(model,run if native else None)
 if run_of(after)!=run or before.get('created_at',before.get('last_run_modification_time'))!=after.get('created_at',after.get('last_run_modification_time')):raise ValueError('Bron wijzigde tijdens de opbouw')
 coordinates=sorted(unique);data=np.stack([unique[p] for p in coordinates],axis=1)
 encoded=data.astype('<f4')
 with (cache/'usage.jsonl').open('a') as log:log.write(json.dumps(dict(consumer='wind-six',model=model,run=iso(run),locations=len(points),requests=len(batches),members=51,fields=2))+'\n')
 return dict(run=iso(run),sourceModel=model,resolution='9 km · native O1280' if native else '0,25° · circa 25 km',members=51,coordinates=coordinates,times=valid,fields=['oper_wind','oper_gust','mean_wind','mean_gust','max_wind','max_gust'],encoding='float32le-base64',scale=1,units='m/s',gustIntervalHours=3,shape=list(encoded.shape),data=base64.b64encode(encoded.tobytes()).decode())
def publish_entry(out,key,entry,publish):
 import fcntl
 with (out/'publish.lock').open('w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  path=out/'current.json';manifest=json.loads(path.read_text()) if path.exists() else dict(runs={},bounds=BOUNDS)
  existing=manifest['runs'].get(key)
  existing_frames=existing.get('frames') if existing else None
  if existing and existing_frames is None:
   old=out/existing['file'];existing_frames=len(json.loads(old.read_text()).get('times',[])) if old.exists() else 48
  if existing and (parse(existing['run'])>parse(entry['run']) or (existing['run']==entry['run'] and existing_frames>entry.get('frames',48))):return
  manifest['runs'][key]=entry;manifest['updated']=iso(dt.datetime.now(UTC));temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(manifest,indent=2));temporary.replace(path)
  if publish:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(path),'r2:weerlab-data/wind-six/current.json','--header-upload','Cache-Control: no-cache'],check=True)
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);ap.add_argument('--cache',type=Path,required=True);ap.add_argument('--publish',action='store_true');ap.add_argument('--cycles',nargs='+',type=int,default=[0,6,12,18]);args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=True)
 manifest_path=args.out/'current.json';manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else dict(runs={},bounds=BOUNDS)
 latest=metadata('ecmwf_ifs_europe_ensemble');last=run_of(latest);candidates=[]
 for cycle in (0,6):
  run=last.replace(hour=cycle)
  if run>last:run-=dt.timedelta(days=1)
  if cycle in args.cycles:candidates.append(('ecmwf_ifs_europe_ensemble',run))
 global_meta=metadata('ecmwf_ifs025_ensemble');global_run=run_of(global_meta)
 if global_run.hour in (12,18) and global_run.hour in args.cycles:candidates.append(('ecmwf_ifs025_ensemble',global_run))
 errors=[]
 for model,run in candidates:
  key=f'{run.hour:02d}';existing=manifest['runs'].get(key)
  if existing and existing['run']==iso(run) and existing.get('frames',48)==48:print(key,'al compleet',flush=True);continue
  try:
   document=build(model,run,args.cache);raw=json.dumps(document,separators=(',',':')).encode();name=f'{run:%Y%m%d%H}-{hashlib.sha256(raw).hexdigest()[:10]}.json';(args.out/name).write_bytes(raw)
   if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(args.out/name),f'r2:weerlab-data/wind-six/{name}','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
   publish_entry(args.out,key,dict(run=iso(run),file=name,resolution=document['resolution'],members=51,frames=len(document['times'])),args.publish)
   print(key,'gepubliceerd',flush=True)
  except Exception as e:errors.append(f'{key}: {e}');print(errors[-1],flush=True)
 # The rolling intermediary may skip a cycle. Recover missing 12/18Z runs
 # directly after a conservative nine-hour availability margin.
 cutoff=dt.datetime.now(UTC)-dt.timedelta(hours=9)
 for cycle in (12,18):
  if cycle not in args.cycles:continue
  run=cutoff.replace(hour=cycle,minute=0,second=0,microsecond=0)
  if run>cutoff:run-=dt.timedelta(days=1)
  key=f'{cycle:02d}';current=json.loads(manifest_path.read_text()) if manifest_path.exists() else {'runs':{}}
  existing=current['runs'].get(key)
  if existing and parse(existing['run'])>=run and existing.get('frames',48)==48:continue
  try:
   from backfill import build_direct
   document=build_direct(run,args.cache);raw=json.dumps(document,separators=(',',':')).encode();name=f'{run:%Y%m%d%H}-{hashlib.sha256(raw).hexdigest()[:10]}.json';(args.out/name).write_bytes(raw)
   if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(args.out/name),f'r2:weerlab-data/wind-six/{name}','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
   publish_entry(args.out,key,dict(run=iso(run),file=name,resolution=document['resolution'],members=51,frames=len(document['times'])),args.publish)
   print(key,'rechtstreeks gepubliceerd',flush=True)
  except Exception as e:errors.append(f'{key} direct: {e}');print(errors[-1],flush=True)
 if errors:raise SystemExit('; '.join(errors))
if __name__=='__main__':main()
