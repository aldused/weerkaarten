import importlib.util,sys,unittest,tempfile,struct
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import icon_global_native as m
class Conservation(unittest.TestCase):
 def test_rain_preserves_every_source_interval(self):
  a=np.array([0,3,12.]).reshape(3,1,1);h,c=m.intervals(a,[0,3,6],[{'start':0,'kind':'accum'}]*3)
  self.assertTrue(np.isnan(h[0]).all());self.assertEqual(h[1:4].sum(),3);self.assertEqual(h[4:7].sum(),9)
 def test_average_radiation_preserves_energy(self):
  a=np.array([0,20,30.]).reshape(3,1,1);h,c=m.intervals(a,[0,3,6],[{'start':0,'kind':'avg'}]*3,True)
  self.assertEqual(h[1:4].sum(),60);self.assertEqual(h[4:7].sum(),120)
 def test_decreasing_rain_rejected(self):
  with self.assertRaises(ValueError):m.intervals(np.array([0,3,2.]).reshape(3,1,1),[0,3,6],[{'start':0,'kind':'accum'}]*3)
 def test_nonzero_accumulation_start_rejected(self):
  with self.assertRaises(ValueError):m.intervals(np.zeros((2,1,1)),[0,3],[{'start':0,'kind':'accum'},{'start':1,'kind':'accum'}])
 def test_members_never_averaged_together(self):
  a=np.array([[[0],[100]],[[6],[160]]]);out=m.interpolate(a,[0,6],[0,3,6]);np.testing.assert_array_equal(out[1,:,0],[3,130])
 def test_rain_precision_repair_bounded_and_final_exact(self):
  a=np.array([0,1.001,1.,2.]).reshape(4,1,1);h,c=m.intervals(a,[0,1,2,3],[{'start':0,'kind':'accum','error':.001}]*4)
  self.assertTrue(np.all(h[1:]>=0));self.assertEqual(c[-1,0,0],2);self.assertTrue(np.all(np.abs(c-a)<=.001+1e-12))
 def test_bad_solar_interval_stays_missing(self):
  a=np.array([0,10,4.]).reshape(3,1,1);h,c=m.intervals(a,[0,1,2],[{'start':0,'kind':'avg'}]*3,True)
  self.assertEqual(h[1,0,0],10);self.assertTrue(np.isnan(h[2,0,0]))
 def test_canvas_header_and_component_order(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'a.bin';m.write_bin(p,[np.ones((7,2,3)),np.full((7,2,3),2.)]);raw=p.read_bytes();self.assertEqual(struct.unpack('<HHHH',raw[:8]),(2,3,7,2));self.assertEqual(len(raw),16+7*2*2*3*4);self.assertEqual(np.frombuffer(raw[16:],dtype='<f4')[6],2)
class Downloads(unittest.TestCase):
 def test_resume_validated_range(self):
  from unittest.mock import patch
  from types import SimpleNamespace
  import json
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'raw.bz2';p.write_bytes(b'abc');p.with_suffix('.source.json').write_text(json.dumps({'url':'https://dwd.test/file','bytes':6,'etag':'"v1"'}))
   def run(args,**kwargs):
    if '-fsSI' in args:return SimpleNamespace(stdout='content-length: 6\netag: "v1"\n')
    self.assertEqual(args[args.index('--range')+1],'3-5');Path(args[args.index('-D')+1]).write_text('HTTP/2 206\ncontent-range: bytes 3-5/6\n');Path(args[args.index('-o')+1]).write_bytes(b'def');return SimpleNamespace(returncode=0)
   with patch.object(m.subprocess,'run',side_effect=run):self.assertEqual(m.source_package('https://dwd.test/file',p),b'abcdef')
 def test_wrong_range_rejected(self):
  from unittest.mock import patch
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory() as d:
   def run(args,**kwargs):
    if '-fsSI' in args:return SimpleNamespace(stdout='content-length: 6\netag: "v1"\n')
    Path(args[args.index('-D')+1]).write_text('HTTP/2 200\n');Path(args[args.index('-o')+1]).write_bytes(b'abcdef');return SimpleNamespace(returncode=0)
   with patch.object(m.subprocess,'run',side_effect=run):
    with self.assertRaises(ValueError):m.source_package('https://dwd.test/file',Path(d)/'raw.bz2')
if __name__=='__main__':unittest.main()

