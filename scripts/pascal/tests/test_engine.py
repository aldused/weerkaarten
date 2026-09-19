import unittest,sys,json
from pathlib import Path
from datetime import datetime,date,timedelta,timezone
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from engine import evaluate, rolling, convection, visibility_m, day_indices
from probability import LOCAL_TZ,METHOD_VERSION,blend
from native import calculate
from build_hybrid import build,contributions
from config import CRITERIA

class EngineTests(unittest.TestCase):
    def setUp(self):
        self.day=date(2026,9,20)
        self.start=datetime(2026,9,19,22,tzinfo=timezone.utc)
        self.times=[self.start+timedelta(hours=h) for h in range(24)]
        self.a=np.zeros((4,24,3))
    def test_zero_and_nonzero_and_or(self):
        r=evaluate(self.a,self.times,self.day,10);self.assertEqual(r['p'],0);self.assertEqual(r['status'],'complete')
        self.a[0,0,0]=10;self.a[1,23,2]=20
        r=evaluate(self.a,self.times,self.day,10);self.assertEqual(r['hits'],2);self.assertEqual(r['p'],50)
    def test_missing_member_never_becomes_miss(self):
        self.a[0]=np.nan;self.a[1,0,0]=20
        r=evaluate(self.a,self.times,self.day,10);self.assertEqual(r['members'],3);self.assertAlmostEqual(r['p'],100/3);self.assertEqual(r['status'],'partial')
    def test_incomplete_member_exclusion_independent_of_hit(self):
        self.a[0,0,0]=np.nan;self.a[0,1,0]=20
        r=evaluate(self.a,self.times,self.day,10);self.assertEqual(r['members'],3);self.assertEqual(r['p'],0)
    def test_missing_points(self):
        self.a[:,:,2]=np.nan
        r=evaluate(self.a,self.times,self.day,10);self.assertEqual(r['points'],2);self.assertEqual(r['status'],'partial');self.assertEqual(r['p'],0)
    def test_no_data_or_insufficient_members(self):
        for a in [np.full_like(self.a,np.nan), self.a[:1],self.a[:,:,:0]]:
            self.assertIsNone(evaluate(a,self.times,self.day,10)['p'])
    def test_outside_horizon(self):
        self.assertIn('buiten',evaluate(self.a,self.times,self.day+timedelta(days=3),10)['reason'])
    def test_partial_day_and_gap(self):
        for indices in [list(range(12)),list(range(5))+list(range(6,24))]:
            r=evaluate(self.a[:,indices],[self.times[i] for i in indices],self.day,10)
            self.assertEqual(r['status'],'partial');self.assertEqual(r['p'],0)
    def test_dst_midnight(self):
        for d,n in [(date(2026,3,29),23),(date(2026,10,25),25),(date(2026,1,4),24)]:
            start=datetime.combine(d,datetime.min.time(),LOCAL_TZ).astimezone(timezone.utc)
            ts=[start+timedelta(hours=h) for h in range(-1,n+1)]
            self.assertEqual(day_indices(ts,d),list(range(1,n+1)))
            self.assertEqual(evaluate(np.zeros((3,n+2,1)),ts,d,1)['status'],'complete')
    def test_mixed_cadence(self):
        for step in [1,3,6]:
            ts=[datetime(2026,9,20,tzinfo=timezone.utc)+timedelta(hours=h) for h in range(0,22,step)]
            self.assertEqual(evaluate(np.zeros((3,len(ts),2)),ts,self.day,1,cadence=step)['status'],'complete' if step>1 else 'partial')
    def test_actual_24h_only(self):
        ts=[self.start+timedelta(hours=i) for i in range(48)]
        a=np.broadcast_to(np.arange(48)[None,:,None],(3,48,2)).astype(float)
        r=rolling(a,ts,24,True,self.start)
        self.assertTrue(np.isnan(r[:,:24]).all());np.testing.assert_equal(r[:,24:],24)
        a[0,30,0]=-1
        self.assertTrue(np.isnan(rolling(a,ts,24,True,self.start)[0,30,0]))
    def test_encoding_noise_vs_reset(self):
        ts=[self.start,self.start+timedelta(hours=24)]
        a=np.array([[[1],[.994]],[[1],[.5]]])
        r=rolling(a,ts,24,True,self.start,tolerance=.01)
        self.assertEqual(r[0,1,0],0);self.assertTrue(np.isnan(r[1,1,0]))
    def test_rain_hourly_gaps_and_missing(self):
        a=np.ones((3,24,1));a[0,0]=np.nan
        r=rolling(a,self.times,24)
        self.assertTrue(np.isnan(r[0,-1,0]));self.assertEqual(r[1,-1,0],24)
        ts=self.times.copy();ts[-1]+=timedelta(hours=1)
        self.assertTrue(np.isnan(rolling(a,ts,24)[:,-1]).all())
    def test_convection_same_point_member_and_window(self):
        cape=self.a.copy();rain=self.a.copy();cape[0,8,0]=600;rain[0,9,0]=2;rain[1,9,0]=2;rain[0,9,1]=2
        r=convection(cape,rain,self.times)
        self.assertEqual(r[0,9,0],600);self.assertEqual(r[1,9,0],0);self.assertEqual(r[0,9,1],0)
    def test_visibility_units_and_all_thresholds(self):
        for t in [50,200,500]:
            a=np.full((4,24,3),1000.);a[0,3,1]=t
            for values,unit in [(a,'m'),(a/1000,'km')]:self.assertEqual(evaluate(visibility_m(values,unit),self.times,self.day,t,True)['p'],25)
        with self.assertRaises(ValueError):visibility_m([1],'mile')
    def test_all_criteria_native(self):
        ts=[self.start-timedelta(hours=24)+timedelta(hours=i) for i in range(48)]
        shape=(4,48,2)
        fields={k:np.zeros(shape) for k in ['gust','wind','t2m','tp','vis','cape']}
        fields['vis'][:]=1000
        fields['tp'][:]=np.arange(48)[None,:,None]*4
        fields['gust'][0]=120;fields['wind'][0]=80;fields['t2m'][0]=45;fields['cape'][0]=2000;fields['vis'][0]=40
        out=calculate(fields,ts,{'Nederland':[0,1],'Regio':[1]},ts[0],[0,1,2,3])
        for c in CRITERIA:
            with self.subTest(c=c['id']):
                self.assertIsNotNone(out['nederland'][c['id']][-1]);self.assertGreater(out['nederland'][c['id']][-1],0)
                self.assertEqual(out['nederland'][c['id']],out['provinces']['Regio'][c['id']])
    def test_duplicate_time_and_naive_rejected(self):
        with self.assertRaises(ValueError):day_indices([self.start,self.start],self.day)
        with self.assertRaises(ValueError):day_indices([datetime(2026,9,20)],self.day)

class ModelTests(unittest.TestCase):
    def test_one_or_multiple_missing_models(self):
        for cs,expected in [([(0,50),(None,20),(100,6)],50), ([(None,50),(None,20),(100,6)],100), ([(None,50)],None)]:self.assertEqual(blend(cs),expected)
    def test_valid_denominator_and_weights(self):
        source={'days':['2026-09-20'],'n_members':6,'nederland':{'gust60':[100/3]},'diagnostics':{'Nederland':{'gust60':[{'members':3,'p':100/3,'status':'partial'}]}}}
        r=contributions({'harm':source},'Nederland','gust60','2026-09-20')['harm'];self.assertEqual(r['members'],3)
        self.assertEqual(blend([(0,3),(100,3)],'member'),50)
    def test_icon_cape_is_not_silently_excluded(self):
        src={'days':['2026-09-20'],'models':{'icon_d2':{'n_members':20}},'nederland_per_model':{'icon_d2':{'thunder':[10]}}}
        self.assertEqual(contributions({'om':src},'Nederland','thunder','2026-09-20')['icon']['p'],10)

if __name__=='__main__':unittest.main()
