"""Bronadapter ECMWF Open Data (data.ecmwf.int), IFS HRES `oper`, 0,1° of 0,25°.

Interface (zelfde voor latere GFS/ICON-adapters):
    expected_steps(cycle)            -> lijst lead times in uren
    list_runs(now)                   -> recente runs (datetime UTC) die de bron kent
    available_steps(run, res)        -> stappen waarvan de bron al data heeft
    fetch_step(run, step, domain, res) -> dict veldnaam -> 2D float32 (domeinraster,
                                        noord→zuid, west→oost) in standaardeenheden

Alleen de benodigde GRIB-berichten worden via HTTP Range uit de stapbestanden
gehaald (msl, 2t, tcc, tprate, ptype, 10u, 10v, max/min, windstoot, sd, rsn, mucape, t en gh op 1000-500 hPa, gh300, u/v 300 en 500, tp ≈ 30 MB per stap i.p.v. ~90 MB).
"""
import json
import re
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import requests
import eccodes

from config import SUN_FRAC, SUN_KT, SUN_MIN_ELEV

BASE = 'https://data.ecmwf.int/forecasts'
PARAMS = ('msl', '2t', 'tcc', 'lcc', 'mcc', 'tprate', 'ptype', '10u', '10v', 'tp', 'sd', 'rsn', 'mucape', '2d', 'tcwv', 'ssrd', 'hcc', '100u', '100v', 'sf')
T_LEVELS = (1000, 925, 850, 700, 600, 500)   # hPa, van laag naar hoog
GH_LEVELS = (300, 500, 600, 700, 850, 925, 1000)  # hPa, voor de dikte, de hoogtelijnen en het 0 °C-niveau
FRZ_LEVELS = (1000, 925, 850, 700, 600, 500)  # hPa, van laag naar hoog
UV_LEVELS = (300, 500, 850)   # hPa, straalstroom, shear en wind 850
PL_FIELDS = {('r', 700), ('r', 850), ('vo', 500), ('w', 700)}   # vocht, vorticiteit en verticale beweging
GUST = ('10fg3', '10fg')  # 10fg3 t/m +144 waar die bestaat, anders 10fg: zelfde betekenis, ander tijdvak in de naam
TIMEOUT = 60
KT = 1.94384             # m/s -> knopen

_session = None


def _http():
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers['User-Agent'] = 'weerlab-overview/1 (+https://weerlab.nl)'
    return _session


def _get(url, headers=None, tries=4):
    last = None
    for i in range(tries):
        try:
            r = _http().get(url, headers=headers, timeout=TIMEOUT)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r
        except requests.RequestException as e:   # netwerkfout/5xx: backoff
            last = e
            time.sleep(1.5 * 2 ** i)
    raise last


def expected_steps(cycle):
    if cycle in (0, 12):
        return list(range(0, 144, 3)) + list(range(144, 361, 6))
    return list(range(0, 145, 3))


def _run_dir(run, res):
    return f"{BASE}/{run:%Y%m%d}/{run:%H}z/ifs/{res}/oper/"


def _step_base(run, step, res):
    # 0,1° splitst grondvelden en drukvlakken (-sfc/-pl), 0,25° heeft één bestand per stap
    return f"{_run_dir(run, res)}{run:%Y%m%d%H}0000-{step}h-oper-fc{'-sfc' if res == '0p1' else ''}"


def list_runs(now=None, cycles=(0, 12), lookback_h=60):
    now = now or datetime.now(timezone.utc)
    t = now.replace(minute=0, second=0, microsecond=0)
    out = []
    while t > now - timedelta(hours=lookback_h):
        if t.hour in cycles:
            out.append(t)
        t -= timedelta(hours=1)
    return out


def available_steps(run, res='0p1'):
    r = _get(_run_dir(run, res))
    if r is None:
        return []
    # De directorypagina noemt elk bestand; een stap telt pas als het
    # .index-bestand er staat (dat wordt na de GRIB geschreven).
    found = {int(s) for s in re.findall(r'-(\d+)h-oper-fc(?:-sfc)?\.index', r.text)}
    return sorted(found)


STATIC = ('lsm', 'z')      # alleen uit stap 0: land-zeemasker en orografie (geopotentiaal)


# Max/min per 3 uur t/m +144, daarna per 6 uur. Op +0 staat er alleen 0 K in.
def _extreme_params(step):
    if step == 0:
        return ()
    return ('mx2t3', 'mn2t3') if step <= 144 else ('mx2t6', 'mn2t6')


def _ranges(run, step, res):
    r = _get(_step_base(run, step, res) + '.index')
    if r is None:
        return None
    want = {}
    for line in r.text.splitlines():
        e = json.loads(line)
        if (e.get('param') in PARAMS or e.get('param') in _extreme_params(step) or e.get('param') in GUST
                or (step == 0 and e.get('param') in STATIC)) and e.get('levtype') == 'sfc':
            want[e['param']] = (e['_offset'], e['_length'])
        elif e.get('param') == 'sot' and e.get('levtype') == 'sol' and str(e.get('levelist')) == '1':
            want['sot1'] = (e['_offset'], e['_length'])                # bodemtemperatuur 0-7 cm
        elif e.get('param') == 'lsm' and e.get('levtype') == 'sfc':
            want['lsm'] = (e['_offset'], e['_length'])                 # elke stap: zee maskeren bij de bodem
    return want


def _grid_slice(gid, domain):
    ni = eccodes.codes_get(gid, 'Ni')
    nj = eccodes.codes_get(gid, 'Nj')
    lat_first = eccodes.codes_get(gid, 'latitudeOfFirstGridPointInDegrees')
    lon_first = eccodes.codes_get(gid, 'longitudeOfFirstGridPointInDegrees')
    d = eccodes.codes_get(gid, 'iDirectionIncrementInDegrees')
    if abs(d - domain['step']) > 1e-6 or lat_first < 0:
        raise ValueError(f'onverwacht raster: d={d} lat0={lat_first}')
    i0 = int(round((lat_first - domain['lat_max']) / d))
    i1 = int(round((lat_first - domain['lat_min']) / d)) + 1
    # lon_first is 180 (== -180): kolom j hoort bij lon_first + j*d (mod 360)
    j0 = int(round(((domain['lon_min'] - lon_first) % 360) / d))
    j1 = j0 + int(round((domain['lon_max'] - domain['lon_min']) / d)) + 1
    if j1 > ni or i1 > nj:
        raise ValueError('domein valt over de datumgrens; niet ondersteund')
    return nj, ni, slice(i0, i1), slice(j0, j1)


def _pl_base(run, step, res):
    # 0,1° heeft de drukvlakken in een eigen bestand
    return _step_base(run, step, res) if res != '0p1' else f"{_run_dir(run, res)}{run:%Y%m%d%H}0000-{step}h-oper-fc-pl"


def _level_temps(run, step, domain, res):
    """Temperatuur op de drukvlakken in °C; sleutel t850 enz."""
    base = _pl_base(run, step, res)
    r = _get(base + '.index')
    if r is None:
        return {}
    out = {}
    for line in r.text.splitlines():
        e = json.loads(line)
        if e.get('param') == 't' and e.get('levtype') == 'pl' and int(e.get('levelist', 0)) in T_LEVELS:
            vals = _fetch_field(base + '.grib2', e['_offset'], e['_length'], domain)
            if vals is not None:
                out[f"t{int(e['levelist'])}"] = vals - 273.15
        if e.get('param') == 'gh' and e.get('levtype') == 'pl' and int(e.get('levelist', 0)) in GH_LEVELS:
            vals = _fetch_field(base + '.grib2', e['_offset'], e['_length'], domain)
            if vals is not None:
                out[f"gh{int(e['levelist'])}"] = vals
        if e.get('param') in ('u', 'v') and e.get('levtype') == 'pl' and int(e.get('levelist', 0)) in UV_LEVELS:
            vals = _fetch_field(base + '.grib2', e['_offset'], e['_length'], domain)
            if vals is not None:
                out[f"{e['param']}{int(e['levelist'])}"] = vals
        if e.get('levtype') == 'pl' and (e.get('param'), int(e.get('levelist', 0))) in PL_FIELDS:
            vals = _fetch_field(base + '.grib2', e['_offset'], e['_length'], domain)
            if vals is not None:
                out[f"{e['param']}{int(e['levelist'])}"] = vals
    return out


def _fetch_field(url, off, ln, domain):
    r = _get(url, headers={'Range': f'bytes={off}-{off + ln - 1}'})
    if r is None or len(r.content) != ln:
        return None
    gid = eccodes.codes_new_from_message(r.content)
    try:
        nj, ni, si, sj = _grid_slice(gid, domain)
        vals = eccodes.codes_get_values(gid).reshape(nj, ni)[si, sj].astype(np.float32)
        miss = eccodes.codes_get(gid, 'missingValue')
        if eccodes.codes_get(gid, 'bitmapPresent'):
            vals[vals == miss] = np.nan
        return vals
    finally:
        eccodes.codes_release(gid)


def _six_hour_extremes(run, step, domain, res, fields):
    """tmax/tmin (°C) over de voorgaande 6 uur; op +3 bestaat alleen 0-3 uur. Tot +144 zijn er
    alleen 3-uursvelden, dus dan deze stap combineren met de vorige."""
    out = {}
    prev = _ranges(run, step - 3, res) if 6 <= step <= 144 else None
    if 6 <= step <= 144 and prev is None:
        return out
    url = _step_base(run, step - 3, res) + '.grib2' if prev else None
    for key, pars, fn in (('tmax', ('mx2t3', 'mx2t6'), np.maximum), ('tmin', ('mn2t3', 'mn2t6'), np.minimum)):
        p = pars[0] if step <= 144 else pars[1]
        a = fields.get(p)
        if a is None:
            continue
        if prev:
            if p not in prev:
                continue
            b = _fetch_field(url, *prev[p], domain)
            if b is None:
                continue
            a = fn(a, b)
        out[key] = a - 273.15
    return out


def _six_hour_gust(run, step, domain, res, fields):
    """Hoogste windstoot (km/u) over de voorgaande 6 uur. Tot +144 geeft een stap maar 3 uur,
    dus dan met de vorige stap combineren; op +3 is er alleen 0-3 uur."""
    a = next((fields[p] for p in GUST if p in fields), None)
    if a is None:
        return None
    if 6 <= step <= 144:
        prev = _ranges(run, step - 3, res)
        p = next((q for q in GUST if prev and q in prev), None)
        b = _fetch_field(_step_base(run, step - 3, res) + '.grib2', *prev[p], domain) if p else None
        if b is None:
            return None
        a = np.maximum(a, b)
    return a * 3.6


def freezing_level(temps, heights):
    """Hoogste 0 °C-overgang (warm eronder, koud erboven) in meter boven zeeniveau, lineair
    tussen de drukvlakken; van laag naar hoog in °C en gpm. Overal koud = 0, overal warm = bovenste vlak."""
    out = np.where(temps[-1] > 0, heights[-1], 0.0).astype(np.float32)
    done = temps[-1] > 0
    for lo, hi, zlo, zhi in zip(temps[-2::-1], temps[:0:-1], heights[-2::-1], heights[:0:-1]):
        hit = ~done & (lo > 0) & (hi <= 0)
        out[hit] = (zlo + (zhi - zlo) * lo / np.where(lo > hi, lo - hi, 1.0))[hit]
        done |= hit
    return np.clip(out, 0, None)


def theta_e(t_c, rh, p_hpa):
    """Equivalent-potentiële temperatuur (°C) volgens Bolton (1980), uit temperatuur (°C) en RV (%) op een drukvlak."""
    tk = t_c + 273.15
    e = np.maximum(np.clip(rh, 0, 100) / 100.0 * 6.112 * np.exp(17.67 * t_c / (t_c + 243.5)), 1e-3)
    r = 0.622 * e / (p_hpa - e)
    tl = 2840.0 / (3.5 * np.log(tk) - np.log(e) - 4.805) + 55.0
    return tk * (1000.0 / p_hpa) ** (0.2854 * (1 - 0.28 * r)) * np.exp((3376.0 / tl - 2.54) * r * (1 + 0.81 * r)) - 273.15


def sunshine_hours(ssrd_j, lats, doy):
    """Zonuren over 24 uur uit de stralingssom (J/m2). Open data heeft geen sund/fdir: fractie van de
    daglengte = f(Kt), Kt = straling / straling buiten de dampkring; curve zie config.SUN_KT/SUN_FRAC."""
    phi = np.radians(lats)[:, None]
    d = 0.409 * np.sin(2 * np.pi * doy / 365 - 1.39)
    dr = 1 + 0.033 * np.cos(2 * np.pi * doy / 365)
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(d), -1, 1))
    g0 = 37.59e6 * dr * (ws * np.sin(phi) * np.sin(d) + np.cos(phi) * np.cos(d) * np.sin(ws))
    c = (np.sin(np.radians(SUN_MIN_ELEV)) - np.sin(phi) * np.sin(d)) / (np.cos(phi) * np.cos(d))
    s0 = 24 / np.pi * np.arccos(np.clip(c, -1, 1))             # uren zon boven de minimale hoogte
    kt = np.where(g0 > 1e5, np.clip(ssrd_j, 0, None) / np.maximum(g0, 1e5), 0.0)
    return (np.interp(kt, SUN_KT, SUN_FRAC) * s0).astype(np.float32)


def land_fill(x, land):
    """Zeecellen krijgen de waarde van de dichtstbijzijnde landcel: boven zee is het
    veld zinloos, en zo mengt de vloeiende textuur langs de kust geen nonsens in.
    De kaart toont alleen land; zonder land in het domein blijft het veld leeg."""
    if not land.any():
        return np.full(x.shape, np.nan, dtype=np.float32)
    from scipy.ndimage import distance_transform_edt
    idx = distance_transform_edt(~land, return_distances=False, return_indices=True)
    return x[tuple(idx)].astype(np.float32)


def feels_like(t, td, ws_kmh):
    """Gevoelstemperatuur (°C), formules als de meteobewaking (MeteobewakingWin/src/core.js): windchill (JAG/TI)
    t/m 10 °C boven 4,8 km/u, hitte-index vanaf 26 °C en 40 % RV, anders de temperatuur. Tussen 10 en 15 °C loopt
    de windchill geleidelijk af; een harde grens tekent op de kaart een sprong van enkele graden als nepfront."""
    rh = np.minimum(100.0, 100.0 * np.exp(17.625 * td / (243.04 + td)) / np.exp(17.625 * t / (243.04 + t)))
    p = np.power(np.maximum(ws_kmh, 0.1), 0.16)
    chill = np.minimum(t, 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p)
    f = t * 9 / 5 + 32
    hi = (-42.379 + 2.04901523 * f + 10.14333127 * rh - 0.22475541 * f * rh - 0.00683783 * f * f - 0.05481717 * rh * rh
          + 0.00122874 * f * f * rh + 0.00085282 * f * rh * rh - 0.00000199 * f * f * rh * rh)
    out = np.where(ws_kmh > 4.8, t + (chill - t) * np.clip((15 - t) / 5, 0, 1), t)
    return np.where((t >= 26) & (rh >= 40), np.maximum(t, (hi - 32) * 5 / 9), out)


def fetch_step(run, step, domain, res='0p1'):
    ranges = _ranges(run, step, res)
    if ranges is None:
        return None
    missing = [p for p in PARAMS if p not in ranges]
    url = _step_base(run, step, res) + '.grib2'
    fields = {}
    for p, (off, ln) in ranges.items():
        vals = _fetch_field(url, off, ln, domain)
        if vals is None:
            missing.append(p)
            continue
        fields[p] = vals
    out = {}
    if step > 0:
        ext = _six_hour_extremes(run, step, domain, res, fields)
        out.update(ext)
        missing += [k for k in ('tmax', 'tmin') if k not in ext]
        gust = _six_hour_gust(run, step, domain, res, fields)
        if gust is None:
            missing.append('gust')
        else:
            out['gust'] = gust
    if 'msl' in fields:
        out['msl'] = fields['msl'] / 100.0                     # Pa -> hPa
    if '2t' in fields:
        out['t2m'] = fields['2t'] - 273.15                     # K -> °C
    if '2d' in fields:
        out['td2m'] = fields['2d'] - 273.15
    if all(p in fields for p in ('2t', '2d', '10u', '10v')):
        out['feel'] = feels_like(out['t2m'], out['td2m'], np.hypot(fields['10u'], fields['10v']) * 3.6)
    else:
        missing.append('feel')
    lev = _level_temps(run, step, domain, res)
    out.update(lev)
    missing += [f't{p}' for p in T_LEVELS if f't{p}' not in lev]
    if 'gh500' in lev and 'gh1000' in lev:
        out['thk'] = (lev['gh500'] - lev['gh1000']) / 10.0     # gpm -> dam
    else:
        missing.append('thk')
    for p, k in ((500, 'z500'), (300, 'z300')):
        if f'gh{p}' in lev:
            out[k] = lev[f'gh{p}'] / 10.0                      # gpm -> dam
        else:
            missing.append(k)
    if all(f't{p}' in lev and f'gh{p}' in lev for p in FRZ_LEVELS):
        out['frz'] = freezing_level([lev[f't{p}'] for p in FRZ_LEVELS], [lev[f'gh{p}'] for p in FRZ_LEVELS])
    else:
        missing.append('frz')
    for k in list(out):                                        # hulpvelden niet doorgeven
        if k.startswith('gh') or k in ('t1000', 't925', 't700', 't600'):
            del out[k]
    if 'u300' in lev and 'v300' in lev:
        out['jet'] = np.hypot(lev['u300'], lev['v300']) * KT
    else:
        missing.append('jet')
    if 'u500' in lev and 'v500' in lev and '10u' in fields and '10v' in fields:
        out['shear'] = np.hypot(lev['u500'] - fields['10u'], lev['v500'] - fields['10v']) * KT  # vectorverschil 10 m - 500 hPa
    else:
        missing.append('shear')
    if 'u850' in lev and 'v850' in lev:
        out['w850'] = np.hypot(lev['u850'], lev['v850']) * KT
    else:
        missing.append('w850')
    if 'r700' in lev:
        out['rh700'] = np.clip(lev['r700'], 0, 100)
    else:
        missing.append('rh700')
    if 'vo500' in lev:
        out['vo500'] = lev['vo500'] * 1e5                      # s-1 -> 10^-5 s-1
    else:
        missing.append('vo500')
    if 'w700' in lev:
        out['w700'] = lev['w700']                              # Pa/s, negatief = stijging
    else:
        missing.append('w700')
    if 'tcwv' in fields:
        out['tcwv'] = fields['tcwv']                           # kg/m2 = mm
    if 't850' in lev and 'r850' in lev:
        out['te850'] = theta_e(lev['t850'], lev['r850'], 850.0)
    else:
        missing.append('te850')
    for k in ('r700', 'r850'):
        out.pop(k, None)
    if 'mucape' in fields:
        out['cape'] = np.clip(np.nan_to_num(fields['mucape']), 0, None)
    if 'sd' in fields and 'rsn' in fields:                     # m water -> cm sneeuw via de dichtheid
        out['sdep'] = np.where(np.nan_to_num(fields['sd']) > 0, np.nan_to_num(fields['sd']) * 1000.0 / np.maximum(np.nan_to_num(fields['rsn']), 50.0) * 100.0, 0.0)
    if 'tcc' in fields:
        out['tcc'] = np.clip(fields['tcc'], 0, 1) * 100.0      # fractie -> %
    for k in ('lcc', 'mcc', 'hcc'):
        if k in fields:
            out[k] = np.clip(fields[k], 0, 1) * 100.0
    if 'tprate' in fields:
        out['prate'] = np.clip(fields['tprate'], 0, None) * 3600.0   # kg m-2 s-1 -> mm/u
    if 'ptype' in fields:
        out['ptype'] = fields['ptype']
    if '10u' in fields and '10v' in fields:
        out['u10'], out['v10'] = fields['10u'], fields['10v']  # m/s
    if 'tp' in fields and step > 0:
        total = np.clip(fields['tp'], 0, None) * 1000.0        # m -> mm, som sinds de start
        out['ptot'] = total
        if step >= 24:                                         # vorige stap: 24 uur eerder
            prev = _ranges(run, step - 24, res)
            b = _fetch_field(_step_base(run, step - 24, res) + '.grib2', *prev['tp'], domain) if prev and 'tp' in prev else None
            if b is None:
                missing.append('p24')
            else:
                out['p24'] = np.clip(fields['tp'] - b, 0, None) * 1000.0
    if '100u' in fields and '100v' in fields:
        out['u100'], out['v100'] = fields['100u'], fields['100v']
        out['w100'] = np.hypot(fields['100u'], fields['100v'])  # m/s
    if 'sf' in fields and step >= 24:                          # som sinds de start; m water -> cm sneeuw bij 10:1
        prev = _ranges(run, step - 24, res)
        b = _fetch_field(_step_base(run, step - 24, res) + '.grib2', *prev['sf'], domain) if prev and 'sf' in prev else None
        if b is None:
            missing.append('snow24')
        else:
            out['snow24'] = np.clip(fields['sf'] - b, 0, None) * 1000.0
    if 'ssrd' in fields and step >= 24:
        prev = _ranges(run, step - 24, res)
        b = _fetch_field(_step_base(run, step - 24, res) + '.grib2', *prev['ssrd'], domain) if prev and 'ssrd' in prev else None
        if b is None:
            missing.append('sun24')
        else:
            lats = domain['lat_max'] - np.arange(b.shape[0]) * domain['step']
            mid = run + timedelta(hours=step - 12)
            out['sun24'] = sunshine_hours(fields['ssrd'] - b, lats, mid.timetuple().tm_yday)
    if 'sot1' in fields and 'lsm' in fields:
        out['st1'] = land_fill(fields['sot1'] - 273.15, fields['lsm'] >= 0.5)
    else:
        missing.append('st1')
    if 'lsm' in fields and step == 0:
        out['lsm'] = np.clip(fields['lsm'], 0, 1)
    if 'z' in fields:
        out['orog'] = fields['z'] / 9.80665                    # m2 s-2 -> m
    out['_missing'] = sorted(set(missing))
    return out
