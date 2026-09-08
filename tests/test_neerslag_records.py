import importlib.util
import unittest
import tempfile, json, os, sys
from unittest.mock import patch
from datetime import date, timedelta
from pathlib import Path
spec=importlib.util.spec_from_file_location('rain',Path(__file__).resolve().parents[1]/'scripts/knmi_neerslag_records.py')
rain=importlib.util.module_from_spec(spec);spec.loader.exec_module(rain)

class CompletePeriods(unittest.TestCase):
    def rows(self,start,count):
        return [{'d':(start+timedelta(days=i)).strftime('%Y%m%d'),'rd':10,'sx':None} for i in range(count)]
    def test_partial_month_cannot_be_wet_or_dry_month_record(self):
        result=rain.bereken_records(self.rows(date(2026,1,1),20))
        self.assertEqual(result['maand'],[])
        self.assertEqual(result['droog_maand'],[])
        self.assertEqual(result['jaar'],[])
        self.assertEqual(result['jaar_reeks'],[])
        self.assertEqual(result['metingen_tm'],'20260120')
    def test_leap_month_and_decade_require_every_day(self):
        result=rain.bereken_records(self.rows(date(2024,2,1),28))
        self.assertEqual(result['maand'],[])
        self.assertEqual(len(result['decade']),2)
        complete=rain.bereken_records(self.rows(date(2024,2,1),29))
        self.assertEqual(complete['maand'][0]['waarde'],29)
        self.assertEqual(len(complete['decade']),3)
    def test_missing_day_breaks_dry_streak(self):
        rows=self.rows(date(2026,1,1),10)
        for row in rows: row['rd']=0
        del rows[4]
        result=rain.bereken_droge_perioden(rows)
        self.assertEqual(result[0]['dagen'],5)
    def test_winter_crosses_year_boundary(self):
        counts={(2023,12):31,(2024,1):31,(2024,2):29}
        self.assertTrue(rain.seizoen_compleet(('winter',2023),counts))
        counts[(2024,2)]=28
        self.assertFalse(rain.seizoen_compleet(('winter',2023),counts))

    def test_failed_bounded_refresh_preserves_all_cached_stations(self):
        with tempfile.TemporaryDirectory() as temp:
            previous=os.getcwd()
            try:
                os.chdir(temp)
                cache=Path(temp)/'cache';cache.mkdir()
                stations={str(n):{'nr':n,'naam':f'Station {n}','bron_tm':'20260131'} for n in (1,2)}
                for n in (1,2):
                    (cache/f'nrs_{n}.json').write_text(json.dumps(self.rows(date(2025,1,1),31)))
                with patch.multiple(rain,CACHE_DIR=str(cache),OUTPUT_JSON=str(Path(temp)/'neerslag_records.json')), \
                     patch.object(rain,'haal_stations_van_pagina',return_value=stations), \
                     patch.object(rain,'haal_station_data',return_value=None) as download, \
                     patch.object(sys,'argv',['records','--max-per-run','1']):
                    rain.main()
                result=json.loads((Path(temp)/'neerslag_records.json').read_text())
                self.assertEqual(set(result['stations']),{'1','2'})
                self.assertEqual(result['stations_achter_bron'],['1','2'])
                self.assertEqual(download.call_count,1)
                self.assertEqual(len(json.loads((cache/'nrs_1.json').read_text())),31)
            finally:
                os.chdir(previous)

if __name__=='__main__': unittest.main()
