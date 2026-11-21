import importlib.util
from pathlib import Path
from datetime import date
import json
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('eerste_vorst', ROOT / 'winter-tools/bouw_eerste_vorst.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FirstFrost(unittest.TestCase):
    def test_classes_boundaries_and_nulls(self):
        self.assertEqual([module.classify(t) for t in [0, -1, -50, -51, -100, -101, -150, -151]], [None, 0, 0, 1, 1, 2, 2, 3])

    def test_august_july_historical_ties_gaps_and_duplicate_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'dagdata_260.json').write_text(json.dumps({'kolommen':['YYYYMMDD','TN'], 'data':[
                ['19430731', -60], ['19430801', -10], ['19430927', -60], ['19440201', -110], ['19440731', -160], ['19440801', -60], ['20261121', -250], ['20261122', -250], ['19440202', None], ['19440203', -9999]
            ]}))
            registry = {'sources':['260','20'], 'stations':{'De Bilt':{'source':'260'}, 'Winterswijk':{'source':'20'}}}
            historic = {'units':'physical', 'stations':{'20':{'dailySeries':True}}, 'days':{'19430927':{'20':{'TN':-5.6}}}}
            curated = {'waarnemingen':[
                {'parameter':'TN','waarde':-5.4,'datum':'1944-05-09','station':'Castricum'},
                {'parameter':'TN','waarde':-7,'datum':'1943-09-27','station':'De Bilt'},
                {'parameter':'TN','waarde':-8,'datum':'1943-08-01','station':'Historische meetplaats'},
            ]}
            result = module.build(root, registry, historic, curated, date(2026,11,21))
            rows = {r[0]:r for r in result['seasons']['1944']['vorst']}
            self.assertEqual(result['seasons']['1944']['length'],366)
            self.assertEqual(rows['260'][1],4)
            self.assertEqual(rows['260'][5],-6)
            castricum=rows['hist:Castricum']
            self.assertEqual(castricum[1],1)
            self.assertEqual(castricum[4],(date(1944,5,9)-date(1943,8,1)).days)
            self.assertEqual(castricum[5],-5.4)
            self.assertEqual(rows['260'][2:4],[0,-1])
            self.assertEqual(rows['260'][4:6],[57,-6])  # authoritative daily value survives curated overlap
            self.assertEqual(rows['20'][4:6],[57,-5.6])
            self.assertEqual(rows['hist:Historische meetplaats'][4:6],[0,-8])  # partial stations must count
            self.assertEqual(rows['hist:Castricum'][4:6],[(date(1944,5,9)-date(1943,8,1)).days,-5.4])
            self.assertEqual(result['through'],'1944-08-01')
            self.assertNotIn('2027',result['seasons'])
            self.assertTrue(result['stations']['hist:Castricum']['historical'])

    def test_published_national_first_dates(self):
        result = json.loads((ROOT / 'winter-data/eerste-vorst.json').read_text())
        for year, index, expected in [(1904,4,'1903-12-03'),(2020,4,'2020-01-21'),(2026,4,'2025-11-21')]:
            first = min(row[index] for row in result['seasons'][str(year)]['vorst'] if row[index] is not None)
            from datetime import timedelta
            self.assertEqual((date(year-1,8,1)+timedelta(days=first)).isoformat(),expected)


if __name__ == '__main__':
    unittest.main()
