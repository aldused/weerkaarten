import sys, unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit,parse_qs
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import open_meteo as om
class NativeGFS(unittest.TestCase):
 def test_gfs_url_does_not_load_or_include_paid_key(self):
  with patch.object(om,'_load_key',side_effect=AssertionError('paid key accessed')):
   for u in [om.om_url(om.ENSEMBLE,models='gfs025',latitude=52,hourly='temperature_2m'),om.upgrade_url('https://customer-api.open-meteo.com/v1/forecast?models=gfs_global&latitude=52&apikey=example')]:
    self.assertEqual(urlsplit(u).netloc,'om.weerlab.nl');self.assertNotIn('apikey',parse_qs(urlsplit(u).query))
 def test_icon_global_url_never_loads_paid_key(self):
  with patch.object(om,'_load_key',side_effect=AssertionError('paid key accessed')):
   for u in [om.om_url(om.ENSEMBLE,models='icon_global',latitude=52,hourly='temperature_2m'),om.upgrade_url('https://customer-api.open-meteo.com/v1/forecast?models=icon_global&latitude=52&apikey=example')]:
    self.assertEqual(urlsplit(u).netloc,'om.weerlab.nl');self.assertNotIn('apikey',parse_qs(urlsplit(u).query))
 def test_removed_icon_eu_blocked_before_key_read(self):
  with patch.object(om,'_load_key',side_effect=AssertionError('paid key accessed')):
   with self.assertRaises(ValueError):om.om_url(om.FORECAST,models='icon_eu')
   with self.assertRaises(ValueError):om.upgrade_url('https://api.open-meteo.com/v1/forecast?models=icon_seamless')
 def test_other_models_keep_existing_route(self):
  with patch.object(om,'_load_key',return_value=None):
   self.assertEqual(om.upgrade_url('https://api.open-meteo.com/v1/forecast?models=dmi_harmonie_arome_europe'),'https://api.open-meteo.com/v1/forecast?models=dmi_harmonie_arome_europe')
if __name__=='__main__':unittest.main()
