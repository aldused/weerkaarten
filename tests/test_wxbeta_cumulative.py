import datetime as dt,gzip,importlib.util,json,tempfile,unittest
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('cumulative_tests_module',ROOT/'shell/wxbeta_region/cumulative.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)

class CumulativeTests(unittest.TestCase):
 def test_grib_precision_allows_only_documented_roundoff(self):
  values=np.array([[3.90625],[3.662109375]],dtype='float32');original=values.copy()
  c.validate_totals(values,[.1220703125,.1220703125])
  np.testing.assert_array_equal(values,original)
  with self.assertRaises(ValueError):c.validate_totals(values,[.01,.01])
  with self.assertRaises(ValueError):c.validate_totals(np.array([[5.],[3.]]),[.122,.122])
  with self.assertRaises(ValueError):c.validate_totals(values,[float('nan'),.122])
 def test_disjoint_gfs_buckets_are_added_once(self):
  values=c.bucket_total({6:np.array([2.]),12:np.array([3.]),18:np.array([4.])},[6,12,18])
  np.testing.assert_array_equal(values[:,0],[2,5,9])
  with self.assertRaises(ValueError):c.bucket_total({6:np.array([2.]),18:np.array([4.])},[6,18])
 def test_24_hour_window_does_not_become_the_total(self):
  total={24:np.array([20.]),48:np.array([35.])}
  np.testing.assert_array_equal(c.elements.precipitation(total,48,24),[15.])
  with self.assertRaises(ValueError):c.elements.precipitation({24:np.array([20.]),48:np.array([10.])},48,24)
 def test_native_total_starts_after_the_exact_run_hour(self):
  run=dt.datetime(2026,10,20,tzinfo=dt.timezone.utc)
  with tempfile.TemporaryDirectory() as name:
   root=Path(name);folder=root/'wxbeta-nl/cache/ecmwf_ifs-2026102000-x-1';folder.mkdir(parents=True)
   response={'latitude':52.,'longitude':4.,'hourly_units':{'precipitation':'mm'},'hourly':{'time':[(run+dt.timedelta(hours=h)).strftime('%Y-%m-%dT%H:%M') for h in range(7)],'precipitation':[999,1,2,3,4,5,6]}}
   responses=[{**response,'latitude':lat,'longitude':lon} for lat,lon in [(50,3),(54,3),(50,8),(54,8)]]
   (folder/'0.json.gz').write_bytes(gzip.compress(json.dumps(responses).encode()))
   coords,values,resolution=c.native_netherlands(root/'wxbeta-cumulative','ecmwf',run,[3,6])
   np.testing.assert_array_equal(values[:,0],[6,21]);self.assertEqual(resolution,'native 9 km')
   (folder/'0.json.gz').write_bytes(gzip.compress(json.dumps(responses[:1]).encode()))
   with self.assertRaisesRegex(ValueError,'dekt Nederland niet volledig'):c.native_netherlands(root/'wxbeta-cumulative','ecmwf',run,[3,6])
   response['hourly']['precipitation'][2]=None
   responses=[{**response,'latitude':lat,'longitude':lon} for lat,lon in [(50,3),(54,3),(50,8),(54,8)]]
   (folder/'0.json.gz').write_bytes(gzip.compress(json.dumps(responses).encode()))
   with self.assertRaises(ValueError):c.native_netherlands(root/'wxbeta-cumulative','ecmwf',run,[3,6])
if __name__=='__main__':unittest.main()
