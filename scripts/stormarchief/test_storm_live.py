import unittest
from datetime import datetime,timedelta,timezone
from update_stormdagen import complete_hours,daily_hours,merge,coverage_rows,rolling_wind
U=timezone.utc
class LiveStormTests(unittest.TestCase):
 def six(self,station=260,end=None,values=None):
  end=end or datetime(2026,10,24,0,tzinfo=U);values=values or [20.5]*6
  return {(station,end-timedelta(minutes=10*i)):{'value':v,'gust':None} for i,v in enumerate(values)}
 def test_rolling_hour_ends_between_clock_hours(self):
  end=datetime(2026,10,25,0,20,tzinfo=U)
  rows=self.six(225,end,[21,21,20,20,20,18]);r=rolling_wind(rows,{225},end)[0]
  self.assertEqual(r['samples'],6);self.assertEqual(r['mean_ms'],20)
  self.assertFalse(r['storm_reached']);self.assertEqual(r['end_utc'],end.isoformat())
 def test_rolling_gap_is_not_filled(self):
  end=datetime(2026,10,25,0,20,tzinfo=U);rows=self.six(225,end)
  del rows[(225,end-timedelta(minutes=20))]
  r=rolling_wind(rows,{225},end)[0];self.assertIsNone(r['mean_ms']);self.assertEqual(r['samples'],5)
 def test_rolling_threshold_uses_unrounded_mean(self):
  end=datetime(2026,10,25,0,20,tzinfo=U)
  r=rolling_wind(self.six(225,end,[20.4999]*6),{225},end)[0]
  self.assertFalse(r['storm_reached'])
 def base(self):
  return {'generated_utc':'2026-10-22T09:00:00Z','latest_date':'2026-10-22','stations':[{'station':260,'name':'De Bilt','last_fhx':'2026-10-22'},{'station':330,'name':'Hoek van Holland','last_fhx':'2026-10-22'}],'years':[{'year':2026,'events':[],'storm':0,'severe':0,'observed_days':295,'expected_days':365,'stations':{'260':295,'330':295},'partial_year':True}]}
 def test_requires_exact_six_samples(self):
  samples=self.six();samples.pop(next(iter(samples)));self.assertEqual(complete_hours(samples),{})
 def test_six_means_are_hour_average_not_peak_or_gust(self):
  hours=complete_hours(self.six(values=[30,20,20,20,20,10]));self.assertEqual(next(iter(hours.values()))['value'],200)
 def test_midnight_is_previous_utc_day_and_hour_24(self):
  days,hours=daily_hours(self.six(),{});r=days[(260,'2026-10-23')];self.assertEqual(r['hour'],24);self.assertEqual(r['value'],205)
 def test_native_hour_overrides_calculated_hour(self):
  ten=self.six();key=next(k for k in complete_hours(ten));days,hours=daily_hours(ten,{key:{'value':20.4,'gust':30}});self.assertEqual(days[(260,'2026-10-23')]['value'],204);self.assertEqual(days[(260,'2026-10-23')]['source'],'hourly-FH')
 def test_archive_can_retract_provisional_storm(self):
  base=self.base();base['years'][0]['events']=[{'date':'2026-10-23','measurements':[[260,210]],'observations':[[260,210,None,24]],'provisional':True}]
  recent,hours=daily_hours(self.six(),{});archive={(260,'2026-10-23'):{'value':204,'gust':300,'hour':24,'hours':24,'provisional':False,'source':'archive-FHX'}}
  out=merge(base,archive,recent,hours,datetime(2026,10,24,tzinfo=U),'2026-10-20');self.assertEqual(out['years'][0]['events'],[])
 def test_multiple_stations_count_one_day_and_excluded_stay_out(self):
  ten={**self.six(),**self.six(330),**self.six(209)};recent,hours=daily_hours(ten,{})
  out=merge(self.base(),{},recent,hours,datetime(2026,10,24,tzinfo=U),'2026-10-20');y=out['years'][0];self.assertEqual(y['storm'],1);self.assertEqual(y['observed_days'],296);self.assertEqual(y['events'][0]['measurements'],[[260,205],[330,205]]);self.assertTrue(y['events'][0]['provisional'])
 def test_timestamp_and_unit_contract(self):
  payload={'parameters':{'ff':{'unit':{'symbol':{'value':'m/s'}},'measurementType':{'duration':'-PT10M','method':'mean'}}},'coverages':[{'eumetnet:locationId':'id','domain':{'axes':{'t':{'values':['2026-10-23T23:50:00Z']}}},'ranges':{'ff':{'shape':[1,1,1],'axisNames':['t','y','x'],'values':[20.6]}}}]}
  self.assertEqual(len(coverage_rows(payload,{'id':260},{260},'ff',datetime(2026,10,24,tzinfo=U))),1)
  payload['parameters']['ff']['measurementType']['duration']='-PT1M'
  with self.assertRaises(ValueError):coverage_rows(payload,{'id':260},{260},'ff',datetime(2026,10,24,tzinfo=U))
 def test_explicit_invalid_hour_retracts_calculated_value(self):
  samples=self.six();key=next(iter(complete_hours(samples)))
  days,hours=daily_hours(samples,{key:{'value':None,'gust':None,'invalid':True}});self.assertEqual(hours,{})
 def test_invalid_sample_never_completes_hour(self):
  samples=self.six();samples[next(iter(samples))]['value']=None;self.assertEqual(complete_hours(samples),{})
if __name__=='__main__':unittest.main()
