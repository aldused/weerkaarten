"""Refresh archive + recent KNMI wind hours. Publishes only complete, validated batches.
No credentials here: uses the existing local knmi_api helper for EDR requests.
"""
import argparse,copy,hashlib,io,json,math,os,sys,time,zipfile,csv,re,subprocess
from pathlib import Path
from datetime import datetime,date,timedelta,timezone
from decimal import Decimal,ROUND_HALF_UP
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from build_stormdagen import build
U=timezone.utc
EDR='https://api.dataplatform.knmi.nl/edr/v1/collections/'
HOURLY='hourly-in-situ-meteorological-observations'
TEN='10-minute-in-situ-meteorological-observations'
def dt(s):return datetime.fromisoformat(s.replace('Z','+00:00')).astimezone(U)
def atomic(path,data):
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_name(path.name+'.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n');tmp.replace(path)
def valid(v):return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) and 0<=v<=100
def tenth(v):return int((Decimal(str(v))*10).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
def coverage_rows(payload,locations,allowed,parameter,now):
 if any(l.get('rel')=='next' for l in payload.get('links',[])):raise ValueError('Paginated KNMI reply is incomplete')
 parameter_meta=payload.get('parameters',{}).get(parameter,{})
 duration='-PT10M' if parameter=='ff' else '-PT1H'
 if parameter_meta.get('unit',{}).get('symbol',{}).get('value')!='m/s' or parameter_meta.get('measurementType',{}).get('duration')!=duration or parameter_meta.get('measurementType',{}).get('method')!='mean':raise ValueError('Unexpected wind unit or duration')
 rows={}
 for c in payload.get('coverages',[]):
  st=locations.get(c.get('eumetnet:locationId'))
  if st not in allowed:continue
  ts=c['domain']['axes']['t']['values'];block=c.get('ranges',{}).get(parameter)
  if not block:continue
  if block.get('shape')!=[len(ts),1,1] or block.get('axisNames')!=['t','y','x']:raise ValueError('Unexpected KNMI axes')
  for i,s in enumerate(ts):
   end=dt(s);v=block['values'][i]
   if end>now:continue
   if end.second or end.microsecond or end.minute%(10 if parameter=='ff' else 60):raise ValueError('Off-grid wind timestamp')
   key=(st,end);value={'value':v if valid(v) else None,'gust':None,'invalid':not valid(v)}
   if parameter=='FH' and payload.get('parameters',{}).get('FX',{}).get('measurementType',{}).get('duration')=='-PT1H':
    gust=c.get('ranges',{}).get('FX',{}).get('values',[]);value['gust']=gust[i] if i<len(gust) and valid(gust[i]) else None
   if key in rows and rows[key]!=value:raise ValueError('Conflicting duplicate KNMI observation')
   rows[key]=value
 return rows

def complete_hours(ten):
 grouped={}
 for (st,t),record in ten.items():
  if not valid(record.get('value')):continue
  end=t.replace(minute=0,second=0,microsecond=0)+(timedelta(hours=1) if t.minute else timedelta())
  grouped.setdefault((st,end),{})[t]=record['value']
 hours={}
 for key,values in grouped.items():
  expected={key[1]-timedelta(minutes=10*i) for i in range(6)}
  if set(values)!=expected:continue
  mean=sum(Decimal(str(values[t])) for t in expected)/6
  hours[key]={'value':tenth(mean),'gust':None,'source':'ten-minute-complete','samples':6}
 return hours

def rolling_wind(ten,allowed,now):
 """Fixed clock hour: ten-minute endpoints :10 through next :00, never sliding."""
 result=[]
 for st in sorted(allowed):
  times=[t for station,t in ten if station==st and t<=now and t.minute==0]
  if not times:continue
  end=max(times)
  def window(t):
   samples=[ten.get((st,t-timedelta(minutes=10*i)),{}).get('value') for i in range(6)]
   return sum(Decimal(str(v)) for v in samples)/6 if all(valid(v) for v in samples) else None
  value=window(end);previous=window(end-timedelta(hours=1))
  result.append({'station':st,'start_utc':(end-timedelta(hours=1)).isoformat(),'end_utc':end.isoformat(),
   'mean_ms':round(float(value),3) if value is not None else None,'samples':sum(valid(ten.get((st,end-timedelta(minutes=10*i)),{}).get('value')) for i in range(6)),
   'previous_mean_ms':round(float(previous),3) if previous is not None else None,
   'storm_threshold_ms':20.5,'storm_reached':value>=Decimal('20.5') if value is not None else None,'source':'KNMI ff: fixed clock hour, endpoints :10 :20 :30 :40 :50 :00'})
 return result

def daily_hours(ten,native):
 hours=complete_hours(ten)
 for key,r in native.items():
  if not valid(r.get('value')):
   hours.pop(key,None);continue
  hours[key]={'value':tenth(r['value']),'gust':tenth(r['gust']) if r['gust'] is not None else None,'source':'hourly-FH','samples':1}
 days={}
 for (st,end),r in sorted(hours.items()):
  day=(end-timedelta(seconds=1)).date().isoformat();entry=days.setdefault((st,day),{'hours':{},'source':'hourly-FH'})
  entry['hours'][end]=r
 result={}
 for key,entry in days.items():
  observations=entry['hours'];peak=max(observations,key=lambda t:observations[t]['value']);gusts=[r['gust'] for r in observations.values() if r['gust'] is not None]
  result[key]={'value':observations[peak]['value'],'gust':max(gusts) if gusts else None,'hour':peak.hour or 24,'source':observations[peak]['source'],'hours':len(observations),'provisional':True,'last':max(observations).isoformat()}
 return result,hours

def archive_recent(source,since):
 rows={}
 for m in json.loads((source/'manifest.json').read_text()):
  with zipfile.ZipFile(source/m['file']) as z:text=z.read(next(n for n in z.namelist() if n.endswith('.txt'))).decode('utf-8-sig')
  header=None
  for line in text.splitlines():
   if re.match(r'\s*#?\s*STN\s*,\s*YYYYMMDD',line):header=[x.strip() for x in line.lstrip('# ').split(',')]
   elif re.match(r'\s*\d+\s*,\s*\d{8}',line):
    if header is None:raise ValueError('Missing archive header')
    r=dict(zip(header,[x.strip() for x in next(csv.reader([line]))]));s=r['YYYYMMDD'];day=f'{s[:4]}-{s[4:6]}-{s[6:8]}'
    if day<since or not r['FHX']:continue
    st=int(r['STN']);rows[(st,day)]={'value':int(r['FHX']),'gust':int(r['FXX']) if r.get('FXX') else None,'hour':int(r['FHXH']) if r.get('FHXH') else None,'source':'archive-FHX','hours':24,'provisional':False}
 return rows

def merge(base,archive,recent,hours,now,since):
 data=copy.deepcopy(base);allowed={s['station'] for s in data['stations']};selected={k:v for k,v in recent.items() if k[0] in allowed and k[1]>=since};selected.update({k:v for k,v in archive.items() if k[0] in allowed and k[1]>=since})
 days={}
 for (st,day),record in selected.items():days.setdefault(day,{})[st]=record
 byyear={y['year']:y for y in data['years']}
 for day,records in sorted(days.items()):
  year=int(day[:4]);y=byyear.get(year)
  if y is None:
   import calendar
   y={'year':year,'events':[],'observed_days':0,'expected_days':366 if calendar.isleap(year) else 365,'stations':{},'partial_year':True,'storm':0,'severe':0};data['years'].append(y);byyear[year]=y
  # Recent complete hours replace the recent-day event, including an old provisional false positive.
  old=next((e for e in y['events'] if e['date']==day),None)
  measurements={st:r['value'] for st,r in records.items() if r['value']>=205}
  if old:
   # Missing stations must not erase an official historical observation.
   for st,value in old['measurements']:
    if st not in records:measurements[st]=value
  y['events']=[e for e in y['events'] if e['date']!=day]
  if measurements:
   obs={r[0]:r for r in (old or {}).get('observations',[])};obs.update({st:[st,r['value'],r['gust'],r['hour']] for st,r in records.items()})
   provisional=[st for st in measurements if records.get(st,{}).get('provisional',False)]
   y['events'].append({'date':day,'measurements':sorted([st,v] for st,v in measurements.items()),'observations':sorted(obs.values()),'provisional':bool(provisional),'provisional_stations':sorted(provisional),'measurement_sources':{str(st):r['source'] for st,r in records.items()},'hours_observed':{str(st):r['hours'] for st,r in records.items()}})
  # Additional covered dates only beyond each station's last archived FHX date.
  added=False
  for st,r in records.items():
   meta=next(s for s in data['stations'] if s['station']==st)
   if r['provisional'] and day>(meta.get('last_fhx') or '0000-00-00'):
    y['stations'][str(st)]=y['stations'].get(str(st),0)+1;added=True
  if added and day>data['latest_date']:y['observed_days']+=1
  y['events'].sort(key=lambda e:e['date']);y['storm']=len(y['events']) if y['observed_days'] else None;y['severe']=sum(any(v>=245 for _,v in e['measurements']) for e in y['events']) if y['observed_days'] else None
  y['partial_year']=y['partial_year'] or year>=now.year
 latest=max((t for st,t in hours if st in allowed),default=None)
 for meta in data['stations']:
  dates=[day for (st,day) in selected if st==meta['station']];meta['latest_observation_date']=max([meta.get('last_fhx') or '0000-00-00']+dates)
 peaks=[(r['value'],st,t,r['source']) for (st,t),r in hours.items() if st in allowed and latest and latest-t<timedelta(hours=24)]
 peak=max(peaks,default=None)
 data['recent_peak']={'value':peak[0],'station':peak[1],'end_utc':peak[2].isoformat(),'source':peak[3]} if peak else None
 data.update(archive_generated_utc=base['generated_utc'],archive_latest_date=base['latest_date'],generated_utc=now.isoformat(),last_checked_utc=now.isoformat(),latest_date=max([base['latest_date']]+list(days)),latest_hour_utc=latest.isoformat() if latest else None,auto_refresh_minutes=15,recent_sources={'hourly':EDR+HOURLY,'ten_minute':EDR+TEN},recent_note='Recente uren voorlopig: KNMI FH, aangevuld met het gemiddelde van zes complete tienminutenmiddelen (ff). Het dagarchief FHX heeft voorrang. Geen tienminutenwind of windstoot als uurgemiddelde.')
 return data

def refresh_archives(selection,out,now):
 source=out/'source';source.mkdir(parents=True,exist_ok=True);meta_path=source/'http.json';http=json.loads(meta_path.read_text()) if meta_path.exists() else {}
 def fetch(m):
  path=source/m['file'];headers={'User-Agent':'Weerlab stormdagen updater/1.0'}
  if path.exists() and http.get(str(m['station'])):headers['If-Modified-Since']=http[str(m['station'])]
  try:
   with urlopen(Request(m['url'],headers=headers),timeout=60) as r:blob=r.read();modified=r.headers.get('Last-Modified')
   with zipfile.ZipFile(io.BytesIO(blob)) as z:
    if not any(n.endswith('.txt') for n in z.namelist()):raise ValueError('Archive has no data')
   path.write_bytes(blob)
  except HTTPError as e:
   if e.code!=304 or not path.exists():raise
   blob=path.read_bytes();modified=http.get(str(m['station']))
  return {**m,'sha256':hashlib.sha256(blob).hexdigest()},modified
 with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(fetch,selection))
 manifest=[r[0] for r in results];atomic(source/'manifest.json',manifest);atomic(meta_path,{str(r[0]['station']):r[1] for r in results if r[1]});history=build(source);atomic(out/'archive.json',history);atomic(out/'archive-check.json',{'time':now.isoformat()});return history

def main():
 p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--publish',action='store_true');p.add_argument('--api-helper-dir',type=Path,default=Path(__file__).resolve().parents[1]);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);now=datetime.now(U);since=(now.date()-timedelta(days=7)).isoformat();selection=json.loads(Path(__file__).with_name('stations.json').read_text());allowed={s['station'] for s in selection}
 last=json.loads((a.out/'archive-check.json').read_text()) if (a.out/'archive-check.json').exists() else None
 if not last or now-dt(last['time'])>timedelta(hours=6):base=refresh_archives(selection,a.out,now)
 else:base=json.loads((a.out/'archive.json').read_text())
 sys.path.insert(0,str(a.api_helper_dir));from knmi_api import knmi_get
 def query(url,params=None):
  response=knmi_get(url,params=params,timeout=60);response.raise_for_status();return response.json()
 loc=query(EDR+TEN+'/locations');mapping={f['id']:int(str(f.get('properties',{}).get('wmoId'))[-3:]) for f in loc['features'] if str(f.get('properties',{}).get('wmoId','')).startswith('06')}
 params={'bbox':'3,50,7.5,54','datetime':since+'T00:00:00Z/'+now.strftime('%Y-%m-%dT%H:%M:%SZ'),'f':'CoverageJSON'}
 native=query(EDR+HOURLY+'/cube',{**params,'parameter-name':'FH,FX'});ten=query(EDR+TEN+'/cube',{**params,'parameter-name':'ff'})
 # Store auditable raw replies locally, never credentials.
 atomic(a.out/'hourly-raw.json',native);atomic(a.out/'ten-minute-raw.json',ten)
 native_rows=coverage_rows(native,mapping,allowed,'FH',now);ten_rows=coverage_rows(ten,mapping,allowed,'ff',now)
 # A temporarily incomplete API response must not erase previously received valid timestamps.
 cache=a.out/'recent-rows.json';previous=json.loads(cache.read_text()) if cache.exists() else {'hourly':[],'ten':[]}
 def retain(old,new):
  result={(int(st),dt(t)):r for st,t,r in old if dt(t).date().isoformat()>=since};result.update(new);return result
 native_rows=retain(previous['hourly'],native_rows);ten_rows=retain(previous['ten'],ten_rows)
 atomic(cache,{'hourly':[[st,t.isoformat(),r] for (st,t),r in native_rows.items()],'ten':[[st,t.isoformat(),r] for (st,t),r in ten_rows.items()]})
 recent,hours=daily_hours(ten_rows,native_rows)
 if not hours:raise ValueError('No complete KNMI wind hours available')
 data=merge(base,archive_recent(a.out/'source',since),recent,hours,now,since)
 data['rolling_wind']=rolling_wind(ten_rows,allowed,now)
 if data['latest_date']<base['latest_date']:raise ValueError('Date regression')
 atomic(a.out/'current.json',data)
 if a.publish:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(a.out/'current.json'),'r2:weerlab-data/stormdagen/current.json','--header-upload','Cache-Control: no-cache'],check=True)
 print(json.dumps({'archive':data['archive_latest_date'],'latest_hour':data['latest_hour_utc'],'recent_stormdays':[{'date':e['date'],'provisional':e.get('provisional',False),'peak':max(v for _,v in e['measurements'])} for y in data['years'] for e in y['events'] if e['date']>=since]}))
if __name__=='__main__':main()
