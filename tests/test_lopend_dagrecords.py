"""Offline controle van de tienminutenupdate en de echte jaartellingen."""
import ast
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
    live_spec = importlib.util.spec_from_file_location('knmi_live_day', ROOT / 'scripts/knmi_live_day.py')
    live_day = importlib.util.module_from_spec(live_spec)
    live_spec.loader.exec_module(live_day)

class LiveDailyRecords(unittest.TestCase):
    def test_first_live_minimum_interval_is_kept_when_reached_twice(self):
        rows = [
            {'time': '2026-11-27T04:40:00Z', 'ta': -5.9, 'tn': -6.6},
            {'time': '2026-11-27T04:30:00Z', 'ta': -6.6, 'tn': -6.6},
            {'time': '2026-11-27T04:20:00Z', 'ta': -6.3, 'tn': -6.5},
        ]
        values = live_day.aggregate(rows)
        self.assertEqual((values['tn'], values['tn_vak']), (-6.6, [270, 10]))
        self.assertEqual(live_day.aggregate([{'time': '2026-11-28T00:00:00Z', 'tn': -8}])['tn_vak'], [1440, 10])
        records = {}
        today = date(2026, 11, 27)
        patcher.patch_vandaag(records, values, today)
        patcher.patch_vandaag(records, {'tn': -6.6, 'tn_vak': [280, 10]}, today)
        record = records['maanddetail']['2026']['11']['dagen'][0]
        self.assertEqual(record['tn_vak'], [270, 10])
        patcher.patch_vandaag(records, {'tn': -7}, today)
        self.assertNotIn('tn_vak', record)

    def test_archive_includes_only_the_hour_of_the_matching_minimum(self):
        src = ast.parse((ROOT / 'scripts/knmi_records.py').read_text())
        fun = [node for node in src.body if isinstance(node, ast.FunctionDef)
               and node.name in ('parse_csv', 'minimum_uurvak', 'seizoen')]
        ctx = {}
        exec(compile(ast.Module(body=fun, type_ignores=[]), 'knmi_records.py', 'exec'), ctx)
        values = ctx['parse_csv']('# STN,YYYYMMDD,TN,TNH\n344,20161129,-68,24\n344,20161130,-66,5\n344,20161130,-65,\n')
        self.assertEqual(values[0]['tn_vak'], [1440, 60])
        self.assertEqual(values[1]['tn'], -6.5)
        self.assertIsNone(values[1].get('tn_vak'))
        js = '''
const assert=require('node:assert/strict');
require('./record-minimum-time.js');
assert.equal(RecordMinimumTime.format('2026-11-27',[270,10]),'05:20–05:30 uur');
assert.equal(RecordMinimumTime.format('2026-07-20',[270,10]),'06:20–06:30 uur');
assert.equal(RecordMinimumTime.format('2016-11-29',[1440,60]),'30 nov 00:00–01:00 uur');
assert.equal(RecordMinimumTime.format('2026-11-27',[0,60]),'');
'''
        subprocess.run(['node', '-e', js], cwd=ROOT, check=True)

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
