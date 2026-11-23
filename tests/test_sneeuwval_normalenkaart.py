"""Snowfall days, hourly gaps, duplicates and real thirty-year source periods."""
from datetime import date, timedelta
import gzip
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'winter-tools'))
spec = importlib.util.spec_from_file_location('snowfall_map', ROOT / 'winter-tools/bouw_sneeuwval_normalenkaart.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnowfallNormalsTest(unittest.TestCase):
    def test_duplicate_and_conflicting_hours_never_double_count(self):
        masks = [0, 0, 0]
        module.add_hour(masks, 1, True)
        module.add_hour(masks, 1, True)
        self.assertEqual(masks[:2], [1, 1])
        module.add_hour(masks, 1, False)
        module.add_hour(masks, 1, True)
        self.assertEqual(masks, [0, 0, 1])
        module.add_hour(masks, 2, None)
        self.assertEqual(masks, [0, 0, 1])

    def test_snow_indicator_covers_the_hour_from_1971(self):
        self.assertFalse(module.snow_indicator('19610101', '17', '', '1'))
        self.assertTrue(module.snow_indicator('19610101', '85', '', '0'))
        self.assertTrue(module.snow_indicator('19710101', '60', '1', '1'))
        self.assertFalse(module.snow_indicator('19710101', '60', '1', '0'))
        self.assertTrue(module.snow_indicator('20100101', '', '7', '1'))
        self.assertIsNone(module.snow_indicator('20100101', '', '7', ''))

    def test_year_quality_tracks_days_and_hour_gaps(self):
        days = {(date(2020, 1, 1) + timedelta(days=i)).strftime('%Y%m%d'): [module.FULL_DAY, 0, 0] for i in range(366)}
        days['20200101'][1] = 3  # Two snowy hours still mean one snow day.
        self.assertEqual(module.summarize_year(days, 2020), [2020, 1, 366, 8784, 1])
        days['20200102'][0] &= ~1
        self.assertEqual(module.summarize_year(days, 2020)[1], 1)
        days['20200103'][0] = 0
        self.assertIsNone(module.summarize_year(days, 2020)[1])

    def test_rows_beyond_month_boundary_are_excluded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for month in range(1, 13):
                text = '# 260 5.180 52.100 1.90 De Bilt\n# STN,YYYYMMDD,HH,WW,IX,S\n'
                if month == 1:
                    text += '260,20200101,24,85,7,1\n260,20200201,1,85,7,1\n260,20210101,1,85,7,1\n'
                    text += '280,20200101,24,85,7,1\n280,20200101,23,85,7,1\n'
                (root / f'2020{month:02}.txt.gz').write_bytes(gzip.compress(text.encode()))
            monthly = {}
            result = module.read_year(root, 2020, {}, {}, monthly)
            self.assertEqual(result[260][2:], [1, 1, 1])
            self.assertEqual(monthly[2020][260][0], [1, 1, 1])
            self.assertEqual(monthly[2020][260][1], [0, 0, 0])
            self.assertEqual(monthly[2020][module.NATIONAL][0], [1, 1, 2])

    def test_published_data_uses_both_real_thirty_year_periods(self):
        for start, end, expected in [(1961, 1990, 29.7333), (1991, 2020, 19.3)]:
            data = json.loads((ROOT / f'winter-data/sneeuwval-normalen-{start}-{end}.json').read_text())
            self.assertEqual(data['period'], [start, end])
            self.assertEqual(len(data['inputSHA256']), 360)
            self.assertEqual(data['minimumYears'], 24)
            station = next(s for s in data['stations'] if s['id'] == 260)
            self.assertEqual(station['mean'], expected)
            self.assertEqual([r[0] for r in station['annual']], list(range(start, end + 1)))
            self.assertEqual(station['validDays'], data['expectedDays'])
            self.assertTrue(all(len(months) == 12 for year, months in station['monthlyAnnual']))
            self.assertTrue(all(s['years'] >= 24 for s in data['stations'] if s['mean'] is not None))


if __name__ == '__main__':
    unittest.main()
