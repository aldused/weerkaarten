import datetime as dt,importlib.util,unittest
from pathlib import Path
import numpy as np
spec=importlib.util.spec_from_file_location('wind_six',Path(__file__).parents[1]/'shell/wind_six/build.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class StatisticsTests(unittest.TestCase):
 def setUp(self):
  self.run=dt.datetime(2026,10,19,6,tzinfo=dt.timezone.utc);times=[m.iso(self.run+dt.timedelta(hours=i)) for i in range(145)]
  self.p={'_native':True,'hourly':{'time':times},'hourly_units':{}}
  for field in m.FIELDS:
   for member in range(51):
    key=field+(f'_member{member:02d}' if member else '')
    self.p['hourly'][key]=[member+1+(i%3*2 if field=='wind_gusts_10m' else 0) for i in range(145)];self.p['hourly_units'][key]='m/s'
 def test_mean_maximum_and_three_hour_gust_windows(self):
  times,values=m.statistics(self.p,self.run)
  self.assertEqual(len(times),48);np.testing.assert_equal(values[0],[1,5,26,30,51,55])
  # Beyond +90 native gust already covers three hours: no max over interpolated hours.
  np.testing.assert_equal(values[30],[1,1,26,26,51,51])
 def test_missing_member_and_missing_time_rejected(self):
  del self.p['hourly']['wind_speed_10m_member50']
  with self.assertRaisesRegex(ValueError,'51 leden'):m.statistics(self.p,self.run)
 def test_missing_values_do_not_silently_reduce_ensemble(self):
  self.p['hourly']['wind_speed_10m_member40'][3]=None
  with self.assertRaisesRegex(ValueError,'Onvolledige run'):m.statistics(self.p,self.run)
 def test_unit_mismatch_rejected(self):
  self.p['hourly_units']['wind_speed_10m']='km/h'
  with self.assertRaisesRegex(ValueError,'eenheden'):m.statistics(self.p,self.run)
class ManifestTests(unittest.TestCase):
 def test_concurrent_cycles_merge_and_older_or_shorter_cannot_replace(self):
  import tempfile,json
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)
   entry=dict(run='2026-10-19T06:00:00Z',file='complete',frames=48)
   m.publish_entry(root,'06',entry,False)
   m.publish_entry(root,'12',dict(run='2026-10-18T12:00:00Z',file='other',frames=1),False)
   m.publish_entry(root,'06',dict(entry,file='short',frames=1),False)
   m.publish_entry(root,'06',dict(run='2026-10-18T06:00:00Z',file='old',frames=48),False)
   document=json.loads((root/'current.json').read_text())
   self.assertEqual(set(document['runs']),{'06','12'});self.assertEqual(document['runs']['06']['file'],'complete')
class DirectTimelineTests(unittest.TestCase):
 def test_complete_cached_timeline_and_source_intervals(self):
  import tempfile,sys,base64
  sys.path.insert(0,str(Path(__file__).parents[1]/'shell/wind_six'))
  from backfill import build_direct
  run=dt.datetime(2026,10,19,18,tzinfo=dt.timezone.utc)
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);cache=root/'2026101918-direct';cache.mkdir()
   for lead in range(3,145,3):
    np.savez(cache/f'{lead:03d}.npz',coordinates=np.array([[52.,4.],[53.,5.]]),values=np.array([[4,8,5,9,7,12],[5,9,6,10,8,13]]),interval=1 if lead<=90 else 3)
   result=build_direct(run,root)
   self.assertEqual(result['shape'],[48,2,6]);self.assertEqual(len(result['times']),48)
   self.assertEqual(result['times'][-1],'2026-10-25T18:00:00Z')
   self.assertEqual(result['gustIntervalHours'],[1]*30+[3]*18)
   values=np.frombuffer(base64.b64decode(result['data']),dtype='<f4').reshape(result['shape'])
   self.assertTrue(np.all(values[:,:,4]>=values[:,:,2]))
   with self.assertRaisesRegex(ValueError,'geldigheid'):build_direct(run,root,[run+dt.timedelta(hours=1)])
if __name__=='__main__':unittest.main()
