import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import h5py
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('radar_validity', ROOT / 'scripts/haal_radar.py')
radar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(radar)


class RadarValidityTests(unittest.TestCase):
    def test_missing_and_outside_pixels_are_distinct_from_dry(self):
        raw = np.array([[0, 100, 65534, 65535]], dtype=np.uint16)
        lut = (np.array([[0, 0, 0, 0]]), np.array([[0, 1, 2, 3]]))
        values = radar._img_to_mmh(raw, lut)[0]
        self.assertEqual(int(values[0]), 0)
        self.assertTrue(0 < values[1] < 255)
        self.assertEqual(list(values[2:]), [255, 255])

    def test_incomplete_forecast_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'partial.h5'
            with h5py.File(path, 'w') as h:
                g = h.create_group('image2')
                g.create_dataset('image_data', data=np.array([[0]], dtype=np.uint16))
                g.attrs['image_datetime_valid'] = np.bytes_('02-OCT-2026;17:05:00.000')
            with patch.object(radar, '_lookup_voor', return_value=(np.array([[0]]), np.array([[0]]))):
                with self.assertRaisesRegex(ValueError, '1/24'):
                    radar.parse_h5_forecast(path, 24)


if __name__ == '__main__':
    unittest.main()
