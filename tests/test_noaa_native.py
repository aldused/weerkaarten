import importlib.util,sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import noaa_native as n
class NOAAIntervals(unittest.TestCase):
 def test_overlapping_accumulations_are_not_double_counted(self):
  a=[np.array([x]) for x in (np.nan,3,8,4)];r=n.intervals(a,[[0,0,0],[0,3,0],[0,6,0],[6,9,0]],[0,3,6,9]);np.testing.assert_allclose(r[1:,0],[3,5,4]);self.assertTrue(np.isnan(r[0,0]))
 def test_packing_noise_repair_preserves_window_total(self):
  a=[np.array([x]) for x in (np.nan,1,0.999,2)];r=n.intervals(a,[[0,0,0],[0,1,.001],[0,2,.001],[0,3,.001]],[0,1,2,3]);self.assertAlmostEqual(float(r[1:].sum()),2);self.assertTrue((r[1:]>=0).all())
 def test_gefs_source_truncation_preserves_final_six_hour_total(self):
  values=[np.array([x]) for x in (np.nan,.08,0.)];windows=[[0,0,0],[0,3,.005],[0,6,.05]]
  with self.assertRaises(ValueError):n.intervals(values,windows,[0,3,6])
  r=n.intervals(values,windows,[0,3,6],packing_factor=2);np.testing.assert_allclose(r[1:,0],[0,0])
  with self.assertRaises(ValueError):n.intervals([np.array([x]) for x in (np.nan,.3,0.)],windows,[0,3,6],packing_factor=2)
 def test_material_reset_is_rejected(self):
  with self.assertRaises(ValueError):n.intervals([np.array([x]) for x in (np.nan,4,1)],[[0,0,0],[0,3,.01],[0,6,.01]],[0,3,6])
 def test_source_average_radiation_preserves_energy(self):
  r=n.intervals([np.array([x]) for x in (np.nan,100,150)],[[0,0,0],[0,3,.01],[0,6,.01]],[0,3,6],True);np.testing.assert_allclose(r[1:,0],[300,600]);self.assertAlmostEqual(float(r[1:].sum()),900)
 def test_missing_interval_is_not_reconstructed(self):
  with self.assertRaises(ValueError):n.intervals([np.array([x]) for x in (np.nan,1)],[[0,0,0],[2,6,.01]],[0,6])
 def test_duplicate_inventory_records_are_selected_once(self):
  rows=n.inventory('1:0:d=2026102512:APCP:surface:0-3 hour acc fcst:\n2:100:d=2026102512:APCP:surface:0-3 hour acc fcst:\n3:200:d=2026102512:CAPE:surface:3 hour fcst:')
  a=n.select(rows,['rain'],'gfs',3);self.assertEqual(a['rain']['offset'],0);self.assertEqual(a['rain']['end'],99)
if __name__=='__main__':unittest.main()
