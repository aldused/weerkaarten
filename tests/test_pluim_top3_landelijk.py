import gzip
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import datetime,timezone
from unittest.mock import patch

import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'shell'))
import pluim_top3_landelijk as national
from pluim_top3_om import GaussianArea


class CountryRankingsTest(unittest.TestCase):
    def setUp(self):
        self.run=datetime(2026,11,20,6,tzinfo=timezone.utc)
        self.times=[int(self.run.timestamp()*1000+h*3600000) for h in range(145)]
        self.groups=[dict(id=f'cell{i}',lat=51+i*.1,lon=5,places=[dict(name=f'Plaats{i}',lat=51+i*.1,lon=5,population=100)]) for i in range(4)]
        shape=(51,4,len(self.times))
        self.fields={key:np.zeros(shape) for key in national.REQUIRED}
        for i in range(4):
            self.fields['temperature_2m'][:,i,:]=i
            self.fields['wind_speed_10m'][:,i,:]=10+i*10
            self.fields['wind_gusts_10m'][:,i,:]=20+i*10
            self.fields['precipitation'][:,i,:]=i+1
        self.source=dict(grid='test',resolution='test',run_initialisation=national.iso(self.run))

    def result(self):
        return national.scores(self.groups,self.run,self.times,self.fields,self.source)

    def period(self,result=None):
        summary=(result or self.result())[0]
        return next(p for p in summary['periods'] if p['days']==5)

    def test_full_catalog_includes_islands_and_deduplicates_real_model_points(self):
        cities=national.catalog(ROOT)
        self.assertGreater(len(cities),1900)
        self.assertIn('Hollum',{p['name'] for p in cities})
        grid=GaussianArea();groups=grid.groups(cities)
        self.assertEqual(sum(len(g['places']) for g in groups),len(cities))
        self.assertGreater(len(groups),400)
        self.assertLess(len(groups),len(cities))
        self.assertEqual(grid.prefix[-1],157257)
        _,index,_,lat,lon=grid.point(52.101,5.178)
        self.assertEqual(index,58488)
        self.assertAlmostEqual(lat,52.126537,places=5)
        self.assertAlmostEqual(lon,5.1381216,places=5)

    def test_extrema_of_all_51_members_and_interval_totals(self):
        self.fields['wind_speed_10m'][0,0,10]=1000
        self.fields['precipitation'][:,:,0]=999
        ranking=self.period()['rankings']
        self.assertEqual(ranking['cold'][0]['name'],'Plaats0')
        self.assertEqual(ranking['mild'][0]['name'],'Plaats3')
        self.assertEqual(ranking['wind'][0]['name'],'Plaats3')
        self.assertEqual(ranking['precipitation'][0]['value'],4*120)
        self.assertEqual(ranking['snow'],[])

    def test_shared_grid_cells_produce_one_independent_rank_and_aliases(self):
        self.groups[0]['places'].append(dict(name='Buurplaats',lat=51.01,lon=5,population=10))
        summary,_=self.result()
        self.assertEqual(summary['station_count'],5)
        self.assertEqual(summary['grid_count'],4)
        row=self.period((summary,{}))['rankings']['cold'][0]
        self.assertEqual(row['equivalent_places'],['Buurplaats'])
        self.assertEqual(row['equivalent_count'],2)
        self.assertEqual(len({r['point'] for r in self.period((summary,{}))['rankings']['cold']}),3)

    def test_snow_is_summed_per_member_before_probability(self):
        self.fields['snowfall'][:17,2,1:3]=.6
        row=self.period()['rankings']['snow'][0]
        self.assertAlmostEqual(row['value'],.4)
        self.assertAlmostEqual(row['chance_1cm'],100/3,places=4)

    def test_missing_member_nonfinite_and_negative_data_block_publication(self):
        for value in (np.nan,np.inf,-1):
            with self.subTest(value=value):
                self.fields['precipitation'][3,2,10]=value
                with self.assertRaises(ValueError):self.result()
        self.fields['precipitation'][3,2,10]=0
        self.fields['wind_speed_10m']=self.fields['wind_speed_10m'][:50]
        with self.assertRaises(ValueError):self.result()

    def test_short_runs_have_no_10_or_15_day_rankings(self):
        summary,_=self.result()
        self.assertEqual([p['days'] for p in summary['periods']],[1,3,5])
        bad=self.times.copy();bad[0]+=3600000
        with self.assertRaises(ValueError):national.scores(self.groups,self.run,bad,self.fields,self.source)

    def test_exact_winner_matrices_and_atomic_local_manifest(self):
        summary,documents=self.result()
        with tempfile.TemporaryDirectory() as tmp:
            repo=Path(tmp)/'repo';repo.mkdir();state=Path(tmp)/'state'
            self.assertTrue(national.publish_run(repo,state,self.run,summary,documents,publish=False))
            self.assertFalse(national.publish_run(repo,state,self.run,summary,documents,publish=False))
            manifest=json.loads((repo/national.NAME).read_text())
            self.assertEqual(manifest['runs'][0]['top3_nl']['revision'],summary['revision'])
            point=summary['periods'][0]['rankings']['cold'][0]['point']
            doc=json.loads(gzip.decompress((state/summary['path']/(point+'.json')).read_bytes()))
            self.assertEqual(doc['run'],national.iso(self.run))
            self.assertEqual(len(doc['members']['temperature_2m']),51)
            self.assertEqual(doc['times_ms'],self.times)
            np.testing.assert_array_equal(doc['members']['temperature_2m'],self.fields['temperature_2m'][:,0,:])

    def test_grib_sampler_keeps_public_station_registry_separate(self):
        from ecmwf_pluim_direct import Station
        core=[Station('De Bilt','debilt',52.101,5.178)]
        sampled,params,groups=national.sampling_configuration(ROOT,core,('2t','tp','10u','10v','10fg'))
        self.assertEqual(len(core),1)
        self.assertEqual(sampled[0],core[0])
        self.assertGreater(len(groups),100)
        self.assertEqual(len(sampled),len(core)+len(groups))
        self.assertIn('sf',params)

    def test_progressive_archive_contains_only_public_stations(self):
        import ecmwf_pluim_direct as direct
        import ecmwf_pluim_progressive as progressive
        core=[direct.Station('De Bilt','debilt',52.101,5.178)]
        grid=(direct.GridPoint(0,52,5.25,1),direct.GridPoint(1,52.25,5.5,0))
        params=('2t','tp','10u','10v','10fg','sf')
        raw={p:np.zeros((51,2,2)) for p in params}
        raw['2t'][:]=280
        raw['tp'][:,:,1]=.001
        raw['tp_packing_error']=np.zeros((51,2,2))
        raw['sf_packing_error']=np.zeros((51,2,2))
        metrics=direct.Metrics(started_monotonic=0)
        manifest,documents=progressive.snapshot(raw,params,(0,3),core,grid,self.run,metrics,self.run)
        self.assertEqual(manifest['station_count'],1)
        self.assertEqual(set(documents),{'debilt'})
        self.assertEqual(len(documents['debilt']['runs'][0]['members']['temperature_2m']),51)


if __name__=='__main__':unittest.main()
