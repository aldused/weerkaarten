"""Offline controle van de tienminutenupdate en de echte jaartellingen."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
import sys
import types
from datetime import date

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('lopend_patch', ROOT / 'scripts/lopend_patch.py')
patcher = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {'knmi_api': types.SimpleNamespace(knmi_get=None)}):
    spec.loader.exec_module(patcher)

class LiveDailyRecords(unittest.TestCase):
    def test_running_record_enters_and_leaves_both_year_views(self):
        today = date(2026, 9, 29)
        records = {'station': 'Test', 'tm': '2026-09-28', 'dag': {'9': {'29': {
            'tx_hoog': [[25.4, '1934-09-29']],
            'tn_hoog': [[16, '2026-09-29'], [14.6, '1934-09-29']],
        }}}}
        for values, expected in [({'tx': 25.5, 'tn': 15.7}, 2),
                                 ({'tx': 25.5, 'tn': 14.0}, 1),
                                 ({'tx': 25.4, 'tn': 14.0}, 0)]:
            patcher.patch_vandaag(records, values, today)
            patcher.patch_dagtemperaturen(records, values, today)
            self.assertEqual(records['lopend'], '2026-09-29')
            self.assertEqual(records['tm'], '2026-09-29')
            # Test both actual HTML implementations, not a copy of the JS algorithm.
            js = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const data=JSON.parse(fs.readFileSync(0,'utf8'));
for(const name of ['dagrecords_jaar.html','records_debilt.html']) {
 const html=fs.readFileSync(name,'utf8');
 const ctx=vm.createContext({knmiDatumDelen:()=>({jaar:2026})});
 let start=html.indexOf('const DRJ_MAXJAAR');
 vm.runInContext(html.slice(start,html.indexOf('function drjBron()',start)),ctx);
 start=html.indexOf('function berekenRecordsPerJaar(');
 vm.runInContext(html.slice(start,html.indexOf('\n}',start)+2),ctx);
 const rows=ctx.drjVerzamel(data.records,2026).filter(r=>r.label.startsWith('Warmste'));
 assert.equal(rows.length,data.expected,name);
 assert(rows.every(r=>r.lopend),name);
 assert.equal(ctx.drjTelPerJaar(data.records)[2026].warm,data.expected,name);
 assert.equal(ctx.berekenRecordsPerJaar(data.records).warm[2026]||0,data.expected,name);
}
'''
            subprocess.run(['node', '-e', js], input=json.dumps({'records': records, 'expected': expected}),
                           text=True, check=True, cwd=ROOT)

    def test_recovers_displaced_history_and_preserves_missing_parameters(self):
        records = {'dag': {'9': {'29': {'tn_hoog': [[99, '2026-09-29']] +
            [[30-i, f'{1900+i}-09-29'] for i in range(24)], 'tg_hoog': [[20, '2020-09-29']]}}},
            'maanddetail': {str(1900+i): {'9': {'dagen': [{'dag': 29, 'tn': 30-i}]}} for i in range(30)}}
        patcher.patch_dagtemperaturen(records, {'tn': -10}, date(2026,9,29))
        rows = records['dag']['9']['29']['tn_hoog']
        self.assertEqual(len(rows), 25)
        self.assertEqual(rows[-1], [6, '1924-09-29'])
        self.assertEqual(records['dag']['9']['29']['tg_hoog'], [[20, '2020-09-29']])

if __name__ == '__main__': unittest.main()
