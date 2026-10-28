import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'shell'))
import ecmwf_pluim_progressive as p

class Progressive(unittest.TestCase):
 def test_prefix_stops_at_one_missing_member_or_packing_error(self):
  raw={'2t':np.ones((51,39,6)),'tp':np.ones((51,39,6)),'tp_packing_error':np.zeros((51,39,6))}
  raw['2t'][50,38,3]=np.nan
  self.assertEqual(p.prefix_count(raw,('2t','tp')),3)
  raw['tp_packing_error'][0,0,2]=np.nan
  self.assertEqual(p.prefix_count(raw,('2t','tp')),2)
 def test_snapshot_is_exact_cycle_and_preserves_rain_totals(self):
  steps=(0,3,6,9,12,15)
  shape=(51,1,6)
  raw={'2t':np.full(shape,280.),'tp':np.broadcast_to(np.array([0,.001,.002,.003,.004,np.nan]),shape).copy(),'tp_packing_error':np.zeros(shape)}
  station=p.direct.Station('De Bilt','debilt',52.101,5.18)
  point=p.direct.GridPoint(0,52.,5.,1.)
  now=datetime(2026,10,27,tzinfo=timezone.utc)
  m,docs=p.snapshot(raw,('2t','tp'),steps,[station],(point,),now,p.direct.Metrics(0),now)
  d=docs['debilt']['runs'][0]
  self.assertFalse(m['complete']);self.assertEqual(m['available_through_hour'],12)
  self.assertEqual(len(d['times_ms']),13);self.assertEqual(len(d['members']['temperature_2m']),51)
  self.assertTrue(all(abs(sum(row)-4)<1e-8 for row in d['members']['precipitation']))
  self.assertNotIn('source_ready',d['source']);self.assertEqual(d['run'],'2026-10-27T00:00:00Z')
 def test_failed_upload_does_not_commit_pointer(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);meta=root/'pluim_progressive_meta.json';meta.write_text('{"old":true}')
   manifest={'path':'pluim-progressive/20261027T00/abc','run':'x','available_through_hour':12,'expected_through_hour':360}
   def fail(*args,**kwargs):raise RuntimeError('upload failed')
   with self.assertRaises(RuntimeError):p.publish_snapshot((manifest,{'debilt':{'runs':[]}}),root,ROOT,fail)
   self.assertEqual(json.loads(meta.read_text()),{'old':True})
 def test_readiness_stops_at_gap(self):
  with patch.object(p,'step_ready',side_effect=lambda client,run,step: step < 6) as probe:
   self.assertEqual(p.available_steps(None,None,(0,3,6,9)),(0,3))
   self.assertEqual(probe.call_count,4)

if __name__=='__main__':unittest.main()

class Availability(unittest.TestCase):
 def test_parallel_probes_never_skip_missing_interval(self):
  with patch.object(p,'step_ready',side_effect=lambda client,run,step:step!=6):
   self.assertEqual(p.available_steps(None,None,(0,3,6,9,12)),(0,3))
 def test_parallel_probes_keep_order(self):
  with patch.object(p,'step_ready',return_value=True):
   self.assertEqual(p.available_steps(None,None,(0,3,6,9,12)),(0,3,6,9,12))
