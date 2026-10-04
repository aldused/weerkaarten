import copy,importlib.util,json,struct,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import zesluik_runs_archive as archive
class ArchiveTests(unittest.TestCase):
    def fixture(self,source):
        meta={'run_utc':'2026-10-04T06:00:00Z','tijden':['2026-10-04T09:00','2026-10-04T10:00'],'grid':{'n_lat':2,'n_lon':2,'lat_min':50,'lat_max':53,'lon_min':3,'lon_max':7},'parameters':{}}
        for field,nc in [('neerslag',1),('wind',2),('windstoten',1)]:
            name='harmonie_data_'+field+'.bin';path=source/name
            path.write_bytes(struct.pack('<HHHH',2,2,2,nc)+b'\0'*8+struct.pack('<'+'f'*(8*nc),*range(8*nc)))
            meta['parameters'][field]={'file':name,'components':nc}
        archive.atomic_json(source/'harmonie_canvas_meta.json',meta)
        return meta
    def test_snapshot_is_immutable_and_keeps_true_runtime_and_valid_times(self):
        with tempfile.TemporaryDirectory() as d:
            source=Path(d)/'source';store=Path(d)/'store';source.mkdir();meta=self.fixture(source)
            self.assertTrue(archive.capture_local(store,source,'harmonie'));self.assertFalse(archive.capture_local(store,source,'harmonie'))
            path=store/'runcompare/harmonie/20261004T0600Z/meta.json';saved=json.loads(path.read_text())
            self.assertEqual(saved['run_utc'],meta['run_utc']);self.assertEqual(saved['tijden'],['2026-10-04T07:00:00Z','2026-10-04T08:00:00Z'])
            self.assertEqual(saved['parameters']['wind']['binary']['step_bytes'],32);self.assertTrue(archive.manifest(store,'harmonie'));self.assertFalse(archive.manifest(store,'harmonie'))
    def test_partial_or_mixed_exports_are_never_published(self):
        with tempfile.TemporaryDirectory() as d:
            source=Path(d)/'source';store=Path(d)/'store';source.mkdir();meta=self.fixture(source)
            (source/meta['parameters']['wind']['file']).write_bytes(b'incomplete')
            self.assertFalse(archive.capture_local(store,source,'harmonie'));self.assertFalse((store/'runcompare/harmonie/20261004T0600Z/meta.json').exists())
    def test_binary_header_must_match_the_forecast_times_and_components(self):
        with tempfile.TemporaryDirectory() as d:
            source=Path(d);meta=self.fixture(source)
            broken=copy.deepcopy(meta);broken['tijden'].append('2026-10-04T11:00')
            with self.assertRaises(ValueError):archive.binary_info(source/meta['parameters']['wind']['file'],broken,meta['parameters']['wind'])
if __name__=='__main__':unittest.main()
