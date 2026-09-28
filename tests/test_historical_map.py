"""Offline end-to-end checks of atomic map updates and retired stations."""
import ast,gzip,json,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
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
   (root/'scripts/requests.py').write_text('def get(*args, **kwargs):\n    raise RuntimeError("Offline test")\n')
   fixtures=json.loads(gzip.decompress((ROOT/'tests/fixtures/historical-daily.json.gz').read_bytes()))
   for id,source in fixtures.items(): (root/f'records_{id}.json').write_text(json.dumps(source))
   def run():return subprocess.run([sys.executable,str(root/'scripts/maak_dagrecords_nl.py')],capture_output=True,text=True)
   result=run();self.assertEqual(result.returncode,0,result.stderr)
   output=root/'dagrecords_nl.json';before=output.read_bytes();data=json.loads(before)
   self.assertEqual(len(data['dagrecords']),366)
   for d,t in [('09-29',28),('09-30',26.7)]: self.assertEqual(data['dagrecords'][d]['Winterswijk']['t'],t)
   self.assertIn('Soesterberg',data['stations'])
   (root/'records_20.json').unlink()
   result=run();self.assertNotEqual(result.returncode,0)
   self.assertIn('Onvolledige dagrecordbronnen',result.stderr)
   self.assertEqual(output.read_bytes(),before)
if __name__=='__main__':unittest.main()
