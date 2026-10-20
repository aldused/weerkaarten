import argparse,sys,unittest
from pathlib import Path
from unittest.mock import patch,Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from scripts import ecmwf_openmeteo_update as module
class PinnedRunTest(unittest.TestCase):
 def test_chosen_run_uses_single_runs_endpoint_and_initialisation(self):
  session=Mock();session.post.return_value.status_code=200;session.post.return_value.json.return_value={'hourly':{'time':['2026-10-20T06:00']}}
  args=argparse.Namespace(model='ecmwf_ifs025',model_label='ECMWF',days=7,run='2026-10-20T06:00')
  with patch.object(module,'_load_key',return_value='test-key'),patch.object(module,'bulk_sessie',return_value=session):module.post_bulk([(0,0,52.,5.)],args)
  call=session.post.call_args
  self.assertEqual(call.args[0],'https://customer-single-runs-api.open-meteo.com/v1/forecast')
  self.assertEqual(call.kwargs['json']['run'],'2026-10-20T06:00')
 def test_legacy_models_keep_forecast_endpoint(self):
  session=Mock();session.post.return_value.status_code=200;session.post.return_value.json.return_value={}
  args=argparse.Namespace(model='gfs_global',model_label='GFS',days=7)
  with patch.object(module,'_load_key',return_value=None),patch.object(module,'bulk_sessie',return_value=session):module.post_bulk([(0,0,52.,5.)],args)
  self.assertEqual(session.post.call_args.args[0],'https://api.open-meteo.com/v1/forecast')
  self.assertNotIn('run',session.post.call_args.kwargs['json'])
if __name__=='__main__':unittest.main()
