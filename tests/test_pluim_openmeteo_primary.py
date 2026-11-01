import json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'shell'))
import pluim_openmeteo_primary as p

def fixtures():
 cycle=p.datetime(2026,11,1,tzinfo=p.timezone.utc)
 hours=list(range(91))+list(range(93,145,3))+list(range(150,361,6))
 meta={'reference_time':p.trend.iso_z(cycle),'created_at':'2026-11-01T07:07:34Z','valid_times':[p.trend.iso_z(cycle+p.timedelta(hours=h)) for h in hours],'variables':list(p.early.REQUIRED_NATIVE_VARIABLES)}
 standard={'last_run_initialisation_time':int((cycle-p.timedelta(hours=6)).timestamp()),'last_run_availability_time':int(cycle.timestamp()),'data_end_time':int((cycle+p.timedelta(hours=138)).timestamp())}
 hourly={'time':[p.trend.iso_z(cycle+p.timedelta(hours=h)) for h in range(385)]}
 units=dict(p.early.EXPECTED_UNITS)
 for field in p.early.EARLY_FIELDS:
  for member in range(51):hourly[field+('_member'+str(member).zfill(2) if member else '')]=[1.]*385
 raw={'hourly':hourly,'hourly_units':units,'latitude':52.101,'longitude':5.178,'elevation':0}
 return meta,standard,raw

class FreePrimary(unittest.TestCase):
 def test_paid_or_other_hosts_are_never_called(self):
  with tempfile.TemporaryDirectory() as d:
   f=p.FreeFetch(Path(d)/'state.json')
   with patch.object(p.subprocess,'run') as run:
    for url in ['https://customer-api.open-meteo.com/v1/ensemble','https://ensemble-api.open-meteo.com/v1/ensemble?apikey=secret']:
     with self.assertRaises(RuntimeError):f(url)
    run.assert_not_called()
 def test_daily_budget_blocks_before_network(self):
  with tempfile.TemporaryDirectory() as d:
   f=p.FreeFetch(Path(d)/'state.json');f.state={'day':p.datetime.now(p.timezone.utc).strftime('%Y-%m-%d'),'credits':8500,'recent':[]}
   with patch.object(p.subprocess,'run') as run:
    with self.assertRaises(RuntimeError):f('https://ensemble-api.open-meteo.com/data_run/test/latest.json')
    run.assert_not_called()
 def test_prefers_newer_native_00_over_standard_18(self):
  early,standard,_=fixtures()
  chosen=p.choose(lambda url:early if '/data_run/' in url else standard)
  self.assertEqual(chosen[0].hour,0);self.assertTrue(chosen[1])
 def test_exact_cycle_build_and_metadata_change_abort(self):
  m,_,raw=fixtures();cycle,created,times=p.early.validate_early_meta(m)
  chosen=(cycle,True,created,times,p.early.EARLY_LATEST_META_URL,m,p.early.EARLY_MODEL)
  with tempfile.TemporaryDirectory() as d,patch.object(p.trend,'STATIONS',[('De Bilt','debilt',52.101,5.178)]):
   fetch=lambda url:raw if '/v1/' in url else m
   docs=p.build_documents(fetch,Path(d),chosen);r=docs['debilt']['runs'][0]
   self.assertEqual(r['run'],'2026-11-01T00:00:00Z');self.assertEqual(len(r['members']['temperature_2m']),51);self.assertNotIn('cape',r['members']);self.assertEqual(len(list(Path(d).iterdir())),0)
   responses=iter([m,raw,dict(m,created_at='2026-11-01T07:08:00Z')])
   with self.assertRaises(RuntimeError):p.build_documents(lambda _:next(responses),Path(d),chosen)
   self.assertEqual(list(Path(d).iterdir()),[])
if __name__=='__main__':unittest.main()
