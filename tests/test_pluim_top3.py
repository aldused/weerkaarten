import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'shell'))
import pluim_trend_cache as trend


class NationalTop3Test(unittest.TestCase):
    def setUp(self):
        self.start = 1795132800000  # 20 November 2026, 00 UTC
        self.times = [self.start + h*3600000 for h in range(0, 145, 3)]
        self.fields = ['temperature_2m', 'wind_speed_10m', 'snowfall', 'precipitation']
        self.runs = {}
        for i, slug in enumerate(sorted(trend.TOP3_NL_SLUGS)):
            members = {
                'temperature_2m': [[i + (t % 8) for t in range(len(self.times))] for _ in range(51)],
                'wind_speed_10m': [[10+i]*len(self.times) for _ in range(51)],
                'precipitation': [[999]+[i+1]*(len(self.times)-1) for _ in range(51)],
                'snowfall': [[0]*len(self.times) for _ in range(51)],
            }
            self.runs[slug] = dict(run='2026-11-20T00:00:00Z', times_ms=self.times[:], members=members)

    def period(self, result=None, days=5):
        result = result or trend.build_nl_top3(self.runs, self.fields)
        return next(p for p in result['periods'] if p['days'] == days)

    def test_actual_single_member_extreme_wins_over_ensemble_mean(self):
        self.runs['arcen']['members']['wind_speed_10m'][0][0] = 1000
        self.runs['debilt']['members']['temperature_2m'][50][5] = -70
        self.runs['rotterdam']['members']['temperature_2m'][12][10] = 80
        ranking = self.period()['rankings']
        self.assertEqual((ranking['cold'][0]['slug'],ranking['cold'][0]['member'],ranking['cold'][0]['value']),('debilt',50,-70))
        self.assertEqual((ranking['mild'][0]['slug'],ranking['mild'][0]['member'],ranking['mild'][0]['value']),('rotterdam',12,80))
        self.assertEqual((ranking['wind'][0]['slug'],ranking['wind'][0]['member'],ranking['wind'][0]['value']),('arcen',0,1000))
        self.assertEqual(ranking['cold'][0]['time_ms'], self.times[5])

    def test_interval_sums_exclude_t0_and_are_not_rates(self):
        ranking = self.period()['rankings']['precipitation']
        # Five days contain 40 preceding 3-hour intervals. No multiplication by 3.
        self.assertAlmostEqual(ranking[0]['value'], len(trend.TOP3_NL_SLUGS)*40)
        self.assertTrue(all(r['value'] < 2000 for r in ranking))

    def test_snow_per_member_sum_probability_and_no_snow_state(self):
        self.assertEqual(self.period()['rankings']['snow'], [])
        m = self.runs['debilt']['members']['snowfall']
        for row in m[:17]:
            row[1:3] = [.6, .6]
        row = self.period()['rankings']['snow'][0]
        self.assertEqual(row['slug'], 'debilt')
        self.assertAlmostEqual(row['value'], 1.2)
        self.assertEqual(row['member'],0)
        self.assertAlmostEqual(row['chance_1cm'], 100/3, places=4)

    def test_rain_sum_uses_one_consistent_member_and_excludes_later_days(self):
        self.runs['arcen']['members']['precipitation'][23][1:41]=[100]*40
        self.runs['debilt']['members']['precipitation'][4][41]=99999
        result=trend.build_nl_top3(self.runs,self.fields)
        self.assertEqual(result['schema'],3)
        self.assertEqual(result['ranking_method'],'member_extremes_v1')
        row=self.period(result)['rankings']['precipitation'][0]
        self.assertEqual((row['slug'],row['member'],row['value']),('arcen',23,4000))

    def test_snow_totals_never_combine_different_members(self):
        members=self.runs['arcen']['members']['snowfall']
        members[1][1]=5;members[2][2]=5
        self.runs['debilt']['members']['snowfall'][3][1:3]=[4,4]
        row=self.period()['rankings']['snow'][0]
        self.assertEqual((row['slug'],row['member'],row['value']),('debilt',3,8))

    def test_short_run_has_no_longer_period(self):
        result = trend.build_nl_top3(self.runs, self.fields)
        self.assertEqual([p['days'] for p in result['periods']], [1,3,5])
        self.assertEqual(result['member_count'], 51)
        self.assertEqual(result['station_count'], 26)
        self.assertEqual(self.period(result)['end_ms'], self.start+120*3600000)

    def test_missing_location_or_mixed_run_invalidates_national_comparison(self):
        bad = copy.deepcopy(self.runs)
        del bad['debilt']
        self.assertIsNone(trend.build_nl_top3(bad, self.fields))
        bad = copy.deepcopy(self.runs)
        bad['debilt']['source'] = dict(run_initialisation='2026-11-19T12:00:00Z')
        self.assertIsNone(trend.build_nl_top3(bad, self.fields))
        bad = copy.deepcopy(self.runs)
        bad['debilt']['times_ms'][1] += 1000
        self.assertIsNone(trend.build_nl_top3(bad, self.fields))

    def test_missing_member_null_and_negative_never_become_zero(self):
        for mutate in (
            lambda m: m.pop(),
            lambda m: m[7].__setitem__(5, None),
            lambda m: m[7].__setitem__(5, -1),
        ):
            with self.subTest(mutate=mutate):
                bad = copy.deepcopy(self.runs)
                mutate(bad['debilt']['members']['snowfall'])
                result = trend.build_nl_top3(bad, self.fields)
                self.assertIsNone(self.period(result)['rankings']['snow'])
                self.assertEqual(len(self.period(result)['rankings']['cold']), 3)

    def test_unpublished_field_and_foreign_station_excluded(self):
        self.runs['londen'] = copy.deepcopy(self.runs['arcen'])
        self.runs['londen']['members']['wind_speed_10m'] = [[999]*len(self.times) for _ in range(51)]
        result = trend.build_nl_top3(self.runs, [f for f in self.fields if f != 'snowfall'])
        ranking = self.period(result)['rankings']
        self.assertIsNone(ranking['snow'])
        self.assertNotIn('londen', [r['slug'] for r in ranking['wind']])

    def test_summary_is_part_of_atomic_manifest_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            for name, slug, lat, lon in trend.STATIONS:
                run = copy.deepcopy(self.runs.get(slug, self.runs['debilt']))
                run['n'] = len(self.times)
                run['members']['cloud_cover'] = [[50]*len(self.times) for _ in range(51)]
                run['data_sha256'] = 'a'*64
                doc = dict(schema=3, station=name, slug=slug, runs=[run])
                (out/f'pluim_trend_{slug}.json').write_text(json.dumps(doc))
            path = trend.write_capability_manifest(out)
            manifest = json.loads(path.read_text())
            self.assertEqual(manifest['runs'][0]['top3_nl']['station_count'], 26)
            semantic = {key:manifest[key] for key in ('schema','complete','station_count','member_count','runs')}
            self.assertEqual(manifest['revision'], trend.canonical_sha256(semantic))
            self.assertIsNone(trend.write_capability_manifest(out))


if __name__ == '__main__':
    unittest.main()
