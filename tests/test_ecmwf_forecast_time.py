import sys
import unittest
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from ecmwf_openmeteo_update import local_forecast_times

class ForecastTimeTest(unittest.TestCase):
    def test_repeated_winter_hour_has_distinct_offsets(self):
        result = local_forecast_times(["2026-10-25T00:00", "2026-10-25T01:00", "2026-10-25T02:00"])
        self.assertEqual(result, ["2026-10-25T02:00:00+02:00", "2026-10-25T02:00:00+01:00", "2026-10-25T03:00:00+01:00"])
        self.assertEqual((datetime.fromisoformat(result[2])-datetime.fromisoformat(result[1])).total_seconds(), 3600)
    def test_summer_and_explicit_utc(self):
        self.assertEqual(local_forecast_times(["2026-10-20T12:00Z"]), ["2026-10-20T14:00:00+02:00"])
