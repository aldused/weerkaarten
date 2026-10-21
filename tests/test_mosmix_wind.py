import sys,unittest
from datetime import datetime,timedelta,date,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from mosmix_wind import aggregate_wind,representative
NL=ZoneInfo('Europe/Amsterdam')
class WindTest(unittest.TestCase):
 def test_direction_is_weighted_but_speed_is_scalar_mean(self):
  self.assertEqual(representative([10,1],[270,90]),(19.8,270));self.assertEqual(representative([10,10],[270,90]),(36.,None));self.assertEqual(representative([0,0],[None,None]),(0.,None))
 def test_missing_is_not_calm(self):
  for bad in [None,-1,float('nan'),True]:self.assertEqual(representative([0,bad],[270,270]),(None,None))
 def test_gust_is_max_over_preceding_hours_not_wind_mean(self):
  times=[datetime(2026,10,21,10)+timedelta(hours=i) for i in range(7)];r=aggregate_wind(times,[10]*7,[270]*7,[99,1,1,1,1,1,25])[date(2026,10,21)]
  self.assertEqual(r['FF_M'],36);self.assertEqual(r['FX_M'],90)
 def test_old_night_is_one_contiguous_evening_and_next_morning(self):
  times=[datetime(2026,10,20,tzinfo=timezone.utc)+timedelta(hours=i) for i in range(56)];speeds=[1 if t.astimezone(NL).day==20 and t.astimezone(NL).hour<6 else 10 for t in times];r=aggregate_wind(times,speeds,[270]*56,[20]*56)
  self.assertEqual(r[date(2026,10,20)]['FF_N'],36)
 def test_dst_night_uses_all_actual_utc_hours(self):
  for day in [date(2026,3,28),date(2026,10,24)]:
   first=datetime.combine(day,datetime.min.time(),NL).astimezone(timezone.utc);times=[first+timedelta(hours=i) for i in range(55)];r=aggregate_wind(times,[10]*55,[270]*55,[20]*55)
   self.assertEqual(r[day]['FF_N'],36);self.assertEqual(r[day]['FX_N'],72)
if __name__=='__main__':unittest.main()

class ParserIntegration(unittest.TestCase):
 def test_parser_writes_consistent_wind_from_original_dwd_fields(self):
  import xml.etree.ElementTree as ET
  from unittest.mock import patch
  import mosmix_json
  root=ET.Element('root');steps=ET.SubElement(root,'ForecastTimeSteps')
  times=[datetime(2026,10,21)+timedelta(hours=i) for i in range(49)]
  for t in times:ET.SubElement(steps,'TimeStep').text=t.strftime('%Y-%m-%dT%H:%M:%SZ')
  for name,values in [('FF',[10]*49),('DD',[270]*49),('FX1',[20]*49),('TTT',[285]*49),('TX',[287]*49),('TN',[280]*49)]:
   fc=ET.SubElement(root,'Forecast',elementName=name);ET.SubElement(fc,'value').text=' '.join(map(str,values))
  ET.SubElement(root,'IssueTime').text='2026-10-20T21:00:00Z'
  with patch.object(mosmix_json,'download_kmz',return_value=root):daily,hourly,run=mosmix_json.verwerk_station('06260','De Bilt')
  self.assertEqual(daily[date(2026,10,21)]['FF_M'],36)
  self.assertEqual(daily[date(2026,10,21)]['DD_M'],270)
  self.assertEqual(daily[date(2026,10,21)]['FX_M'],72)
  self.assertEqual(hourly['FF'][0],36)
  self.assertEqual(hourly['FX1'][0],72)
  self.assertTrue(hourly['tijden_utc'][0].endswith('Z'))
