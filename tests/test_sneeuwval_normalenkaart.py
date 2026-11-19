"""Official snowfall normals: preserve missing annual values and actual period."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('snowfall_map', ROOT / 'winter-tools/bouw_sneeuwval_normalenkaart.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnowfallNormalsTest(unittest.TestCase):
    def test_absent_and_not_occurred_have_distinct_meanings(self):
        self.assertIsNone(module.value('-'))
        self.assertEqual(module.value('.'), 0)
        self.assertEqual(module.value('18.9'), 18.9)
        with self.assertRaises(ValueError):
            module.value('-1')

    def test_official_source_and_measured_period_are_preserved(self):
        data = module.build(ROOT / 'winter-tools/bronnen/KNMI-sneeuwvalnormalen-2003-2020.csv',
                            ROOT / 'winter-tools/bronnen/KNMI-uurstations-sneeuwval.csv', ROOT / 'beta_neerslagstations.html')
        published = json.loads((ROOT / 'winter-data/sneeuwval-normalen-2003-2020.json').read_text())
        self.assertEqual(data, published)
        self.assertEqual(data['period'], [2003, 2020])
        self.assertEqual(data['publicationPeriod'], [1991, 2020])
        stations = {s['id']: s for s in data['stations']}
        self.assertEqual(len(stations), 14)
        self.assertEqual(sum(s['mean'] is not None for s in stations.values()), 11)
        self.assertEqual(stations[260]['mean'], 18.9)
        # Source annual averages are not sums of rounded monthly averages.
        self.assertNotAlmostEqual(sum(stations[260]['monthly']), stations[260]['mean'], places=1)
        self.assertEqual(stations[279]['mean'], 23.7)
        self.assertEqual(stations[310]['mean'], 12.8)
        for sid in [215, 251, 280]:
            self.assertIsNone(stations[sid]['mean'])
        self.assertIsNone(stations[280]['monthly'][3])
        self.assertEqual(stations[280]['monthly'][6], 0)
        self.assertTrue(all(len(s['monthly']) == 12 for s in stations.values()))
        self.assertTrue(all(3 < s['lon'] < 7.5 and 50.5 < s['lat'] < 54 for s in stations.values()))


if __name__ == '__main__':
    unittest.main()
