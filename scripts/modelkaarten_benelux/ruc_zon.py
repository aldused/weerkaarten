"""Haal globale straling voor dezelfde ICON-D2-RUC-run op bij DWD."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from urllib.parse import quote

import eccodes as grib
import numpy as np
from scipy.spatial import cKDTree

BASE = 'https://opendata.dwd.de/weather/nwp/v1/m/icon-d2-ruc/p'


def map_indices(lat, lon, grid):
    lat_out = grid['lat0'] + np.arange(grid['h']) * grid['dy']
    lon_out = grid['lon0'] + np.arange(grid['w']) * grid['dx']
    x, y = np.meshgrid(lon_out, lat_out)
    selected = np.flatnonzero(np.isfinite(lat+lon) & (lat > y.min()-.2) & (lat < y.max()+.2)
                              & (lon > x.min()-.2) & (lon < x.max()+.2))
    if not selected.size:
        raise ValueError('DWD-rooster bevat de Benelux niet')
    correction = np.cos(np.radians(lat_out.mean()))
    tree = cKDTree(np.column_stack((lat[selected], lon[selected]*correction)))
    distances, indices = tree.query(np.column_stack((y.ravel(), x.ravel()*correction)))
    target = selected[indices].reshape(y.shape)
    in_domain = distances.reshape(y.shape) < .035
    return target, in_domain


def run_radiation(start, leads, grid, get):
    run = quote(start.strftime('%Y-%m-%dT%H:%M'), safe='')

    def read(field, lead):
        url = f'{BASE}/{field}/r/{run}/s/PT{lead:03}H00M.grib2'
        response = get(url)
        if response is None:
            raise ValueError(f'DWD-veld ontbreekt: {field} T+{lead}')
        msg = grib.codes_new_from_message(response.content)
        try:
            raw = grib.codes_get_values(msg)
            if grib.codes_get(msg, 'bitmapPresent'):
                raw[raw == grib.codes_get(msg, 'missingValue')] = np.nan
            key = grib.codes_get(msg, 'uuidOfHGrid')
            if field.startswith('ASW'):
                if (grib.codes_get(msg, 'stepType') != 'avg' or grib.codes_get(msg, 'startStep') != 0
                        or grib.codes_get(msg, 'endStep') != lead):
                    raise ValueError(f'Onverwacht stralingstijdvak voor {field} T+{lead}')
            return raw, key, grib.codes_get(msg, 'units')
        finally:
            grib.codes_release(msg)

    with ThreadPoolExecutor(max_workers=6) as pool:
        lat_result = pool.submit(read, 'CLAT', 0)
        lon, lon_key, lon_unit = read('CLON', 0)
        lat, grid_key, lat_unit = lat_result.result()
        if lon_key != grid_key or lat.shape != lon.shape:
            raise ValueError('Ongelijke DWD-coördinatenrasters')
        if lat_unit in ('rad', 'radian'):
            lat = np.degrees(lat)
        if lon_unit in ('rad', 'radian'):
            lon = np.degrees(lon)
        if np.nanmax(lat) < 20 or np.nanmax(lat) > 90:
            raise ValueError(f'Onverwachte DWD-latitude-eenheid {lat_unit}')
        target, in_domain = map_indices(lat, lon, grid)
        hours = sorted({h for lead in leads for h in (lead-1, lead) if h>0})
        futures = {(field,h): pool.submit(read,field,h) for field in ('ASWDIR_S','ASWDIFD_S') for h in hours}
        totals = {0: np.zeros(target.shape)}
        for hour in hours:
            values = []
            for field in ('ASWDIR_S', 'ASWDIFD_S'):
                raw, key, unit = futures[field,hour].result()
                if key != grid_key or raw.shape != lat.shape or unit != 'W m-2':
                    raise ValueError(f'Onverwacht DWD-raster of eenheid bij {field}')
                values.append(raw[target])
            totals[hour] = hour * (values[0] + values[1])
    return {start+timedelta(hours=h): np.where(in_domain, np.maximum(0, totals[h]-totals[h-1]), np.nan)
            for h in leads if h>0}
