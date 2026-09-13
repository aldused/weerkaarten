"""Calendar boundaries and actual archive integrity; no network needed."""
import importlib.util
import json
from datetime import date
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('feestdagen', ROOT / 'feestdagen_ophalen.py')
fd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fd)

class FeestdagenTest(unittest.TestCase):
    def test_third_tuesday_full_gregorian_cycle(self):
        for year in range(1901, 2401):
            day = date.fromisoformat(fd.nde_weekdag(year, 9, 1, 3))
            self.assertEqual(day.weekday(), 1)
            self.assertEqual(day.month, 9)
            self.assertIn(day.day, range(15, 22))
        for year, expected in [(2024, '2024-09-17'), (2025, '2025-09-16'),
                               (2026, '2026-09-15'), (2027, '2027-09-21')]:
            self.assertEqual(fd.nde_weekdag(year, 9, 1, 3), expected)

    def test_calendar_continues_after_2026(self):
        old = {name: dict(years) for name, years in fd.FEESTDAGEN_DATUMS.items()}
        fd.kalender_tot(2032)
        for name, years in old.items():
            for year, value in years.items():
                self.assertEqual(fd.FEESTDAGEN_DATUMS[name][year], value)
        self.assertEqual(fd.FEESTDAGEN_DATUMS['Prinsjesdag']['2027'], '2027-09-21')
        self.assertEqual(fd.FEESTDAGEN_DATUMS['1e Paasdag']['2027'], '2027-03-28')
        self.assertEqual(fd.FEESTDAGEN_DATUMS['2e Paasdag']['2027'], '2027-03-29')
        self.assertEqual(fd.FEESTDAGEN_DATUMS['Koningsdag']['2031'], '2031-04-26')

    def test_knmi_missing_trace_and_wind(self):
        rows = fd.parse_etmgeg('# STN,YYYYMMDD,TX,TN,TG,RH,SQ,FG,FXX\n260,20250916,168,,147,-1,45,50,150')
        self.assertEqual(rows['20250916']['FX'], 150)
        self.assertEqual(rows['20250916']['FG'], 50)
        self.assertIsNone(rows['20250916']['TN'])
        self.assertEqual(rows['20250916']['RH'], -1)

    def test_published_archive_integrity(self):
        raw = (ROOT/'feestdagen_data.json').read_text()
        self.assertEqual((ROOT/'feestdagen_data.js').read_text(), 'const FEESTDAGEN_DATA = '+raw+';')
        data = json.loads(raw)
        self.assertIn('Prinsjesdag', data['kalender'])
        self.assertEqual(len(data['data']['260']['Prinsjesdag']), date.today().year - 1901 + (date.today().isoformat() > fd.nde_weekdag(date.today().year,9,1,3)))
        for station in data['data'].values():
            for holiday, rows in station.items():
                dates = [r['datum'] for r in rows]
                self.assertEqual(len(dates), len(set(dates)))
                for row in rows:
                    self.assertLess(row['datum'], date.today().isoformat())
                    if holiday == 'Prinsjesdag':
                        self.assertEqual(row['datum'], fd.nde_weekdag(row['jaar'],9,1,3))

if __name__ == '__main__':
    unittest.main()
