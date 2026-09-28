"""Offline end-to-end checks of atomic map updates and retired stations."""
import gzip,json,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class HistoricalMap(unittest.TestCase):
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
