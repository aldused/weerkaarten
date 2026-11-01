import unittest
from datetime import datetime,timezone
from pluim_run_queue import choose_run

def record(hour):
 return dict(run=f'2026-10-31T{hour:02d}:00:00Z',complete=True,station_count=39)
class Queue(unittest.TestCase):
 now=datetime(2026,11,1,4,tzinfo=timezone.utc)
 def test_newest_missing_first(self):
  run,old=choose_run(self.now,{'runs':[record(0),record(6)]},{'run':record(6)['run']})
  self.assertEqual(run.hour,18);self.assertFalse(old)
 def test_missing_twelve_caught_up_after_eighteen(self):
  run,old=choose_run(self.now,{'runs':[record(0),record(6),record(18)]},{'run':record(18)['run']})
  self.assertEqual(run.hour,12);self.assertTrue(old)
 def test_unpublished_local_run_not_trusted(self):
  run,old=choose_run(self.now,{'runs':[record(0),record(6),record(12),record(18)]},{'run':record(6)['run']})
  self.assertEqual(run.hour,18);self.assertFalse(old)
 def test_complete_day_keeps_newest(self):
  run,old=choose_run(self.now,{'runs':[record(h) for h in (0,6,12,18)]},{'run':record(18)['run']})
  self.assertEqual(run.hour,18);self.assertFalse(old)
 def test_incomplete_run_not_skipped(self):
  r=record(18);r['complete']=False
  run,old=choose_run(self.now,{'runs':[record(0),record(6),record(12),r]},{'run':r['run']})
  self.assertEqual(run.hour,18);self.assertFalse(old)
 def test_new_day_rollover(self):
  run,old=choose_run(datetime(2026,11,1,6,30,tzinfo=timezone.utc),{'runs':[record(h) for h in (0,6,12,18)]},{'run':record(18)['run']})
  self.assertEqual(run.day,1);self.assertEqual(run.hour,0);self.assertFalse(old)
if __name__=='__main__':unittest.main()
