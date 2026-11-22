import copy
from datetime import datetime,timedelta,timezone
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from knmi_warning_context import warning_days,month_window,rows,daily_documents,ten_minute_rows,visibility_code

ID='0-20000-0-06260'
class ContextTests(unittest.TestCase):
 def coverage(self,times,fields):
  return {'type':'CoverageCollection','coverages':[{'eumetnet:locationId':ID,'domain':{'axes':{'x':{'values':[5.18]},'y':{'values':[52.1]},'t':{'values':times}}},'ranges':{key:{'axisNames':['t','y','x'],'shape':[len(times),1,1],'values':values} for key,values in fields.items()}}]}
 def test_warning_days_use_dutch_day_and_exclusive_end(self):
  now=datetime(2026,11,22,tzinfo=timezone.utc)
  self.assertEqual(warning_days([{'onset':'2026-10-24T22:00Z','expires':'2026-10-25T23:00Z'}],now),['2026-10-25'])
  a,b=month_window('2026-03');self.assertEqual((b-a).total_seconds()/3600,31*24-1)
 def test_coverage_keeps_visibility_codes_nulls_and_physical_units(self):
  data=self.coverage(['2026-11-20T07:00Z'],{'T':[1.7],'VV':[1],'RH':[None]})
  result=rows(data,'validated');row=next(iter(result.values()))
  self.assertEqual(row['values'][:3],[1.7,None,1]);self.assertIsNone(row['values'][6])
  bad=copy.deepcopy(data);bad['coverages'][0]['ranges']['T']['shape']=[3,1,1]
  with self.assertRaises(ValueError):rows(bad,'validated')
 def test_winter_day_retains_both_two_oclock_measurements(self):
  first=datetime(2026,10,24,22,tzinfo=timezone.utc)
  times=[(first+timedelta(hours=i)).isoformat() for i in range(25)]
  data=rows(self.coverage(times,{'T':list(range(25)),'VV':[0]*25}),'validated')
  result=daily_documents(data,['2026-10-25'],{ID:{'name':'De Bilt'}},first)['2026-10-25']
  self.assertEqual(len(result['times']),25);self.assertEqual(len(set(result['times'])),25)
 def test_ten_minute_gust_needs_six_complete_intervals_and_rain_stays_missing(self):
  times=[f'2026-11-22T00:{m:02d}:00Z' for m in [10,20,30,40,50]]+['2026-11-22T01:00:00Z']
  source=self.coverage(times,{'ta':[1]*6,'td':[.5]*6,'vv':[150]*6,'rh':[98]*6,'ff':[2]*6,'fx':[3,4,5,9,4,3]})
  result=ten_minute_rows(source);self.assertEqual(len(result),1)
  row=next(iter(result.values()));self.assertEqual(row['values'][2],1);self.assertEqual(row['values'][5],9);self.assertIsNone(row['values'][6]);self.assertEqual(row['visibility_m'],150)
  incomplete=copy.deepcopy(source);incomplete['coverages'][0]['ranges']['fx']['values'][2]=None
  self.assertIsNone(next(iter(ten_minute_rows(incomplete).values()))['values'][5])
 def test_visibility_metres_are_classed_without_a_linear_code_conversion(self):
  for metres,code in [(0,0),(99,0),(100,1),(199,1),(200,2),(5000,50),(6000,56),(10000,60),(30000,80),(70001,89)]:self.assertEqual(visibility_code(metres),code)
  self.assertIsNone(visibility_code(None));self.assertIsNone(visibility_code(-1))

if __name__=='__main__':unittest.main()
