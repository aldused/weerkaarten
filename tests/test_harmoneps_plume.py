import importlib.util,sys,unittest
from pathlib import Path
import numpy as np
p=Path(__file__).resolve().parents[1]/'scripts/harmoneps_plume.py'
s=importlib.util.spec_from_file_location('hp',p);hp=importlib.util.module_from_spec(s);s.loader.exec_module(hp)
class Fields(unittest.TestCase):
 def test_identities(self):
  self.assertEqual(hp.FIELDS[(186,200,0,0)],'cloudbase')
  self.assertNotIn((209,200,0,0),hp.FIELDS)
  self.assertNotIn((181,105,0,0),hp.FIELDS)
  self.assertEqual(hp.FIELDS[(181,105,0,4)],'rain')
 def test_total_and_reset(self):
  np.testing.assert_allclose(hp.interval_precip([[0,1,2]],[[0,.5,1]],[[0,.1,.2]]),[[0,1.6,1.6]])
  for arr in [[[0,2,1]],[[0,float('nan'),2]],[[1,2,3]]]:
   with self.assertRaises(ValueError):hp.interval_precip(arr,np.zeros((1,3)),np.zeros((1,3)))
 def test_source_discovery_any_hour(self):
  self.assertEqual(hp.latest_file([{'filename':'harm43_v1_P2a_2026091013.tar','size':1},{'filename':'harm43_v1_P2a_2026091012.tar','size':1}])['filename'],'harm43_v1_P2a_2026091013.tar')
 def test_real_probe_identity(self):
  probe=Path('/tmp/pluim-harm-probe.grib')
  if not probe.exists():self.skipTest('Optional live GRIB probe not present')
  found=set()
  with probe.open('rb') as f:
   while (g:=hp.ec.codes_grib_new_from_file(f)) is not None:
    try:
     identity=tuple(hp.ec.codes_get(g,k,int) for k in ['indicatorOfParameter','indicatorOfTypeOfLevel','level','timeRangeIndicator'])
     if identity in hp.FIELDS:found.add(hp.FIELDS[identity])
    finally:hp.ec.codes_release(g)
  self.assertEqual(found,hp.REQUIRED)
if __name__=='__main__':unittest.main()
