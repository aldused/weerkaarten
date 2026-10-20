import datetime as dt,importlib.util,unittest
from pathlib import Path
import numpy as np
spec=importlib.util.spec_from_file_location('nl_layers',Path(__file__).parents[1]/'shell/wxbeta_nl/layers.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class DetailedNetherlandsTests(unittest.TestCase):
 def setUp(self):
  self.run=dt.datetime(2026,10,19,18,tzinfo=dt.timezone.utc)
  self.point={'hourly_units':dict(m.SURFACE),'hourly':{'time':[m.iso(self.run+dt.timedelta(hours=h)) for h in range(145)]}}
  for field in m.SURFACE:self.point['hourly'][field]=[1000 if field=='pressure_msl' else 1 for _ in range(145)]
 def test_precipitation_uses_complete_preceding_windows(self):
  keys,values=m.point_values(self.point,self.run,[3,24,93,144],'ecmwf_ifs');d=dict(zip(keys,values.T))
  np.testing.assert_equal(d['rain3'],3);self.assertTrue(np.isnan(d['rain24'][0]));np.testing.assert_equal(d['rain24'][1:],24)
  self.point['hourly']['precipitation'][23]=None
  with self.assertRaises(ValueError):m.point_values(self.point,self.run,[24],'ecmwf_ifs')
 def test_units_and_missing_forecast_are_rejected(self):
  self.point['hourly_units']['temperature_2m']='K'
  with self.assertRaises(ValueError):m.point_values(self.point,self.run,[3],'ecmwf_ifs')
  self.point['hourly_units']['temperature_2m']='°C'
  with self.assertRaises(ValueError):m.point_values(self.point,self.run,[150],'ecmwf_ifs')
 def test_beaufort_thresholds_and_upper_air_units(self):
  np.testing.assert_equal(m.bft(np.array([0,.3,1.6,5.5,10.8,32.7])),[0,1,2,4,6,12])
  np.testing.assert_allclose(m.chart_values('z500',{'geopotential_height_500hPa':np.array([5500])}),[550])
  np.testing.assert_allclose(m.chart_values('jetstream',{'wind_speed_300hPa':np.array([10])}),[19.4384449])
if __name__=='__main__':unittest.main()
