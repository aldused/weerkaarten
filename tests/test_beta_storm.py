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

    def test_discovers_later_low_without_filling_earlier_positions(self):
        core_map={}
        for m in range(51):
            core_map[(0,m)]=[[50,-10,980]]
            core_map[(3,m)]=[[50,-8,982],[59,-30,960]]
            core_map[(6,m)]=[[50,-6,984],[59,-28,950]]
        systems=storm.track_systems(core_map,[0,3,6])
        self.assertEqual(len(systems),2)
        later=systems[1]
        self.assertEqual(later['start_hour'],3)
        self.assertEqual(later['minimum_hpa'],950)
        self.assertIsNone(later['tracks'][0]['points'][0])
        self.assertEqual(len(later['tracks']),51)

    def test_lost_core_does_not_resume(self):
        core_map={(0,0):[[50,-10,980]],(6,0):[[50,-8,975]]}
        systems=storm.track_systems(core_map,[0,3,6])
        self.assertEqual(systems[0]['tracks'][0]['points'],[[50,-10,980],None,None])
        self.assertEqual(systems[1]['start_hour'],6)

    def test_storm_name_requires_official_event_and_unique_core(self):
        registry={'verified_on':'2026-10-24','storms':[{'name':'Verified','source':'https://www.metoffice.gov.uk/test','from':'2026-10-24T00:00:00Z','until':'2026-10-25T00:00:00Z','box':[53,-25,66,5],'maximum_pressure_hpa':980}]}
        frames=[{'valid':'2026-10-24T12:00:00Z'}]
        def system(name,pressure):
            return {'id':name,'tracks':[{'member':0,'points':[[58,-10,pressure]]}]}
        systems=[system('a',950),system('b',975)]
        storm.assign_storm_names(systems,frames,registry)
        self.assertEqual(systems[0]['storm_name'],'Verified')
        self.assertNotIn('storm_name',systems[1])
        ambiguous=[system('a',950),system('b',952)]
        storm.assign_storm_names(ambiguous,frames,registry)
        self.assertTrue(all('storm_name' not in s for s in ambiguous))
        expired=[system('a',950)]
        storm.assign_storm_names(expired,[{'valid':'2026-10-27T12:00:00Z'}],registry)
        self.assertNotIn('storm_name',expired[0])

    def test_eight_day_steps_keep_native_timing(self):
        steps=storm.forecast_steps(192)
        self.assertEqual(len(steps),57)
        self.assertEqual(steps[-1],192)
        self.assertEqual(steps[48:51],[144,150,156])
        self.assertNotIn(147,steps)
        self.assertEqual(storm.forecast_steps(96),list(range(0,97,3)))

    def test_ranges_only_combine_adjacent_messages(self):
        groups=storm.group_ranges([(20,5,'c'),(0,10,'a'),(10,5,'b')])
        self.assertEqual(groups,[[(0,10,'a'),(10,5,'b')],[(20,5,'c')]])

    def test_run_paths_separate_control(self):
        from datetime import datetime
        r=datetime(2026,10,22,12)
        self.assertTrue(storm.base_url(r,3).endswith('enfo/20261022120000-3h-enfo-ef'))
        self.assertTrue(storm.base_url(r,3,True).endswith('oper/20261022120000-3h-oper-fc'))

if __name__=='__main__':unittest.main()
