import base64
import gzip
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/modelkaarten_benelux'))
import regional_frames as regional
from update import wire


GRID = {'lon0': 4, 'lat0': 52.025, 'dx': .025, 'dy': -.025, 'w': 4, 'h': 2}
SOURCE_GRID = {'lon_min': 4, 'lon_max': 4.075, 'lat_min': 52, 'lat_max': 52.025,
               'n_lon': 4, 'n_lat': 2}
SHAPE = (GRID['h'], GRID['w'])


def fixture(root, cache, model):
    parameters = {}
    for name, components, value in (
        ('temp', 1, 1), ('dauwpunt', 1, -1.5), ('wind', 2, 0),
        ('windstoten', 2, 0), ('bewolking', 3, 1), ('neerslag', 1, .4),
        ('zicht', 1, 10000), ('druk', 1, 101300), ('zon', 1, 0),
    ):
        file = f'{name}.bin'
        values = np.full((3, components, *SHAPE), value, dtype='<f4')
        (root/file).write_bytes(struct.pack('<4HB7x', *SHAPE, 3, components, 0) + values.tobytes())
        parameters[name] = {'file': file, 'components': components}
    (root/f'{model}_canvas_meta.json').write_text(json.dumps({
        'run_utc': '2026-11-27T12:00:00Z',
        'tijden': [f'2026-11-27T{hour}:00:00Z' for hour in (13, 14, 15)],
        'grid': SOURCE_GRID, 'parameters': parameters,
    }))
    target = cache/f'{model}-2026112712-velden.npz'
    if model.startswith('icond2'):
        np.savez(target, **{'2_ww': np.array([[61, 71, 67, 3], [96, 45, np.nan, 80]])})
        return
    # Op 2 m suggereerde de oude regel sneeuw. Een warme laag daarboven
    # kan de neerslag laten smelten. Voor het kaarttype telt de bron aan de grond.
    prior = np.full(SHAPE, 2)
    rain = prior + [.4, 0, .2, .1]
    snow = prior + [[0, .4, .2, 0], [.001, np.nan, -.3, 0]]
    graupel = prior + [0, 0, 0, .3]
    rain[1] = prior[1]
    graupel[1] = prior[1]
    np.savez(target, **{
        '1_rain_cum': prior, '1_snow_cum': prior, '1_graupel_cum': prior,
        '2_rain_cum': rain, '2_snow_cum': snow, '2_graupel_cum': graupel,
        '2_t850': np.full(SHAPE, 4.5),
        '3_rain_cum': rain + .4, '3_snow_cum': snow,
    })


class PrecipitationTypeTest(unittest.TestCase):
    def test_published_phase_uses_knmi_surface_amounts_or_is_unknown(self):
        self.check_models(('harmonie', 'harmonie46'), 'knmi-p1-surface-hour', [1, 2, 4, 9, 8, 8, 8, 8])

    def test_published_phase_uses_dwd_diagnosis_or_is_unknown(self):
        self.check_models(('icond2', 'icond2ruc'), 'dwd-ww-surface-hour', [1, 2, 5, 8, 8, 8, 8, 1])

    def check_models(self, models, source, types):
        for model in models:
            with self.subTest(model=model), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                cache = root/'cache'
                cache.mkdir()
                assets = root/'assets'
                assets.mkdir()
                fixture(root, cache, model)
                with patch.object(regional, 'GRID', GRID):
                    run = regional.native_model(root, model, cache_dir=cache)
                manifest = wire(model, GRID, [run], assets)
                diagnosed, unknown = manifest['runs'][0]['steps'][1:]
                self.assertEqual(diagnosed['ptypeSource'], source)
                self.assertNotIn('ptypeSource', unknown)
                for step, expected in (
                    (diagnosed, types),
                    (unknown, [8] * 8),
                ):
                    frames = json.loads((assets/step['asset']).read_text())
                    raw = gzip.decompress(base64.b64decode(frames[str(step['lead'])]))
                    fields = dict(zip(step['keys'], np.frombuffer(raw, 'u1').reshape(-1, 8)))
                    self.assertEqual(fields['ptype'].tolist(), expected)
                    self.assertTrue(np.all((fields['rain'] > 0) & (fields['rain'] < 255)))
