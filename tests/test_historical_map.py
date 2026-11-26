"""Offline end-to-end checks of atomic map updates and retired stations."""
import ast,gzip,json,shutil,subprocess,sys,tempfile,unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1]
class HistoricalMap(unittest.TestCase):
 def test_import_uses_complete_registry(self):
  namespace={'json':json,'Path':Path,'__file__':str(ROOT/'scripts/knmi_records.py')}
  tree=ast.parse((ROOT/'scripts/knmi_records.py').read_text())
  for node in tree.body:
   if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ['_registry','STATIONS','CSV_STATIONS','EPEN_STATIONS'] for t in node.targets):
    exec(compile(ast.Module(body=[node],type_ignores=[]),'import-config','exec'),namespace)
  imported=namespace['STATIONS']+namespace['CSV_STATIONS']+namespace['EPEN_STATIONS']
  self.assertEqual({s[0] for s in imported},set(namespace['_registry']['sources']))
  self.assertEqual(len(imported),47)
  self.assertIn(('344','Rotterdam Airport'),namespace['STATIONS'])
  self.assertIn('20',{s[0] for s in namespace['CSV_STATIONS']})
 def test_preserve_history_and_reject_partial_update(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);(root/'scripts').mkdir()
   shutil.copy(ROOT/'scripts/maak_dagrecords_nl.py',root/'scripts')
   shutil.copy(ROOT/'record-stations.json',root)
   (root/'scripts/requests.py').write_text(
    'class RequestException(Exception): pass\n'
    'def get(*args, **kwargs):\n    raise RequestException("Offline test")\n')
   fixtures=json.loads(gzip.decompress((ROOT/'tests/fixtures/historical-daily.json.gz').read_bytes()))
   for id,source in fixtures.items(): (root/f'records_{id}.json').write_text(json.dumps(source))
   def run(*args):return subprocess.run([sys.executable,str(root/'scripts/maak_dagrecords_nl.py'),*args],capture_output=True,text=True)
   result=run();self.assertEqual(result.returncode,0,result.stderr)
   output=root/'dagrecords_nl.json';before=output.read_bytes();data=json.loads(before)
   self.assertEqual(len(data['dagrecords']),366)
   for d,t in [('09-29',28),('09-30',26.7)]: self.assertEqual(data['dagrecords'][d]['Winterswijk']['t'],t)
   self.assertIn('Soesterberg',data['stations'])
   self.assertNotIn('Rotterdam Geulhaven',data['stations'])
   de_bilt=fixtures['260']
   de_bilt['lopend']='2026-01-27'
   de_bilt['maanddetail']={
    '1930':{'1':{'dagen':[{'dag':27,'tx':-4.6,'tn':-24.6}]}},
    '1950':{'1':{'dagen':[{'dag':27,'tx':-4.7,'tn':-24.7}]}},
   }
   for soort in ('tx_laag','tn_laag'):
    de_bilt['dag']['1']['27'][soort].insert(0,[-40,'2026-01-27'])
   (root/'records_260.json').write_text(json.dumps(de_bilt))
   result=run('--koude');self.assertEqual(result.returncode,0,result.stderr)
   cold_output=root/'dagrecords_koude_nl.json'
   cold_before=cold_output.read_bytes()
   cold=json.loads(cold_before)
   self.assertNotIn('Rotterdam Geulhaven',cold['stations'])
   for soort,waarde in [('tx_laag',-4.8),('tn_laag',-24.8)]:
    days=cold['dagrecords'][soort]
    self.assertEqual(len(days),366)
    self.assertEqual(days['01-27']['De Bilt']['t'],waarde)
    self.assertEqual(days['01-27']['De Bilt']['d'],'1942-01-27')
    self.assertEqual(days['01-27']['De Bilt']['vorig'],
                     {'t':round(waarde+0.2,1),'d':'1930-01-27'})
   self.assertEqual(cold['dagrecords']['tn_laag']['01-27']['Warnsveld'],
                    {'t':-25.4,'d':'1942-01-27','h':1})
   vandaag=datetime.now(ZoneInfo('Europe/Amsterdam')).date()
   iso=vandaag.isoformat()
   sleutel=iso[5:]
   de_bilt['lopend']=iso
   rijen=de_bilt['dag'][str(vandaag.month)][str(vandaag.day)]
   warmere_tx=cold['dagrecords']['tx_laag'][sleutel]['De Bilt']['t']+1
   for soort,waarde in [('tx_laag',-40),('tn_laag',-45)]:
    rijen[soort].insert(0,[waarde,iso])
   (root/'records_260.json').write_text(json.dumps(de_bilt))
   result=run('--koude');self.assertEqual(result.returncode,0,result.stderr)
   met_tussenstand=json.loads(cold_output.read_bytes())
   self.assertEqual(met_tussenstand['voorlopig']['datum'],iso)
   for soort,waarde in [('tx_laag',-40),('tn_laag',-45)]:
    self.assertEqual(met_tussenstand['voorlopig']['records'][soort]['De Bilt'],{'t':waarde,'d':iso})
    self.assertNotEqual(met_tussenstand['dagrecords'][soort][sleutel]['De Bilt']['d'],iso)
   rijen['tx_laag'][0][0]=warmere_tx
   (root/'records_260.json').write_text(json.dumps(de_bilt))
   result=run('--koude');self.assertEqual(result.returncode,0,result.stderr)
   cold_before=cold_output.read_bytes()
   self.assertNotIn('De Bilt',json.loads(cold_before)['voorlopig']['records']['tx_laag'])
   (root/'records_20.json').unlink()
   result=run();self.assertNotEqual(result.returncode,0)
   self.assertIn('Onvolledige dagrecordbronnen',result.stderr)
   self.assertEqual(output.read_bytes(),before)
   result=run('--koude');self.assertNotEqual(result.returncode,0)
   self.assertEqual(cold_output.read_bytes(),cold_before)
if __name__=='__main__':unittest.main()
