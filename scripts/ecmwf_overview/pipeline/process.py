"""Eén voorspelstap → waardetexturen (8-bit PNG) + isobaren/H-L (JSON).

Geen kleuren hier: de browser kleurt de waarden met de palet-LUT's uit
web/js/palettes.js. Zo blijven lagen los schakelbaar en is een frame klein.
"""
import hashlib
import io
import json
import os

import numpy as np
from PIL import Image
from contourpy import contour_generator
from scipy.ndimage import gaussian_filter, label, maximum_filter, minimum_filter
from shapely.geometry import LineString

import lcc
from config import (ENC, CAPE_ZERO_BELOW, DYN_SMOOTH_DEG, Z500_STEP, Z300_STEP, SUM_ZERO_BELOW, SNOW_ZERO_BELOW, PTYPE_FREEZING, PTYPE_PELLETS, THICK_BASE, THICK_STEP, WIND_VEC_STEP, ISOBAR_STEP, ISOBAR_SMOOTH, ISOBAR_SIMPLIFY_KM, PTYPE_FROZEN,
                    PRECIP_ZERO_BELOW, TCC_ZERO_BELOW, CENTRE_DEPTHS, LOW_MAX_HPA, HIGH_MIN_HPA, DOMAIN,
                    SHADE_ALTITUDE, SHADE_AZIMUTH, SHADE_EXAGGERATION, SHADE_GAIN)


def encode(name, x):
    e = ENC[name]
    x = np.asarray(x, dtype=np.float64)
    if e['kind'] == 'linear':
        v = np.round((x - e['offset']) / e['scale'])
        v = np.clip(v, e['lo'], 255)
    else:
        v = np.round(e['k'] * np.log2(1 + np.maximum(x, 0) / e['base']))
        v = np.clip(v, 0, 255)
    v = np.where(np.isfinite(x), v, 0)
    return v.astype(np.uint8)


def decode(name, v):
    e = ENC[name]
    v = np.asarray(v, dtype=np.float64)
    if e['kind'] == 'linear':
        return v * e['scale'] + e['offset']
    return e['base'] * (2 ** (v / e['k']) - 1)


def png_bytes(arr):
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def split_precip(prate, ptype):
    frozen = np.isin(np.nan_to_num(ptype, nan=0).astype(np.int16), PTYPE_FROZEN)
    rain = np.where(frozen, 0.0, prate)
    snow = np.where(frozen, prate, 0.0)
    return rain, snow


def freezing_precip(prate, ptype):
    """Winteroverzicht: ijsregen en ijskorrels apart; ze blijven ook in rain en snow zitten."""
    t = np.nan_to_num(ptype, nan=0).astype(np.int16)
    return np.where(np.isin(t, PTYPE_FREEZING), prate, 0.0), np.where(np.isin(t, PTYPE_PELLETS), prate, 0.0)


def isobars(msl, lons, lats, k=1.0, step=ISOBAR_STEP, base=0):
    # k = 0,1° / rasterstap: alle afstanden in rastercellen zijn voor 0,1° gekozen
    sm = gaussian_filter(msl.astype(np.float64), ISOBAR_SMOOTH * k, mode='nearest')
    lo = int(np.floor((np.nanmin(sm) - base) / step) * step) + base
    hi = int(np.ceil((np.nanmax(sm) - base) / step) * step) + base
    gen = contour_generator(lons, lats, sm, line_type='Separate')
    lines = []
    for lev in range(lo, hi + 1, step):
        for seg in gen.lines(lev):
            if len(seg) < 4:
                continue
            x, y = lcc.forward(seg[:, 0], seg[:, 1])
            ls = LineString(np.column_stack([x, y])).simplify(ISOBAR_SIMPLIFY_KM)
            if ls.length < 40:          # mini-lusjes (<40 km) weglaten
                continue
            c = np.round(np.asarray(ls.coords) * 10).astype(np.int64)   # 0,1 km
            d = np.vstack([c[:1], np.diff(c, axis=0)]).ravel().tolist()
            lines.append({'p': lev, 'd': d})
    return sm, lines


def _depth(field, i, j, half_i=120, half_j=180):
    """Hoe diep is de kern: grootste d waarvoor het gebied rond (i, j) binnen `field < v + d`
    een gesloten isobaar heeft, dus de rand van het zoekvenster niet raakt. Field is zo
    gekozen dat kernen minima zijn."""
    i0, i1 = max(0, i - half_i), min(field.shape[0], i + half_i + 1)
    j0, j1 = max(0, j - half_j), min(field.shape[1], j + half_j + 1)
    w, v, depth = field[i0:i1, j0:j1], field[i, j], 0.0
    for d in CENTRE_DEPTHS:
        lab, _ = label(w < v + d)
        k = lab[i - i0, j - j0]
        if k == 0 or (lab[0] == k).any() or (lab[-1] == k).any() or (lab[:, 0] == k).any() or (lab[:, -1] == k).any():
            break
        depth = d
    return depth


def centres(msl, sm, lons, lats, size=41, min_dist_deg=5.0, k=1.0):
    """H/L-kernen: lokaal extreem op een licht gladgestreken veld met minstens één gesloten
    isobaar eromheen. Dus ook brede, vlakke kernen (Schotland 1040) tellen mee, zonder
    afhankelijk te zijn van het gemiddelde van de omgeving. De waarde komt uit het
    isobarenveld, zodat label en lijnen kloppen."""
    det = gaussian_filter(msl.astype(np.float64), 5.0 * k, mode='nearest')
    size, wi, wj = int(size * k) | 1, int(30 * k), int(45 * k)
    out = []
    for letter, filt, sign in (('H', maximum_filter, -1), ('L', minimum_filter, 1)):
        ext = filt(det, size=size, mode='nearest') == det
        cand = []
        for i, j in np.argwhere(ext):
            if not (3 < i < det.shape[0] - 4 and 3 < j < det.shape[1] - 4):
                continue
            d = _depth(sign * det, i, j, int(120 * k), int(180 * k))
            if d >= CENTRE_DEPTHS[0]:
                cand.append((d, -sign * det[i, j], i, j))
        cand.sort(reverse=True)
        kept = []
        for d, _, i, j in cand:
            la, lo = lats[i], lons[j]
            sc = max(np.cos(np.radians(la)), 0.3)
            if any(np.hypot(la - kla, (lo - klo) * sc) <= min_dist_deg for kla, klo in kept):
                continue
            kept.append((la, lo))
            # Plaats en waarde uit het isobarenveld: in een vlakke kern kan het extreem
            # van het gladdere detectieveld enkele graden naast het echte extreem liggen.
            i0, j0 = max(0, i - wi), max(0, j - wj)
            w = sm[i0:i + wi + 1, j0:j + wj + 1]
            ki, kj = np.unravel_index(w.argmax() if letter == 'H' else w.argmin(), w.shape)
            la, lo, val = lats[i0 + ki], lons[j0 + kj], w[ki, kj]
            x, y = lcc.forward(lo, la)
            if (letter == 'L' and val >= LOW_MAX_HPA) or (letter == 'H' and val <= HIGH_MIN_HPA):
                continue
            out.append({'t': letter, 'x': round(float(x), 1), 'y': round(float(y), 1),
                        'p': int(round(float(val))), 'prom': d,
                        'lon': round(float(lo), 2), 'lat': round(float(la), 2)})
    return out


def _write(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)


def hillshade(orog, lsm, lats, step=DOMAIN['step']):
    """Reliëfschaduw als 8-bit (128 = vlak of zee), op het modelraster."""
    dy = 11120.0 * step                                # m per rastercel
    dx = dy * np.maximum(np.cos(np.radians(lats)), 0.05)[:, None]
    gy, gx = np.gradient(orog.astype(np.float64))
    # rij 0 ligt noord: gy is d/d(zuid), dus omkeren voor d/d(noord)
    sx, sy = gx / dx * SHADE_EXAGGERATION, -gy / dy * SHADE_EXAGGERATION
    az, alt = np.radians(SHADE_AZIMUTH), np.radians(SHADE_ALTITUDE)
    lx, ly, lz = np.sin(az) * np.cos(alt), np.cos(az) * np.cos(alt), np.sin(alt)
    s = (-sx * lx - sy * ly + lz) / np.sqrt(1 + sx ** 2 + sy ** 2)
    v = 128 + (s - lz) * SHADE_GAIN
    return np.clip(np.where(lsm < 0.5, 128, v), 0, 255).round().astype(np.uint8)


def write_static(lsm, orog, lats, static_dir, step=DOMAIN['step']):
    """Vaste lagen per modelversie: bestandsnaam bevat de inhoudshash, dus immutable
    cachen kan en runs met hetzelfde veld delen één bestand."""
    os.makedirs(static_dir, exist_ok=True)
    out = {}
    for name, arr in (('lsm', encode('lsm', lsm)), ('shade', hillshade(orog, lsm, lats, step))):
        b = png_bytes(arr)
        fname = f'{name}-{hashlib.sha1(b).hexdigest()[:10]}.png'
        path = os.path.join(static_dir, fname)
        if not os.path.exists(path):
            _write(path, b)
        out[name] = fname
    return out


def high_share(tcc, lcc, mcc):
    """Deel van de bewolking dat niet door lage of middelbare wolken verklaard kan worden,
    dus alleen hoog is (0..1). Geen optelling van lagen: die overlappen. tcc - max(lcc, mcc)
    is de ondergrens van 'alleen hoog'; hcc is daarvoor niet nodig."""
    t = np.maximum(tcc, 1e-3)
    return np.where(tcc < TCC_ZERO_BELOW, 0.0, np.clip((tcc - np.maximum(lcc, mcc)) / t, 0, 1))


def block_mean(a):
    """2×2-blokgemiddelde (0,1° → 0,2°); oneven rand valt af. Gemiddelde van de
    fysische waarde, dus het grove niveau toont het gebiedsgemiddelde."""
    ny, nx = (a.shape[0] // 2) * 2, (a.shape[1] // 2) * 2
    a = a[:ny, :nx].astype(np.float64)
    return a.reshape(ny // 2, 2, nx // 2, 2).mean(axis=(1, 3))


def wind_stride(step):
    """Hoeveelste rasterpunt de vaantjes gebruiken (0,25° → elk, 0,1° → 1 op 3)."""
    return int(np.ceil(WIND_VEC_STEP / step - 1e-9))


def write_step(fields, out_dir, lons, lats, static_dir, step=DOMAIN['step']):
    """Schrijft alle beschikbare lagen in twee resoluties (<laag>.png = modelraster,
    <laag>.lo.png = 2× zo grof); geeft per bestand bytes + sanity-statistiek."""
    os.makedirs(out_dir, exist_ok=True)
    info = {'layers': {}, 'missing': list(fields.get('_missing', []))}

    def put(name, arr, lo=True, prep=None):
        prep = prep or (lambda x: x)
        for suffix, a in (('', arr), ('.lo', block_mean(arr) if lo else None)):
            if a is None:
                continue
            a = prep(a)
            b = png_bytes(encode(name, a))
            _write(os.path.join(out_dir, f'{name}{suffix}.png'), b)
            info['layers'][name + suffix] = {'bytes': len(b), 'min': round(float(np.nanmin(a)), 2),
                                             'max': round(float(np.nanmax(a)), 2)}

    if 't2m' in fields:
        put('t2m', fields['t2m'])
    for k in ('tmax', 'tmin', 'td2m', 'st1', 'feel', 'sun24', 'frz', 'z500', 'anom', 'a850', 't850', 't500'):
        if k in fields:
            put(k, fields[k])
    if 'gust' in fields:
        put('gust', fields['gust'])
    if 'cape' in fields:
        put('cape', fields['cape'], prep=lambda x: np.where(x < CAPE_ZERO_BELOW, 0.0, x))
    for k in ('shear', 'jet', 'w850', 'rh700', 'tcwv', 'te850', 'thk'):
        if k in fields:
            put(k, fields[k])
    for k in ('vo500', 'w700'):
        if k in fields:
            put(k, gaussian_filter(fields[k], DYN_SMOOTH_DEG / step, mode='nearest'))
    for k in ('lcc', 'mcc', 'hcc', 'w100'):
        if k in fields:
            put(k, fields[k])
    if 'snow24' in fields:
        put('snow24', fields['snow24'], prep=lambda x: np.where(x < SNOW_ZERO_BELOW, 0.0, x))
    if 'sdep' in fields:
        put('sdep', fields['sdep'], prep=lambda x: np.where(x < SNOW_ZERO_BELOW, 0.0, x))
    for k in ('p24', 'ptot'):
        if k in fields:
            put(k, fields[k], prep=lambda x: np.where(x < SUM_ZERO_BELOW, 0.0, x))
    if 'tcc' in fields:
        put('tcc', fields['tcc'], prep=lambda x: np.where(x < TCC_ZERO_BELOW, 0.0, x))
    if all(k in fields for k in ('tcc', 'lcc', 'mcc')):
        put('hsh', high_share(fields['tcc'], fields['lcc'], fields['mcc']))
    if 'prate' in fields and 'ptype' in fields:
        rain, snow = split_precip(fields['prate'], fields['ptype'])
        cut = lambda x: np.where(x < PRECIP_ZERO_BELOW, 0.0, x)
        put('rain', rain, prep=cut)
        put('snow', snow, prep=cut)
        fzra, ipel = freezing_precip(fields['prate'], fields['ptype'])
        put('fzra', fzra, prep=cut)
        put('ipel', ipel, prep=cut)
    elif 'rain' in fields and 'snow' in fields:       # ensemble: al gemiddeld en gesplitst per lid
        cut = lambda x: np.where(x < PRECIP_ZERO_BELOW, 0.0, x)
        put('rain', fields['rain'], prep=cut)
        put('snow', fields['snow'], prep=cut)
    if 'u10' in fields and 'v10' in fields:
        put('ws', np.hypot(fields['u10'], fields['v10']))
        # u boven v in één grijs-PNG: alleen in de browser nodig om vaantjes te tekenen
        n = wind_stride(step)
        b = png_bytes(encode('wuv', np.vstack([fields['u10'][::n, ::n], fields['v10'][::n, ::n]])))
        _write(os.path.join(out_dir, 'uv.png'), b)
        info['layers']['uv'] = {'bytes': len(b)}
    for name, a, b in (('uv5', 'u500', 'v500'), ('uv3', 'u300', 'v300'), ('uv8', 'u850', 'v850')):
        if a in fields and b in fields:
            n = wind_stride(step)
            d = png_bytes(encode('juv', np.vstack([fields[a][::n, ::n], fields[b][::n, ::n]])))
            _write(os.path.join(out_dir, f'{name}.png'), d)
            info['layers'][name] = {'bytes': len(d)}
    if 'u100' in fields and 'v100' in fields:
        n = wind_stride(step)
        d = png_bytes(encode('wuv', np.vstack([fields['u100'][::n, ::n], fields['v100'][::n, ::n]])))
        _write(os.path.join(out_dir, 'uv100.png'), d)
        info['layers']['uv100'] = {'bytes': len(d)}
    if 'z500' in fields or 'z300' in fields:
        k = DOMAIN['step'] / step
        hgt = {key: isobars(fields[key], lons, lats, k, st)[1] for key, st in (('z500', Z500_STEP), ('z300', Z300_STEP)) if key in fields}
        d = json.dumps(hgt, separators=(',', ':')).encode()
        _write(os.path.join(out_dir, 'hgt.json'), d)
        info['layers']['hgt'] = {'bytes': len(d)}
    if 'lsm' in fields and 'orog' in fields:
        info['static'] = write_static(fields['lsm'], fields['orog'], lats, static_dir, step)
    if 'msl' in fields:
        put('msl', fields['msl'], lo=False)
        k = DOMAIN['step'] / step
        sm, lines = isobars(fields['msl'], lons, lats, k)
        hl = centres(fields['msl'], sm, lons, lats, k=k)
        thk = isobars(fields['thk'], lons, lats, k, THICK_STEP, THICK_BASE)[1] if 'thk' in fields else []
        b = json.dumps({'step_hpa': ISOBAR_STEP, 'unit': 'km/10', 'lines': lines, 'hl': hl, 'thk': thk},
                       separators=(',', ':')).encode()
        _write(os.path.join(out_dir, 'iso.json'), b)
        info['layers']['iso'] = {'bytes': len(b), 'n': len(lines), 'hl': len(hl)}
    return info
