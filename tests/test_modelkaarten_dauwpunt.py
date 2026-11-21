import base64
import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/modelkaarten_benelux'))
import ecmwf_frames as E
import regional_frames as R
import update as U

def data(raw):
    return base64.b64encode(gzip.compress(raw)).decode()

class DewpointTests(unittest.TestCase):
    def test_regional_encoding_keeps_zero_negative_and_unknown(self):
        encoded=R.encode('td2m',np.array([-20,0,12,np.nan]))
        self.assertEqual(encoded.tolist(),[61,101,125,0])

    def test_ecmwf_crop_includes_the_native_dewpoint_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'003').mkdir()
            source=np.array([[61,101],[125,0]],dtype='uint8')
            Image.fromarray(source).save(root/'003/td2m.png')
            step=E.write_frame(root,3,{'layers':['td2m'],'valid':'2026-11-21T03:00Z'},
                               (0,0,2,2),{'nx':2,'ny':2},{},{})
            self.assertEqual(step['keys'],['td2m'])
            self.assertEqual(gzip.decompress(base64.b64decode(step['data'])),source.tobytes())

    def test_complete_ecmwf_steps_are_backfilled_without_refetching_other_fields(self):
        grid={'nx':2,'ny':2,'lon0':0,'lat0':1,'dlon':1,'dlat':-1}
        enc={'td2m':R.ENC['td2m']}
        keys=['t2m','tcc','rain','t850','t500','sdep','ptype','sun','g3','frz']
        raw=b''.join(bytes([i])*4 for i in range(len(keys)))
        old={'enc':enc,'_build_key':25,'steps':[{'lead':3,'valid':'2026-11-21T03:00Z','keys':keys.copy(),'data':data(raw)}]}
        m={'grid':grid,'grid_uv':{},'enc':enc,'pipeline':25,'run_time':'2026-11-21T00:00Z',
           'steps':{'3':{'valid':'2026-11-21T03:00Z','layers':{'td2m':1}}}}
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'2026112100/003').mkdir(parents=True)
            dew=np.array([[61,101],[125,0]],dtype='uint8')
            Image.fromarray(dew).save(root/'2026112100/003/td2m.png')
            with patch.object(U,'crop_bounds',return_value=(0,0,2,2)),patch.object(U,'enrich',side_effect=AssertionError('Unnecessary refetch')):
                _,new=U.ecmwf_run(root,'2026112100',json.dumps(m).encode(),root/'cache',old)
            step=new['steps'][0]
            self.assertEqual(step['keys'],keys+['td2m'])
            self.assertEqual(gzip.decompress(base64.b64decode(step['data'])),raw+dew.tobytes())
            self.assertEqual(old['steps'][0]['keys'],keys)

    def test_existing_complete_regional_fields_survive_partial_supplement_failure(self):
        stamp='2026-11-21T03:00:00+00:00'
        old={'id':'2026112100','enc':{},'_complete':True,
             'steps':[{'lead':3,'valid':stamp,'keys':['t2m','frz'],'data':data(b'A'*8)}]}
        fresh={'id':old['id'],'enc':R.ENC,
               'steps':[{'lead':3,'valid':stamp,'keys':['t2m','td2m'],'data':data(b'B'*4+b'D'*4)}]}
        with tempfile.TemporaryDirectory() as temp:
            project=Path(temp);(project/'weerlab').mkdir()
            raw=b'{}';(project/'weerlab/harmonie_canvas_meta.json').write_bytes(raw)
            old['_source']=U.digest(raw)
            with patch.object(U,'native_model',return_value=fresh),patch.object(U,'GRID',{'w':2,'h':2}):
                _,runs=U.regional('harmonie',project,project/'cache',[old])
            self.assertEqual(runs[0]['steps'][0]['keys'],['t2m','frz','td2m'])
            self.assertEqual(gzip.decompress(base64.b64decode(runs[0]['steps'][0]['data'])),b'A'*8+b'D'*4)
            self.assertEqual(old['steps'][0]['keys'],['t2m','frz'])

if __name__=='__main__':
    unittest.main()
