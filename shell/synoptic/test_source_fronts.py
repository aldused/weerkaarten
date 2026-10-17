import hashlib,json,tempfile,unittest
from pathlib import Path
import numpy as np
from PIL import Image
from prepare_front_sources import colour_masks,PALETTE
from source_fronts import source_review,source_coordinates,vector_paths
HERE=Path(__file__).parent
REVIEW=HERE/'fronts'/'20261016T12-source'
class SourceFrontTests(unittest.TestCase):
 def setUp(self):
  self.metadata=json.loads((REVIEW/'source.json').read_text());self.frames=[dict(day=int(day),valid=entry['valid']) for day,entry in self.metadata['frames'].items()]
 def test_source_cycle_date_and_checksums(self):
  source_review(REVIEW,'2026-10-16T12:00:00Z',self.frames)
  with self.assertRaisesRegex(ValueError,'andere modelrun'):source_review(REVIEW,'2026-10-17T00:00:00Z',self.frames)
  wrong=[dict(self.frames[0],valid='2026-10-18T12:00:00Z')]
  with self.assertRaisesRegex(ValueError,'geldigheid'):source_review(REVIEW,'2026-10-16T12:00:00Z',wrong)
 def test_modified_front_mask_rejected(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder);meta=json.loads(json.dumps(self.metadata));day=str(self.frames[0]['day']);meta['frames'][day]['sha256']='0'*64
   (path/'source.json').write_text(json.dumps(meta));(path/f'{day}-fronts-source.png').write_bytes((REVIEW/f'{day}-fronts-source.png').read_bytes())
   with self.assertRaisesRegex(ValueError,'na controle gewijzigd'):source_review(path,'2026-10-16T12:00:00Z',self.frames[:1])
 def test_geographic_control_point_london(self):
  x,y=source_coordinates(-.12,51.5)
  self.assertAlmostEqual(float(x),445,delta=.1);self.assertAlmostEqual(float(y),290,delta=.1)
 def test_original_coloured_front_ink_retained_without_thickness_contours(self):
  # Exact source glyph pixels must retain their type and pixel position.
  for frame in self.frames:
   day=frame['day'];reference=np.asarray(Image.open(REVIEW/f'{day}-front-reference.png'));mask=np.asarray(Image.open(REVIEW/f'{day}-fronts-source.png'))
   for color in PALETTE.astype('uint8'):
    source=np.all(reference==color,axis=2)
    self.assertGreater(int(source.sum()),100)
    self.assertTrue(np.all(mask[source,3]>=220),f'Missing glyph pixels on day {day}')
    self.assertTrue(np.all(mask[source,:3]==color),f'Wrong front type on day {day}')
   thickness=np.all(reference==[251,5,4],axis=2)
   self.assertTrue(np.all(mask[thickness,3]==0),f'Thickness contours mistaken for fronts on day {day}')
 def test_vectorization_preserves_separate_colours_and_internal_glyph_holes(self):
  pixels=np.zeros((60,60,4),dtype='uint8')
  pixels[10:35,10:35]=[0,50,254,255];pixels[18:25,18:25,3]=0
  pixels[45:48,10:45]=[254,50,0,255]
  paths=list(vector_paths(Image.fromarray(pixels)))
  self.assertEqual({p[0] for p in paths},{'#0032fe','#fe3200'})
  blue=[p for p in paths if p[0]=='#0032fe']
  self.assertTrue(any(np.count_nonzero(p[2]==1)>1 for p in blue),'Weakening-cross/glyph hole was filled')
 def test_vectorization_does_not_bridge_one_pixel_source_gap(self):
  pixels=np.zeros((30,30,4),dtype='uint8')
  pixels[12:15,3:14]=[0,50,254,255];pixels[12:15,15:27]=[0,50,254,255]
  self.assertEqual(len(list(vector_paths(Image.fromarray(pixels)))),2)
if __name__=='__main__':unittest.main()
