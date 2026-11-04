"""Bronadapter ECMWF Open Data, AIFS Single (`aifs-single`), 0,25°, stappen per 6 uur t/m +360.

Zelfde interface als ecmwf_opendata. AIFS staat stap voor stap online zodra hij gerekend is
(00z: +0 om 05:45, +144 om 06:27 UTC), tot 1¾ uur vóór IFS, dat pas aan het eind van het
realtime-schema in de open data komt.

AIFS heeft minder velden dan IFS: geen windstoot, CAPE, 6-uurs max/min, sneeuwdek of
neerslagsoort. Neerslag(intensiteit) volgt uit de tp-som per 6 uur; sneeuw waar het grootste
deel van die som sneeuw (sf) is. Vocht op 700/850 hPa uit q, vorticiteit 500 hPa uit u/v,
neerslagbaar water benaderd met tcw (incl. wolkenwater, verschil doorgaans < 1 mm).
"""
import json
import re
from datetime import timedelta

import numpy as np

from sources import ecmwf_opendata as ifs

BASE = ifs.BASE
SFC = ('msl', '2t', '2d', '10u', '10v', '100u', '100v', 'tcc', 'lcc', 'mcc', 'hcc', 'tp', 'sf', 'ssrd', 'tcw')
STATIC = ('lsm', 'z')
PL = ({('t', p) for p in ifs.T_LEVELS} | {('gh', p) for p in ifs.GH_LEVELS}
      | {(c, p) for c in ('u', 'v') for p in ifs.UV_LEVELS} | {('q', 700), ('q', 850), ('w', 700)})
R_EARTH = 6.371e6

list_runs = ifs.list_runs


def expected_steps(cycle):
    return list(range(0, 361, 6))


def _run_dir(run):
    return f"{BASE}/{run:%Y%m%d}/{run:%H}z/aifs-single/0p25/oper/"


def _base(run, step):
    return f"{_run_dir(run)}{run:%Y%m%d%H}0000-{step}h-oper-fc"


def available_steps(run, res=None):
    r = ifs._get(_run_dir(run))
    if r is None:
        return []
    return sorted({int(s) for s in re.findall(r'-(\d+)h-oper-fc\.index', r.text)})


def _index(run, step, keys=None):
    """Sleutel -> (offset, lengte): grondvelden op naam, drukvlakken als t850, bodem als sot1."""
    r = ifs._get(_base(run, step) + '.index')
    if r is None:
        return None
    want = {}
    for line in r.text.splitlines():
        e = json.loads(line)
        p, lt = e.get('param'), e.get('levtype')
        if lt == 'sfc' and (p in SFC or (step == 0 and p in STATIC)):
            k = p
        elif lt == 'sol' and p == 'sot' and str(e.get('levelist')) == '1':
            k = 'sot1'
        elif lt == 'pl' and (p, int(e.get('levelist', 0))) in PL:
            k = f"{p}{int(e['levelist'])}"
        else:
            continue
        if keys is None or k in keys:
            want[k] = (e['_offset'], e['_length'])
    return want


def _fields(run, step, domain, keys=None):
    ix = _index(run, step, keys)
    if ix is None:
        return None
    url = _base(run, step) + '.grib2'
    out = {}
    for k, (off, ln) in ix.items():
        v = ifs._fetch_field(url, off, ln, domain)
        if v is not None:
            out[k] = v
    return out


_lsm_cache = {}


def _lsm(run, domain):
    key = (run, domain['step'])
    if key not in _lsm_cache:
        _lsm_cache[key] = (_fields(run, 0, domain, {'lsm'}) or {}).get('lsm')
    return _lsm_cache[key]


def rel_humidity(q, t_c, p_hpa):
    """Relatieve vochtigheid (%) uit specifieke vochtigheid (kg/kg) en temperatuur (°C) op een drukvlak."""
    e = q * p_hpa / (0.622 + 0.378 * q)
    es = 6.112 * np.exp(17.67 * t_c / (t_c + 243.5))
    return np.clip(100.0 * e / es, 0, 100)


def vorticity(u, v, lats, d_deg):
    """Relatieve vorticiteit (1/s) op een regelmatig lat/lon-raster, rijen noord→zuid."""
    phi = np.radians(lats)[:, None]
    d = np.radians(d_deg)
    dvdx = np.gradient(v, axis=1) / (R_EARTH * np.cos(phi) * d)
    dudy = -np.gradient(u, axis=0) / (R_EARTH * d)            # rij omlaag = zuidwaarts
    return dvdx - dudy + u * np.tan(phi) / R_EARTH


def fetch_step(run, step, domain, res='0p25'):
    f = _fields(run, step, domain)
    if f is None:
        return None
    missing = [k for k in SFC if k not in f and not (step == 0 and k in ('tp', 'sf', 'ssrd'))]
    lats = domain['lat_max'] - np.arange(next(iter(f.values())).shape[0]) * domain['step']
    out = {}
    if 'msl' in f:
        out['msl'] = f['msl'] / 100.0
    if '2t' in f:
        out['t2m'] = f['2t'] - 273.15
    if '2d' in f:
        out['td2m'] = f['2d'] - 273.15
    if all(k in f for k in ('2t', '2d', '10u', '10v')):
        out['feel'] = ifs.feels_like(out['t2m'], out['td2m'], np.hypot(f['10u'], f['10v']) * 3.6)
    if '10u' in f and '10v' in f:
        out['u10'], out['v10'] = f['10u'], f['10v']
    if '100u' in f and '100v' in f:
        out['u100'], out['v100'] = f['100u'], f['100v']
        out['w100'] = np.hypot(f['100u'], f['100v'])
    for k in ('tcc', 'lcc', 'mcc', 'hcc'):                    # AIFS levert al procenten
        if k in f:
            out[k] = np.clip(f[k], 0, 100)
    if 'tcw' in f:
        out['tcwv'] = f['tcw']
    # bovenlucht
    t = {p: f[f't{p}'] - 273.15 for p in ifs.T_LEVELS if f't{p}' in f}
    gh = {p: f[f'gh{p}'] for p in ifs.GH_LEVELS if f'gh{p}' in f}
    for p in (850, 500):
        if p in t:
            out[f't{p}'] = t[p]
    if 500 in gh and 1000 in gh:
        out['thk'] = (gh[500] - gh[1000]) / 10.0
    for p, k in ((500, 'z500'), (300, 'z300')):
        if p in gh:
            out[k] = gh[p] / 10.0
    if all(p in t and p in gh for p in ifs.FRZ_LEVELS):
        out['frz'] = ifs.freezing_level([t[p] for p in ifs.FRZ_LEVELS], [gh[p] for p in ifs.FRZ_LEVELS])
    if 'u300' in f and 'v300' in f:
        out['jet'] = np.hypot(f['u300'], f['v300']) * ifs.KT
    if all(k in f for k in ('u500', 'v500', '10u', '10v')):
        out['shear'] = np.hypot(f['u500'] - f['10u'], f['v500'] - f['10v']) * ifs.KT
    if 'u500' in f and 'v500' in f:
        out['vo500'] = vorticity(f['u500'], f['v500'], lats, domain['step']) * 1e5
    if 'u850' in f and 'v850' in f:
        out['w850'] = np.hypot(f['u850'], f['v850']) * ifs.KT
    if 'q700' in f and 700 in t:
        out['rh700'] = rel_humidity(f['q700'], t[700], 700.0)
    if 'q850' in f and 850 in t:
        out['te850'] = ifs.theta_e(t[850], rel_humidity(f['q850'], t[850], 850.0), 850.0)
    if 'w700' in f:
        out['w700'] = f['w700']
    for k in ('u500', 'v500', 'u300', 'v300', 'u850', 'v850'):
        if k in f:
            out[k] = f[k]
    # neerslag: sommen sinds de start (mm); intensiteit = gemiddelde over de laatste 6 uur
    if 'tp' in f and step > 0:
        out['ptot'] = np.clip(f['tp'], 0, None)
        prev = _fields(run, step - 6, domain, {'tp', 'sf'}) if step >= 6 else None
        if prev and 'tp' in prev:
            dtp = np.clip(f['tp'] - prev['tp'], 0, None)
            out['prate'] = dtp / 6.0
            dsf = np.clip(f['sf'] - prev['sf'], 0, None) if 'sf' in f and 'sf' in prev else np.zeros_like(dtp)
            out['ptype'] = np.where(dsf >= 0.5 * np.maximum(dtp, 1e-6), 5.0, 1.0)   # 5 = sneeuw, 1 = regen
        else:
            missing.append('prate')
    if step >= 24:
        prev = _fields(run, step - 24, domain, {'tp', 'sf', 'ssrd'}) or {}
        if 'tp' in f and 'tp' in prev:
            out['p24'] = np.clip(f['tp'] - prev['tp'], 0, None)
        if 'sf' in f and 'sf' in prev:
            out['snow24'] = np.clip(f['sf'] - prev['sf'], 0, None)   # mm water -> cm sneeuw bij 10:1
        if 'ssrd' in f and 'ssrd' in prev:
            mid = run + timedelta(hours=step - 12)
            out['sun24'] = ifs.sunshine_hours(f['ssrd'] - prev['ssrd'], lats, mid.timetuple().tm_yday)
        missing += [k for k, s in (('p24', 'tp'), ('snow24', 'sf'), ('sun24', 'ssrd')) if s not in prev]
    # bodem alleen boven land; het landmasker staat alleen in stap 0
    lsm = f.get('lsm') if step == 0 else _lsm(run, domain)
    if 'sot1' in f and lsm is not None:
        out['st1'] = ifs.land_fill(f['sot1'] - 273.15, lsm >= 0.5)
    else:
        missing.append('st1')
    if step == 0 and lsm is not None and 'z' in f:
        out['lsm'] = np.clip(lsm, 0, 1)
        out['orog'] = f['z'] / 9.80665
    out['_missing'] = sorted(set(missing))
    return out
