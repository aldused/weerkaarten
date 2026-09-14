import datetime as dt
import pathlib
import sys
import unittest
from zoneinfo import ZoneInfo
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from mosmix_trend_rain import rain_by_day

NL = ZoneInfo('Europe/Amsterdam')
class RainIntervals(unittest.TestCase):
    def test_midnight_value_belongs_to_preceding_hour(self):
        times = [dt.datetime(2026, 9, 14, 22), dt.datetime(2026, 9, 14, 23)]
        self.assertEqual(rain_by_day(times, [2, 0], NL), {dt.date(2026,9,14):2, dt.date(2026,9,15):0})

    def test_unknown_is_not_dry(self):
        times = [dt.datetime(2026, 9, 14, h) for h in [10, 11]]
        for values in [[0, None], [0], [float('nan'), 1], [-1, 0], [True, 0]]:
            self.assertEqual(rain_by_day(times, values, NL), {dt.date(2026,9,14):None})
        self.assertEqual(rain_by_day(times, [0, 0], NL), {dt.date(2026,9,14):0})

    def test_missing_interval_keeps_day_unknown(self):
        times = [dt.datetime(2026, 9, 14, h) for h in [10, 12]]
        self.assertIsNone(rain_by_day(times, [1, 2], NL)[dt.date(2026,9,14)])

    def test_clock_changes_preserve_real_hour_count(self):
        for day, hours in [(dt.date(2026,3,29),23), (dt.date(2026,10,25),25)]:
            start=dt.datetime.combine(day, dt.time(), NL).astimezone(dt.timezone.utc)
            times=[start+dt.timedelta(hours=h) for h in range(1,hours+1)]
            self.assertEqual(rain_by_day(times, [1]*hours, NL), {day:hours})

if __name__ == '__main__': unittest.main()
