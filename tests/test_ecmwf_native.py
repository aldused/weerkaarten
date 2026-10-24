import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import ecmwf_native_update as e
from ecmwf_interpolate import hourly_ensemble
class NativeTests(unittest.TestCase):
 def test_rain_quantisation_keeps_exact_total(self):
  a=np.array([0,10,9.756,15],dtype='float64')[:,None,None]/1000
  error=np.array([0,.1220703125,.244140625,.244140625])/1000
  out=e.deaccumulate(a,error,np.array([0,3,6,9]),1000)
  self.assertTrue(np.all(out>=0));self.assertAlmostEqual(float(out.sum()*3),15,places=5)
 def test_real_source_reset_stops_publication(self):
  with self.assertRaises(ValueError):e.deaccumulate(np.array([0,10,8,15])[:,None,None]/1000,np.full(4,.000244),np.array([0,3,6,9]),1000)
 def test_unequal_intervals(self):
  a=np.array([0,3,15])[:,None,None]/1000
  np.testing.assert_allclose(e.deaccumulate(a,np.zeros(3),np.array([0,3,9]),1000).ravel(),[1,2])
class EnsembleInterpolationTests(unittest.TestCase):
 def test_member_spread_and_interval_rain_are_preserved(self):
  rain=np.array([[[0,3,6]],[[0,6,3]]],dtype=float)
  fields={'precipitation':rain,'temperature_2m':np.array([[[0,6,12]],[[10,16,22]]],dtype=float)}
  out,hours=hourly_ensemble(fields,[0,3,9])
  self.assertEqual(hours,tuple(range(10)))
  np.testing.assert_allclose(out['temperature_2m'][1]-out['temperature_2m'][0],10)
  np.testing.assert_allclose(out['precipitation'][...,1:4].sum(axis=-1),rain[...,1])
  np.testing.assert_allclose(out['precipitation'][...,4:10].sum(axis=-1),rain[...,2])
 def test_wind_interpolates_across_north(self):
  fields={'wind_speed_10m':np.array([[[10,10]]]),'wind_direction_10m':np.array([[[350,10]]])}
  out,_=hourly_ensemble(fields,[0,2])
  self.assertAlmostEqual(float(out['wind_direction_10m'][0,0,1])%360,0,places=7)
  self.assertGreater(float(out['wind_speed_10m'][0,0,1]),9)
if __name__=='__main__':unittest.main()
