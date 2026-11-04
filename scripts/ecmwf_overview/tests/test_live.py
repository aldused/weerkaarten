import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pipeline'))
spec = importlib.util.spec_from_file_location('live_publish_test', ROOT / 'pipeline/publish.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class LiveTests(unittest.TestCase):
    def test_all_manifests_before_index(self):
        calls = []
        def rc(*args, **kwargs):
            payload = pathlib.Path(args[1]).read_text() if args[0] == 'copyto' else None
            calls.append((args, payload))
        live = p.LivePublisher.__new__(p.LivePublisher)
        live.model = 'ecmwf'
        live.static_done = True
        batch = [('2026110400', 0, '{"steps":{"0":{}}}', b'{"default":"2026110400"}'),
                 ('2026110318', 3, '{"steps":{"3":{}}}', b'{"default":"2026110400"}')]
        with patch.object(p, 'rc', rc):
            live._upload(batch)
        targets = [args[2] for args, _ in calls]
        self.assertTrue(targets[-1].endswith('/runs.json'))
        self.assertTrue(targets[-3].endswith('/2026110400/manifest.json'))
        self.assertTrue(targets[-2].endswith('/2026110318/manifest.json'))
        self.assertEqual(json.loads(calls[-3][1])['steps'], {'0': {}})

    def test_failed_batch_is_retried_before_new_manifest(self):
        import queue
        live = p.LivePublisher.__new__(p.LivePublisher)
        live.q = queue.Queue()
        live.q.put(('run', 0, 'first', b'index'))
        attempts = []
        def upload(batch):
            attempts.append(list(batch))
            if len(attempts) == 1:
                live.q.put(('run', 3, 'second', b'index'))
                live.q.put(None)
                raise OSError('temporary failure')
        live._upload = upload
        live._loop()
        self.assertEqual([b[1] for b in attempts[1]], [0, 3])

if __name__ == '__main__':
    unittest.main()
