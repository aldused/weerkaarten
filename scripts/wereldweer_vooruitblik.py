#!/usr/bin/env python3
"""Wereldweer 'Wat komt eraan in Europa?': modelsignalen uit ECMWF IFS HRES (open data, 0,25°), +0 t/m +72 uur.

Geen taalmodel: vaste drempels, vaste zinnen. Per kalenderdag (UTC) en per verschijnsel worden aaneengesloten
gebieden boven de drempel gezocht (minstens 3 rastercellen, ±2000 km²); per gebied de hoogste waarde met
plaats en land uit de gazetteer. Uitdrukkelijk modelinformatie: één deterministische run, geen waarschuwing.

    python3 scripts/wereldweer_vooruitblik.py            # nieuwste run (slaat over als die al verwerkt is)
    python3 scripts/wereldweer_vooruitblik.py --forceer

Download: alleen de benodigde velden via HTTP-range op de .index (±70 MB per run), parallel.
Uitvoer: data/wereldweer/stroom/vooruitblik.json (wordt door wereldweer_stroom.py mee gepubliceerd).
"""
import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import eccodes
import numpy as np
import requests
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wereldweer_geo as G  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
UIT = ROOT / 'data' / 'wereldweer' / 'stroom' / 'vooruitblik.json'
BASE = 'https://data.ecmwf.int/forecasts'
DOMEIN = {'lat_min': 33.0, 'lat_max': 72.0, 'lon_min': -25.0, 'lon_max': 45.0}
D = 0.25
GUST = ('10fg3', '10fg')
DREMPEL = {  # (drempel, eenheid, alleen land?)
    'storm': (100, 'km/u', True),        # zwaarste windstoot op land
    'storm_zee': (125, 'km/u', False),   # zeer zware storm op zee
    'neerslag': (60, 'mm', True),        # neerslagsom in de (deel)dag
    'sneeuw': (15, 'cm', True),          # verse sneeuw bij 10:1
    'hitte': (35, '°C', True),
    'kou': (-20, '°C', True),
    'depressie': (975, 'hPa', False),
}
DAGEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']
MAANDEN = 'januari februari maart april mei juni juli augustus september oktober november december'.split()
S = requests.Session()
S.headers['User-Agent'] = 'weerlab.nl wereldweer'


def basis(run, stap):
    return f"{BASE}/{run:%Y%m%d}/{run:%H}z/ifs/0p25/oper/{run:%Y%m%d%H}0000-{stap}h-oper-fc"


def nieuwste_run(nu):
    """Nieuwste run waarvan +72 u er al staat."""
    t = nu.replace(minute=0, second=0, microsecond=0)
    t -= timedelta(hours=t.hour % 6)
    for _ in range(6):
        r = S.head(basis(t, 72) + '.index', timeout=20)
        if r.status_code == 200:
            return t
        t -= timedelta(hours=6)
    raise RuntimeError('geen run met +72 u gevonden')


def index(run, stap):
    r = S.get(basis(run, stap) + '.index', timeout=30)
    r.raise_for_status()
    uit = {}
    for regel in r.text.splitlines():
        e = json.loads(regel)
        if e.get('levtype') == 'sfc':
            uit[e['param']] = (e['_offset'], e['_length'])
    return uit


def veld(run, stap, off, ln):
    r = S.get(basis(run, stap) + '.grib2', headers={'Range': f'bytes={off}-{off + ln - 1}'}, timeout=60)
    r.raise_for_status()
    gid = eccodes.codes_new_from_message(r.content)
    try:
        ni, nj = eccodes.codes_get(gid, 'Ni'), eccodes.codes_get(gid, 'Nj')
        lat0 = eccodes.codes_get(gid, 'latitudeOfFirstGridPointInDegrees')
        lon0 = eccodes.codes_get(gid, 'longitudeOfFirstGridPointInDegrees')
        v = eccodes.codes_get_values(gid).reshape(nj, ni)
    finally:
        eccodes.codes_release(gid)
    i0, i1 = int(round((lat0 - DOMEIN['lat_max']) / D)), int(round((lat0 - DOMEIN['lat_min']) / D)) + 1
    j = (np.round(((np.arange(DOMEIN['lon_min'], DOMEIN['lon_max'] + D / 2, D) - lon0) % 360) / D).astype(int)) % ni
    return v[i0:i1][:, j].astype(np.float32)


def haal(run):
    stappen = list(range(3, 73, 3))
    grenzen = sorted({s for s in range(0, 73, 3) if (run + timedelta(hours=s)).hour == 0} | {72})
    taken = []
    idx = {s: index(run, s) for s in sorted(set(stappen) | {0} | set(grenzen))}
    taken.append((0, 'lsm'))
    taken.append((0, 'z'))
    for s in stappen:
        g = next((p for p in GUST if p in idx[s]), None)
        if g:
            taken.append((s, g))
        for p in ('mx2t3', 'mn2t3'):
            if p in idx[s]:
                taken.append((s, p))
        if s % 6 == 0:
            taken.append((s, 'msl'))
    for s in grenzen:
        taken += [(s, 'tp'), (s, 'sf')]
    taken = [(s, p) for s, p in taken if p in idx[s]]
    with ThreadPoolExecutor(8) as ex:
        vals = list(ex.map(lambda t: veld(run, t[0], *idx[t[0]][t[1]]), taken))
    return {t: v for t, v in zip(taken, vals)}, grenzen


def dagvensters(run, grenzen):
    """[(dag_start_dt, stap_a, stap_b)] per kalenderdag UTC binnen +0..+72."""
    pts = [0] + grenzen
    uit = []
    for a, b in zip(pts, pts[1:]):
        if b - a >= 6:
            uit.append((a, b))
    return uit


def label_dag(t):
    return f'{DAGEN[t.weekday()]} {t.day} {MAANDEN[t.month - 1]}'


def gebieden(masker, waarden, hoog=True, min_cellen=3):
    lab, n = ndimage.label(masker, structure=np.ones((3, 3)))
    uit = []
    for k in range(1, n + 1):
        m = lab == k
        if m.sum() < min_cellen:
            continue
        w = np.where(m, waarden, -np.inf if hoog else np.inf)
        i, j = np.unravel_index(np.argmax(w) if hoog else np.argmin(w), w.shape)
        uit.append((float(waarden[i, j]), i, j, int(m.sum())))
    return sorted(uit, key=lambda x: -x[0] if hoog else x[0])


def waar(lat, lon, land_cel):
    naam, iso2, km = G.dichtbij(lat, lon)
    l = G.land(iso2) or {'nl': iso2}
    if km < 40:
        tekst = f'bij {naam}'
    elif land_cel:
        tekst = f'{int(round(km / 10) * 10)} km van {naam}'
    else:
        tekst = f'op zee, {int(round(km / 10) * 10)} km van {naam}'
    return {'tekst': f"{tekst} ({l['nl']})", 'plaats': naam, 'land': iso2, 'land_nl': l['nl'], 'km': round(km)}


def signalen(run, velden, grenzen):
    lats = DOMEIN['lat_max'] - np.arange(next(iter(velden.values())).shape[0]) * D
    lons = DOMEIN['lon_min'] + np.arange(next(iter(velden.values())).shape[1]) * D
    land = velden[(0, 'lsm')] > 0.5
    hoog_gebergte = velden[(0, 'z')] / 9.80665 > 1500  # windstoten op modeltoppen zijn geen nieuws
    uit = []

    hoogte = velden[(0, 'z')] / 9.80665

    def voeg(soort, v, i, j, n, a, b, extra=None):
        t0, t1 = run + timedelta(hours=a), run + timedelta(hours=b)
        w = waar(float(lats[i]), float(lons[j]), bool(land[i, j]))
        # alleen Europa (incl. Turkije/Kaukasus), niet de ijskap van Groenland of het Midden-Oosten
        if w['land'] not in G.EUROPA or w['km'] > (400 if soort == 'storm_zee' else 250):
            return
        if soort in ('kou', 'hitte') and hoogte[i, j] > 1000:
            return  # bergtoppen: geen nieuws
        if any(u['soort'] == soort and u['termijn'] == [a, b] and abs(u['lat'] - lats[i]) < 5
               and abs(u['lon'] - lons[j]) < 7 for u in uit):
            return  # zelfde gebied, zelfde dag: alleen de hoogste (de lijst komt gesorteerd binnen)
        if soort == 'sneeuw' and hoogte[i, j] > 1200:
            extra = {**(extra or {}), 'gebergte': True}
        uit.append({'soort': soort, 'waarde': round(v, 1 if soort == 'neerslag' and v < 100 else 0),
                    'eenheid': DREMPEL[soort][1], 'lat': round(float(lats[i]), 2), 'lon': round(float(lons[j]), 2),
                    'waar': w['tekst'], 'plaats': w['plaats'], 'land': w['land'], 'land_nl': w['land_nl'],
                    'oppervlak_km2': int(n * (27.8 * D / .25) ** 2 * np.cos(np.radians(float(lats[i])))),
                    'van': t0.isoformat(), 'tot': t1.isoformat(), 'dag': label_dag(t0), 'termijn': [a, b],
                    **(extra or {})})

    for a, b in dagvensters(run, grenzen):
        st = [s for s in range(a + 3, b + 1, 3)]
        gust = np.nanmax([velden[(s, p)] for s in st for p in GUST if (s, p) in velden], axis=0) * 3.6
        for soort, msk in (('storm', land & ~hoog_gebergte & (gust >= DREMPEL['storm'][0])),
                           ('storm_zee', ~land & (gust >= DREMPEL['storm_zee'][0]))):
            for v, i, j, n in gebieden(msk, gust)[:6]:
                voeg(soort, v, i, j, n, a, b)
        tp = (velden[(b, 'tp')] - (velden[(a, 'tp')] if a else 0)) * 1000
        for v, i, j, n in gebieden(land & (tp >= DREMPEL['neerslag'][0]), tp)[:3]:
            voeg('neerslag', v, i, j, n, a, b)
        sf = (velden[(b, 'sf')] - (velden[(a, 'sf')] if a else 0)) * 1000  # m smeltwater → mm = cm sneeuw bij 10:1
        for v, i, j, n in gebieden(land & (sf >= DREMPEL['sneeuw'][0]), sf)[:3]:
            voeg('sneeuw', v, i, j, n, a, b)
        tx = [velden[(s, 'mx2t3')] for s in st if (s, 'mx2t3') in velden]
        tn = [velden[(s, 'mn2t3')] for s in st if (s, 'mn2t3') in velden]
        if tx:
            tx = np.nanmax(tx, axis=0) - 273.15
            for v, i, j, n in gebieden(land & (tx >= DREMPEL['hitte'][0]), tx)[:2]:
                voeg('hitte', v, i, j, n, a, b)
        if tn:
            tn = np.nanmin(tn, axis=0) - 273.15
            for v, i, j, n in gebieden(land & (tn <= DREMPEL['kou'][0]), tn, hoog=False)[:2]:
                voeg('kou', v, i, j, n, a, b)
    # diepe depressies: per 6-uursstap het minimum; elk systeem één keer (op zijn diepste moment)
    kern = []
    for s in range(6, 73, 6):
        p = velden.get((s, 'msl'))
        if p is None:
            continue
        p = p / 100
        for v, i, j, n in gebieden(p <= DREMPEL['depressie'][0], p, hoog=False, min_cellen=1)[:3]:
            kern.append((v, i, j, s))
    kern.sort()
    gekozen = []
    for v, i, j, s in kern:
        if any(abs(i - i2) * D < 8 and abs(j - j2) * D < 12 for _, i2, j2, _ in gekozen):
            continue  # zelfde systeem (binnen ±8° lat / 12° lon)
        gekozen.append((v, i, j, s))
        t = run + timedelta(hours=s)
        w = waar(float(lats[i]), float(lons[j]), bool(land[i, j]))
        if w['land'] not in G.EUROPA or w['km'] > 900:
            continue
        uit.append({'soort': 'depressie', 'waarde': round(v), 'eenheid': 'hPa', 'lat': round(float(lats[i]), 2),
                    'lon': round(float(lons[j]), 2), 'waar': w['tekst'], 'plaats': w['plaats'], 'land': w['land'],
                    'land_nl': w['land_nl'], 'oppervlak_km2': None, 'van': t.isoformat(), 'tot': t.isoformat(),
                    'dag': label_dag(t), 'termijn': [s, s]})
    return uit


TITEL = {
    'storm': 'Zware windstoten tot {w} km/u {waar}',
    'storm_zee': 'Zeer zware storm op zee: windstoten tot {w} km/u {waar}',
    'neerslag': 'Tot {w} mm neerslag {waar}',
    'sneeuw': 'Tot ±{w} cm verse sneeuw {waar}{berg}',
    'hitte': 'Hitte tot {w} °C {waar}',
    'kou': 'Strenge vorst tot {w} °C {waar}',
    'depressie': 'Diepe depressie van {w} hPa {waar}',
}


def tekstueel(s, run):
    w = str(int(s['waarde'])) if s['soort'] != 'neerslag' or s['waarde'] >= 100 else str(s['waarde']).replace('.', ',')
    if s['soort'] == 'kou':
        w = w.replace('-', '−')
    s['titel'] = TITEL[s['soort']].format(w=w, waar=s['waar'], berg=' (gebergte)' if s.get('gebergte') else '')
    van, tot = datetime.fromisoformat(s['van']), datetime.fromisoformat(s['tot'])
    if s['soort'] == 'depressie':
        s['periode'] = f"{s['dag']} {van:%H} UTC (+{s['termijn'][0]} u)"
    else:
        eind = f'{tot:%H}' if tot.hour else '24'
        s['periode'] = f"{s['dag']}, {van:%H}–{eind} UTC (+{s['termijn'][0]} t/m +{s['termijn'][1]} u)"
        if s['soort'] == 'neerslag':
            s['periode'] = 'som ' + s['periode']
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--forceer', action='store_true')
    args = ap.parse_args()
    nu = datetime.now(timezone.utc)
    run = nieuwste_run(nu)
    oud = json.loads(UIT.read_text()) if UIT.exists() else {}
    if oud.get('run') == run.isoformat() and not args.forceer:
        print(f'run {run:%d/%m %H} UTC al verwerkt', file=sys.stderr)
        return
    velden, grenzen = haal(run)
    sig = [tekstueel(s, run) for s in signalen(run, velden, grenzen)]
    prio = {'storm': 0, 'depressie': 1, 'neerslag': 2, 'sneeuw': 3, 'storm_zee': 4, 'hitte': 5, 'kou': 6}
    sig.sort(key=lambda s: (s['van'][:10], prio[s['soort']], -abs(s['waarde'])))
    data = {'gemaakt': nu.isoformat(timespec='seconds'), 'run': run.isoformat(),
            'model': 'ECMWF IFS HRES (deterministisch), open data 0,25°', 'termijn': '+0 t/m +72 uur',
            'drempels': {k: f'{"≤" if k in ("kou", "depressie") else "≥"} {v[0]} {v[1]}' + (' (land)' if v[2] else '')
                         for k, v in DREMPEL.items()},
            'uitleg': ('Automatisch afgeleid uit één modelrun: geen officiële waarschuwing en geen kansverwachting. '
                       'Windstoten boven 1500 m modelhoogte tellen niet mee; sneeuw is omgerekend met 1 cm per mm '
                       'smeltwater (10:1). Waarschuwingen staan bij Meteoalarm en de nationale weerdiensten.'),
            'signalen': sig}
    UIT.parent.mkdir(parents=True, exist_ok=True)
    tmp = UIT.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    tmp.replace(UIT)
    print(f'run {run:%d/%m %H} UTC: {len(sig)} signalen', file=sys.stderr)


if __name__ == '__main__':
    main()
