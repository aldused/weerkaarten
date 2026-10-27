import ast,json,tempfile,unittest
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1]
tree=ast.parse((ROOT/'scripts/icond2_eps_native.py').read_text());node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='resumable_run');ns={'json':json,'datetime':datetime};exec(compile(ast.Module(body=[node],type_ignores=[]),'resume','exec'),ns)
class Resume(unittest.TestCase):
 def test_published_pending_never_pins_next_poll(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'pending';s=Path(tmp)/'state';p.write_text(json.dumps({'run_utc':'2026-10-26T18:00:00+00:00'}));s.write_text(json.dumps({'run_key':'2026102618'}));now=datetime(2026,10,27,9,tzinfo=timezone.utc)
   self.assertIsNone(ns['resumable_run'](p,s,now));s.write_text(json.dumps({'run_key':'2026102603'}));self.assertEqual(ns['resumable_run'](p,s,now).hour,18)
   self.assertIsNone(ns['resumable_run'](p,s,datetime(2026,10,27,13,tzinfo=timezone.utc)))
if __name__=='__main__':unittest.main()
