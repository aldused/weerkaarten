from datetime import date, timedelta
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2 if Path(__file__).resolve().parent.name=='climate' else 1]
sys.path.insert(0,str(ROOT/'scripts'/'climate' if (ROOT/'scripts'/'climate').exists() else ROOT/'scripts'))
from climate_math import (calendar_reference,difference,episodes,extremes,full_years,month_shift,quantile,trend)
from update_climate import (Fetcher,guard,parse_advisory,parse_daily,parse_index,parse_monthly,run)

def year_rows(year):
    d=date(year,1,1);rs=[]
    while d.year==year:
        rs.append({'date':d.isoformat(),'value':float(d.month),'missing':0});d+=timedelta(days=1)
    return rs

class Calculations(unittest.TestCase):
    def test_calendar_boundary_and_leap(self):
        self.assertEqual(month_shift(date(2000,1,1),-1),date(1999,12,1))
        self.assertEqual(month_shift(date(2000,2,29),12),date(2001,2,28))
    def test_season_windows(self):
        rows=parse_index('SEAS YR ANOM\nDJF 2000 -1.00\nNDJ 2000 -0.70\n','roni')
        self.assertEqual(rows[0]['period_start'],'1999-12-01')
        self.assertEqual(rows[0]['period_end'],'2000-02-29')
        self.assertEqual(rows[-1]['period_end'],'2001-01-31')
    def test_episode_exact_official_threshold(self):
        rows=[{'date':date(2000,m,1).isoformat(),'value':.49,'official_value':.5,'period':str(m)} for m in range(1,7)]
        rows[-1]['official_value']=0
        e=episodes(rows);self.assertEqual(len(e),1);self.assertEqual(e[0]['duration'],5)
        self.assertFalse(e[0]['ongoing']);self.assertEqual(e[0]['end'],'2000-05-01')
        self.assertEqual(episodes(rows[:4]),[])
    def test_missing_period_breaks_episode(self):
        rows=[{'date':date(2000,m,1).isoformat(),'value':1,'period':str(m)} for m in [1,2,3,5,6,7]]
        self.assertEqual(episodes(rows),[])
    def test_episode_pre_2000_not_truncated(self):
        rows=[];d=date(1999,9,1)
        for _ in range(8):rows.append({'date':d.isoformat(),'value':-1,'period':d.isoformat()});d=month_shift(d,1)
        e=episodes(rows)[0];self.assertEqual(e['start'],'1999-09-01');self.assertEqual(e['duration'],8)
    def test_full_daily_year_missing_pixels_or_day(self):
        rs=year_rows(2000)+year_rows(2001)
        self.assertEqual(full_years(rs,date(2002,1,1)),[2000,2001])
        rs.pop(0);self.assertEqual(full_years(rs,date(2002,1,1)),[2001])
        rs[-1]['missing']=.001;self.assertEqual(full_years(rs,date(2002,1,1)),[])
    def test_current_year_is_not_complete(self):
        self.assertEqual(full_years(year_rows(2000),date(2000,12,31)),[])
    def test_monthly_complete_and_partial(self):
        rows=[{'date':date(2000,m,1).isoformat(),'value':1} for m in range(1,13)]
        self.assertEqual(full_years(rows,date(2001,1,1),False),[2000])
        self.assertEqual(full_years(rows[:-1],date(2001,1,1),False),[])
    def test_calendar_alignment_after_february(self):
        rs=[{'date':'2000-02-29','value':2},{'date':'2000-03-01','value':3},{'date':'2001-03-01','value':5}]
        ref=calendar_reference(rs,2000,2001)
        self.assertEqual(ref['02-29']['n'],1);self.assertEqual(ref['03-01']['mean'],4)
    def test_percentage_zero_and_missing(self):
        self.assertEqual(difference(8,10),{'absolute':-2,'percent':-20})
        self.assertIsNone(difference(8,0)['percent']);self.assertIsNone(difference(8,None)['absolute'])
    def test_percentiles(self):
        self.assertAlmostEqual(quantile([1,2,3,4,5],.1),1.4)
    def test_tied_extremes_and_incomplete_rank(self):
        rs=year_rows(2000)+year_rows(2001)+[{'date':'2002-01-01','value':0,'missing':0}]
        es=extremes(rs,date(2002,10,1))
        self.assertEqual(es[0]['min_rank'],1);self.assertEqual(es[1]['min_rank'],1)
        self.assertGreater(len(es[0]['min_dates']),1);self.assertIsNone(es[-1]['min_rank'])
    def test_known_linear_trend(self):
        t=trend([(y,10-.1*(y-2000)) for y in range(2000,2026)],10)
        self.assertAlmostEqual(t['per_decade'],-1,8);self.assertAlmostEqual(t['percent_per_decade'],-10,8)
        self.assertLess(abs(t['ci95'][1]-t['ci95'][0]),1e-8)
    def test_trend_missing_year_or_short_series(self):
        self.assertIsNone(trend([(y,1) for y in range(2000,2005)],1))
        self.assertIsNone(trend([(y,1) for y in range(2000,2026) if y!=2010],1))

class Sources(unittest.TestCase):
    def test_changed_index_schema_and_duplicates(self):
        with self.assertRaises(ValueError):parse_index('UNKNOWN\nDJF 2000 1\n','roni')
        with self.assertRaises(ValueError):parse_index('SEAS YR ANOM\nDJF 2000 1\nDJF 2000 1\nNDJ 2000 1\n','roni')
    def test_changed_nsidc_header(self):
        with self.assertRaises(ValueError):parse_daily('Year,Month,Day,Area\n','N')
        with self.assertRaises(ValueError):parse_monthly('year,mo,area\n','N',1)
    def test_official_watch_is_not_advisory(self):
        x=parse_advisory('<p>8 October 2026</p> ENSO Alert System Status: El Niño Watch Synopsis: ...')
        self.assertEqual(x['phase'],'ENSO-neutraal');self.assertEqual(x['alert'],'El Niño Watch')
        x=parse_advisory('<p>8 October 2026</p> ENSO Alert System Status: La Niña Advisory Synopsis: ...')
        self.assertEqual(x['phase'],'La Niña')
    def test_regressing_dataset_rejected(self):
        with self.assertRaises(ValueError):guard({'rows':[{'date':'2026-09-01'}]},{'rows':[{'date':'2026-08-01'}]})
    def test_failed_validation_does_not_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);f=Fetcher(root,True)
            class Response(io.BytesIO):headers={}
            with patch('urllib.request.urlopen',return_value=Response(b'bad new data')):
                with self.assertRaises(ValueError):f.get('test','https://example.test',1,lambda x:(_ for _ in ()).throw(ValueError('schema')))
            self.assertFalse((root/'test.json').exists())
    def test_outage_preserves_last_good_and_timestamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);output=root/'data';output.mkdir();saved={'meta':{'last_success':'2026-09-01T00:00:00Z'},'rows':[{'date':'2026-08-01','value':1}]}
            path=output/'roni.json';path.write_text(json.dumps(saved));before=path.read_bytes()
            with patch.object(Fetcher,'get',side_effect=OSError('offline')):
                code=run(output,root/'cache',True)
            self.assertEqual(code,1);self.assertEqual(before,path.read_bytes())
            status=json.loads((output/'status.json').read_text())['sources'];self.assertEqual(status['roni']['state'],'delayed')
            self.assertEqual(status['roni']['last_success'],saved['meta']['last_success']);self.assertEqual(status['south']['state'],'unavailable')

if __name__=='__main__':unittest.main()
