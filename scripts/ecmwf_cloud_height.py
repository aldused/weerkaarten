#!/usr/bin/env python3
"""Native ECMWF CBH from FCOO's public, fixed-run OPeNDAP dataset.

Only a Benelux subset is requested. CBH is converted from packed feet to
metres AGL and its own source run is retained separately from Open-Meteo.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import tempfile
from zoneinfo import ZoneInfo

import numpy as np
import requests

BASE = 'https://data.fcoo.dk/webmap/v2/data/NETCDF/ECMWF/DYSD/'
NO_BASE = 9999.0


def get(url):
    r = requests.get(url, timeout=(10, 90))
    r.raise_for_status()
    return r.content


def dap_arrays(blob):
    header, data = blob.split(b'\nData:\n', 1)
    declarations = re.findall(r'(Float32|Float64|Int16)\s+(\w+)((?:\[[^\]]+\])+);', header.decode())
    offset, arrays = 0, {}
    for dtype, name, dims in declarations:
        shape = tuple(int(n) for n in re.findall(r'=\s*(\d+)\]', dims))
        count, duplicate = struct.unpack_from('>II', data, offset)
        offset += 8
        if count != duplicate or count != int(np.prod(shape)):
            raise ValueError('Invalid OPeNDAP array length')
        # DAP2 shorts are transmitted as signed 32-bit XDR integers.
        dt = {'Float32': '>f4', 'Float64': '>f8', 'Int16': '>i4'}[dtype]
        values = np.frombuffer(data, dtype=dt, count=count, offset=offset).reshape(shape).copy()
        offset += values.nbytes
        arrays[name] = values
    if offset != len(data):
        raise ValueError('Unexpected trailing/truncated OPeNDAP data')
    return arrays


def decode_height(raw, scale, bias, fill):
    # The native CBH field has no diagnosed base when its fill marker is set.
    # Do not call this "clear sky": the diagnostic excludes ground-level fog.
    feet = raw.astype(np.float64) * scale + bias
    return np.where((raw == fill) | (feet < 0), NO_BASE, feet * 0.3048).astype(np.float32)


def interpolate_times(data, source_seconds, wanted_seconds):
    out = np.full((len(wanted_seconds),) + data.shape[1:], np.nan, dtype=np.float32)
    for i, t in enumerate(wanted_seconds):
        after = int(np.searchsorted(source_seconds, t))
        if after < len(source_seconds) and source_seconds[after] == t:
            out[i] = data[after]
        elif 0 < after < len(source_seconds):
            before = after - 1
            weight = (t - source_seconds[before]) / (source_seconds[after] - source_seconds[before])
            a, b = data[before], data[after]
            heights = (a != NO_BASE) & (b != NO_BASE) & np.isfinite(a) & np.isfinite(b)
            no_base = (a == NO_BASE) & (b == NO_BASE)
            out[i] = np.where(no_base, NO_BASE, np.where(heights, a * (1-weight) + b * weight, np.nan))
    return out


def update(root, upload=False):
    path = root / 'ecmwf_om_canvas_meta.json'
    original = path.read_bytes()
    meta = json.loads(original)
    names = re.findall(r'href="(ECMWF_DYSD_(\d{10})\.nc)(?:\.html)?"', get(BASE).decode())
    if not names:
        raise ValueError('No ECMWF fixed-run datasets found')
    name, run_key = sorted(set(names), key=lambda item: item[1])[-1]
    run = datetime.strptime(run_key, '%Y%m%d%H').replace(tzinfo=timezone.utc)
    if (datetime.now(timezone.utc) - run).total_seconds() > 36 * 3600:
        raise ValueError('ECMWF cloud-base source is more than 36 hours old')
    source_run = run.isoformat().replace('+00:00', 'Z')
    if meta['parameters'].get('wolkenbasis', {}).get('source_run_utc') == source_run:
        print('ECMWF: native cloud base already present for this feed/source run', flush=True)
        return
    url = BASE + name
    attrs = get(url + '.das').decode()
    def attribute(field, attr, quoted=False):
        section = re.search(r'\n    '+field+r' \{(.*?)\n    \}', attrs, re.S)
        if section is None:
            raise ValueError(f'Missing metadata for {field}')
        pattern = r'\b'+attr+r'\s+"([^"]+)";' if quoted else r'\b'+attr+r'\s+([^;]+);'
        found = re.search(pattern, section.group(1))
        if found is None:
            raise ValueError(f'Missing {field}.{attr}')
        return found.group(1) if quoted else float(found.group(1))
    if attribute('CBH', 'units', True) != 'feet' or attribute('CBH', 'code') != 23 or attribute('CBH', 'table') != 228:
        raise ValueError('Unexpected cloud-base parameter/units')
    units = attribute('time', 'units', True)
    if not units.startswith('seconds since '):
        raise ValueError('Unsupported source time units')
    epoch = datetime.fromisoformat(units[14:]).replace(tzinfo=timezone.utc)
    if epoch != run:
        raise ValueError('Fixed-run filename and source time epoch disagree')
    coords = dap_arrays(get(url + '.dods?time,lat,lon'))
    lat, lon = coords['lat'], coords['lon']
    source_seconds = coords['time'].astype(np.float64)
    if len(source_seconds) < 2 or not np.all(np.diff(source_seconds) > 0):
        raise ValueError('Invalid cloud-base time axis')
    grid = meta['grid']
    yi = np.where((lat >= grid['lat_min']-0.1) & (lat <= grid['lat_max']+0.1))[0]
    xi = np.where((lon >= grid['lon_min']-0.1) & (lon <= grid['lon_max']+0.1))[0]
    if not len(yi) or not len(xi):
        raise ValueError('Source does not cover the canvas domain')
    query = f'CBH[0:1:{len(source_seconds)-1}][{yi[0]}:1:{yi[-1]}][{xi[0]}:1:{xi[-1]}]'
    subset = dap_arrays(get(url + '.dods?' + query))
    if not np.array_equal(subset['time'], coords['time']):
        raise ValueError('Source times changed during download')
    heights = decode_height(subset['CBH'], attribute('CBH','scale_factor'),
                            attribute('CBH','add_offset'), attribute('CBH','_FillValue'))
    wanted_lat = np.linspace(grid['lat_min'], grid['lat_max'], grid['n_lat'])
    wanted_lon = np.linspace(grid['lon_min'], grid['lon_max'], grid['n_lon'])
    y = np.abs(subset['lat'][:,None] - wanted_lat).argmin(axis=0)
    x = np.abs(subset['lon'][:,None] - wanted_lon).argmin(axis=0)
    heights = heights[:, y][:, :, x]
    times = []
    for value in meta['tijden']:
        valid = datetime.fromisoformat(value)
        if valid.tzinfo is None:
            valid = valid.replace(tzinfo=ZoneInfo('Europe/Amsterdam'))
        times.append((valid.astimezone(timezone.utc) - epoch).total_seconds())
    data = interpolate_times(heights, source_seconds, times)
    if not np.isfinite(data).any():
        raise ValueError('Cloud-base source has no overlapping forecast times')
    blob = struct.pack('<HHHH8x', grid['n_lat'], grid['n_lon'], len(times), 1) + data.astype('<f4').tobytes()
    fingerprint = hashlib.sha256(blob).hexdigest()[:12]
    binary = f'ecmwf_om_data_wolkenbasis_{run_key}_{fingerprint}.bin'
    (root / binary).write_bytes(blob)
    meta['parameters']['wolkenbasis'] = {
        'file': binary, 'components': 1, 'unit': 'm', 'kind': 'ecmwf_cbh',
        'label': 'Wolkenbasis ECMWF CBH (m boven grond; 9999 = geen diagnose)',
        'source': 'ECMWF IFS via FCOO; omgezet van feet naar m en naar uurlijkse stappen',
        'source_run_utc': source_run, 'source_url': url + '.html',
        'source_interval_hours': 3, 'clear_sky_value': 9999,
        'attribution': '© ECMWF 2026, CC-BY-4.0; beschikbaar gesteld door FCOO; verwerking Weerlab',
        'valid_until': (epoch + timedelta(seconds=float(source_seconds[-1]))).isoformat().replace('+00:00','Z'),
        'grid': grid,
    }
    if upload:
        subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(root / binary),f'r2:weerlab-harmonie/{binary}',
                        '--header-upload','Content-Type: application/octet-stream',
                        '--header-upload','Cache-Control: public, max-age=86400, immutable'],check=True)
    if path.read_bytes() != original:
        raise RuntimeError('ECMWF canvas metadata changed during download; retry')
    with tempfile.NamedTemporaryFile(mode='w',dir=root,delete=False,suffix='.json') as tmp:
        tmp.write(json.dumps(meta,indent=2,ensure_ascii=False)+'\n')
        temporary = Path(tmp.name)
    if upload:
        subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(temporary),f'r2:weerlab-harmonie/{path.name}',
                        '--header-upload','Content-Type: application/json',
                        '--header-upload','Cache-Control: public, max-age=30'],check=True)
    temporary.replace(path)
    print(f'ECMWF native CBH: run {source_run}, {len(times)} frames, published={upload}',flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--root',type=Path,default=Path('/Users/aldus/KNMI_Project/weerlab'))
    p.add_argument('--upload',action='store_true')
    args = p.parse_args()
    update(args.root,args.upload)
