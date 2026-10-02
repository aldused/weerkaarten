import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
previous_cwd = os.getcwd()
spec = importlib.util.spec_from_file_location('dwd_publication', ROOT / 'scripts/haal_dwd_guidance.py')
dwd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dwd)
os.chdir(previous_cwd)


class DwdPublicationTests(unittest.TestCase):
    def test_failure_preserves_last_good_feed(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'feed.json'
            target.write_text('last good feed')
            with patch.object(sys, 'argv', ['dwd', '--output', str(target)]), patch.object(dwd, 'scrape_dwd', side_effect=RuntimeError('upstream unavailable')):
                with self.assertRaisesRegex(RuntimeError, 'laatste geldige'):
                    dwd.main()
            self.assertEqual(target.read_text(), 'last good feed')

    def test_complete_translation_replaces_feed(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'feed.json'
            with patch.object(sys, 'argv', ['dwd', '--output', str(target)]), patch.object(dwd, 'scrape_dwd', return_value=('German weather source', 'Freitag, den 02.10.2026 um 08 UTC')), patch.object(dwd, 'vertaal_tekst', return_value='Nederlandse verwachting'):
                dwd.main()
            data = json.loads(target.read_text())
            self.assertTrue(all(data[k]['translated'] == 'Nederlandse verwachting' for k in dwd.URLS))
            self.assertEqual(list(Path(folder).iterdir()), [target])


if __name__ == '__main__':
    unittest.main()
