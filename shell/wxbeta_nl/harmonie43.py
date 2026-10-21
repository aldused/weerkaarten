"""HARMONIE 43 charts from the existing KNMI binary pipeline; independent manifest."""
import argparse, concurrent.futures, datetime as dt, fcntl, hashlib, json, os, struct, subprocess, sys
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
import layers as nl
REV='nl-knmi-harmonie43-1'
ROOT=Path('/Users/aldus/KNMI_Project/weerlab')
LAYERS=['mslp_bft','t2m','wind','gust']

def hourly_frames(times, run):
 """Resolve Dutch clock times as one unbroken UTC sequence, including DST."""
 zone = ZoneInfo('Europe/Amsterdam')
 sequences = [[]]
 for value in times:
  local = dt.datetime.fromisoformat(value)
  if local.tzinfo:
   candidates = {local.astimezone(dt.timezone.utc)}
  else:
   candidates = {local.replace(tzinfo=zone, fold=fold).astimezone(dt.timezone.utc)
                 for fold in (0, 1)}
   candidates = {valid for valid in candidates
                 if valid.astimezone(zone).replace(tzinfo=None) == local}
  sequences = [seq + [valid] for seq in sequences for valid in sorted(candidates)
               if valid >= run and (not seq or valid == seq[-1] + dt.timedelta(hours=1))]
 if len(times) < 2 or len(sequences) != 1:
  raise ValueError('Niet-aaneengesloten of ongeldige uurtijden')
 frames = []
 for valid in sequences[0]:
  hours = (valid-run).total_seconds()/3600
  if hours != int(hours): raise ValueError('Ongeldige prognosetijd')
  frames.append(dict(lead=int(hours), valid_utc=valid.isoformat()))
 return frames

def snapshot(root):
 path=root/'harmonie_canvas_meta.json';raw=path.read_bytes();meta=json.loads(raw)
 if meta.get('model')!='HARMONIE V43':raise ValueError('Geen HARMONIE 43 bron')
 run=nl.parse(meta['run_utc']);arrays={};digest=hashlib.sha256(raw);checks=[]
 for key in ['temp','wind','windstoten','druk']:
  p=meta['parameters'][key];file=root/p['file'];before=file.stat();blob=file.read_bytes();after=file.stat()
  if (before.st_mtime_ns,before.st_size)!=(after.st_mtime_ns,after.st_size):raise ValueError('Bron gewijzigd tijdens lezen')
  checks.append((file,after.st_mtime_ns,after.st_size));digest.update(blob)
  ny,nx,nt,nc=struct.unpack('<HHHH',blob[:8]);grid=p.get('grid',meta['grid'])
  if blob[8]!=0 or (ny,nx)!=(grid['n_lat'],grid['n_lon']) or nt!=len(meta['tijden']) or nc!=p['components']:raise ValueError('Bin/meta komen niet overeen')
  a=np.frombuffer(blob[16:],dtype='<f4').reshape(nt,nc,ny,nx)
  if not np.isfinite(a).all():raise ValueError('Ontbrekende bronwaarden')
  arrays[key]=a
 if path.read_bytes()!=raw or any((p.stat().st_mtime_ns,p.stat().st_size)!=(mtime,size) for p,mtime,size in checks):raise ValueError('Bron gewijzigd tijdens momentopname')
 grid=meta['grid'];yy,xx=np.meshgrid(np.linspace(grid['lat_min'],grid['lat_max'],grid['n_lat']),np.linspace(grid['lon_min'],grid['lon_max'],grid['n_lon']),indexing='ij');mask=(xx>=nl.BOUNDS[0]-.2)&(xx<=nl.BOUNDS[1]+.2)&(yy>=nl.BOUNDS[2]-.2)&(yy<=nl.BOUNDS[3]+.2)
 coords=np.column_stack([yy[mask],xx[mask]]);keys=['temperature_2m','pressure_msl','wind_speed_10m','wind_direction_10m','wind_gusts_10m'];u,v=arrays['wind'][:,0],arrays['wind'][:,1]
 pressure=arrays['druk'][:,0]/100.0  # KNMI GRIB pressure is Pa; chart uses hPa
 if not ((pressure>850)&(pressure<1100)).all():raise ValueError('Luchtdruk niet in hPa')
 values=np.stack([arrays['temp'][:,0],pressure,np.hypot(u,v),np.degrees(np.arctan2(-u,-v))%360,np.hypot(arrays['windstoten'][:,0],arrays['windstoten'][:,1])],axis=-1)[:,mask,:]
 frames=hourly_frames(meta['tijden'],run)
 return run,frames,coords,values,keys,digest.hexdigest()[:12]

def render(task):
 nl.MODEL_INFO['harmonie43']=('HARMONIE 43','KNMI · kaartrooster circa 4 km',4)
 nl.render(task)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--state',type=Path,required=True);ap.add_argument('--source',type=Path,default=ROOT);ap.add_argument('--publish',action='store_true');ap.add_argument('--limit',type=int);args=ap.parse_args();args.state.mkdir(parents=True,exist_ok=True)
 with (args.state/'build.lock').open('w') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:return
  run,frames,coords,values,keys,identity=snapshot(args.source);folder=f'{run:%Y%m%d%H}-{identity}-{REV}';path=args.state/'current.json'
  old=json.loads(path.read_text()) if path.exists() else {}
  if old.get('identity')==identity and old.get('renderer')==REV and not args.limit:
   if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(path),'r2:weerlab-data/wxbeta-harmonie43/current.json','--header-upload','Cache-Control: no-cache'],check=True)
   print('HARMONIE 43 al actueel',flush=True);return
  if args.limit:frames=frames[:args.limit]
  tasks=[(run,f['lead'],coords,values[i],keys,layer,'harmonie43',args.state/'maps'/folder/f'{layer}_{f["lead"]:03d}.png') for layer in LAYERS for i,f in enumerate(frames)]
  with concurrent.futures.ProcessPoolExecutor(max_workers=4) as pool:
   for i,_ in enumerate(pool.map(render,tasks)):
    if i%10==0:print(f'HARMONIE 43 {i+1}/{len(tasks)}',flush=True)
  entry=dict(cycle=f'{run:%H}',run_utc=run.isoformat(),maxlead=frames[-1]['lead'],renderer=REV,modelLabel='HARMONIE 43',resolution='KNMI · kaartrooster circa 4 km',base='https://data.weerlab.nl/wxbeta-harmonie43/',frames=frames,files={k:[f'{folder}/{k}_{f["lead"]:03d}.png' for f in frames] for k in LAYERS},regions=['netherlands'])
  manifest=dict(identity=identity,renderer=REV,updated=dt.datetime.now(dt.timezone.utc).isoformat(),models=[dict(key='harmonie43',label='HARMONIE 43')],data={'harmonie43':dict(cycles=[f'{run:%H}'],runs={f'{run:%H}':entry})})
  if args.publish:
   if args.limit:raise ValueError('Testframes niet publiceren')
   subprocess.run(['/opt/homebrew/bin/rclone','copy',str(args.state/'maps'/folder),f'r2:weerlab-data/wxbeta-harmonie43/{folder}','--transfers','8','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
  tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(manifest));tmp.replace(path)
  if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(path),'r2:weerlab-data/wxbeta-harmonie43/current.json','--header-upload','Cache-Control: no-cache'],check=True)
if __name__=='__main__':main()
