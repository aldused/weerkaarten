import datetime as dt,json,math,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from maximum_temperature import SITES,select_maxima,render_maxima
from wind_math import beaufort,flow_bearing,THRESHOLDS
import refresh
UTC=dt.timezone.utc
class LayerTests(unittest.TestCase):
 def setUp(self):
  self.now=dt.datetime(2026,10,17,6,tzinfo=UTC)
  self.frames=[dict(day=d,valid=f'2026-10-{d}T12:00:00Z') for d in range(17,22)]
  self.feed={'run':'2026-10-17T03:00:00Z','stations':{'Rotterdam Airport':[4.437,51.957]},'data':{'2026-10-17':{'TX':{'Rotterdam Airport':14.6}}}}
 def test_temperature_sites_cover_british_isles_and_scandinavia_without_overlap(self):
  self.assertEqual(len(SITES),12)
  self.assertEqual({s[0] for s in SITES if s[1]=='gb'},{'Dublin','Edinburgh','Londen'})
  self.assertEqual({s[0] for s in SITES if s[1]=='scan'},{'Bergen','Oslo','Stockholm','Kopenhagen'})
  merc=lambda lat:math.log(math.tan(math.pi/4+math.radians(lat)/2))
  positions=[]
  for name,_,_,lon,lat in SITES:
   x=(lon+13)/37*1400+7;y=(merc(62)-merc(lat))/(merc(62)-merc(42))*880+19
   self.assertTrue(0<x<1320 and 0<y<830,name)
   for other,ox,oy in positions:
    self.assertTrue(abs(x-ox)>105 or abs(y-oy)>65,f'{name} overlaps {other}')
   positions.append((name,x,y))
 def test_daily_maximum_not_noon_temperature_and_missing_days_empty(self):
  result=select_maxima({'nl':self.feed},self.frames,self.now)
  self.assertEqual(result['17']['points'][0]['value'],14.6)
  self.assertEqual(result['17']['points'][0]['station'],'Rotterdam Airport')
  self.assertEqual(result['18']['points'],[])
 def test_stale_and_nonfinite_maxima_are_not_drawn(self):
  self.feed['run']='2026-10-14T03:00:00Z'
  self.assertEqual(select_maxima({'nl':self.feed},self.frames,self.now)['17']['points'],[])
  self.feed['run']='2026-10-17T03:00:00Z'
  for value in [None,float('nan'),float('inf'),True,'14.6']:
   self.feed['data']['2026-10-17']['TX']['Rotterdam Airport']=value
   self.assertEqual(select_maxima({'nl':self.feed},self.frames,self.now)['17']['points'],[])
 def test_maxima_rounding_and_date_provenance(self):
  with tempfile.TemporaryDirectory() as folder:
   result=select_maxima({'nl':self.feed},self.frames,self.now);render_maxima(Path(folder),result)
   svg=(Path(folder)/'17-maximum.svg').read_text()
   self.assertIn('max 15°',svg);self.assertIn('2026-10-17',svg)
 def test_wind_boundaries_and_flow_direction(self):
  self.assertEqual(beaufort(0),0)
  for i,threshold in enumerate(THRESHOLDS):
   self.assertEqual(beaufort(threshold-.0001),i)
   self.assertEqual(beaufort(threshold),i+1)
  self.assertEqual([flow_bearing(d) for d in [0,90,180,270]],[180,270,0,90])
  with self.assertRaises(ValueError):beaufort(-1)
 def test_missing_front_review_publishes_fresh_weather_without_reusing_old_fronts(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder);review=base/'review'/'20261016T12';review.mkdir(parents=True)
   dates=[self.now.replace(hour=12)+dt.timedelta(days=i) for i in range(5)]
   for date in dates:(review/f'{date.day}-front-reference.png').touch()
   def renderer(command,**kwargs):
    if 'env' not in kwargs:return
    out=Path(kwargs['env']['WEERKAART_OUT'])
    (out/'capabilities.json').write_text('{"cloudLevels":[]}')
    for date in dates:
     for suffix in ['ukmo-temp.png','ukmo-cloud.png','ukmo-rain.png','ukmo-temp@2x.png','ukmo-cloud@2x.png','ukmo-rain@2x.png','ukmo-pressure.svg','wind.svg','values.svg','maximum.svg']:(out/f'{date.day}-{suffix}').touch()
   with patch.object(refresh,'HERE',base),patch.object(refresh,'CACHE',base),patch.object(refresh,'get',return_value=b''),patch.object(refresh,'fetch_maxima',return_value={}),patch.object(refresh,'render_maxima'),patch.object(refresh,'discover',return_value=(self.now.replace(day=16,hour=12),{d:'https://source.invalid/' for d in dates})),patch.object(refresh.subprocess,'run',side_effect=renderer) as run:
    refresh.refresh(True)
    published=json.loads((base/'published.json').read_text())
    self.assertFalse(published['frontsAvailable']);self.assertFalse(published['troughsAvailable'])
    self.assertIsNone(published['frontRun']);self.assertEqual(published['frames'][0]['valid'],'2026-10-17T12:00:00Z')
    self.assertTrue(run.call_args_list[-1].args[0][-1].endswith('max-age=60'))
    self.assertFalse(any('trace_fronts.py' in str(call) for call in run.call_args_list))
if __name__=='__main__':unittest.main()
