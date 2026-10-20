"""Publish immutable ECMWF canvas runs plus a run chooser manifest."""
import copy,fcntl,json,subprocess
from datetime import datetime,timedelta,timezone
from pathlib import Path
import ecmwf_openmeteo_update as converter
from open_meteo import bulk_sessie,upgrade_url
ROOT=converter.WORK_DIR
RCLONE='/opt/homebrew/bin/rclone'
BASE='https://api.open-meteo.com/data_run/ecmwf_ifs025/'

def metadata(path):
 r=bulk_sessie().get(upgrade_url(BASE+path),timeout=45)
 if not r.ok:raise ValueError('ECMWF-runmetadata HTTP '+str(r.status_code))
 return r.json()

def build(args,run,source):
 key=run.strftime('%Y%m%d%H');folder=ROOT/'.ecmwf-fourpanel-runs'/key;folder.mkdir(parents=True,exist_ok=True)
 conf=copy.copy(args);conf.run=run.strftime('%Y-%m-%dT%H:%M');conf.no_upload=True
 conf.max_steps=min(args.max_steps,int((datetime.fromisoformat(source['valid_times'][-1].replace('Z','+00:00'))-run).total_seconds()/3600)+1)
 previous_dir,previous_args=converter.WORK_DIR,converter.parse_args
 try:
  converter.WORK_DIR=folder;converter.parse_args=lambda:conf;converter.main()
 finally:converter.WORK_DIR=previous_dir;converter.parse_args=previous_args
 path=folder/f'{args.prefix}_canvas_meta.json';meta=json.loads(path.read_text())
 if datetime.fromisoformat(meta['run_utc'])!=run:raise ValueError('Gekozen run en canvasrun verschillen')
 for p in meta['parameters'].values():p['file']=f'ecmwf-runs/{key}/'+Path(p['file']).name
 published=folder/'meta.json';published.write_text(json.dumps(meta,ensure_ascii=False))
 if not args.no_upload:
  subprocess.run([RCLONE,'copy',str(folder),f'r2:weerlab-harmonie/ecmwf-runs/{key}','--include','*.bin','--include','meta.json','--transfers','8','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
 return dict(run_utc=meta['run_utc'],meta=f'ecmwf-runs/{key}/meta.json',maxlead=conf.max_steps-1),meta

def main():
 args=converter.parse_args()
 if args.model!='ecmwf_ifs025' or args.prefix!='ecmwf_om':raise ValueError('Alleen ECMWF IFS voor vierluik')
 state=ROOT/'.ecmwf-fourpanel-runs';state.mkdir(exist_ok=True)
 with (state/'update.lock').open('w') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:return
  source=metadata('latest.json');latest=datetime.fromisoformat(source['reference_time'].replace('Z','+00:00'))
  index_path=ROOT/'ecmwf_runs.json';index=json.loads(index_path.read_text()) if index_path.exists() else {'runs':[]};runs={r['run_utc']:r for r in index['runs']};latest_meta=None
  # Bootstrap yesterday's cycles as well, then retain the four latest published runs.
  for run in [latest-timedelta(hours=h) for h in (18,12,6,0)]:
   iso=run.isoformat()
   if iso in runs:
    if run==latest:latest_meta=json.loads((state/run.strftime('%Y%m%d%H')/'meta.json').read_text())
    continue
   before=metadata(f'{run:%Y/%m/%d/%H%M}Z/meta.json')
   if datetime.fromisoformat(before['reference_time'].replace('Z','+00:00'))!=run:raise ValueError('Bronrun wijkt af')
   item,meta=build(args,run,before);runs[iso]=item
   if run==latest:latest_meta=meta
  index=dict(model='ECMWF IFS',updated=datetime.now(timezone.utc).isoformat(),runs=sorted(runs.values(),key=lambda r:r['run_utc'],reverse=True)[:4]);index['latest']=index['runs'][0]['run_utc']
  tmp=index_path.with_suffix('.tmp');tmp.write_text(json.dumps(index));tmp.replace(index_path)
  if latest_meta:
   current_path=ROOT/'ecmwf_om_canvas_meta.json'
   current=json.loads(current_path.read_text()) if current_path.exists() else {}
   if current.get('run_utc')==latest_meta['run_utc'] and current.get('parameters',{}).get('wolkenbasis'):
    latest_meta['parameters']['wolkenbasis']=current['parameters']['wolkenbasis']
   tmp=ROOT/'ecmwf_om_canvas_meta.tmp';tmp.write_text(json.dumps(latest_meta,ensure_ascii=False));tmp.replace(ROOT/'ecmwf_om_canvas_meta.json')
  if latest_meta:
   try:
    from ecmwf_cloud_height import update
    update(ROOT,upload=not args.no_upload)
   except Exception as exc:print('ECMWF wolkenbasis tijdelijk niet aangevuld: '+str(exc),flush=True)
  if not args.no_upload:
   # Data is immutable and uploaded first; only these two pointers change.
   for path in [index_path,ROOT/'ecmwf_om_canvas_meta.json']:
    subprocess.run([RCLONE,'copyto',str(path),'r2:weerlab-harmonie/'+path.name,'--header-upload','Cache-Control: no-cache'],check=True)
if __name__=='__main__':main()
