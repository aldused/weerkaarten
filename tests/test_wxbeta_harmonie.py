import datetime as dt
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('harmonie_charts', Path(__file__).parents[1]/'shell/wxbeta_nl/harmonie43.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

class HourlyFrames(unittest.TestCase):
 def test_every_hour_through_repeated_wintertime_hour(self):
  run = dt.datetime(2026,10,24,22,tzinfo=dt.timezone.utc)
  frames = h.hourly_frames(['2026-10-25T01:00','2026-10-25T02:00','2026-10-25T02:00','2026-10-25T03:00'],run)
  self.assertEqual([f['lead'] for f in frames],[1,2,3,4])
  self.assertEqual(len({f['valid_utc'] for f in frames}),4)
 def test_first_hour_can_be_the_second_two_oclock(self):
  run = dt.datetime(2026,10,25,0,tzinfo=dt.timezone.utc)
  self.assertEqual([f['lead'] for f in h.hourly_frames(['2026-10-25T02:00','2026-10-25T03:00'],run)],[1,2])
 def test_springtime_skips_a_clock_hour_but_not_a_forecast_hour(self):
  run = dt.datetime(2027,3,28,0,tzinfo=dt.timezone.utc)
  self.assertEqual([f['lead'] for f in h.hourly_frames(['2027-03-28T01:00','2027-03-28T03:00','2027-03-28T04:00'],run)],[0,1,2])
 def test_missing_and_nonexistent_hours_are_rejected(self):
  run = dt.datetime(2026,10,21,9,tzinfo=dt.timezone.utc)
  with self.assertRaises(ValueError):h.hourly_frames(['2026-10-21T12:00','2026-10-21T14:00'],run)
  run = dt.datetime(2027,3,28,0,tzinfo=dt.timezone.utc)
  with self.assertRaises(ValueError):h.hourly_frames(['2027-03-28T02:00','2027-03-28T03:00'],run)

if __name__ == '__main__':unittest.main()
