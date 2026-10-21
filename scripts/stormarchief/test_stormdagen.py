import unittest,json
from pathlib import Path
from build_stormdagen import parse_text

class StormDays(unittest.TestCase):
    def test_missing_is_not_zero(self):
        rows=list(parse_text('# STN,YYYYMMDD,FHX,FXX\n260,19010101,,300\n260,19010102,0,300'))
        self.assertIsNone(rows[0][2]);self.assertEqual(rows[1][2],0)
    def test_fhx_not_gust(self):
        rows=list(parse_text('# STN,YYYYMMDD,FHX,FXX\n260,20000101,204,400\n260,20000102,205,400\n260,20000103,244,400\n260,20000104,245,400'))
        self.assertEqual([r[2]>=205 for r in rows],[False,True,True,True])
        self.assertEqual([r[2]>=245 for r in rows],[False,False,False,True])
    def test_published_totals_are_unique_utc_dates(self):
        data=json.loads((Path(__file__).resolve().parents[2]/'stormdagen_data.json').read_text())
        for y in data['years']:
            dates=[e['date'] for e in y['events']]
            self.assertEqual(len(dates),len(set(dates)))
            self.assertLessEqual(y['observed_days'],y['expected_days'])
            if not y['observed_days']:
                self.assertIsNone(y['storm']);self.assertIsNone(y['severe'])
            else:
                self.assertEqual(y['storm'],len(dates))
                self.assertEqual(y['severe'],sum(max(v for st,v in e['measurements'])>=245 for e in y['events']))
    def test_early_missing_and_recent_source_regression(self):
        data=json.loads((Path(__file__).resolve().parents[2]/'stormdagen_data.json').read_text());years={y['year']:y for y in data['years']}
        self.assertEqual(len(data['stations']),44)
        excluded={209,308,311,315,316,285,312,313}
        self.assertTrue(excluded.isdisjoint(s['station'] for s in data['stations']))
        for y in data['years']:
            self.assertTrue(excluded.isdisjoint(map(int,y['stations'])))
            for e in y['events']:
                self.assertTrue(excluded.isdisjoint(m[0] for m in e['measurements']))
                self.assertTrue(excluded.isdisjoint(m[0] for m in e['observations']))
        for y in (1901,1902,1903):self.assertIsNone(years[y]['storm'])
        self.assertEqual(years[2025]['storm'],6)
        self.assertEqual([e['date'] for e in years[2025]['events']],['2025-01-01','2025-01-06','2025-09-15','2025-10-04','2025-10-23','2025-10-24'])
        self.assertEqual(years[2024]['expected_days'],366)
if __name__=='__main__':unittest.main()
