import importlib.util,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
spec=importlib.util.spec_from_file_location('render',Path(__file__).parents[1]/'shell/wxbeta_render.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class RenderTests(unittest.TestCase):
 def test_resume_corruption_and_force(self):
  with tempfile.TemporaryDirectory() as directory:
   target=str(Path(directory)/'overview_2026102000_099.png');calls=[]
   def draw(path):
    calls.append(path);Image.new('RGB',(4,4)).save(path)
   m.render_task((draw,(target,)));self.assertTrue(Path(target).exists());self.assertFalse(Path(target+'.incomplete.png').exists())
   m.render_task((draw,(target,)));self.assertEqual(len(calls),1)
   Path(target).write_bytes(b'partial PNG');m.render_task((draw,(target,)));self.assertEqual(len(calls),2)
   with patch.dict(os.environ,{'WXBETA_RERENDER':'1'}):m.render_task((draw,(target,)))
   self.assertEqual(len(calls),3)
 def test_failed_render_never_replaces_published_image(self):
  with tempfile.TemporaryDirectory() as directory:
   target=str(Path(directory)/'chart.png');Image.new('RGB',(4,4)).save(target);before=Path(target).read_bytes()
   def fail(path):Path(path).write_bytes(b'partial');raise RuntimeError('render failed')
   with patch.dict(os.environ,{'WXBETA_RERENDER':'1'}):
    with self.assertRaises(RuntimeError):m.render_task((fail,(target,)))
   self.assertEqual(Path(target).read_bytes(),before)
