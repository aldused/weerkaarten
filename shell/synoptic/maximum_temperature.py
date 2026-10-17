"""Sparse station maxima from Weerlab's current DWD MOSMIX TX feed.
TX is the supplied daytime maximum, not a maximum synthesized from noon values.
"""
import datetime as dt,json,math
from html import escape
from concurrent.futures import ThreadPoolExecutor
SITES=[
 ('Dublin','gb','Dublin',-6.26,53.35),
 ('Edinburgh','gb','Edinburgh',-3.19,55.95),
 ('Londen','gb','London Heathrow',-.12,51.5),
 ('Bergen','scan','Bergen',5.32,60.39),
 ('Oslo','scan','Oslo',10.75,59.91),
 ('Stockholm','scan','Stockholm',18.06,59.33),
 ('Kopenhagen','scan','Kopenhagen',12.57,55.68),
 ('Rotterdam','nl','Rotterdam Airport',4.48,51.92),
 ('Parijs','fr','Paris',2.35,48.85),
 ('Bordeaux','fr','Bordeaux',-.58,44.84),
 ('Berlijn','de','Berlin',13.4,52.52),
 ('Wenen','alps','Wien',16.37,48.21),
]
def number(value):return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)
def select_maxima(feeds,frames,now):
 result={str(f['day']):{'points':[],'sources':[]} for f in frames}
 for label,region,preferred,lon,lat in SITES:
  data=feeds.get(region) or {}
  try:run=dt.datetime.fromisoformat(data['run'].replace('Z','+00:00'))
  except (KeyError,TypeError,ValueError):continue
  if not dt.timedelta(0)<=now-run<=dt.timedelta(hours=36):continue
  stations=data.get('stations',{})
  # Prefer named station; otherwise nearest supplied station within 70 km.
  candidates=[]
  for name,coords in stations.items():
   if not isinstance(coords,list) or len(coords)!=2 or not all(number(v) for v in coords):continue
   distance=111*math.hypot((coords[0]-lon)*math.cos(math.radians(lat)),coords[1]-lat)
   if distance<=70:candidates.append((name!=preferred,distance,name,coords))
  if not candidates:continue
  _,_,station,coords=min(candidates)
  for frame in frames:
   date=frame['valid'][:10];value=data.get('data',{}).get(date,{}).get('TX',{}).get(station)
   if not number(value) or not -80<=value<=65:continue
   target=result[str(frame['day'])]
   target['points'].append(dict(place=label,station=station,lon=coords[0],lat=coords[1],value=value,date=date))
   target['sources'].append(dict(region=region,run=data['run'],updated=data.get('bijgewerkt')))
 return result

def fetch_maxima(frames,now,get):
 def fetch(region):
  try:return region,json.loads(get(f'https://data.weerlab.nl/mosmix_{region}.json'))
  except Exception:return region,{}
 with ThreadPoolExecutor(max_workers=6) as pool:feeds=dict(pool.map(fetch,sorted({s[1] for s in SITES})))
 return select_maxima(feeds,frames,now)

def render_maxima(out,maximum):
 merc=lambda la:math.log(math.tan(math.pi/4+math.radians(la)/2))
 for day,data in maximum.items():
  svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="880" viewBox="0 0 1400 880">']
  for point in data['points']:
   # Pair at the same geographically distributed city anchors; station provenance is retained in title.
   site=next(s for s in SITES if s[0]==point['place']);lo,la=site[-2:]
   x=(lo+13)/37*1400+7;y=(merc(62)-merc(la))/(merc(62)-merc(42))*880+43
   value=math.floor(point['value']+.5);title=escape(f"{point['station']}: MOSMIX TX {point['value']} °C, {point['date']}")
   svg.append(f'<text x="{x:.1f}" y="{y:.1f}" font-family="Arial,sans-serif" font-size="19" font-weight="700" fill="#843aa5" stroke="white" stroke-width="4" stroke-linejoin="round" paint-order="stroke"><title>{title}</title>max {value}°</text>')
  (out/f'{day}-maximum.svg').write_text(''.join(svg)+'</svg>')
