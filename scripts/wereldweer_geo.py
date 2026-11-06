#!/usr/bin/env python3
"""Wereldweer-gazetteer: landen, regio's (admin-1) en plaatsen uit Natural Earth 10m (cartopy-cache).

Het taalmodel noemt alleen *namen* (ISO2-land + plaats/regio); de coördinaten komen hier vandaan.
Zo staat een kaartmarkering nooit op een door een model verzonnen punt. Wat niet herleidbaar is,
krijgt de landcoördinaat met nauwkeurigheid 'land', of geen markering.

    python3 scripts/wereldweer_geo.py --bouw      # → data/wereldweer/geo/gazetteer.json (eenmalig, ±3 s)
    python3 scripts/wereldweer_geo.py IT Abruzzo  # test een opzoeking
"""
import json
import re
import sys
import unicodedata
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAZ = ROOT / 'data' / 'wereldweer' / 'geo' / 'gazetteer.json'

# Europese regiofilters op de pagina. Een land kan in meer groepen vallen (AT/CH: Alpen én Centraal).
REGIO_GROEPEN = {
    'benelux': ['NL', 'BE', 'LU'],
    'west': ['FR', 'DE', 'NL', 'BE', 'LU', 'MC'],
    'britse_eilanden': ['GB', 'IE', 'IM', 'JE', 'GG'],
    'scandinavie': ['NO', 'SE', 'DK', 'FI', 'IS', 'FO', 'SJ', 'AX', 'GL'],
    'alpen': ['CH', 'AT', 'LI', 'SI'],
    'zuid': ['ES', 'PT', 'IT', 'GR', 'MT', 'CY', 'AD', 'SM', 'VA', 'GI', 'HR', 'AL', 'ME', 'BA', 'MK', 'XK', 'RS',
             'TR', 'BG'],
    'centraal': ['DE', 'PL', 'CZ', 'SK', 'HU', 'AT', 'CH', 'SI', 'LI'],
    'oost': ['UA', 'BY', 'MD', 'RO', 'BG', 'RU', 'LT', 'LV', 'EE', 'RS', 'GE', 'AM', 'AZ'],
}
# Alpengebied buiten AT/CH/LI/SI: Franse, Italiaanse en Duitse Alpen binnen deze box tellen ook mee
ALPEN_BOX = (43.8, 48.4, 5.2, 16.6)  # lat_min, lat_max, lon_min, lon_max
EUROPA = sorted({c for v in REGIO_GROEPEN.values() for c in v} | {'XE'})  # XE = 'Europa breed' (geen land)

WERELD_GROEPEN = {  # Natural Earth CONTINENT → filter op de pagina
    'North America': 'noord_amerika', 'South America': 'zuid_amerika', 'Asia': 'azie', 'Africa': 'afrika',
    'Oceania': 'oceanie', 'Antarctica': 'polen', 'Europe': 'europa',
}
# Pseudocodes voor zeeën/oceanen/polen (het model mag die gebruiken); coördinaat = representatief punt
PSEUDO = {
    'XA': ('Atlantische Oceaan', 30.0, -40.0, 'wereld'),
    'XP': ('Grote Oceaan', 15.0, 150.0, 'wereld'),
    'XI': ('Indische Oceaan', -10.0, 80.0, 'wereld'),
    'XN': ('Noordpoolgebied', 80.0, 0.0, 'polen'),
    'XS': ('Zuidpoolgebied', -78.0, 0.0, 'polen'),
    'XM': ('Middellandse Zee', 37.0, 17.0, 'europa'),
    'XE': ('Europa', 50.0, 10.0, 'europa'),
    'XW': ('Wereld', None, None, 'wereld'),
}


def sleutel(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\b(province|provincia|region|regione|county|oblast|kraj|voivodeship|wojewodztwo|departement|'
               r'department|state|land|canton|kanton|district|prefecture|municipality|of|de|di|del|la|le)\b', ' ', s)
    return re.sub(r'[^a-z0-9]+', '', s)


def bouw():
    import cartopy.io.shapereader as shp
    landen, regios, plaatsen, groot = {}, {}, {}, {}
    for rec in shp.Reader(shp.natural_earth('10m', 'cultural', 'admin_0_countries')).records():
        a = rec.attributes
        iso = a['ISO_A2'] if a['ISO_A2'] not in ('-99', '') else a['ISO_A2_EH']
        if iso in ('-99', ''):
            continue
        # grootste deel van het land (Frankrijk zonder Guyana, Noorwegen zonder Svalbard)
        geom = max(getattr(rec.geometry, 'geoms', [rec.geometry]), key=lambda g: g.area)
        if iso in landen and landen[iso]['_opp'] >= geom.area:  # Clipperton heet in NE ook 'FR'
            continue
        hp = geom.representative_point()
        landen[iso] = {'nl': a['NAME_NL'] or a['NAME'], 'en': a['NAME_EN'] or a['NAME'], 'lat': round(hp.y, 2),
                       'lon': round(hp.x, 2), 'bbox': [round(x, 1) for x in geom.bounds],
                       'continent': WERELD_GROEPEN.get(a['CONTINENT'], 'wereld'), '_opp': geom.area}
    for l in landen.values():
        l.pop('_opp')
    # Rusland en Turkije: continent volgens NE (Europe/Asia) – voor de pagina tellen beide als Europa-dekking
    for iso in ('RU', 'TR', 'GE', 'AM', 'AZ', 'CY'):
        if iso in landen:
            landen[iso]['continent'] = 'europa'
    for rec in shp.Reader(shp.natural_earth('10m', 'cultural', 'admin_1_states_provinces')).records():
        a = rec.attributes
        iso = a['iso_a2']
        if not iso or iso == '-99':
            continue
        namen = {a.get(k) for k in ('name', 'name_en', 'name_nl', 'woe_name', 'gn_name', 'name_local')} | set(
            (a.get('name_alt') or '').split('|'))
        namen = sorted({n for n in namen if n})
        regios.setdefault(iso, []).append({'n': a['name_nl'] or a['name'], 'k': sorted({sleutel(n) for n in namen} - {''}),
                                           'lat': round(a['latitude'], 2), 'lon': round(a['longitude'], 2)})
        if a.get('region'):  # Italië/Frankrijk/Spanje: NE-admin1 = provincie, 'region' = de regio (Abruzzo, Corse)
            groot.setdefault((iso, a['region']), []).append((a['latitude'], a['longitude']))
    for (iso, naam), pts in groot.items():
        k = sleutel(naam)
        if k and not any(k in r['k'] for r in regios[iso]):
            regios[iso].append({'n': naam, 'k': [k], 'lat': round(sum(p[0] for p in pts) / len(pts), 2),
                                'lon': round(sum(p[1] for p in pts) / len(pts), 2)})
    for rec in shp.Reader(shp.natural_earth('10m', 'cultural', 'populated_places')).records():
        a = rec.attributes
        iso = a['ISO_A2']
        if not iso or iso == '-99':
            continue
        namen = {a.get(k) for k in ('NAME', 'NAMEASCII', 'NAME_EN', 'NAME_NL', 'NAME_DE', 'NAME_FR', 'NAME_IT',
                                    'NAME_ES', 'NAME_PL')} | set((a.get('NAMEALT') or '').split('|'))
        plaatsen.setdefault(iso, []).append({'n': a['NAME_NL'] or a['NAME'], 'k': sorted({sleutel(n) for n in namen if n} - {''}),
                                             'lat': round(a['LATITUDE'], 3), 'lon': round(a['LONGITUDE'], 3),
                                             'pop': int(a['POP_MAX'] or 0), 'adm1': a['ADM1NAME']})
    # GeoNames cities5000 (CC BY 4.0, download.geonames.org): ook kleine plaatsen (Zakopane, Chamonix, Porto-Vecchio)
    gn = GAZ.parent / 'bron' / 'cities5000.txt'
    if gn.exists():
        for regel in gn.open(encoding='utf-8'):
            c = regel.rstrip('\n').split('\t')
            iso = c[8]
            namen = {c[1], c[2]} | {n for n in c[3].split(',') if n and n.isascii() or re.match(r'^[\w\s\'-]+$', n or '')
                                     and not re.search(r'[\u0400-\uffff]', n)}
            ks = sorted({sleutel(n) for n in namen} - {''})
            plaatsen.setdefault(iso, []).append({'n': c[1], 'k': ks, 'lat': round(float(c[4]), 3),
                                                 'lon': round(float(c[5]), 3), 'pop': int(c[14] or 0), 'adm1': None})
    GAZ.parent.mkdir(parents=True, exist_ok=True)
    GAZ.write_text(json.dumps({'landen': landen, 'regios': regios, 'plaatsen': plaatsen}, ensure_ascii=False))
    print(f'{len(landen)} landen, {sum(map(len, regios.values()))} regio\'s, '
          f'{sum(map(len, plaatsen.values()))} plaatsen → {GAZ}', file=sys.stderr)


@lru_cache(1)
def gaz():
    if not GAZ.exists():
        bouw()
    return json.loads(GAZ.read_text())


def land(iso):
    iso = (iso or '').upper()
    if iso in PSEUDO:
        n, lat, lon, cont = PSEUDO[iso]
        return {'nl': n, 'en': n, 'lat': lat, 'lon': lon, 'continent': cont, 'bbox': None}
    return gaz()['landen'].get(iso)


def in_box(lat, lon, bbox, marge=1.0):
    return bbox is None or (bbox[0] - marge <= lon <= bbox[2] + marge and bbox[1] - marge <= lat <= bbox[3] + marge)


def zoek(iso, plaats=None, regio=None):
    """→ {'lat','lon','nauwkeurigheid': plaats|regio|land, 'naam'} of None. Alleen binnen het opgegeven land."""
    iso = (iso or '').upper()
    l = land(iso)
    if not l:
        return None
    g = gaz()
    for naam, soort in ((plaats, 'plaats'), (regio, 'regio')):
        for deel in re.split(r'\s*[,/;]\s*|\s+en\s+|\s+and\s+', naam or ''):
            k = sleutel(deel)
            if len(k) < 3:
                continue
            kand = []
            if soort == 'plaats':
                kand = sorted((p for p in g['plaatsen'].get(iso, []) if k in p['k']), key=lambda p: -p['pop'])
            if not kand:  # plaatsnaam kan ook een regionaam zijn (en omgekeerd)
                kand = [r for r in g['regios'].get(iso, []) if k in r['k']]
                soort_echt = 'regio'
            else:
                soort_echt = 'plaats'
            if not kand and soort == 'regio':
                kand = sorted((p for p in g['plaatsen'].get(iso, []) if k in p['k']), key=lambda p: -p['pop'])
                soort_echt = 'plaats'
            if kand:
                c = kand[0]
                return {'lat': c['lat'], 'lon': c['lon'], 'nauwkeurigheid': soort_echt, 'naam': c['n']}
    if l['lat'] is None:
        return None
    return {'lat': l['lat'], 'lon': l['lon'], 'nauwkeurigheid': 'land', 'naam': l['nl']}


@lru_cache(1)
def _grote_plaatsen():
    import numpy as np
    rij = [(p['lat'], p['lon'], p['n'], iso, p['pop']) for iso, lst in gaz()['plaatsen'].items() for p in lst
           if p['pop'] >= 25000]
    arr = np.array([(r[0], r[1]) for r in rij])
    return rij, np.radians(arr)


def dichtbij(lat, lon, min_pop=25000):
    """Dichtstbijzijnde plaats (≥ min_pop inwoners) → (naam, iso2, afstand_km)."""
    import numpy as np
    rij, arr = _grote_plaatsen()
    la, lo = np.radians(lat), np.radians(lon)
    a = np.sin((arr[:, 0] - la) / 2) ** 2 + np.cos(la) * np.cos(arr[:, 0]) * np.sin((arr[:, 1] - lo) / 2) ** 2
    km = 6371 * 2 * np.arcsin(np.sqrt(a))
    if min_pop > 25000:
        km = np.where(np.array([r[4] for r in rij]) >= min_pop, km, 1e9)
    i = int(np.argmin(km))
    return rij[i][2], rij[i][3], float(km[i])


def groepen(iso, lat=None, lon=None):
    """Regiofilters waar een gebeurtenis onder valt (Europa) of het werelddeel."""
    iso = (iso or '').upper()
    uit = [g for g, landen_ in REGIO_GROEPEN.items() if iso in landen_]
    if lat is not None and iso in ('FR', 'IT', 'DE') and ALPEN_BOX[0] <= lat <= ALPEN_BOX[1] \
            and ALPEN_BOX[2] <= lon <= ALPEN_BOX[3]:
        uit.append('alpen')
    l = land(iso)
    cont = l['continent'] if l else 'wereld'
    if iso in EUROPA or cont == 'europa':
        return ['europa'] + sorted(set(uit))
    return [cont]


if __name__ == '__main__':
    if '--bouw' in sys.argv:
        bouw()
    else:
        print(zoek(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None), groepen(sys.argv[1]))
