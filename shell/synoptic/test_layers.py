import datetime as dt,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from maximum_temperature import select_maxima,render_maxima
from wind_math import beaufort,flow_bearing,THRESHOLDS
import refresh
UTC=dt.timezone.utc
class LayerTests(unittest.TestCase):
 def setUp(self):
  self.now=dt.datetime(2026,10,17,6,tzinfo=UTC)
  self.frames=[dict(day=d,valid=f'2026-10-{d}T12:00:00Z') for d in range(17,22)]
  self.feed={'run':'2026-10-17T03:00:00Z','stations':{'Rotterdam Airport':[4.437,51.957]},'data':{'2026-10-17':{'TX':{'Rotterdam Airport':14.6}}}}
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
 def test_missing_front_review_does_not_publish_empty_fronts(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder);review=base/'review'/'20261016T12';review.mkdir(parents=True)
   dates=[self.now.replace(hour=12)+dt.timedelta(days=i) for i in range(5)]
   for date in dates:(review/f'{date.day}-front-reference.png').touch()
   with patch.object(refresh,'HERE',base),patch.object(refresh,'CACHE',base),patch.object(refresh,'get',return_value=b''),patch.object(refresh,'discover',return_value=(self.now.replace(day=16,hour=12),{d:'https://source.invalid/' for d in dates})),patch.object(refresh.subprocess,'run') as run:
    with self.assertRaisesRegex(ValueError,'Frontencontrole ontbreekt'):refresh.refresh(True)
    run.assert_not_called()
if __name__=='__main__':unittest.main()
