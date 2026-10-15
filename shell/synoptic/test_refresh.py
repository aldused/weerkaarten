import datetime as dt,unittest
from refresh import discover
class DiscoveryTests(unittest.TestCase):
 def test_validity_crosses_month(self):
  html=' '.join(f'https://data.consumer-digital.api.metoffice.gov.uk/v1/surface-pressure/bw/2026-10-30T1200/1200_MEDIUM_RANGE_FC{x:03d}.gif' for x in [24,48,72,96,120])
  run,charts=discover(html,dt.datetime(2026,10,31,5,tzinfo=dt.timezone.utc))
  self.assertEqual([v.isoformat()[:10] for v in charts],['2026-10-31','2026-11-01','2026-11-02','2026-11-03','2026-11-04'])
 def test_incomplete_cycle_rejected(self):
  with self.assertRaises(ValueError):discover('',dt.datetime.now(dt.timezone.utc))
 def test_validity_not_filename_lead_assumption(self):
  html=' '.join(f'https://data.consumer-digital.api.metoffice.gov.uk/v1/surface-pressure/bw/2026-10-15T0000/0000_MEDIUM_RANGE_FC{x:03d}.gif' for x in [12,36,60,84,108])
  run,charts=discover(html,dt.datetime(2026,10,15,5,tzinfo=dt.timezone.utc))
  self.assertTrue(all(d.hour==12 for d in charts));self.assertEqual(run.hour,0)
if __name__=='__main__':unittest.main()
