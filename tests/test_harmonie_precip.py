import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from harmonie_precip import (grib1_precip_kind, rain_rate_mm_h,
                             rain_rate_to_dbz, hourly_from_accumulation)


class PrecipitationTests(unittest.TestCase):
    def test_parameter_identity(self):
        self.assertEqual(grib1_precip_kind(181, 105, 0, 0), 'regenrate')
        self.assertEqual(grib1_precip_kind(61, 105, 0, 4), 'cum')
        for args in [(181,105,0,4), (181,200,0,0), (181,109,1,0),
                     (201,200,0,0), (61,105,0,0)]:
            self.assertIsNone(grib1_precip_kind(*args))

    def test_flux_and_zr_units(self):
        rate = rain_rate_mm_h(np.array([0, 1/3600, 10/3600]))
        np.testing.assert_allclose(rate, [0, 1, 10])
        np.testing.assert_allclose(rain_rate_to_dbz(rate), [0, 23.01029996, 39.01029996])
        self.assertEqual(rain_rate_to_dbz([0.049])[0], 0)

    def test_difference_before_encoding(self):
        accumulated = [np.array([[0.,2.]]), np.array([[1.25,3.5]]), np.array([[2.,4.]])]
        hourly = hourly_from_accumulation(accumulated)
        np.testing.assert_allclose(hourly, [[[1.25,1.5]],[[.75,.5]]])
        np.testing.assert_allclose(np.sum(hourly, axis=0), accumulated[-1]-accumulated[0])

    def test_missing_or_reset_is_not_dry(self):
        for source in [[None, np.zeros((1,1))], [np.ones((1,1)),np.zeros((1,1))],
                       [np.zeros((1,1)),np.full((1,1),np.nan)]]:
            with self.assertRaises(ValueError): hourly_from_accumulation(source)
        with self.assertRaises(ValueError): rain_rate_mm_h([np.nan])
        with self.assertRaises(ValueError): rain_rate_to_dbz([-1])

    def test_grib_roundoff(self):
        np.testing.assert_equal(hourly_from_accumulation([np.array([1.]), np.array([.999])]), [[0.]])

    def test_native_render_preserves_isolated_peak(self):
        from benelux_neerslag_anim import crop_and_upsample
        lat=np.linspace(50,54,201); lon=np.linspace(2,8,201)
        field=np.zeros((201,201)); field[100,100]=30
        la,lo,out=crop_and_upsample(lat,lon,field,[2.2,7.8,50.5,53.5],None)
        self.assertEqual(out.max(),30)
        self.assertEqual(np.count_nonzero(out),1)
        np.testing.assert_array_equal(out,field[np.ix_(np.isin(lat,la),np.isin(lon,lo))])


if __name__ == '__main__': unittest.main()
