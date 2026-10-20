import datetime as dt,importlib.util,unittest
from pathlib import Path
import numpy as np
spec=importlib.util.spec_from_file_location('native_nl',Path(__file__).parents[1]/'shell/wxbeta_nl/build.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class NativeGustTests(unittest.TestCase):
 def setUp(self):
  self.run=dt.datetime(2026,10,19,0,tzinfo=dt.timezone.utc)
  self.point={'hourly_units':{'wind_gusts_10m':'m/s','pressure_msl':'hPa'},'hourly':{'time':[m.iso(self.run+dt.timedelta(hours=i)) for i in range(361)],'wind_gusts_10m':[1+2*(i%3) for i in range(361)],'pressure_msl':[1000]*361}}
 def test_three_hour_maximum_and_later_native_intervals(self):
  values=m.sample_point(self.point,self.run,[3,90,93,144,150,360]);np.testing.assert_allclose(values[:,0],[18,18,3.6,3.6,3.6,3.6]);np.testing.assert_equal(values[:,1],1000)
 def test_missing_hour_or_wrong_unit_rejected(self):
  self.point['hourly']['wind_gusts_10m'][2]=None
  with self.assertRaises(ValueError):m.sample_point(self.point,self.run,[3])
  self.point['hourly_units']['pressure_msl']='Pa'
  with self.assertRaises(ValueError):m.sample_point(self.point,self.run,[93])
 def test_all_four_cycle_horizons(self):
  self.assertEqual([len(m.steps(c)) for c in [0,6,12,18]],[84,48,84,48]);self.assertEqual(m.steps(18)[-1],144)
if __name__=='__main__':unittest.main()
