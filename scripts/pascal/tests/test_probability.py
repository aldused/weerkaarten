import sys
import unittest
from datetime import datetime, date, timedelta, timezone
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from probability import event_probability, cumulative_windows, hourly_windows, complete_day_indices, blend, LOCAL_TZ
from build_hybrid import contributions, fresh_source, build


class ProbabilityTests(unittest.TestCase):
    def test_member_union_precedes_average(self):
        a = np.zeros((4, 2, 2))
        a[0, 0, 0] = 30
        a[1, 1, 1] = 30
        self.assertEqual(event_probability(a, 25), 50)
        self.assertEqual(max(event_probability(a[:,:,i:i+1], 25) for i in range(2)), 25)
        self.assertEqual(event_probability(a, 30), 50)
        self.assertEqual(event_probability(a, 31), 0)

    def test_missing_is_unknown_including_an_empty_area(self):
        self.assertIsNone(event_probability(np.empty((6, 24, 0)), 20))
        a = np.zeros((6, 24, 1)); a[0, 0, 0] = np.nan
        self.assertIsNone(event_probability(a, 20))
        self.assertIsNone(event_probability([[np.inf]], 20))

    def test_six_member_precision_and_threshold_nesting(self):
        self.assertAlmostEqual(event_probability([[40],[30],[20],[10],[0],[0]],35),100/6)
        self.assertEqual(event_probability([[100],[200],[500],[1000]],200,True),50)

    def test_exact_cumulative_24h_with_known_zero(self):
        hours=list(range(3,49,3)); a=np.array([[h for h in hours]])
        self.assertIsNone(cumulative_windows(a,hours,[0]))
        self.assertEqual(cumulative_windows(a,hours,[7]).item(),24)
        self.assertEqual(cumulative_windows(a,hours,[8]).item(),24)
        self.assertIsNone(cumulative_windows(a,hours,[6,7]))
        a[0,8] = -1
        self.assertIsNone(cumulative_windows(a,hours,[8]))

    def test_missing_start_of_cumulative_window(self):
        self.assertIsNone(cumulative_windows([[1,27]],[1,27],[1]))

    def test_hourly_24h_never_shortened_or_filled(self):
        a=np.ones((3,48))
        self.assertIsNone(hourly_windows(a,[22]))
        np.testing.assert_equal(hourly_windows(a,[23,24]),np.full((3,2),24))
        a[2,0]=np.nan
        self.assertIsNone(hourly_windows(a,[23]))

    def test_dst_days_have_correct_number_of_hours(self):
        for day,n in [(date(2026,3,29),23),(date(2026,10,25),25),(date(2026,9,12),24)]:
            start=datetime.combine(day,datetime.min.time(),LOCAL_TZ).astimezone(timezone.utc)
            times=[start+timedelta(hours=i) for i in range(n)]
            self.assertEqual(len(complete_day_indices(times,day)),n)
            self.assertEqual(complete_day_indices(times[1:],day),[])
            self.assertEqual(complete_day_indices(times[:-1],day),[])
            self.assertEqual(complete_day_indices(times[:5]+times[6:],day),[])

    def test_model_weights_not_confused_with_members(self):
        self.assertEqual(blend([(0,50),(100,20),(100,6)]),200/3)
        self.assertAlmostEqual(blend([(0,50),(100,20),(100,6)],'member'),2600/76)
        self.assertEqual(blend([(None,50),(100,6)]),100)
        self.assertIsNone(blend([(10,0),(float('nan'),20)]))


class MergeTests(unittest.TestCase):
    def source(self, p, n=50, day='2026-09-12'):
        return {'method_version':3,'fetched_at':'2026-09-12T03:00:00Z', 'days':[day], 'n_members':n,
                'nederland':{'gust60':[p], 'vis200':[p]}}

    def test_no_duplicate_ifs_delivery_routes_and_date_alignment(self):
        native=self.source(80,day='2026-09-13')
        om={'days':['2026-09-12','2026-09-13'],'models':{'ecmwf_ifs025':{'n_members':51}},
            'nederland_per_model':{'ecmwf_ifs025':{'gust60':[10,20]}}}
        a=contributions({'grib':native,'om':om},'Nederland','gust60','2026-09-12')
        self.assertEqual(a['ifs']['p'],10)
        a=contributions({'grib':native,'om':om},'Nederland','gust60','2026-09-13')
        self.assertEqual(list(a),['ifs']);self.assertEqual(a['ifs']['p'],80)

    def test_fog_mos_excluded_from_visibility_mix(self):
        om=self.source(100)
        om.update(models={'ecmwf_ifs025':{'n_members':51}},nederland_per_model={'ecmwf_ifs025':{'vis200':[100]}})
        native=self.source(0,n=20)
        days,views,details,meta=build({'om':om,'dwd':native},datetime(2026,9,12,4,tzinfo=timezone.utc))
        self.assertEqual(views['mix']['Nederland']['vis200'],[0])
        self.assertEqual(views['fog']['Nederland']['vis200'],[100])
        self.assertIsNone(views['ifs']['Nederland']['vis200'][0])

    def test_stale_or_legacy_data_cannot_be_relabelled_fresh(self):
        now=datetime(2026,9,12,4,tzinfo=timezone.utc)
        source=self.source(0)
        self.assertTrue(fresh_source(source,now))
        self.assertFalse(fresh_source({**source,'method_version':1},now))
        self.assertFalse(fresh_source({**source,'fetched_at':'2026-09-10T03:00:00Z'},now))
        self.assertFalse(fresh_source({**source,'fetched_at':'2026-09-13T03:00:00Z'},now))
        self.assertFalse(fresh_source({**source,'run':'2026090900Z'},now))

if __name__=='__main__': unittest.main()
