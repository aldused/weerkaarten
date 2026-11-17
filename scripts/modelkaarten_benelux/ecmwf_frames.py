"""Lees ECMWF IFS-rasters en aanvullende velden voor de Benelux."""
import base64
from datetime import datetime, timedelta, timezone
import gzip
import json
from pathlib import Path
import sys
from threading import local
import time

import numpy as np
from PIL import Image
import requests
from requests.adapters import HTTPAdapter

HERE = Path(__file__).resolve().parent
ROOT = Path('/Users/aldus/KNMI_Project')
MIRROR = 'https://storage.googleapis.com/ecmwf-open-data'
# Extra rasterrand voor interpolatie tot aan de schermrand.
WEST, SOUTH, EAST, NORTH = 1.7, 48.8, 8.4, 54.3
FIELDS = ('t2m', 'ws', 'tcc', 'rain', 'snow', 'fzra', 'ipel', 'vis', 'msl', 'ptot', 't850', 't500', 'sdep')
THREAD = local()
PRECIP_TYPES = {1: 1, 5: 2, 6: 3, 7: 4, 3: 5, 8: 6, 12: 7}


def read_json(path):
    return json.loads(path.read_text())


def atomic(path, data):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_bytes(data)
    temp.replace(path)


def http(url, headers=None):
    if not hasattr(THREAD, 'session'):
        THREAD.session = requests.Session()
        THREAD.session.headers['User-Agent'] = 'Weerlab Benelux (+https://weerlab.nl)'
        # urllib3.future kan via Alt-Svc QUIC kiezen; houd grote Range-requests op TCP.
        try:
            from urllib3.backend import HttpVersion
        except ImportError:
            pass
        else:
            class TCPAdapter(HTTPAdapter):
                def init_poolmanager(self, *args, **kwargs):
                    return super().init_poolmanager(*args, **kwargs, disabled_svn={HttpVersion.h3})
            THREAD.session.mount('https://', TCPAdapter())
    for i in range(3):
        try:
            res = THREAD.session.get(url, headers=headers, timeout=(7, 22))
            if res.status_code == 404:
                return None
            if res.status_code in (429, 500, 502, 503, 504) and i < 2:
                time.sleep(2 ** i)
                continue
            res.raise_for_status()
            return res
        except (requests.Timeout, requests.ConnectionError):
            if i == 2:
                raise
            time.sleep(2 ** i)


def crop_bounds(grid):
    def index(value, start, step):
        return round((value - start) / step)
    a, b = index(WEST, grid['lon0'], grid['dlon']), index(EAST, grid['lon0'], grid['dlon'])
    c, d = index(NORTH, grid['lat0'], grid['dlat']), index(SOUTH, grid['lat0'], grid['dlat'])
    if not (0 <= a <= b < grid['nx'] and 0 <= c <= d < grid['ny']):
        raise ValueError('Benelux valt buiten het bronraster')
    return a, c, b + 1, d + 1


def crop_grid(grid, bounds):
    left, top, right, bottom = bounds
    return dict(lon0=round(grid['lon0']+left*grid['dlon'], 8),
                lat0=round(grid['lat0']+top*grid['dlat'], 8),
                dx=grid['dlon'],dy=grid['dlat'],w=right-left,h=bottom-top)


def raw_field(base, rec, lead, grid, gust=False):
    import eccodes as grib
    off, length = rec['_offset'], rec['_length']
    end = off + length - 1
    res = http(base + '.grib2', {'Range': f'bytes={off}-{end}'})
    if res is None:
        return None
    if res.status_code != 206 or not res.headers.get('Content-Range', '').startswith(f'bytes {off}-{end}/') or len(res.content) != length:
        raise ValueError(f'Onjuiste byte-range voor {rec["param"]}')
    gid = grib.codes_new_from_message(res.content)
    try:
        get = lambda k: grib.codes_get(gid, k)
        period = lead - get('startStep') if gust else None
        if get('endStep') != lead or (gust and (get('stepType') != 'max' or period not in (1, 3, 6))):
            return None
        if rec['param'] == 'ssrd' and (get('stepType') != 'accum' or get('startStep') != 0):
            return None
        nx, ny = get('Ni'), get('Nj')
        dlon, dlat = get('iDirectionIncrementInDegrees'), get('jDirectionIncrementInDegrees')
        if (abs(dlon - grid['dx']) > 1e-6 or abs(dlat + grid['dy']) > 1e-6
                or get('iScansNegatively') or get('jScansPositively') or get('jPointsAreConsecutive')
                or get('alternativeRowScanning')):
            raise ValueError('Onverwacht GRIB-raster')
        lat0, lon0 = get('latitudeOfFirstGridPointInDegrees'), get('longitudeOfFirstGridPointInDegrees')
        i = round(((grid['lon0'] - lon0) % 360) / dlon) % nx
        j = round((lat0 - grid['lat0']) / dlat)
        w, h = grid['w'], grid['h']
        if not 0 <= j <= ny - h:
            raise ValueError('Onverwacht GRIB-domein')
        v = grib.codes_get_values(gid).reshape(ny, nx)[j:j + h][:, (i + np.arange(w)) % nx]
        if get('bitmapPresent'):
            v[v == get('missingValue')] = np.nan
        return (v, period) if gust else v
    finally:
        grib.codes_release(gid)


def enrich(run, lead, cache, mirror, grid):
    target = cache / f'{run}-{lead:03}.npz'
    fields = {}
    if target.exists():
        with np.load(target, allow_pickle=False) as saved:
            fields.update(saved)
    want_gust = lead > 0 and not any(f'g{n}' in fields for n in (1, 3, 6))
    want_type = 'ptype' not in fields
    want_solar = lead > 0 and 'ssrd' not in fields
    if not (want_type or want_gust or want_solar):
        return fields
    resolution, suffix = ('0p1', '-sfc') if grid['dx']==.1 else ('0p25', '')
    base = f'{mirror}/{run[:8]}/{run[8:]}z/ifs/{resolution}/oper/{run}0000-{lead}h-oper-fc{suffix}'
    try:
        index = http(base + '.index')
        if index is None:
            return fields
        recs = [json.loads(line) for line in index.text.splitlines() if line.strip()]
        rows = {x['param']: x for x in recs if x.get('levtype') == 'sfc'}
        if want_gust:
            for k in ('10fg3', '10fg6', '10fg'):
                if k not in rows:
                    continue
                result = raw_field(base, rows[k], lead, grid, gust=True)
                if result is not None:
                    v, period = result
                    fields[f'g{period}'] = np.where(np.isfinite(v), np.clip(np.rint(v * 3.6), 0, 254), 255).astype('uint8')
                    break
        if want_type and 'ptype' in rows:
            v = raw_field(base, rows['ptype'], lead, grid)
            if v is not None:
                t = np.full(v.shape, 255, 'uint8')
                t[v == 0] = 0
                for code, display in PRECIP_TYPES.items():
                    t[v == code] = display
                fields['ptype'] = t
        if want_solar and 'ssrd' in rows:
            v = raw_field(base, rows['ssrd'], lead, grid)
            if v is not None:
                fields['ssrd'] = v.astype('float32')
    except (requests.RequestException, ValueError, RuntimeError) as exc:
        print(f'{run} +{lead}: {exc}', file=sys.stderr)
    if fields:
        temp = target.with_suffix('.tmp.npz')
        np.savez_compressed(temp, **fields)
        temp.replace(target)
    return fields


def sunshine_minutes(end, hours, energy, grid):
    """Schat zonneduur in een modelinterval uit globale straling en zonnestand."""
    phi = np.radians(grid['lat0']+np.arange(grid['h'])*grid['dy'])[:, None]
    lon = (grid['lon0']+np.arange(grid['w'])*grid['dx'])[None, :]
    potential = np.zeros_like(energy, dtype='float64')
    daylight = np.zeros_like(potential)
    for minute in range(hours * 60):
        t = end - timedelta(minutes=minute + .5)
        g = 2 * np.pi / 365 * (t.timetuple().tm_yday - 1 + (t.hour - 12) / 24)
        eot = 229.18 * (.000075 + .001868*np.cos(g) - .032077*np.sin(g) - .014615*np.cos(2*g) - .040849*np.sin(2*g))
        dec = (.006918 - .399912*np.cos(g) + .070257*np.sin(g) - .006758*np.cos(2*g)
               + .000907*np.sin(2*g) - .002697*np.cos(3*g) + .00148*np.sin(3*g))
        ha = np.radians((t.hour*60+t.minute+t.second/60+eot+4*lon)/4 - 180)
        cosz = np.sin(phi)*np.sin(dec) + np.cos(phi)*np.cos(dec)*np.cos(ha)
        positive = np.maximum(cosz, 1e-6)
        # Haurwitz-benadering van globale straling bij heldere hemel (W/m²).
        potential += 60 * 1098 * positive * np.exp(-.059 / positive)
        daylight += cosz > np.sin(np.radians(3))
    clear_fraction = np.clip(energy / np.maximum(potential, 1), 0, 1)
    # Indicatieve vertaling van globale straling naar fractie met zon, begrensd
    # door de tijd dat de zon hoog genoeg staat. Er is geen minutendata.
    sunny = np.clip((clear_fraction - .30) / .60, 0, 1) * daylight
    return np.where(np.isfinite(sunny), np.rint(sunny / 2), 255).astype('uint8')


def write_frame(src, lead, info, bounds, grid, uvgrid, supplement):
    available = info['layers']
    w, h = bounds[2] - bounds[0], bounds[3] - bounds[1]
    blank = np.zeros((h, w), 'uint8')
    layers = dict(supplement)
    if lead == 0:
        layers['ptot'] = blank
    check_shape = (grid['nx'], grid['ny'])
    for key in FIELDS:
        if key in available:
            with Image.open(src / f'{lead:03d}' / f'{key}.png') as im:
                if im.size != check_shape or im.mode != 'L':
                    raise ValueError(f'Onverwachte afmetingen/codering voor {src.name} {lead} {key}')
                layers[key] = np.asarray(im.crop(bounds))
    if 'uv' in available:
        with Image.open(src / f'{lead:03d}' / 'uv.png') as im:
            if im.width == uvgrid['nx'] and im.height == uvgrid['ny'] * 2:
                uv = np.asarray(im)
                uidx = np.rint((grid['lon0'] + np.arange(bounds[0], bounds[2]) * grid['dlon'] - uvgrid['lon0']) / uvgrid['dlon']).astype(int)
                vidx = np.rint((grid['lat0'] + np.arange(bounds[1], bounds[3]) * grid['dlat'] - uvgrid['lat0']) / uvgrid['dlat']).astype(int)
                layers['u'] = uv[np.ix_(vidx, uidx)]
                layers['v'] = uv[np.ix_(vidx + uvgrid['ny'], uidx)]
    keys = [k for k in (*FIELDS, 'u', 'v', 'g1', 'g3', 'g6', 'ptype', 'sun') if k in layers]
    if any(layers[k].shape != blank.shape for k in keys):
        raise ValueError('Afmetingen van deelrasters komen niet overeen')
    data = base64.b64encode(gzip.compress(b''.join(layers[k].tobytes() for k in keys), compresslevel=4, mtime=0)).decode()
    return dict(lead=lead, valid=info['valid'], keys=keys, data=data,
                gustPeriod=next((n for n in (3, 1, 6) if f'g{n}' in layers), None))
