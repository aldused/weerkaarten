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
import pluim_top3_om as native


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

    def test_average_rankings_use_all_members_and_archive_their_winners(self):
        self.fields['temperature_2m'][50, 3, 1] = -50
        self.fields['precipitation'][50, 0, 1] = 500
        summary, documents = self.result()
        period = self.period((summary, documents))
        extreme = period['rankings']
        average = period['average_rankings']
        self.assertEqual(extreme['cold'][0]['point'], 'cell3')
        self.assertEqual(average['cold'][0]['point'], 'cell0')
        self.assertEqual(extreme['precipitation'][0]['point'], 'cell0')
        self.assertEqual(average['precipitation'][0]['value'], 480)
        self.assertNotIn('member', average['cold'][0])
        self.assertTrue(all(row['point'] in documents for rows in average.values() for row in rows))

    def test_period_average_accounts_for_unequal_time_steps(self):
        self.times = [int(self.run.timestamp()*1000+h*3600000) for h in (0, 6, 9, 15, 21, 24)]
        self.fields = {key: values[:, :, :6].copy() for key, values in self.fields.items()}
        self.fields['temperature_2m'][:, 0, 0] = -24
        summary, _ = self.result()
        self.assertEqual(summary['periods'][0]['average_rankings']['cold'][0]['value'], -3)

    def test_extrema_of_all_51_members_and_interval_totals(self):
        self.fields['wind_speed_10m'][0,0,10]=1000
        self.fields['temperature_2m'][50,3,15]=-70
        self.fields['temperature_2m'][12,0,24]=60
        self.fields['precipitation'][:,:,0]=999
        ranking=self.period()['rankings']
        self.assertEqual((ranking['cold'][0]['name'],ranking['cold'][0]['member'],ranking['cold'][0]['value']),('Plaats3',50,-70))
        self.assertEqual(ranking['cold'][0]['time_ms'],self.times[15])
        self.assertEqual((ranking['mild'][0]['name'],ranking['mild'][0]['member'],ranking['mild'][0]['value']),('Plaats0',12,60))
        self.assertEqual((ranking['wind'][0]['name'],ranking['wind'][0]['member'],ranking['wind'][0]['value']),('Plaats0',0,1000))
        self.assertEqual(ranking['wind'][0]['time_ms'],self.times[10])
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
        self.assertAlmostEqual(row['value'],1.2)
        self.assertEqual(row['member'],0)
        self.assertAlmostEqual(row['chance_1cm'],100/3,places=4)

    def test_wettest_member_wins_and_future_intervals_are_excluded(self):
        self.fields['precipitation'][23,0,1:121]=10
        self.fields['precipitation'][5,1,121]=99999
        row=self.period()['rankings']['precipitation'][0]
        self.assertEqual((row['name'],row['member'],row['value']),('Plaats0',23,1200))

    def test_totals_never_switch_members_between_intervals(self):
        for field,category in [('precipitation','precipitation'),('snowfall','snow')]:
            self.fields[field][:]=0
            self.fields[field][1,0,1]=5
            self.fields[field][2,0,2]=5
            self.fields[field][3,1,1:3]=4
            row=self.period()['rankings'][category][0]
            self.assertEqual((row['name'],row['member'],row['value']),('Plaats1',3,8))

    def test_ranked_values_are_reproducible_from_the_exact_member_documents(self):
        self.fields['temperature_2m'][44,3,65]=-25
        self.fields['snowfall'][17,1,15:19]=2.5
        summary,documents=self.result()
        self.assertEqual(summary['schema'],3)
        self.assertEqual(summary['ranking_method'],'member_extremes_v1')
        for period in summary['periods']:
            stop=self.times.index(period['end_ms'])+1
            for category,field in [('cold','temperature_2m'),('mild','temperature_2m'),('wind','wind_speed_10m'),('snow','snowfall'),('precipitation','precipitation')]:
                for row in period['rankings'][category]:
                    values=documents[row['point']]['members'][field][row['member']]
                    expected=sum(values[1:stop]) if category in ('snow','precipitation') else values[self.times.index(row['time_ms'])]
                    self.assertAlmostEqual(row['value'],expected,places=4)

    def test_ties_choose_earliest_time_then_lowest_member(self):
        self.fields['temperature_2m'][12,0,10]=-10
        self.fields['temperature_2m'][1,0,20]=-10
        self.fields['temperature_2m'][13,0,10]=-10
        row=self.period()['rankings']['cold'][0]
        self.assertEqual((row['time_ms'],row['member']),(self.times[10],12))

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

    def test_unchanged_source_with_old_mean_rankings_is_rebuilt(self):
        cities=national.catalog(ROOT)
        meta={'created_at':national.iso(self.run)}
        source={'native_revision':native.hashlib.sha256(national.canonical(meta)).hexdigest(),
                'catalog_revision':native.hashlib.sha256(national.canonical(cities)).hexdigest()}
        entry={'run':national.iso(self.run),'complete':True,'top3_nl':{'schema':2,'source':source}}
        with tempfile.TemporaryDirectory() as tmp:
            repo=Path(tmp)
            (repo/'pluim_archive_meta.json').write_text(json.dumps({'runs':[entry]}))
            (repo/national.NAME).write_text(json.dumps({'runs':[entry]}))
            raw={key:self.fields.get(key,np.zeros_like(self.fields['temperature_2m'])) for key in native.RAW}
            with patch.object(native,'catalog',return_value=cities),patch.object(GaussianArea,'groups',return_value=self.groups),patch.object(native,'metadata',return_value=(meta,self.times)),patch.object(native,'read_field',side_effect=lambda field,*args:(field,raw[field],'etag')),patch.object(native,'publish_run') as published:
                native.update_native_runs(repo,repo,publish=False)
                self.assertEqual(published.call_count,1)
                summary=published.call_args.args[3]
                self.assertEqual(summary['ranking_method'],national.RANKING_METHOD)
                entry['top3_nl']=summary
                (repo/national.NAME).write_text(json.dumps({'runs':[entry]}))
                native.update_native_runs(repo,repo,publish=False)
                self.assertEqual(published.call_count,1)

    def test_legacy_native_average_cannot_block_corrected_coarse_extremes(self):
        summary,documents=self.result()
        with tempfile.TemporaryDirectory() as tmp:
            repo=Path(tmp)/'repo';repo.mkdir();state=Path(tmp)/'state'
            old={'run':national.iso(self.run),'complete':True,'top3_nl':{'schema':2,'source':{'grid':'O1280'}}}
            (repo/national.NAME).write_text(json.dumps({'runs':[old]}))
            self.assertTrue(national.publish_run(repo,state,self.run,summary,documents,publish=False))
            native_summary={**summary,'source':{**summary['source'],'grid':'O1280'}}
            self.assertTrue(national.publish_run(repo,state,self.run,native_summary,documents,publish=False))
            self.assertFalse(national.publish_run(repo,state,self.run,summary,documents,publish=False))

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
