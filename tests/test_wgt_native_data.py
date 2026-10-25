import sys,unittest
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import wgt_native_data as native
class NativeGridTests(unittest.TestCase):
 def test_bilinear_and_outside_domain(self):
  a=np.array([[[0.,10.],[20.,30.]]]);g={'n_lat':2,'n_lon':2,'lat_min':50.,'lat_max':51.,'lon_min':4.,'lon_max':5.}
  values=native.bilinear(a,g,[50.5,49.],[4.5,4.5]);self.assertEqual(values[0,0],15);self.assertTrue(np.isnan(values[1,0]))
 def test_packed_rain_is_decoded_before_spatial_interpolation(self):
  packed=np.array([[[0,50],[50,100]]],dtype=np.uint8)
  values=native.decode_packed(packed,{"dtype":"u8sqrt","scale":50,"power":3})
  g={"n_lat":2,"n_lon":2,"lat_min":50.,"lat_max":51.,"lon_min":4.,"lon_max":5.}
  self.assertEqual(native.bilinear(values,g,[50.5],[4.5])[0,0],2.5)
 def test_repeated_autumn_hour_is_preserved(self):
  m={'run_utc':'2026-10-24T23:00:00Z','tijden':['2026-10-25T02:00','2026-10-25T02:00','2026-10-25T03:00']}
  times=native.times_utc(m);self.assertEqual(times[0].hour,0);self.assertEqual(times[1].hour,1);self.assertTrue(np.all(np.diff(times.asi8)==3600000000000))
 def test_first_forecast_hour_after_midnight_run_uses_winter_time(self):
  times=native.times_utc({'run_utc':'2026-10-25T00:00:00Z','tijden':['2026-10-25T02:00','2026-10-25T03:00']})
  self.assertEqual(times[0].hour,1)
 def test_unordered_source_times_fail(self):
  with self.assertRaises(ValueError):native.times_utc({'run_utc':'2026-10-25T00:00:00Z','tijden':['2026-10-25T03:00+01:00','2026-10-25T02:00+01:00']})
if __name__=='__main__':unittest.main()
