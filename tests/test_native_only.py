import sys,unittest,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import requests,weerlab_network_fence as fence,open_meteo as om,native_only_pages
class NativeOnly(unittest.TestCase):
 def test_provider_hosts_blocked(self):
  for host in ['api.open-meteo.com','customer-ensemble-api.open-meteo.com','open-meteo.com']:
   with self.assertRaises(RuntimeError):fence.check('https://'+host+'/v1/forecast')
 def test_native_hosts_preserved(self):
  for host in ['data.ecmwf.int','opendata.dwd.de','om.weerlab.nl','data.weerlab.nl']:fence.check('https://'+host+'/file')
 def test_requests_stopped_before_transport(self):
  with patch.object(fence,'original_send',side_effect=AssertionError('network called')):
   with self.assertRaises(RuntimeError):requests.get('https://api.open-meteo.com/v1/forecast')
 def test_non_native_url_builder_fails_closed(self):
  with self.assertRaises(RuntimeError):om.om_url(om.ENSEMBLE,models='ecmwf_aifs025')
  self.assertIsNone(om._load_key())
 def test_html_fence_precedes_other_scripts(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);p=root/'test.html';p.write_text('<!doctype html><html><head><script>fetch("x")</script></head><body>Hello</body></html>');self.assertEqual(native_only_pages.apply(root),1);s=p.read_text();self.assertLess(s.index('weerlab-native-only'),s.index('fetch('));self.assertEqual(native_only_pages.apply(root),0);self.assertIn('<body>Hello</body>',s)
if __name__=='__main__':unittest.main()
