"""Regressions for measured snow-cover normals, missing days and map positions."""
import calendar
from datetime import date, timedelta
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('snow_normals', ROOT / 'winter-tools/bouw_sneeuwdek_normalenkaart.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnowNormalMapTest(unittest.TestCase):
    def test_missing_and_conflicting_days_never_become_zero(self):
        days = {}
        for i in range(366):
            day = date(2020, 1, 1) + timedelta(days=i)
            days[day.isoformat()] = [[1, 0], [2, 0], [3, 0], [4, 0]]
        days['2020-01-01'] = [[1, 997], [1, 997], [2, 0], [3, None], [4, 0]]
        days['2020-01-02'] = [[1, 999], [2, 0], [3, 0], [4, 0], [4, 1]]
        result = module.year_values({'days': days}, 2020)
        self.assertEqual(result[1], [2, 366])
        self.assertEqual(result[2], [0, 366])
        self.assertEqual(result[3], [None, 365])
        self.assertEqual(result[4], [None, 365])

    def test_thirty_complete_calendar_years_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for year in range(1991, 2021):
                days = {}
                for i in range(366 if calendar.isleap(year) else 365):
                    day = date(year, 1, 1) + timedelta(days=i)
                    days[day.isoformat()] = [[1, int(i == 0)], [2, None if year == 2000 and i == 59 else 0], [3, 0]]
                data = {'stations': {'1': 'A', '2': 'B', '3': 'C'}, 'days': days}
                (root / f'{year}.json.gz').write_bytes(gzip.compress(json.dumps(data).encode()))
            stations = root / 'stations.csv'
            stations.write_text('Naam,statnr,lon,lat,has\nA,1_N,5.1,52.1,0\nB,2_N,5.2,52.2,0\nC,3_N,5.3,52.3,0\n')
            geometry = root / 'map.html'
            geometry.write_text('/*GEO-START*/const GEO={"w":851,"h":1000};/*GEO-END*/')
            result = module.build(root, stations, geometry)
            a, b, c = result['stations']
            self.assertEqual((a['mean'], a['years'], a['validDays']), (1, 30, 10958))
            self.assertEqual((b['mean'], b['years']), (None, 29))
            self.assertEqual(c['mean'], 0)

    def test_ambiguous_coordinates_are_not_guessed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'stations.csv'
            path.write_text('Naam,statnr,lon,lat,has\nA,1_N,5.1,52.1,0\nA,1_N,5.1,52.1,0\nB,2_N,5.2,52.2,0\nB oud,2_N,5.3,52.3,0\n')
            positions = module.positions(path)
            self.assertEqual(positions[1]['lat'], 52.1)
            self.assertIsNone(positions[2]['lat'])

    def test_published_normals_match_measured_de_bilt_days(self):
        data = json.loads((ROOT / 'winter-data/sneeuwdek-normalen-1991-2020.json').read_text())
        normal = next(s for s in data['stations'] if s['id'] == 550)
        measured = 0
        for year in range(1991, 2021):
            raw = json.loads(gzip.decompress((ROOT / f'sneeuwdek-data/{year}.json.gz').read_bytes()))
            measured += sum(any(station == 550 and code is not None and code > 0 for station, code in readings)
                            for readings in raw['days'].values())
        self.assertEqual(normal['mean'], round(measured / 30, 4))
        self.assertEqual(normal['validDays'], 10958)
        self.assertGreaterEqual(sum(s['mean'] is not None for s in data['stations']), 250)
        self.assertTrue(all(s['lat'] is not None for s in data['stations'] if s['mean'] is not None))


if __name__ == '__main__':
    unittest.main()
