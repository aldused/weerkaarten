"""Windplaat-rooster: wind, windstoten en windrichting per uur voor heel Nederland.

De pagina weerbewaking_windplaat.html haalt dit rooster op en rekent zelf de verwachting uit
voor elke plaats die je intikt (bilineair tussen de vier omliggende roosterpunten).

  Uur 1-60   KNMI HARMONIE 43, volle 2 km-modelresolutie, om de 2 punten (≈ 3-4 km)
             (weerlab/harmonie_canvas_meta.json + harmonie_native_wind/windstoten.bin)
  daarna     ECMWF IFS 0,25° uit grib_cache/wx_wind.grib2 + wx_gust.grib2, uurlijks
             geïnterpoleerd, tot 96 uur na het eerste HARMONIE-uur (pagina toont er 90)

Uitvoer (map --out):
  windplaat_<run>_<ifs>.bin   uint8, volgorde [veld][uur][y][x]; velden ws, wg (km/u), wd/2 (°)
  current.json                metadata + bestandsnaam van het rooster

  python3 weerlab/scripts/windplaat_grid.py --out windplaat_cache            # bouwen
  python3 weerlab/scripts/windplaat_grid.py --out windplaat_cache --publish  # + naar R2
"""
import argparse, datetime as dt, json, struct, subprocess, sys
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np

ROOT = Path('/Users/aldus/KNMI_Project')
BOX = (50.70, 53.72, 3.15, 7.35)       # lat_min, lat_max, lon_min, lon_max (NL + rand)
STRIDE = 2                             # elk 2e HARMONIE-punt
HOURS = 96
R2 = 'r2:weerlab-data/windplaat'
RCLONE = '/opt/homebrew/bin/rclone'
Z, U = ZoneInfo('Europe/Amsterdam'), dt.timezone.utc


def h43(root):
    src = root / 'weerlab'
    raw = (src / 'harmonie_canvas_meta.json').read_bytes(); meta = json.loads(raw)
    if meta.get('model') != 'HARMONIE V43':
        raise SystemExit('Geen HARMONIE 43-bron')
    out = {}
    for key in ('wind_hr', 'windstoten_hr'):
        p = meta['parameters'][key]; g = p['grid']
        blob = (src / p['file']).read_bytes()
        ny, nx, nt, nc = struct.unpack('<HHHH', blob[:8])
        if (ny, nx, nc) != (g['n_lat'], g['n_lon'], 2) or nt != len(meta['tijden']):
            raise SystemExit(f'{key}: bin en meta komen niet overeen')
        out[key] = np.frombuffer(blob[16:], dtype='<f4').reshape(nt, nc, ny, nx)
    g = meta['parameters']['wind_hr']['grid']
    lats = np.linspace(g['lat_min'], g['lat_max'], g['n_lat'])
    lons = np.linspace(g['lon_min'], g['lon_max'], g['n_lon'])
    iy = np.where((lats >= BOX[0]) & (lats <= BOX[1]))[0][::STRIDE]
    ix = np.where((lons >= BOX[2]) & (lons <= BOX[3]))[0][::STRIDE]
    w = out['wind_hr'][:, :, iy][:, :, :, ix]; gu = out['windstoten_hr'][:, :, iy][:, :, :, ix]
    if not (np.isfinite(w).all() and np.isfinite(gu).all()):
        raise SystemExit('Ontbrekende HARMONIE-waarden')
    run = dt.datetime.fromisoformat(meta['run_utc'].replace('Z', '+00:00'))
    t0 = dt.datetime.fromisoformat(meta['tijden'][0]).replace(tzinfo=Z).astimezone(U)
    if not (run < t0 <= run + dt.timedelta(hours=3)):
        raise SystemExit(f'Onverwacht eerste uur {t0} bij run {run}')
    return run, t0, lats[iy], lons[ix], w[:, 0], w[:, 1], np.hypot(gu[:, 0], gu[:, 1])


def ifs_fields(root):
    """{shortName: {endStep: veld}} rond NL + run en roosterassen; None als eccodes ontbreekt."""
    try:
        import eccodes as ec
    except ImportError:
        print('eccodes ontbreekt: rooster alleen uit HARMONIE 43 (60 uur)', file=sys.stderr)
        return None
    vals, run, axes = {}, None, None
    for name in ('wind', 'gust'):
        path = root / f'grib_cache/wx_{name}.grib2'
        if not path.exists():
            return None
        with open(path, 'rb') as fh:
            while (h := ec.codes_grib_new_from_file(fh)) is not None:
                sn = ec.codes_get(h, 'shortName')
                if sn in ('10u', '10v', '10fg', '10fg3'):
                    ni, nj = ec.codes_get(h, 'Ni'), ec.codes_get(h, 'Nj')
                    la0 = ec.codes_get(h, 'latitudeOfFirstGridPointInDegrees')
                    lo0 = ec.codes_get(h, 'longitudeOfFirstGridPointInDegrees')
                    d = ec.codes_get(h, 'iDirectionIncrementInDegrees')
                    la = la0 - d * np.arange(nj); lo = (lo0 + d * np.arange(ni) + 180) % 360 - 180
                    a = ec.codes_get_values(h).reshape(nj, ni)
                    ky = np.where((la >= BOX[0] - 1) & (la <= BOX[1] + 1))[0]
                    kx = np.where((lo >= BOX[2] - 1) & (lo <= BOX[3] + 1))[0]
                    axes = (la[ky], lo[kx])
                    key = 'gust' if sn.startswith('10fg') else sn
                    vals.setdefault(key, {})[int(ec.codes_get(h, 'endStep'))] = a[np.ix_(ky, kx)]
                    r = dt.datetime.strptime(f"{ec.codes_get(h, 'dataDate')}{ec.codes_get(h, 'dataTime'):04d}",
                                             '%Y%m%d%H%M').replace(tzinfo=U)
                    if run and r != run:
                        raise SystemExit('wx_wind en wx_gust komen uit verschillende runs')
                    run = r
                ec.codes_release(h)
    return run, axes, vals


def regrid(field, axes, lats, lons):
    """Bilineair van het IFS-rooster (dalende lat) naar de HARMONIE-subpunten."""
    la, lo = axes
    fy = np.interp(lats, la[::-1], np.arange(len(la))[::-1])
    fx = np.interp(lons, lo, np.arange(len(lo)))
    i0 = np.clip(np.floor(fy).astype(int), 0, len(la) - 2); j0 = np.clip(np.floor(fx).astype(int), 0, len(lo) - 2)
    wy = (fy - i0)[:, None]; wx = (fx - j0)[None, :]
    I, J = i0[:, None], j0[None, :]
    return (field[I, J] * (1 - wy) * (1 - wx) + field[I + 1, J] * wy * (1 - wx)
            + field[I, J + 1] * (1 - wy) * wx + field[I + 1, J + 1] * wy * wx)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', type=Path, default=ROOT)
    ap.add_argument('--out', type=Path, default=ROOT / 'windplaat_cache')
    ap.add_argument('--publish', action='store_true')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args(); a.out.mkdir(parents=True, exist_ok=True)

    run, t0, lats, lons, u, v, gust = h43(a.root)
    ifs = ifs_fields(a.root)
    ifs_run = ifs[0] if ifs else None
    if ifs_run and t0 + dt.timedelta(hours=HOURS) > ifs_run + dt.timedelta(hours=max(ifs[2]['10u'])):
        print('IFS-run reikt niet ver genoeg; alleen HARMONIE', file=sys.stderr); ifs = ifs_run = None
    tag = f'{run:%Y%m%d%H}' + (f'_ifs{ifs_run:%Y%m%d%H}' if ifs_run else '')
    cur = a.out / 'current.json'
    if not a.force and cur.exists() and json.loads(cur.read_text()).get('tag') == tag:
        print(f'Windplaat-rooster al actueel ({tag})'); return

    ws = np.hypot(u, v) * 3.6; wd = np.degrees(np.arctan2(-u, -v)) % 360; wg = gust * 3.6
    n_h43 = ws.shape[0]
    if ifs:
        _, axes, e = ifs
        su = sorted(e['10u']); sg = sorted(e['gust'])
        U10 = np.stack([e['10u'][s] for s in su]); V10 = np.stack([e['10v'][s] for s in su])
        G10 = np.stack([e['gust'][s] for s in sg]); mid = np.array(sg, float) - 1.5   # 3-uursmax op venstermidden
        extra = []
        for k in range(n_h43, HOURS):
            st = (t0 + dt.timedelta(hours=k) - ifs_run).total_seconds() / 3600
            def lin(steps, stack):
                j = int(np.clip(np.searchsorted(steps, st) - 1, 0, len(steps) - 2)); w = (st - steps[j]) / (steps[j + 1] - steps[j])
                return stack[j] * (1 - np.clip(w, 0, 1)) + stack[j + 1] * np.clip(w, 0, 1)
            uu = regrid(lin(np.array(su, float), U10), axes, lats, lons)
            vv = regrid(lin(np.array(su, float), V10), axes, lats, lons)
            gg = regrid(lin(mid, G10), axes, lats, lons)
            extra.append((np.hypot(uu, vv) * 3.6, np.degrees(np.arctan2(-uu, -vv)) % 360, gg * 3.6))
        ws = np.concatenate([ws, np.stack([x[0] for x in extra])])
        wd = np.concatenate([wd, np.stack([x[1] for x in extra])])
        wg = np.concatenate([wg, np.stack([x[2] for x in extra])])
    wg = np.maximum(wg, ws)
    cube = np.stack([np.clip(np.rint(ws), 0, 255), np.clip(np.rint(wg), 0, 255),
                     np.rint(wd / 2) % 180]).astype(np.uint8)          # [veld][uur][y][x]
    name = f'windplaat_{tag}.bin'
    (a.out / name).write_bytes(cube.tobytes())
    meta = dict(schema=1, tag=tag, file=name, generated=dt.datetime.now(U).isoformat(timespec='minutes'),
                h43_run=run.isoformat(), ifs_run=ifs_run.isoformat() if ifs_run else None,
                t0=t0.isoformat(), hours=int(ws.shape[0]), n_h43=int(n_h43),
                fields=['ws', 'wg', 'wd2'], units='km/u; wd2 = richting/2 in graden',
                grid=dict(ny=len(lats), nx=len(lons), lat0=round(float(lats[0]), 5), dlat=round(float(lats[1] - lats[0]), 6),
                          lon0=round(float(lons[0]), 5), dlon=round(float(lons[1] - lons[0]), 6)))
    for old in a.out.glob('windplaat_*.bin'):
        if old.name != name:
            old.unlink()
    if a.publish:
        subprocess.run([RCLONE, 'copyto', str(a.out / name), f'{R2}/{name}',
                        '--header-upload', 'Cache-Control: public, max-age=31536000, immutable'], check=True)
    tmp = cur.with_suffix('.tmp'); tmp.write_text(json.dumps(meta)); tmp.replace(cur)
    if a.publish:
        subprocess.run([RCLONE, 'copyto', str(cur), f'{R2}/current.json', '--header-upload', 'Cache-Control: no-cache'], check=True)
    print(f'Windplaat-rooster {tag}: {meta["hours"]} uur ({n_h43} HARMONIE), {len(lats)}×{len(lons)} punten, '
          f'{cube.nbytes / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
