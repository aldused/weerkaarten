import re,unittest
import numpy as np
from PIL import Image,ImageDraw
from normalized_fronts import svg,baselines,side_of_symbols,join_paths
class NormalizedFrontTests(unittest.TestCase):
 def mask(self,side):
  image=Image.new('RGBA',(800,540));draw=ImageDraw.Draw(image)
  draw.line([(380,300),(480,300)],fill=(0,50,254,255),width=2)
  for x in [400,430,460]:draw.polygon([(x-5,300),(x+5,300),(x,300+side*8)],fill=(0,50,254,255))
  return image
 def test_symbols_have_fixed_size_and_thin_lines(self):
  text=svg(self.mask(-1))
  self.assertIn('data-front-line="cold"',text);self.assertIn('data-front-symbol="cold"',text)
  self.assertEqual(set(re.findall(r'stroke-width="([0-9.]+)"',text)),{'4.4','2.2','.5'})
  self.assertTrue(all(s in ['1,-1','1,1'] for s in re.findall(r'scale\(([^)]+)\)',text)))
  self.assertNotIn('fill-rule="evenodd"',text)
 def test_front_side_follows_original_symbols(self):
  for side in [-1,1]:
   mask=np.asarray(self.mask(side))[:,:,3]>0
   points=np.column_stack([np.linspace(380,480,100),np.full(100,300.)])
   self.assertEqual(side_of_symbols(mask,points),side)
 def test_glyph_spurs_do_not_become_long_front_branches(self):
  mask=np.asarray(self.mask(-1))[:,:,3]>0
  paths=list(join_paths(baselines(mask)))
  main=max(paths,key=len)
  self.assertLess(float(np.ptp(main[:,1])),4)
  self.assertGreater(float(np.ptp(main[:,0])),90)
 def test_visible_official_source_fronts_are_not_dropped(self):
  from pathlib import Path
  from scipy.spatial import cKDTree
  from source_fronts import source_to_screen
  from normalized_fronts import PALETTE
  source=Path(__file__).parent/'fronts'/'20261016T12-source'
  for day in range(17,22):
   rgba=np.asarray(Image.open(source/f'{day}-fronts-source.png'))
   for kind,color,_ in PALETTE:
    mask=np.all(rgba[:,:,:3]==color,axis=2)&(rgba[:,:,3]>90)
    points=np.argwhere(mask)[:,::-1];screen=source_to_screen(points)
    points=points[(screen[:,0]>0)&(screen[:,0]<1400)&(screen[:,1]>0)&(screen[:,1]<880)]
    if not len(points):continue
    paths=list(join_paths(baselines(mask)))
    self.assertTrue(paths,f'{day} {kind}: missing front')
    errors=cKDTree(np.vstack(paths)).query(points)[0]
    self.assertLess(float(np.percentile(errors,99)),12,f'{day} {kind}: misplaced or missing branch')
 def test_separate_parallel_fronts_remain_separate(self):
  mask=np.zeros((100,100),bool);mask[30,10:90]=True;mask[55,10:90]=True
  paths=list(join_paths(baselines(mask)))
  self.assertEqual(len(paths),2)
if __name__=='__main__':unittest.main()
