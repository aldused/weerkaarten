import datetime as dt,io,tempfile,unittest
from pathlib import Path
from PIL import Image
import numpy as np
from automatic_fronts import prepare,render
class AutomaticFrontTests(unittest.TestCase):
 def test_exact_cycle_zero_padded_analysis_and_no_black_or_red_contours(self):
  pixels=np.full((540,800,3),255,dtype='uint8');pixels[250:255,400:450]=[0,50,254];pixels[300:305,400:450]=[251,5,4];pixels[350:355,400:450]=0
  buffer=io.BytesIO();Image.fromarray(pixels).save(buffer,format='GIF')
  run=dt.datetime(2026,10,19,12,tzinfo=dt.timezone.utc);frames=[dict(day=19,valid='2026-10-19T12:00:00Z')]
  url='https://data.consumer-digital.api.metoffice.gov.uk/v1/surface-pressure/colour/2026-10-19T1200/FSXX12T_00.gif'
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder);out=path/'out';out.mkdir()
   meta=prepare(run,frames,[url],lambda _:buffer.getvalue(),path)
   self.assertFalse(meta['reviewed']);self.assertFalse(meta['troughsAvailable']);self.assertEqual(meta['frames']['19']['source'],url)
   mask=np.asarray(Image.open(path/'19-automatic-fronts.png'))
   self.assertTrue(np.all(mask[252,400:450,3]>220));self.assertTrue(np.all(mask[302,400:450,3]==0));self.assertTrue(np.all(mask[352,400:450,3]==0))
   render(path,out,meta);self.assertIn('#0032fe',(out/'19-fronts.svg').read_text())
   with self.assertRaisesRegex(ValueError,'kleurenbron'):prepare(run+dt.timedelta(hours=12),frames,[url],lambda _:buffer.getvalue(),path)
if __name__=='__main__':unittest.main()
