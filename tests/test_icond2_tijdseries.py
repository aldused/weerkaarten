import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location('icond2_ts',Path(__file__).resolve().parents[1]/'scripts/icond2_tijdseries.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class TestICONAdapter(unittest.TestCase):
    def fixture(self,root):
        g=dict(n_lat=2,n_lon=2,lat_min=50.,lat_max=51.,lon_min=4.,lon_max=5.)
        meta=dict(run_utc='2026-10-24T23:00:00Z',uren=3,tijden=['2026-10-25T02:00','2026-10-25T02:00','2026-10-25T03:00'],grid=g,parameters={})
        fields={'temp':np.full((3,1,2,2),10.),'dauwpunt':np.full((3,1,2,2),5.),'wind':np.full((3,2,2,2),3.),'windstoten':np.full((3,2,2,2),4.),'druk':np.full((3,1,2,2),101500.),'bewolking':np.full((3,3,2,2),.5)}
        fields['wind'][:,1]=4;fields['windstoten'][:,1]=0;fields['temp'][1,0,0,0]=np.nan
        for key,a in fields.items():
            fn=key+'.bin'; nc=a.shape[1]
            (root/fn).write_bytes(struct.pack('<4H',2,2,3,nc)+bytes(8)+a.astype('<f4').tobytes())
            meta['parameters'][key]={'file':fn,'components':nc}
        (root/'icond2_canvas_meta.json').write_text(json.dumps(meta));return meta
    def test_values_units_and_dst(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.fixture(root);rd=module.build(root)
            self.assertEqual(rd.leads,[1,2,3]);self.assertEqual(rd.model,'icond2')
            self.assertEqual(rd.values['msl'][0,0,0],1015.)
            self.assertEqual(rd.values['gust'][0,0,0],4.)
            self.assertEqual(rd.values['lcc'][0,0,0],50.)
            self.assertTrue(np.isnan(rd.values['t2m'][1,0,0]))
            self.assertEqual(rd.windows['gust'],[[0,1],[1,2],[2,3]])
            self.assertNotIn('tcc',rd.values);self.assertNotIn('cbh',rd.values)
    def test_reject_mixed_or_incomplete_source(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);meta=self.fixture(root)
            (root/'temp.bin').write_bytes((root/'temp.bin').read_bytes()[:-4])
            with self.assertRaisesRegex(ValueError,'incompleet'):module.build(root)
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);meta=self.fixture(root);meta['tijden'][0]='2026-10-25T03:00'
            (root/'icond2_canvas_meta.json').write_text(json.dumps(meta))
            with self.assertRaisesRegex(ValueError,'tijdas wijkt af'):module.build(root)

if __name__=='__main__':unittest.main()
