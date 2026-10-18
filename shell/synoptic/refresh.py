"""Build an immutable, complete synoptic map set; publish its pointer last.
Front overlays require reviewed geometry for the exact source cycle. Missing
review disables the overlay while fresh weather and source charts are published.
"""
import argparse,datetime as dt,fcntl,hashlib,json,os,re,shutil,subprocess,sys,tempfile,urllib.request
from pathlib import Path
from PIL import Image
from maximum_temperature import fetch_maxima,render_maxima
from source_fronts import source_review,METHOD as SOURCE_FRONT_METHOD
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1] if HERE.parent.name=='shell' else Path('/Users/aldus/KNMI_Project/weerlab')
CACHE=REPO/'.synoptic-cache';CACHE.mkdir(exist_ok=True)
UTC=dt.timezone.utc
SITE='https://weather.metoffice.gov.uk/maps-and-charts/surface-pressure'
def get(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Weerlab/1.0'}),timeout=45) as r:return r.read()
def write(path,data):path.write_text(json.dumps(data,indent=2))
def discover(html,now):
 urls=sorted(set(re.findall(r'https://data\.consumer-digital\.api\.metoffice\.gov\.uk/v1/surface-pressure/bw/[^"<>\s]+?\.gif',html)))
 cycles={}
 for url in urls:
  m=re.search(r'/(\d{4}-\d\d-\d\dT\d{4})/.*FC(\d{3})\.gif',url)
  if not m:continue
  run=dt.datetime.strptime(m[1],'%Y-%m-%dT%H%M').replace(tzinfo=UTC);lead=int(m[2]);valid=run+dt.timedelta(hours=lead)
  cycles.setdefault(run,{})[valid]=url
 wanted=[now.replace(hour=12,minute=0,second=0,microsecond=0)+dt.timedelta(days=i) for i in range(5)]
 for run,charts in sorted(cycles.items(),reverse=True):
  if all(d in charts for d in wanted):return run,{d:charts[d] for d in wanted}
  available=sorted(d for d in charts if d.hour==12 and d>=wanted[0])
  if len(available)>=5:return run,{d:charts[d] for d in available[:5]}
 raise ValueError('Geen volledige Bracknell-set voor vijf middagen beschikbaar')
def refresh(publish=False,repair_current=False):
 now=dt.datetime.now(UTC)
 if repair_current:
  previous=json.loads((CACHE/'published.json').read_text())
  run=dt.datetime.fromisoformat(previous['run'].replace('Z','+00:00'))
  source=json.loads((HERE/'fronts'/f"{run.strftime('%Y%m%dT%H')}-source"/'source.json').read_text())
  charts={dt.datetime.fromisoformat(f['valid'].replace('Z','+00:00')):source['frames'][str(f['day'])]['source'] for f in previous['frames']}
  if len(charts)!=5:raise ValueError('De bestaande kaartset heeft geen vijf geldige middagen')
 else:run,charts=discover(get(SITE).decode(),now)
 key=run.strftime('%Y%m%dT%H');front=HERE/'fronts'/f'{key}.json'
 review=CACHE/'review'/key;review.mkdir(parents=True,exist_ok=True)
 frames=[]
 for valid,url in charts.items():
  day=valid.day;lead=int((valid-run).total_seconds()/3600);interval=6 if lead>=150 else 3 if lead>=57 else 1
  frames.append(dict(day=day,valid=valid.isoformat().replace('+00:00','Z'),intervalHours=interval,rainInterval=f'{12-interval:02d}–12 UTC'))
  path=review/f'{day}-front-reference.png'
  if not path.exists():
   with tempfile.NamedTemporaryFile(suffix='.gif') as tmp:
    tmp.write(get(url));tmp.flush();Image.open(tmp.name).convert('RGB').save(path)
 write(review/'sources.json',{str(v.day):u for v,u in charts.items()})
 source_dir=HERE/'fronts'/f'{key}-source'
 reviewed_source=None
 if (source_dir/'source.json').exists():
  reviewed_source=source_review(source_dir,run.isoformat().replace('+00:00','Z'),frames)
  fronts_available=True
 else:
  geometry=json.loads(front.read_text()) if front.exists() else {}
  fronts_available=all(str(f['day']) in geometry for f in frames)
 if not fronts_available:raise ValueError(f'Frontencontrole ontbreekt voor {key}; de laatste complete kaartset met fronten blijft zichtbaar. Bronkaarten: {review}')
 config=dict(run=run.isoformat().replace('+00:00','Z'),runPath=run.strftime('%Y/%m/%d/%H00Z'),frames=frames)
 maximum=fetch_maxima(frames,now,get)
 # Content identity includes reviewed geometry, valid dates and renderer revision.
 front_identity=json.dumps(reviewed_source,sort_keys=True).encode() if reviewed_source else front.read_bytes()
 version=hashlib.sha256(front_identity+json.dumps(config).encode()+json.dumps(maximum,sort_keys=True).encode()+b'render-v8-standard-front-symbols').hexdigest()[:10];set_id=f'{key}-{version}'
 previous=CACHE/'published.json'
 if previous.exists() and json.loads(previous.read_text()).get('setId')==set_id:print('Zelfde gecontroleerde set; niets gepubliceerd');return
 with tempfile.TemporaryDirectory(dir=CACHE,prefix='build-') as tmp:
  out=Path(tmp);write(out/'build.json',config);write(out/'frames.json',frames)
  env=dict(os.environ,WEERKAART_OUT=str(out),WEERKAART_FRONTS=str(front),MPLCONFIGDIR=str(CACHE/'matplotlib'))
  if reviewed_source:env['WEERKAART_FRONT_SOURCE']=str(source_dir)
  subprocess.run([shutil.which('node') or '/opt/homebrew/bin/node',str(HERE/'ukmo.mjs')],env=env,check=True,timeout=900)
  for script in ['render_ukmo.py','render_retina.py','render_wind.py','render_temperature_labels.py','trace_fronts.py']:
   subprocess.run([sys.executable,str(HERE/script)],env=env,check=True,timeout=240)
  render_maxima(out,maximum)
  capabilities=json.loads((out/'capabilities.json').read_text())
  for file in review.glob('*-front-reference.png'):
   if not (out/file.name).exists():shutil.copy(file,out/file.name)
  for frame in frames:
   day=frame['day']
   for suffix in ['ukmo-temp.png','ukmo-cloud.png','ukmo-rain.png','ukmo-temp@2x.png','ukmo-cloud@2x.png','ukmo-rain@2x.png','ukmo-pressure.svg','fronts.svg','wind.svg','values.svg','front-reference.png','maximum.svg']:
    if not (out/f'{day}-{suffix}').is_file():raise ValueError('Onvolledige uitvoer '+suffix)
  manifest=dict(cloudLevels=capabilities['cloudLevels'],maximumTemperature=maximum,updated=now.isoformat(),model='UKMO Global 10km',run=config['run'],frontRun=config['run'] if fronts_available else None,frontsAvailable=fronts_available,frames=frames,frontMethod=SOURCE_FRONT_METHOD if reviewed_source else 'Handmatig gedigitaliseerd en visueel gecontroleerd, inclusief troggen.' if fronts_available else 'Nog niet gedigitaliseerd voor deze run; bekijk de actuele Bracknell-bronkaarten.',snowAvailable=False,automaticRefresh='twice-daily-with-front-review',setId=set_id,assetRoot=f'https://data.weerlab.nl/synoptic/sets/{set_id}/')
  for frame in frames:
   for level in capabilities['cloudLevels']:
    for resolution in ['', '@2x']:
     if not (out/f"{frame['day']}-ukmo-cloud-{level}{resolution}.png").is_file():raise ValueError('Onvolledige wolkenlaag '+level)
  # Retain source URLs and checksums with the published immutable set.
  if reviewed_source:write(out/'front-sources.json',reviewed_source)
  # Never upload raw fields. Data assets first; immutable manifest pointer last.
  public=out/'public';public.mkdir()
  for file in out.iterdir():
   if file.suffix in ['.png','.svg'] or file.name=='front-sources.json':shutil.copy(file,public/file.name)
  write(out/'current.json',manifest)
  if publish:
   rclone='/opt/homebrew/bin/rclone';remote='r2:weerlab-data/synoptic'
   subprocess.run([rclone,'copy',str(public),f'{remote}/sets/{set_id}','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True,timeout=600)
   subprocess.run([rclone,'check',str(public),f'{remote}/sets/{set_id}','--size-only','--one-way'],check=True,timeout=180)
   subprocess.run([rclone,'copyto',str(out/'current.json'),remote+'/current.json','--header-upload','Cache-Control: public, max-age=60'],check=True,timeout=60)
   shutil.copy(out/'current.json',previous)
  else:
   dest=CACHE/'preview'/set_id;shutil.copytree(public,dest,dirs_exist_ok=True);shutil.copy(out/'current.json',dest/'current.json');print('Preview',dest)
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--publish',action='store_true');parser.add_argument('--repair-current',action='store_true',help='Herbouw de bestaande gecontroleerde run met aangepaste renderer');args=parser.parse_args()
 with (CACHE/'refresh.lock').open('w') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:sys.exit(0)
  try:refresh(args.publish,args.repair_current)
  except Exception as e:
   write(CACHE/'status.json',dict(checked=dt.datetime.now(UTC).isoformat(),ok=False,message=str(e)));print(str(e),file=sys.stderr);sys.exit(1)
  write(CACHE/'status.json',dict(checked=dt.datetime.now(UTC).isoformat(),ok=True))
