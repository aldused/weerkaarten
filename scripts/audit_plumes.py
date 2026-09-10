#!/usr/bin/env python3
"""Read-only audit of all archived ECMWF plume values and KNMI point plumes."""
import json,math,hashlib
from pathlib import Path
from datetime import datetime,timezone
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'pluim_archive_meta.json').read_text())
errors=[];values=0;runs=0;stations=0;delays=[]
limits={'temperature_2m':(-100,65),'dew_point_2m':(-110,65),'relative_humidity_2m':(0,100),'cloud_cover':(0,100),'wind_speed_10m':(0,450),'wind_gusts_10m':(0,500),'wind_direction_10m':(0,360),'precipitation':(0,2000),'snowfall':(0,1000),'cape':(0,20000)}
for path in sorted(root.glob('pluim_trend_*.json')):
 d=json.loads(path.read_text());stations+=1
 for r in d['runs']:
  runs+=1;n=r['n'];times=r.get('times_ms',[])
  if len(times)!=n or any(not isinstance(t,(int,float)) or (i and t<=times[i-1]) for i,t in enumerate(times)):errors.append(f'{path.name} {r["run"]}: time axis')
  if times and times[0]!=datetime.fromisoformat(r['run'].replace('Z','+00:00')).timestamp()*1000:errors.append(f'{path.name}: run start')
  for field,members in r.get('members',{}).items():
   if len(members)!=51:errors.append(f'{path.name} {field}: member count')
   for member in members:
    if len(member)!=n:errors.append(f'{path.name} {field}: length')
    for v in member:
     values+=1
     if not isinstance(v,(int,float)) or not math.isfinite(v) or (field in limits and not limits[field][0]<=v<=limits[field][1]):errors.append(f'{path.name} {r["run"]} {field}: {v}');break
  src=r.get('source',{})
  if path.name=='pluim_trend_debilt.json':
   def date(v):return datetime.fromisoformat(v.replace('Z','+00:00'))
   available=src.get('availability');fetched=r.get('fetched')
   if available and fetched:delays.append({'run':r['run'],'source':src.get('access'),'delay_seconds':round((date(fetched)-date(available)).total_seconds())})
new=root/'harmoneps_plume/latest.json';hcount=0
if new.exists():
 hm=json.loads(new.read_text())
 for path in (root/'harmoneps_plume'/hm['run_key']).glob('*.json'):
  if path.name=='manifest.json':continue
  d=json.loads(path.read_text());hcount+=1
  if d.get('schema')!=2 or not d.get('complete') or d.get('n_members')!=6:errors.append(path.name+': KNMI identity')
  if 'pwat_mm' in d['vars']:errors.append(path.name+': mislabelled PWAT')
  for field,members in d['vars'].items():
   if len(members)!=6 or any(len(m)!=61 or any(not math.isfinite(v) for v in m) for m in members):errors.append(path.name+': incomplete '+field)
report={'checked_at':datetime.now(timezone.utc).isoformat(),'ecmwf_stations':stations,'ecmwf_runs':runs,'ecmwf_values':values,'harmoneps_stations':hcount,'errors':errors,'ecmwf_source_to_archive':delays}
print(json.dumps(report,indent=2))
raise SystemExit(bool(errors))
