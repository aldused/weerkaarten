"""Klimatologie voor de temperatuurafwijking: ERA5 1990-2019 (tools/build_climate.py), 2 m en
850 hPa, op het 0,25°-domein. Ontbreekt een bestand, dan is er gewoon geen afwijkingslaag."""
import math
import os

import numpy as np
from scipy.ndimage import map_coordinates

from config import DOMAIN, ROOT

SRC_STEP = 0.25
_clim = {}


def _load(name):
    path = os.path.join(ROOT, 'climate', f'{name}_clim.npy')
    if name not in _clim and os.path.exists(path):
        _clim[name] = np.load(path, mmap_mode='r')
    return _clim.get(name)


def clim_at(name, valid, lons, lats):
    """t2m of t850: °C op (lats, lons) voor geldigheidstijd `valid` (UTC), of None.
    De bron heeft 00/06/12/18 UTC; 3-uurstappen via harmonischen, want lineair tussen 12 en
    18 UTC mist de middagtop en dan verspringt de afwijking om de 3 uur."""
    c = _load(name)
    if c is None:
        return None
    doy = valid.timetuple().tm_yday - 1
    f0, f1, f2, f3 = (np.asarray(c[h, doy], dtype=np.float32) / 100.0 - 273.15 for h in range(4))
    th = 2 * math.pi * valid.hour / 24
    a = (f0 + f1 + f2 + f3) / 4 + (f0 - f2) / 2 * math.cos(th) + (f1 - f3) / 2 * math.sin(th) \
        + (f0 - f1 + f2 - f3) / 4 * math.cos(2 * th)
    if len(lons) == a.shape[1] and len(lats) == a.shape[0]:
        return a
    jj, ii = np.meshgrid((lons - DOMAIN['lon_min']) / SRC_STEP, (DOMAIN['lat_max'] - lats) / SRC_STEP)
    return map_coordinates(a, [ii, jj], order=1, mode='nearest').astype(np.float32)
