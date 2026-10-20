import importlib.util,unittest,datetime as dt
from pathlib import Path
spec=importlib.util.spec_from_file_location('nl_presentation',Path(__file__).parents[1]/'shell/wxbeta_nl/presentation.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class DutchLabelsTests(unittest.TestCase):
 def test_wintertime_switch_changes_hour_and_season(self):
  self.assertIn('05:00 uur (zomertijd)',m.local_label(dt.datetime(2026,10,24,3,tzinfo=dt.timezone.utc)))
  self.assertIn('04:00 uur (wintertijd)',m.local_label(dt.datetime(2026,10,25,3,tzinfo=dt.timezone.utc)))
 def test_local_date_can_differ_from_utc_date(self):
  self.assertTrue(m.local_label(dt.datetime(2026,10,24,22,tzinfo=dt.timezone.utc)).startswith('zo 25 okt'))
