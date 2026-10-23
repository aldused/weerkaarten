"""Small numerical fixtures test algorithms only; never published as weather data."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np
spec = importlib.util.spec_from_file_location('storm', Path(__file__).parents[1] / 'beta-storm' / 'build.py')
storm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storm)

class StormTests(unittest.TestCase):
    def test_strict_threshold_and_missing_denominator(self):
        p,n = storm.probabilities([np.array([[25.,26.,np.nan]]),np.array([[25.01,24.,30.]])])
        np.testing.assert_equal(p, [[50,50,100]])
        np.testing.assert_equal(n, [[2,2,1]])

    def test_all_missing_is_unknown(self):
        p,n=storm.probabilities([np.array([[np.nan]])])
        self.assertTrue(np.isnan(p[0,0]))
        self.assertEqual(n[0,0],0)
        self.assertIsNone(storm.probabilities([]))

    def test_core_closed_low_not_trough(self):
        lat=np.arange(35,65.01,.25);lon=np.arange(-30,10.01,.25)
        yy,xx=np.meshgrid(lat,lon,indexing='ij')
        p=980+((yy-50)**2+(xx+10)**2)*.3
        c=storm.cores(p,lat,lon)
        self.assertEqual(len(c),1)
        self.assertAlmostEqual(c[0][0],50,delta=.25)
        self.assertAlmostEqual(c[0][1],-10,delta=.25)
        trough=990+(xx+10)**2*.3
        self.assertEqual(storm.cores(trough,lat,lon),[])

    def test_tracking_rejects_jump(self):
        self.assertIsNone(storm.choose_core([[55,20,970]],[50,-20],3))
        self.assertEqual(storm.choose_core([[50,-18,980],[49,-22,970]],[50,-20],3),[50,-18,980])

    def test_no_core_no_position(self):
        self.assertIsNone(storm.choose_core([],None,3))

    def test_run_paths_separate_control(self):
        from datetime import datetime
        r=datetime(2026,10,22,12)
        self.assertTrue(storm.base_url(r,3).endswith('enfo/20261022120000-3h-enfo-ef'))
        self.assertTrue(storm.base_url(r,3,True).endswith('oper/20261022120000-3h-oper-fc'))

if __name__=='__main__':unittest.main()
