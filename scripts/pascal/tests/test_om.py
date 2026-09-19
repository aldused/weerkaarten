import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from process_om import process,normalise_field
import numpy as np

class OpenMeteoTests(unittest.TestCase):
    def test_unit_normalisation(self):
        self.assertEqual(normalise_field('wind_speed_10m',[10],'m/s')[0],36)
        self.assertAlmostEqual(normalise_field('temperature_2m',[300],'K')[0],26.85)
        self.assertEqual(normalise_field('precipitation',[.01],'m')[0],10)
        self.assertTrue(np.isnan(normalise_field('cape',[500],'undefined')[0]))

    def fixture(self):
        n=3
        hourly={'time':['2026-08-31T22:00'],'wind_speed_10m':[[40]]*n,'wind_gusts_10m':[[60]]*n,'temperature_2m':[[25]]*n,'relative_humidity_2m':[[95]]*n,'cloud_cover_low':[[0]]*n}
        point={'models':{'ecmwf_ifs025':{'hourly':hourly}}}
        return {'models':{'ecmwf_ifs025':{'n_members':n}},'data':{'Regio':[point]},'fetched_at':'2026-09-01T00:00:00Z','source':'fixture'}
    def test_absent_parameter_does_not_remove_others(self):
        out=process(self.fixture());r=out['provinces_per_model']['ecmwf_ifs025']['Regio']
        self.assertEqual(r['wind40'],[100]);self.assertEqual(r['gust60'],[100]);self.assertEqual(r['t25'],[100]);self.assertEqual(r['rr10'],[None]);self.assertEqual(r['vis200'],[None])
    def test_mos_utc_not_local_hour(self):
        # At 22 UTC sin(hour)=-0.5 → sigmoid(-3+2.5)=0.377, above .30.
        # Wrong local midnight would yield sigmoid(-3)=.047, below .30.
        lr={'vis200':{'coef':[0,0,0,0,0,0,-5,0,0,0],'intercept':-3}}
        r=process(self.fixture(),lr)
        self.assertEqual(r['days'],['2026-09-01'])
        self.assertEqual(r['nederland_per_model']['ecmwf_ifs025']['vis200'],[100])
    def test_missing_point_and_member(self):
        raw=self.fixture();raw['data']['Regio'].append({'models':{}})
        raw['data']['Regio'][0]['models']['ecmwf_ifs025']['hourly']['wind_speed_10m']=[[40],[0],[None]]
        r=process(raw)['diagnostics_per_model']['ecmwf_ifs025']['Regio']['wind40'][0]
        self.assertEqual(r['p'],50);self.assertEqual(r['members'],2);self.assertEqual(r['points'],1);self.assertEqual(r['expected_points'],2);self.assertEqual(r['status'],'partial')

if __name__=='__main__':unittest.main()
