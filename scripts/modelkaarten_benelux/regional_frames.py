"""Bouw de nieuwe Weerlab-modelkaarten met de ECMWF- en regionale bronbestanden."""
import base64
from datetime import datetime, timezone
import gzip
import json
from pathlib import Path
import struct
from zoneinfo import ZoneInfo

import numpy as np

HERE = Path(__file__).resolve().parent
from ecmwf_frames import http, sunshine_minutes

LOCAL = ZoneInfo('Europe/Amsterdam')
UTC = timezone.utc
NATIVE = {
    'harmonie': ('HARMONIE 43', 'KNMI · 2 km'),
    'harmonie46': ('HARMONIE 46', 'KNMI · 2 km · experimenteel'),
    'icond2': ('ICON-D2', 'DWD · 2,2 km'),
    'icond2ruc': ('ICON-D2-RUC', 'DWD · 2,2 km'),
}
GRID = {'lon0': 1.7, 'lat0': 54.3, 'dx': .025, 'dy': -.025, 'w': 269, 'h': 221}
ENC = {
    't2m': dict(kind='linear', offset=-50.5, scale=.5, lo=1),
    'td2m': dict(kind='linear', offset=-50.5, scale=.5, lo=1),
    't850': dict(kind='linear', offset=-70.5, scale=.5, lo=1),
    't500': dict(kind='linear', offset=-70.5, scale=.5, lo=1),
    'frz': dict(kind='linear', offset=-25, scale=25, lo=1),
    'sdep': dict(kind='log2', base=.1, k=20),
    'ws': dict(kind='linear', offset=-.25, scale=.25, lo=1),
    'wuv': dict(kind='linear', offset=-64, scale=.5, lo=1),
    'tcc': dict(kind='linear', offset=-.5, scale=.5, lo=1),
    'vis': dict(kind='linear', offset=-100, scale=100, lo=1),
    'msl': dict(kind='linear', offset=929.5, scale=.5, lo=1),
    'rain': dict(kind='log2', base=.02, k=12),
    'ptot': dict(kind='log2', base=.1, k=16),
}


def extract_bundle(path):
    marker = '<script id="bundle" type="application/json">'
    return json.loads(path.read_text().split(marker, 1)[1].split('</script>', 1)[0])


def add_bytes(step, fields):
    new = {k: v for k, v in fields.items() if k not in step['keys']}
    if not new:
        return
    raw = gzip.decompress(base64.b64decode(step['data']))
    raw += b''.join(new.values())
    step['keys'].extend(new)
    step['data'] = base64.b64encode(gzip.compress(raw, compresslevel=4, mtime=0)).decode()


def harmonie_snow(root, start):
    source = root/'sneeuw/out/harmoniep1'/start.strftime('%Y%m%d%H')
    if not (source/'manifest.json').is_file():
        return {}
    m = json.loads((source/'manifest.json').read_text())
    if (datetime.fromisoformat(m['run_utc']) != start or m['products']['sneeuwhoogte']['encoding'] != 'cm_x2'
            or m['grid']['row0'] != 'north'):
        raise ValueError('Sneeuwcache is geen overeenkomstige HARMONIE-run')
    times = [datetime.fromisoformat(t) for t in m['valid_utc']]
    g = m['grid']
    nx, ny = g['nx'], g['ny']
    raw = gzip.decompress((source/m['files']['sneeuwhoogte/model']).read_bytes())
    if struct.unpack_from('<4s3H',raw) != (b'SNW1',nx,ny,len(times)):
        raise ValueError('Onverwachte kop in het KNMI-sneeuwwerkbestand')
    values = np.frombuffer(raw, dtype='uint8', offset=10).reshape(len(times),ny,nx)
    x = (GRID['lon0']+np.arange(GRID['w'])*GRID['dx']-g['lon_min'])/(g['lon_max']-g['lon_min'])*nx
    y = (g['lat_max']-GRID['lat0']-np.arange(GRID['h'])*GRID['dy'])/(g['lat_max']-g['lat_min'])*ny
    inside = ((y>=0)&(y<ny))[:,None]&((x>=0)&(x<nx))[None,:]
    j = np.clip(np.floor(y).astype(int),0,ny-1)[:,None]
    i = np.clip(np.floor(x).astype(int),0,nx-1)[None,:]
    sampled = values[:,j,i]
    result = np.where(inside&(sampled!=255),sampled/2,np.nan)
    return dict(zip(times,result))


def forecast_times(values, start):
    times = []
    previous = start.timestamp() - 1
    for raw in values:
        wall = datetime.fromisoformat(raw.replace('Z', '+00:00'))
        candidates = [wall] if wall.tzinfo else [wall.replace(tzinfo=LOCAL, fold=f) for f in (0, 1)]
        valid = sorted({d.timestamp() for d in candidates if d.timestamp() > previous
                        and (wall.tzinfo or d.astimezone(UTC).astimezone(LOCAL).replace(tzinfo=None) == wall)})
        if not valid:
            raise ValueError(f'Ongeldige of ongeordende geldigheidstijd: {raw}')
        previous = valid[0]
        times.append(datetime.fromtimestamp(previous, UTC))
    return times


def get_field(root, info, grid, steps):
    path = root / info['file']
    with path.open('rb') as f:
        ny, nx, ns, nc, dtype = struct.unpack('<4HB7x', f.read(16))
    if dtype not in (0, 1, 2) or ns != steps or (nx, ny, nc) != (grid['n_lon'], grid['n_lat'], info['components']):
        raise ValueError(f'Metadata en databestand komen niet overeen: {path.name}')
    width = 4 if dtype == 0 else 1
    if path.stat().st_size != 16 + ny * nx * ns * nc * width:
        raise ValueError(f'Onvolledig databestand: {path.name}')
    values = np.memmap(path, dtype='<f4' if dtype == 0 else 'u1', mode='r', offset=16, shape=(ns, nc, ny, nx))
    x = (GRID['lon0'] + np.arange(GRID['w']) * GRID['dx'] - grid['lon_min']) / (grid['lon_max'] - grid['lon_min']) * (nx-1)
    y = (GRID['lat0'] + np.arange(GRID['h']) * GRID['dy'] - grid['lat_min']) / (grid['lat_max'] - grid['lat_min']) * (ny-1)
    inside = ((0 <= y) & (y <= ny - 1))[:, None] & ((0 <= x) & (x <= nx - 1))[None, :]
    j = np.clip(np.rint(y).astype(int), 0, ny-1)[:, None]
    i = np.clip(np.rint(x).astype(int), 0, nx-1)[None, :]

    def frame(step):
        v = values[step][:, j, i].astype('float32')
        if dtype == 1:
            v = (v / info.get('scale', 16)) ** info.get('power', 2)
        elif dtype == 2:
            v /= 255
        v[:, ~inside] = np.nan
        return v

    return frame


def encode(key, values):
    e = ENC['wuv' if key in ('u', 'v') else key]
    if e['kind'] == 'linear':
        q = np.rint((values - e['offset']) / e['scale'])
        return np.where(np.isfinite(q), np.clip(q, 1, 255), 0).astype('uint8')
    q = np.rint(e['k'] * np.log2(1 + np.maximum(values, 0) / e['base']))
    return np.where(np.isfinite(q), np.clip(q, 0, 254), 255).astype('uint8')


def wet_bulb(temp, dew):
    rh = np.clip(100 * np.exp(17.625 * dew / (243.04 + dew) - 17.625 * temp / (243.04 + temp)), 5, 100)
    return (temp * np.arctan(.151977 * np.sqrt(rh + 8.313659)) + np.arctan(temp + rh)
            - np.arctan(rh - 1.676331) + .00391838 * rh**1.5 * np.arctan(.023101 * rh) - 4.686035)


def native_model(root, key, ruc_solar=False, dwd_levels=False, knmi_levels=False, cache_dir=None):
    meta_path = root / f'{key}_canvas_meta.json'
    before = meta_path.read_bytes()
    meta = json.loads(before)
    start = datetime.fromisoformat(meta['run_utc'].replace('Z', '+00:00')).astimezone(UTC)
    times = forecast_times(meta['tijden'], start)
    leads = [int((t-start).total_seconds() / 3600) for t in times]
    solar = {}
    if ruc_solar and key == 'icond2ruc':
        from ruc_zon import run_radiation
        solar = run_radiation(start, leads, GRID, http)
        print(f'RUC-straling: {len(solar)} uurlijkse velden', flush=True)
    extra = {}
    partial_snow = set()
    if key in ('icond2','icond2ruc'):
        cache = cache_dir or HERE/'.veld-cache'
        if dwd_levels or cache.is_dir():
            from dwd_levels import cached_icon_fields
            extra = cached_icon_fields(cache,key,start,leads,GRID,http if dwd_levels else None)
    if key in ('harmonie','harmonie46'):
        cache = cache_dir or HERE/'.veld-cache'
        if knmi_levels or cache.is_dir():
            from dwd_levels import cached_model_fields
            load = None
            if knmi_levels:
                from knmi_levels import knmi_fields
                load = lambda: knmi_fields(root.parent,key,start,leads,GRID,http)
            expected = {'t850','t500','sdep','frz'}
            extra = cached_model_fields(cache,key,start,leads,expected,load)
        if key == 'harmonie':
            for t, array in harmonie_snow(root.parent,start).items():
                fields = extra.setdefault(t,{})
                if 'sdep' not in fields:
                    fields['sdep'] = array
                    partial_snow.add(t)
    wanted = ('temp', 'dauwpunt', 'wind', 'windstoten', 'bewolking', 'neerslag', 'cumul', 'zicht', 'straling', 'zon', 'druk')
    source = {n: get_field(root, info, info.get('grid') or meta['grid'], len(times))
              for n, info in meta['parameters'].items() if n in wanted}
    steps = []
    running = None
    for i, (t, lead) in enumerate(zip(times, leads)):
        f = {name: read(i) for name, read in source.items()}
        temp = f['temp'][0]
        # De regionale bron publiceert de drie wolkenlagen als fracties.
        clouds = 100 * (1 - np.prod(1 - np.clip(f['bewolking'], 0, 1), axis=0))
        u, v = f['wind']
        out = {'t2m': temp, 'ws': np.hypot(u, v), 'u': u, 'v': v, 'tcc': clouds,
               'vis': f['zicht'][0], 'msl': f['druk'][0]/100, 'rain': f['neerslag'][0]}
        out.update({k: v for k,v in extra.get(t, {}).items() if np.any(np.isfinite(v))})
        if 'dauwpunt' in f:
            out['td2m'] = f['dauwpunt'][0]
        total = f.get('cumul')
        if total is not None:
            out['ptot'] = total[0]
        elif lead == 1 or (i and lead == leads[i-1]+1 and running is not None):
            running = np.maximum(f['neerslag'][0], 0) if lead == 1 else running + np.maximum(f['neerslag'][0], 0)
            out['ptot'] = running
        else:
            running = None
        encoded = {k: encode(k, a) for k, a in out.items()}
        gust = np.hypot(*f['windstoten']) * 3.6
        encoded['gustNative'] = np.where(np.isfinite(gust), np.clip(np.rint(gust), 0, 254), 255).astype('uint8')
        dew = f.get('dauwpunt')
        if dew is not None:
            tw = wet_bulb(temp, dew[0])
            encoded['ptype'] = np.where(np.isfinite(tw), np.where(tw <= .6, 2, np.where(tw <= 1.4, 3, 1)), 8).astype('uint8')
        else:
            encoded['ptype'] = np.full(temp.shape, 8, 'uint8')
        sun_native = 'zon' in f
        if sun_native:
            sun = f['zon'][0]
            encoded['sun'] = np.where(np.isfinite(sun), np.rint(np.clip(sun, 0, 60)/2), 255).astype('uint8')
        elif 'straling' in f:
            encoded['sun'] = sunshine_minutes(t, 1, f['straling'][0]*3600, GRID)
        elif t in solar:
            encoded['sun'] = sunshine_minutes(t, 1, solar[t]*3600, GRID)
        raw = b''.join(a.tobytes() for a in encoded.values())
        steps.append(dict(lead=lead, valid=t.isoformat(), keys=list(encoded),
                          sunHours=1, sunEstimated=not sun_native, gustPeriod=None,
                          snowPartial=t in partial_snow,
                          data=base64.b64encode(gzip.compress(raw, compresslevel=4, mtime=0)).decode()))
    if meta_path.read_bytes() != before:
        raise RuntimeError(f'{key} is bijgewerkt tijdens inlezen. Bouw opnieuw met de nieuwe run.')
    return dict(id=start.strftime('%Y%m%d%H'), time=start.isoformat(), enc=ENC, steps=steps, regional=True)
