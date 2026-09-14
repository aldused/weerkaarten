"""Missing days and unfinished periods must not become dry/cold records."""
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import pandas as pd
from climate_periods import complete_days
import knmi_l5 as l5
import knmi_p13 as p13

class PeriodTests(unittest.TestCase):
    def series(self, start, end, value=1.0):
        return pd.Series(value,index=pd.date_range(start,end))

    def test_calendar_boundaries_and_missing_days(self):
        leap=self.series('2024-02-01','2024-02-29')
        self.assertEqual(len(complete_days(leap,'month')),29)
        self.assertEqual(len(complete_days(leap.iloc[:-1],'month')),0)
        self.assertEqual(len(complete_days(leap.drop(pd.Timestamp('2024-02-14')),'month')),0)
        self.assertEqual(len(complete_days(leap.loc['2024-02-21':],'decade')),9)
        winter=self.series('2023-12-01','2024-02-29')
        self.assertEqual(len(complete_days(winter,'season')),91)
        self.assertEqual(len(complete_days(winter.iloc[1:],'season')),0)

    def test_partial_dry_month_cannot_top_rankings(self):
        s=self.series('2024-01-01','2024-02-10');s.loc['2024-02-01':]=0
        records=l5.bereken_records(s,'RH')
        self.assertEqual(records['laagste_maand'],[{'label':'januari 2024','waarde':31.0}])
        self.assertEqual(records['hoogste_jaar'],[])
        rain=pd.DataFrame({'rh_mm':s})
        self.assertEqual(p13.maand_records(rain)['droogste_maand'],[{'label':'januari 2024','waarde':31.0}])
        self.assertEqual(p13.jaar_records(rain)['droogste_jaar'],[])

    def test_ice_day_uses_maximum_temperature(self):
        tx=self.series('2024-01-01','2024-12-31',5);tn=tx.copy();tx.iloc[0]=-1;tn.iloc[1]=-11
        result=l5.jaar_statistieken({'TX':tx,'TN':tn})[0]
        self.assertEqual(result['ijs_dagen'],1)
        self.assertEqual(len(complete_days(tx,'year')),366)
        self.assertEqual(len(complete_days(tx.iloc[:-1],'year')),0)

    def test_november_year_is_incomplete(self):
        rain=pd.DataFrame({'rh_mm':self.series('2025-01-01','2025-11-30')})
        self.assertTrue(p13.jaar_statistieken(rain)[0]['onvolledig'])
        self.assertEqual(p13.jaar_records(rain)['natste_jaar'],[])

if __name__=='__main__':unittest.main()
