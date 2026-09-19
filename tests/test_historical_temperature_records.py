"""python3 -m unittest discover -s tests -p test_historical_temperature_records.py"""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_nl_extreme', ROOT / 'scripts/build_nl_extreme.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class HistoricalTemperatures(unittest.TestCase):
    def test_export_matches_every_parsed_source_observation(self):
        expected = [(parameter, iso, station, temperature)
                    for parameter, parsed in [('TX', builder.parse_warm(builder.WARM_RAW)), ('TN', builder.parse_cold(builder.COLD_RAW))]
                    for _, _, iso, temperature, station in parsed]
        for data in [builder.build(), json.loads((ROOT / 'records_nl_extreme.json').read_text())]:
            actual = [(r['parameter'], r['datum'], r['station'], r['waarde']) for r in data['waarnemingen']]
            self.assertCountEqual(actual, expected)
            self.assertIn(('TX', '1921-10-10', 'Sittard', 30.1), actual)

    def test_observations_are_not_truncated_by_rankings(self):
        original = builder.WARM_RAW
        try:
            builder.WARM_RAW = '\n'.join(f'10 oktober 1921: Station{chr(65+i)} 30,1°C' for i in range(26))
            data = builder.build()
            self.assertEqual(len(data['dag']['10']['10']['tx_hoog']), 25)
            self.assertEqual(len([r for r in data['waarnemingen'] if r['parameter'] == 'TX']), 26)
        finally:
            builder.WARM_RAW = original

if __name__ == '__main__':
    unittest.main()
