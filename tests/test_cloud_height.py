import importlib.util
from pathlib import Path
import struct
import unittest
import numpy as np


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parents[1] / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


icon = load('icon_cloud_height')
ecmwf = load('ecmwf_cloud_height')


class CloudHeightTests(unittest.TestCase):
    def test_ceiling_above_ground_preserves_missing_and_below_sea_level(self):
        actual = icon.above_ground(np.array([200, 20, -10, np.nan, 500]), np.array([100, 30, -40, 10, np.nan]))
        np.testing.assert_allclose(actual, [100, 0, 30, np.nan, np.nan], equal_nan=True)

    def test_nearest_source_grid_does_not_extrapolate(self):
        grid = dict(n_lat=2, n_lon=2, lat_min=0, lat_max=2, lon_min=0, lon_max=2)
        idx, covered = icon.nearest_indices(np.array([0, 0, 1, 1]), np.array([0, 1, 0, 1]), grid)
        self.assertEqual(covered.tolist(), [True, False, False, False])

    def test_packed_feet_decode_to_metres_and_no_diagnosis(self):
        actual = ecmwf.decode_height(np.array([-128, -127, -126, -123]), 250, 31750, -128)
        np.testing.assert_allclose(actual, [9999, 0, 76.2, 304.8], rtol=1e-6)

    def test_hourly_interpolation_never_blends_no_base_into_a_high_cloud(self):
        data = np.array([[100, 9999, 9999, np.nan], [400, 9999, 500, 100]], dtype=np.float32)
        out = ecmwf.interpolate_times(data, np.array([0, 10800]), [-3600, 0, 3600, 7200, 10800, 14400])
        np.testing.assert_allclose(out[2], [200, 9999, np.nan, np.nan], equal_nan=True)
        np.testing.assert_allclose(out[3], [300, 9999, np.nan, np.nan], equal_nan=True)
        self.assertTrue(np.isnan(out[0]).all())
        self.assertTrue(np.isnan(out[-1]).all())
        np.testing.assert_array_equal(out[1], data[0])
        np.testing.assert_array_equal(out[-2], data[-1])

    def test_dap2_signed_short_wire_format_and_corruption(self):
        head = b'Dataset { Int16 CBH[time = 2]; } sample;\nData:\n'
        blob = head + struct.pack('>IIii', 2, 2, -128, -126)
        self.assertEqual(ecmwf.dap_arrays(blob)['CBH'].tolist(), [-128, -126])
        with self.assertRaises(ValueError):
            ecmwf.dap_arrays(head + struct.pack('>IIii', 2, 1, -128, -126))
        with self.assertRaises(ValueError):
            ecmwf.dap_arrays(blob + b'extra')


if __name__ == '__main__':
    unittest.main()
