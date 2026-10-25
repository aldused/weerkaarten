import importlib.util
from pathlib import Path
import unittest
import numpy as np
spec=importlib.util.spec_from_file_location('icond2_eps',Path(__file__).resolve().parents[1]/'scripts/icond2_eps_native.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class RainTest(unittest.TestCase):
 def test_member_totals_and_no_invented_initial_interval(self):
  a=np.array([[[0,0],[0,0]],[[1,2],[3,4]],[[2,5],[4,6]]],dtype=float)
  h=m.rain_hours(a,[0,0,0]);self.assertTrue(np.isnan(h[0]).all());np.testing.assert_allclose(h[1:].sum(axis=0),a[-1]-a[0]);np.testing.assert_allclose(h[1],a[1])
 def test_material_accumulation_reset_is_rejected(self):
  with self.assertRaises(ValueError):m.rain_hours(np.array([0,2,1.0])[:,None,None],[0,0,0])
 def test_only_packing_noise_can_be_repaired(self):
  h=m.rain_hours(np.array([0,2,1.99999,3])[:,None,None],[0,0.00001,0.00001,0.00001]);self.assertAlmostEqual(float(h[1:].sum()),3);self.assertTrue((h[1:]>=0).all())
if __name__=='__main__':unittest.main()
