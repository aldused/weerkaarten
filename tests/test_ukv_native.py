import importlib.util,sys,tempfile,unittest
from pathlib import Path
from datetime import datetime,timezone
import h5py,numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import ukv_native_update as u
class UKVTests(unittest.TestCase):
 def test_valid_time_filename_crosses_day(self):
  r=datetime(2026,10,24,12,tzinfo=timezone.utc)
  self.assertEqual(u.name(r,54,'temperature_at_screen_level'),'20261026T1800Z-PT0054H00M-temperature_at_screen_level.nc')
 def test_wind_from_direction_and_speed(self):
  x,y=u.wind_components(np.array([10.,10.,10.,10.]),np.array([0.,90.,180.,270.]))
  np.testing.assert_allclose(x,[0,-10,0,10],atol=1e-6);np.testing.assert_allclose(y,[-10,0,10,0],atol=1e-6)
 def test_netcdf_missing_units_run_and_interval(self):
  r=datetime(2026,10,24,12,tzinfo=timezone.utc)
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'test.nc'
   with h5py.File(p,'w') as f:
    f['forecast_reference_time']=int(r.timestamp());f['time']=int(r.timestamp())+3600
    f['forecast_period_bnds']=[0,3600]
    v=f.create_dataset('cloud_base_height',data=np.array([[100,-999],[200,300]],dtype='float32'))
    v.attrs['grid_mapping']=np.bytes_('lambert_azimuthal_equal_area');v.attrs['long_name']=np.bytes_('cloud_base_height');v.attrs['units']=np.bytes_('m');v.attrs['_FillValue']=-999.
   a=u.read(p,'m',r,1,True);self.assertTrue(np.isnan(a[0,1]));self.assertEqual(a[1,1],300)
   with self.assertRaises(ValueError):u.read(p,'K',r,1,True)
   with self.assertRaises(ValueError):u.read(p,'m',r,2,True)
   with h5py.File(p,'a') as f:f['forecast_period_bnds'][...]=[0,7200]
   with self.assertRaises(ValueError):u.read(p,'m',r,1,True)
if __name__=='__main__':unittest.main()
