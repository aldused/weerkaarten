"""Lees DWD druktemperaturen en sneeuwhoogte voor exact dezelfde modelrun."""
import bz2
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from urllib.parse import quote

import eccodes as grib
import numpy as np

from ruc_zon import BASE, map_indices

CLASSIC = 'https://opendata.dwd.de/weather/nwp/icon-d2/grib'
FIELDS = {'t850': (850, 'K'), 't500': (500, 'K'), 'sdep': (None, 'm'), 'frz': (None, 'm')}
SINGLE = {'sdep':'h_snow','frz':'hzerocl'}


def icon_fields(model, start, leads, grid, get):
    ruc = model == 'icond2ruc'
    stamp = start.strftime('%Y%m%d%H')
    cycle = start.strftime('%H')
    ruc_run = quote(start.strftime('%Y-%m-%dT%H:%M'), safe='')

    def filename(field, lead):
        if field in ('CLAT', 'CLON'):
            if ruc:
                return f'{BASE}/{field}/r/{ruc_run}/s/PT000H00M.grib2'
            return f'{CLASSIC}/{cycle}/{field.lower()}/icon-d2_germany_icosahedral_time-invariant_{stamp}_000_0_{field.lower()}.grib2.bz2'
        level, _ = FIELDS[field]
        if ruc:
            prefix = f'T/lvt1/100/lv1/{level*100}' if level else SINGLE[field].upper()
            return f'{BASE}/{prefix}/r/{ruc_run}/s/PT{lead:03}H00M.grib2'
        code = 't' if level else SINGLE[field]
        tag = f'pressure-level_{stamp}_{lead:03}_{level}_t' if level else f'single-level_{stamp}_{lead:03}_2d_{code}'
        return f'{CLASSIC}/{cycle}/{code}/icon-d2_germany_icosahedral_{tag}.grib2.bz2'

    def read(field, lead):
        url = filename(field, lead)
        response = get(url)
        if response is None:
            return None
        content = bz2.decompress(response.content) if url.endswith('.bz2') else response.content
        msg = grib.codes_new_from_message(content)
        try:
            value = grib.codes_get_values(msg)
            get_key = lambda key: grib.codes_get(msg, key)
            if get_key('bitmapPresent'):
                value[value == get_key('missingValue')] = np.nan
            unit, key = get_key('units'), get_key('uuidOfHGrid')
            if field in FIELDS:
                level, expected_unit = FIELDS[field]
                if (get_key('dataDate') != int(stamp[:8]) or get_key('dataTime') != start.hour*100
                        or get_key('endStep') != lead or unit != expected_unit
                        or (level and (get_key('typeOfLevel') != 'isobaricInhPa' or get_key('level') != level))):
                    raise ValueError(f'Onverwachte DWD GRIB-metadata: {model} {field} T+{lead}')
            elif unit in ('rad', 'radian'):
                value = np.degrees(value)
            return value, key
        finally:
            grib.codes_release(msg)

    with ThreadPoolExecutor(max_workers=8) as pool:
        lat_future = pool.submit(read, 'CLAT', 0)
        lon = read('CLON', 0)
        lat = lat_future.result()
        if not lat or not lon or lat[1] != lon[1] or lat[0].shape != lon[0].shape:
            raise ValueError(f'Geen geldig DWD-raster voor {model}')
        target, coverage = map_indices(lat[0], lon[0], grid)

        def frame(lead):
            fields = {}
            for field in FIELDS:
                result = read(field, lead)
                if not result:
                    continue
                values, key = result
                if key != lat[1] or values.shape != lat[0].shape:
                    raise ValueError(f'Ongelijk DWD-raster voor {model} {field}')
                v = values[target]
                if field=='frz':
                    fields[field] = np.where(coverage & (v>-100),v,np.nan)
                else:
                    fields[field] = np.where(coverage, v*100 if field == 'sdep' else v-273.15, np.nan)
            return start+timedelta(hours=lead), fields

        return dict(pool.map(frame, leads))


def cached_icon_fields(root, model, start, leads, grid, get=None):
    load = (lambda: icon_fields(model,start,leads,grid,get)) if get else None
    return cached_model_fields(root,model,start,leads,set(FIELDS),load)


def cached_model_fields(root, model, start, leads, expected, load=None):
    root.mkdir(parents=True, exist_ok=True)
    cache = root/f'{model}-{start:%Y%m%d%H}-velden.npz'
    fields = {}
    if cache.exists():
        with np.load(cache, allow_pickle=False) as data:
            for key in data.files:
                lead, field = key.split('_', 1)
                fields.setdefault(start+timedelta(hours=int(lead)), {})[field] = data[key]
    if load is None or all(expected <= set(fields.get(start+timedelta(hours=h), ())) for h in leads):
        return fields
    downloaded = load()
    for when, mapped in downloaded.items():
        fields.setdefault(when, {}).update(mapped)
    temp = cache.with_suffix('.tmp.npz')
    np.savez_compressed(temp, **{f'{int((when-start).total_seconds()/3600)}_{field}': value.astype('float32')
                                for when, mapped in fields.items() for field, value in mapped.items()})
    temp.replace(cache)
    return fields
