"""
Nederlandse weerkaarten (animatie) — ECMWF HRES en HARMONIE

Sociale kaarten voor neerslagsom, windkracht, windstoten, temperatuur en zicht:
kleurvlak + cijfers op een raster, verticale kleurschaal rechts en run/geldigheid
in de kop. Per beschikbaar model een GIF, een mp4 en een losse eindkaart.

Modellen:
  ecmwf     ECMWF IFS HRES 9 km uit open data (veld `tp`).
            Alle vier runs (00/06/12/18 UTC) lopen t/m +144u in 3-uursstappen.
  harmonie  KNMI HARMONIE V46 2,5 km, elk uur een nieuwe run, t/m +60u
            in uurstappen. Leest de cumulatieve som die de bestaande
            harmonie46_update.sh-pijplijn al wegschrijft, inclusief zicht,
            dus geen tweede download van de 865 MB-run-tar.

Gebruik:
    python benelux_neerslag_anim.py --demo                    # synthetische data
    python benelux_neerslag_anim.py                           # ECMWF, laatste run
    python benelux_neerslag_anim.py --model harmonie          # HARMONIE, laatste run
    python benelux_neerslag_anim.py --run 6 --max-step 72
    python benelux_neerslag_anim.py --no-mp4                  # alleen GIF
"""

import os
import glob
import hashlib
import json
import shutil
import struct
import tempfile
import argparse
import subprocess
import warnings
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
from matplotlib.colors import ListedColormap, BoundaryNorm
from matplotlib.lines import Line2D
from matplotlib.offsetbox import TextArea, HPacker, VPacker, AnchoredOffsetbox
from scipy.interpolate import RegularGridInterpolator
import cartopy.crs as ccrs
import cartopy.feature as cfeature

warnings.filterwarnings('ignore')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WEERLAB_DIR = os.path.dirname(SCRIPT_DIR)
BASE_DIR   = os.path.dirname(WEERLAB_DIR)
GRIB_DIR   = os.path.join(BASE_DIR, 'grib_cache')
OUTPUT_DIR = os.environ.get('WEERLAB_KAARTEN_OUTPUT_DIR',
                            os.path.join(BASE_DIR, 'benelux_neerslag'))
FRAME_ROOT = os.path.join(OUTPUT_DIR, 'frames')
HARMONIE_DIR = WEERLAB_DIR
LOCAL_TZ = ZoneInfo('Europe/Amsterdam')

PROJ    = ccrs.LambertConformal(central_longitude=4.9, central_latitude=51.5,
                                standard_parallels=(49.0, 54.0))
PROJ_PC = ccrs.PlateCarree()

# ── Modelconfiguratie ────────────────────────────────────────────────────────
# extent      = lon_min, lon_max, lat_min, lat_max van het kaartvenster
# interp_step = doelresolutie in graden voor het kleurvlak
ECMWF_RUN_HOURS = (0, 6, 12, 18)
ECMWF_MAX       = 144              # alle vier dagelijkse runs, 3-uursstappen
HARMONIE_MAX    = 60

MODELS = {
    'ecmwf': {
        'label':       'ECMWF HRES 9 km',
        'bron':        'ECMWF IFS HRES 9 km (open data)',
        'credit':      '© ECMWF (open data)',
        'extent':      [2.2, 8.2, 50.5, 54.2],
        'interp_step': 0.05,
        'tijdzone':    'utc',
    },
    'harmonie': {
        'label':       'HARMONIE V46',
        'bron':        'KNMI HARMONIE V46 2,5 km',
        'credit':      '© KNMI · HARMONIE V46',
        # Nederland van Zuid-Limburg tot en met de Wadden. De strakke uitsnede
        # geeft op X veel meer bruikbare pixels per provincie dan Benelux-breed.
        'extent':      [2.2, 8.2, 50.5, 54.2],
        'interp_step': 0.02,        # native ~0,018° lat / 0,029° lon
        'tijdzone':    'local',
    },
}


def prefix_van(model, var):
    """Bestandsprefix. neerslag houdt zijn oude namen (bestaande R2-links)."""
    return f'benelux_{var}' + ('_harmonie' if model == 'harmonie' else '')

# ── Kleurschalen per veld ────────────────────────────────────────────────────

# Neerslagsom (mm), in de indeling van noodweer.be: fijne stappen onderin
# (blauw t/m 5 mm, groen t/m 10) en logaritmisch oplopend naar boven, via geel,
# oranje en rood naar paars/roze. Daardoor blijft een 60-uurs HARMONIE-som met
# een paar millimeter net zo leesbaar als een 144-uurs ECMWF-som.
PRECIP_LEVELS = [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40, 50,
                 60, 80, 100, 150, 200, 300]
PRECIP_COLORS = ['#eaf7fd', '#c9eafa', '#9adcf5', '#5fc4ec', '#2ba6e0',
                 '#19a94b', '#37bf4e', '#7ed24a', '#c3e243',
                 '#f2ea3c', '#fcd130', '#fba52a', '#f77b25',
                 '#ef4a22', '#e01f1f', '#c00d0d', '#8f0a1e',
                 '#a3178f', '#c44bb5', '#dd8ad2', '#eec0e6', '#f8e3f4']
PRECIP_OVER   = '#fdf3fa'

# Wind: de klassegrenzen ZIJN de Beaufort-drempels in km/u, dus één kleurvlak =
# één windkracht. Gemiddelde wind en windstoot delen de schaal, zodat je in één
# oogopslag ziet hoeveel klassen de stoot boven het gemiddelde uitkomt.
BFT_GRENZEN = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]   # Bft 1..12
BFT_KLASSEN = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']
WIND_COLORS = ['#f4fafd', '#dceef8', '#b9dcef', '#8ec6e4', '#5fa9d4', '#43a95f',
               '#8dc63f', '#e8d02e', '#f2a232', '#e2632a', '#c41f1f']
WIND_OVER   = '#7a1270'                    # Bft 12 en hoger

# Temperatuur (°C): 2,5°-stappen in het bereik dat er in Nederland toe doet,
# grovere stappen aan de uiteinden. De overgang licht→warm valt op 0 °C.
TEMP_LEVELS = [-25, -20, -15, -10, -5, 0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20,
               22.5, 25, 27.5, 30, 32.5, 35]
TEMP_COLORS = ['#3b0a52', '#5b2a8f', '#3949ab', '#3f7fc9', '#7fb8e0', '#c9e6f5',
               '#e4f3e6', '#d2ecbe', '#b7e08a', '#dceca0', '#f5efa0',
               '#fbe07a', '#fac95a', '#f7ab41', '#f28a33', '#e8642a', '#d63f24',
               '#b71c1c', '#8e0f4a']
TEMP_UNDER  = '#1a0330'
TEMP_OVER   = '#5d0b3a'

# Horizontaal zicht (km). Slecht zicht krijgt waarschuwende paars/rood/oranje
# tinten; goed zicht loopt via groen naar lichtblauw. Het KNMI-veld is op 50 km
# afgetopt, daarom eindigt de schaal daar ook.
ZICHT_LEVELS = [0, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 50]
ZICHT_COLORS = ['#5b006e', '#a50026', '#d73027', '#f46d43', '#fdae61',
                 '#fee08b', '#d9ef8b', '#91cfbd', '#d9eef7']
ZICHT_UNDER  = '#2d0038'
ZICHT_OVER   = '#f7fbff'


def _fmt_mm(v):
    return f'{v:.0f}'


def _fmt_heel(v):
    return f'{v:.0f}'


def _fmt_bft(v):
    """km/u → windkracht. De klassegrenzen zijn precies de kleurvlakgrenzen,
    dus het cijfer benoemt het vlak waar het in staat."""
    return f'{sum(1 for grens in BFT_GRENZEN if v >= grens)}'


def _fmt_zicht(v):
    return f'{v:.1f}' if v < 1 else f'{v:.0f}'


# Soort bepaalt de kopregels: 'som' loopt op vanaf de run, 'moment' is de waarde
# op de geldigheidstijd en 'interval' een maximum over het voorgaande tijdvak.
VARS = {
    'neerslag': {
        'titel':      'neerslagsom',
        'eenheid':    'mm',
        'soort':      'som',
        'subtitel':   None,                        # som krijgt "vanaf <run>"
        'menu':       'Neerslagsom',
        'levels':     PRECIP_LEVELS,
        'colors':     PRECIP_COLORS,
        'over':       PRECIP_OVER,
        'under':      '#ffffff',
        'cb_klassen': None,
        'label_min':  1.0,
        'label_fmt':  _fmt_mm,
        'ecmwf_params': ['tp'],
        'ecmwf_cache':  'tp',                      # bestaande GRIB-cache hergebruiken
        'harmonie':   ('harmonie46_data_cumul.bin', 'native'),
    },
    'wind': {
        'titel':      'windkracht',
        'eenheid':    'Bft',
        'soort':      'moment',
        'subtitel':   'windkracht in Beaufort, op 10 meter',
        'menu':       'Windkracht',
        'levels':     BFT_GRENZEN,
        'colors':     WIND_COLORS,
        'over':       WIND_OVER,
        'under':      '#ffffff',
        'cb_klassen': BFT_KLASSEN,
        'label_min':  None,
        'label_fmt':  _fmt_bft,
        'ecmwf_params': ['10u', '10v'],
        'ecmwf_cache':  'wind',
        'harmonie':   ('harmonie46_data_wind.bin', 'canvas'),
    },
    'windstoten': {
        'titel':      'windstoten',
        'eenheid':    'Bft',
        'soort':      'interval',
        'subtitel':   'hoogste stoot per stap · kleurvlak Beaufort, cijfers in km/u',
        'menu':       'Windstoten',
        'levels':     BFT_GRENZEN,
        'colors':     WIND_COLORS,
        'over':       WIND_OVER,
        'under':      '#ffffff',
        'cb_klassen': BFT_KLASSEN,
        'label_min':  None,
        'label_fmt':  _fmt_heel,
        'ecmwf_params': ['10fg', '10fg3'],
        'ecmwf_cache':  'windstoten',
        'harmonie':   ('harmonie46_data_windstoten.bin', 'canvas'),
    },
    'temp': {
        'titel':      'temperatuur',
        'eenheid':    '°C',
        'soort':      'moment',
        'subtitel':   'temperatuur op 2 meter',
        'menu':       'Temperatuur',
        'levels':     TEMP_LEVELS,
        'colors':     TEMP_COLORS,
        'over':       TEMP_OVER,
        'under':      TEMP_UNDER,
        'cb_klassen': None,
        'label_min':  None,
        'label_fmt':  _fmt_heel,
        'ecmwf_params': ['2t'],
        'ecmwf_cache':  'temp',
        'harmonie':   ('harmonie46_data_temp.bin', 'canvas'),
    },
    'zicht': {
        'titel':      'zicht',
        'eenheid':    'km',
        'soort':      'moment',
        'subtitel':   'horizontaal zicht aan het oppervlak',
        'menu':       'Zicht',
        'levels':     ZICHT_LEVELS,
        'colors':     ZICHT_COLORS,
        'over':       ZICHT_OVER,
        'under':      ZICHT_UNDER,
        'cb_klassen': None,
        'label_min':  None,
        'label_max':  10.0,
        'label_fmt':  _fmt_zicht,
        # ECMWF-open-data bevat geen rechtstreeks zichtveld. Deze kaart is
        # daarom bewust alleen beschikbaar voor HARMONIE V46.
        'ecmwf_params': [],
        'ecmwf_cache':  'zicht',
        'harmonie':   ('harmonie46_data_zicht.bin', 'canvas'),
    },
}

# Merkstrook onder de kaart. Kleuren komen uit weerlab_design_tokens.css:
# --wl-color-text (#0f172a), --wl-color-accent (#2ec4e8), --wl-color-text-muted.
MERK_INK    = '#0f172a'
MERK_ACCENT = '#2ec4e8'
MERK_MUTED  = '#64748b'
MERK_SUB_1  = 'Ed Aldus • weerdata &'
MERK_SUB_2  = 'visualisaties'

# Verticale opbouw in inches. De kaart houdt exact zijn oude hoogte; de
# merkstrook komt eronder, zodat er geen data onder het logo verdwijnt.
MAP_H_IN    = 5.40
HEADER_IN   = 0.62
BOTTOM_IN   = 0.08
FOOTER_IN   = 0.58

NL_DAGEN  = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']


# Vaste Nederlandse referentiepunten voor enkele grotere modelcijfers. De
# plaatsnamen zelf worden bewust niet op de kaart gezet.
PUNTEN = [
    ('Groningen',   53.22, 6.57),
    ('Leeuwarden',  53.20, 5.80),
    ('Enschede',    52.22, 6.90),
    ('De Bilt',     52.10, 5.18),
    ('Amsterdam',   52.37, 4.90),
    ('Rotterdam',   51.92, 4.48),
    ('Vlissingen',  51.45, 3.58),
    ('Eindhoven',   51.44, 5.48),
    ('Roermond',    51.19, 5.99),
    ('Maastricht',  50.85, 5.69),
]


def build_cmap(var):
    cmap = ListedColormap(var['colors'])
    cmap.set_over(var['over'])
    cmap.set_under(var['under'])
    return cmap, BoundaryNorm(var['levels'], cmap.N)


def lokale_tijd(dt):
    """Interpreteer modeltijden zonder tzinfo als UTC en zet ze om naar NL-tijd."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(LOCAL_TZ)


def fmt_run(dt, lokaal=False):
    if lokaal:
        dt = lokale_tijd(dt)
        return f'{dt.day:02d}.{dt.month:02d}. {dt.hour:02d}:{dt.minute:02d} LT'
    return f'{dt.day:02d}.{dt.month:02d}. {dt.hour:02d}z'


def fmt_valid(dt, lokaal=False):
    if lokaal:
        dt = lokale_tijd(dt)
        return (f'{NL_DAGEN[dt.weekday()]} {dt.day:02d}.{dt.month:02d}. '
                f'{dt.hour:02d}:{dt.minute:02d} LT')
    return f'{NL_DAGEN[dt.weekday()]} {dt.day:02d}.{dt.month:02d}. {dt.hour:02d}z'


def ecmwf_max_step(run_hour):
    return ECMWF_MAX


def ecmwf_steps(run_hour, max_step=None):
    """3-uursstappen tot maximaal +144u voor iedere dagelijkse run."""
    top = min(max_step or ecmwf_max_step(run_hour), ecmwf_max_step(run_hour))
    return list(range(3, top + 1, 3))


# ── Data ──────────────────────────────────────────────────────────────────────

def crop_and_upsample(lats, lons, field, extent, interp_step):
    """Snijd op kaartvenster (met marge) en interpoleer naar interp_step.

    `lats` mag op- of aflopend zijn; er wordt altijd oplopend geïnterpoleerd.
    """
    pad = 1.0
    lat_mask = (lats >= extent[2] - pad) & (lats <= extent[3] + pad)
    lon_mask = (lons >= extent[0] - pad) & (lons <= extent[1] + pad)
    lats_c, lons_c = lats[lat_mask], lons[lon_mask]
    field_c = field[np.ix_(lat_mask, lon_mask)]
    if lats_c[0] > lats_c[-1]:                       # aflopend → oplopend
        lats_c, field_c = lats_c[::-1], field_c[::-1, :]

    interp = RegularGridInterpolator((lats_c, lons_c), field_c,
                                    method='linear', bounds_error=False, fill_value=np.nan)
    lats_f = np.arange(float(lats_c.min()), float(lats_c.max()) + interp_step, interp_step)
    lons_f = np.arange(float(lons_c.min()), float(lons_c.max()) + interp_step, interp_step)
    lon2d, lat2d = np.meshgrid(lons_f, lats_f)
    pts = np.column_stack([lat2d.ravel(), lon2d.ravel()])
    return lats_f, lons_f, interp(pts).reshape(lat2d.shape)


def demo_fields(steps, run=None):
    """Synthetisch: front trekt over de Benelux, som loopt op."""
    lats = np.arange(56.0, 46.9, -0.25)
    lons = np.arange(-1.0, 11.1, 0.25)
    lon2d, lat2d = np.meshgrid(lons, lats)
    run = run or datetime(2026, 8, 17, 0)

    total = np.zeros_like(lon2d)
    out = []
    rng = np.random.default_rng(7)
    prev = 0
    for lead in steps:
        # frontband schuift van west naar oost, buien erin
        x0 = -2.0 + lead * 0.06
        band = np.exp(-(((lon2d - x0 - 0.35 * (lat2d - 51.5)) / 1.1) ** 2))
        rate = 2.6 * band * np.exp(-((lat2d - 52.0) / 5.5) ** 2)
        for _ in range(3):
            clon = rng.uniform(0, 10)
            clat = rng.uniform(47.5, 55.5)
            rate += rng.uniform(0, 5.0) * np.exp(-(((lon2d - clon) / 0.7) ** 2 +
                                                   ((lat2d - clat) / 0.5) ** 2))
        total = total + np.clip(rate, 0, None) * (lead - prev) / 3.0
        prev = lead
        out.append((lead, run, run + timedelta(hours=lead), lats, lons, total.copy()))
    return out


# ── ECMWF ────────────────────────────────────────────────────────────────────

def latest_run(run_hour=None):
    """Runlabel (YYYYMMDDHH) van de nieuwste volledige run in open data."""
    from ecmwf.opendata import Client
    client = Client(os.environ.get('ECMWF_OPEN_DATA_SOURCE', 'ecmwf'))
    # Op +144u is elk van de vier runs compleet; de langere 00/12-staart komt
    # in dezelfde levering mee, dus dit is de juiste "is de run binnen"-toets.
    kw = {'stream': 'oper', 'type': 'fc', 'param': 'tp', 'step': ECMWF_MAX}
    if run_hour is not None:
        kw['time'] = run_hour
    latest = client.latest(**kw)
    hour = latest.hour if run_hour is None else run_hour
    return f'{latest.date():%Y%m%d}{hour:02d}'


def _ecmwf_veld(ds_vars, var_naam):
    """GRIB-variabelen → het veld in de eenheid van de kaart."""
    if var_naam == 'neerslag':
        return ds_vars['tp'] * 1000.0              # m → mm, cumulatief vanaf run
    if var_naam == 'wind':
        return np.hypot(ds_vars['u10'], ds_vars['v10']) * 3.6   # m/s → km/u
    if var_naam == 'windstoten':
        # ECMWF noemt de stoot per stapbereik anders: 10fg t/m +90u en vanaf
        # +150u, 10fg3 daartussen. Zonder allebei valt +93..+144u uit de reeks.
        stoot = ds_vars.get('fg10')
        if stoot is None:
            stoot = ds_vars.get('fg10_3')
        if stoot is None:
            return None
        return stoot * 3.6
    if var_naam == 'temp':
        return ds_vars['t2m'] - 273.15             # K → °C
    raise SystemExit(f'onbekend veld: {var_naam}')


def ecmwf_fields(var_naam='neerslag', run_hour=None, max_step=None, refresh=False):
    import cfgrib
    from ecmwf.opendata import Client

    if not VARS[var_naam].get('ecmwf_params'):
        raise SystemExit(f'{VARS[var_naam]["menu"]} is niet als rechtstreeks '
                         'veld beschikbaar in ECMWF-open-data')

    os.makedirs(GRIB_DIR, exist_ok=True)
    client = Client(os.environ.get('ECMWF_OPEN_DATA_SOURCE', 'ecmwf'))

    if run_hour is None:
        latest = client.latest(stream='oper', type='fc', param='tp', step=ECMWF_MAX)
        run_date, run_hour = latest.date(), latest.hour
    else:
        # laatste datum waarvoor dit runuur al volledig binnen is
        latest = client.latest(stream='oper', type='fc', param='tp',
                               time=run_hour, step=ECMWF_MAX)
        run_date = latest.date()

    var = VARS[var_naam]
    steps = ecmwf_steps(run_hour, max_step)
    top = steps[-1]

    run_tag = f'{run_date:%Y%m%d}{run_hour:02d}'
    target = os.path.join(GRIB_DIR,
                          f'benelux_{var["ecmwf_cache"]}_{run_tag}_{top:03d}.grib2')
    if refresh or not os.path.exists(target):
        print(f'Download {"+".join(var["ecmwf_params"])} {run_tag} '
              f'(+{steps[0]}..+{top}u, {len(steps)} stappen)...')
        client.retrieve(date=run_date, time=run_hour, stream='oper', type='fc',
                        step=steps, param=var['ecmwf_params'], target=target)
    else:
        print(f'GRIB uit cache: {os.path.basename(target)}')

    # 10u en 10v komen als twee variabelen in hetzelfde bestand; open_datasets
    # geeft ze desnoods gesplitst terug, dus alles in één dict verzamelen.
    ds_lijst = cfgrib.open_datasets(target)
    ds0 = ds_lijst[0]
    lats = ds0.latitude.values
    lons = np.where(ds0.longitude.values > 180, ds0.longitude.values - 360,
                    ds0.longitude.values)
    sort_idx = np.argsort(lons)
    lons = lons[sort_idx]

    run = datetime.strptime(str(ds0.time.values)[:16], '%Y-%m-%dT%H:%M')

    # Niet elke variabele dekt elke stap (zie 10fg/10fg3), dus per stap
    # verzamelen in plaats van één blok over alle stappen aannemen.
    per_lead = {}
    for ds in ds_lijst:
        ds_steps = np.atleast_1d(ds.step.values)
        for naam in ds.data_vars:
            blok = ds[naam].values.reshape(len(ds_steps), len(lats), -1)
            for i, st in enumerate(ds_steps):
                lead = int(st / np.timedelta64(1, 'h'))
                per_lead.setdefault(lead, {})[naam] = blok[i][:, sort_idx]

    out = []
    for lead in sorted(per_lead):
        veld = _ecmwf_veld(per_lead[lead], var_naam)
        if veld is None:                      # stap mist het benodigde veld
            continue
        out.append((lead, run, run + timedelta(hours=lead), lats, lons, veld))
    if not out:
        raise SystemExit(f'geen enkele stap bruikbaar voor {var_naam}')
    return out


# ── HARMONIE ─────────────────────────────────────────────────────────────────

def harmonie_meta(grid='native', bron_dir=None):
    """Run + rooster van de laatste complete HARMONIE-V46-verwerking.

    De V46-pijplijn schrijft de metadata atomair als laatste. Het volledige
    neerslagrooster staat bij parameter ``cumul``; wind en temperatuur gebruiken
    het compactere basisrooster.
    """
    bron_dir = bron_dir or HARMONIE_DIR
    with open(os.path.join(bron_dir, 'harmonie46_canvas_meta.json')) as fh:
        meta = json.load(fh)
    run_utc = meta.get('run_utc')
    if not run_utc:
        raise SystemExit('HARMONIE-V46-metadata bevat geen run_utc')
    run = datetime.strptime(run_utc, '%Y-%m-%dT%H:%M:%SZ')
    rooster = (meta.get('parameters', {}).get('cumul', {}).get('grid')
               if grid == 'native' else meta.get('grid'))
    if not rooster:
        raise SystemExit(f'HARMONIE-V46-metadata bevat geen {grid}-rooster')
    return run, rooster


def harmonie_latest_run():
    run, _ = harmonie_meta()
    return f'{run:%Y%m%d%H}'


def harmonie_snapshot(velden):
    """Kopieer meta's en bins naar een tijdelijke map, en controleer dat de run
    daar voor én na dezelfde is.

    harmonie46_update.sh herschrijft deze bestanden elk uur, en een bouwronde
    duurt langer dan dat interval. Zonder momentopname leest een veld halverwege
    een half overschreven bin: dat gaf 18 aug een frame waarin de hele Benelux
    in één kleur vollooop terwijl het volgende frame weer normaal was.
    """
    meta_naam = 'harmonie46_canvas_meta.json'

    def runs():
        with open(os.path.join(HARMONIE_DIR, meta_naam)) as fh:
            return json.load(fh).get('run_utc')

    def vinger(path):
        h = hashlib.blake2b(digest_size=16)
        with open(path, 'rb') as fh:
            for blok in iter(lambda: fh.read(1 << 20), b''):
                h.update(blok)
        return h.hexdigest()

    voor = runs()
    if not voor:
        raise SystemExit('HARMONIE-V46-meta bevat geen run_utc — verwerking '
                         'nog bezig, wacht op de volgende ronde')

    namen = [meta_naam] + [VARS[v]['harmonie'][0] for v in velden]
    tmp = tempfile.mkdtemp(prefix='harmonie46_snap_')
    for naam in namen:
        shutil.copy2(os.path.join(HARMONIE_DIR, naam), os.path.join(tmp, naam))

    na = runs()
    if na != voor:
        shutil.rmtree(tmp, ignore_errors=True)
        raise SystemExit(f'HARMONIE-run wisselde tijdens het kopiëren '
                         f'({voor} → {na}) — volgende ronde probeert opnieuw')

    # run_utc alleen is niet genoeg: harmonie_update.sh verwerkt soms dezelfde
    # run opnieuw. Dan blijft run_utc gelijk terwijl de bin eronder verandert,
    # en kopieerden we een mengsel van de oude en de nieuwe versie. Vergelijk
    # daarom ook de inhoud zelf.
    for naam in namen:
        if vinger(os.path.join(HARMONIE_DIR, naam)) != vinger(os.path.join(tmp, naam)):
            shutil.rmtree(tmp, ignore_errors=True)
            raise SystemExit(f'{naam} veranderde tijdens het kopiëren — '
                             'volgende ronde probeert opnieuw')
    return tmp


def _harmonie_veld(kubus, var_naam):
    """Rauwe bin-inhoud → het veld in de eenheid van de kaart.

    kubus is (stap, component, lat, lon) voor float-bins, of (stap, lat, lon)
    voor de uint8-gecodeerde neerslag.
    """
    if var_naam == 'neerslag':
        return (kubus / 12.0) ** 2                 # uint8-sqrt schaal 12 → mm
    if var_naam in ('wind', 'windstoten'):
        return np.hypot(kubus[:, 0], kubus[:, 1]) * 3.6       # m/s → km/u
    if var_naam == 'temp':
        return kubus[:, 0]                         # staat al in °C in de bin
    if var_naam == 'zicht':
        return kubus[:, 0] / 1000.0                # m → km
    raise SystemExit(f'onbekend veld: {var_naam}')


def harmonie_fields(var_naam='neerslag', max_step=None, bron_dir=None):
    """Veld per uur uit de bins die weerlab/scripts/harmonie_update.sh wegschrijft.

    Die pijplijn haalt de run-tar toch al binnen, dus hier alleen uitlezen — geen
    tweede download van de grote run-tar. dtype-byte 0 = float32,
    1 = uint8-sqrt.
    """
    bestand, grid_soort = VARS[var_naam]['harmonie']
    run, grid = harmonie_meta(grid_soort, bron_dir)
    path = os.path.join(bron_dir or HARMONIE_DIR, bestand)
    with open(path, 'rb') as fh:
        n_lat, n_lon, n_steps, n_comp = struct.unpack('<HHHH', fh.read(8))
        dtype_flag = fh.read(8)[0]
        raw = fh.read()
    if (n_lat, n_lon) != (grid['n_lat'], grid['n_lon']):
        raise SystemExit(f'{bestand} en de {grid_soort}-meta horen niet bij dezelfde '
                         'run — wacht op de volgende HARMONIE-verwerking')

    if dtype_flag == 1:
        kubus = np.frombuffer(raw, dtype=np.uint8).astype(np.float32)
        verwacht = n_lat * n_lon * n_steps * n_comp
        vorm = (n_steps, n_lat, n_lon)
    elif dtype_flag == 0:
        kubus = np.frombuffer(raw, dtype='<f4')
        verwacht = n_lat * n_lon * n_steps * n_comp
        vorm = (n_steps, n_comp, n_lat, n_lon)
    else:
        raise SystemExit(f'{bestand}: onverwacht dtype {dtype_flag}')
    if kubus.size != verwacht:
        raise SystemExit(f'{bestand}: {kubus.size} waarden, verwacht {verwacht}')

    veld = _harmonie_veld(kubus.reshape(vorm), var_naam)
    if VARS[var_naam]['soort'] == 'som':
        zakt = np.where((veld[1:] < veld[:-1] - 1e-6).any(axis=(1, 2)))[0]
        if zakt.size:
            raise SystemExit(f'{bestand}: som daalt bij stap(pen) '
                             f'{[int(i) + 2 for i in zakt[:5]]} — half overschreven '
                             'bin, volgende ronde probeert opnieuw')
    lats = np.linspace(grid['lat_min'], grid['lat_max'], n_lat)
    lons = np.linspace(grid['lon_min'], grid['lon_max'], n_lon)

    top = min(max_step or HARMONIE_MAX, n_steps)
    out = []
    for i in range(top):                             # bin-index 0 = +1u
        lead = i + 1
        out.append((lead, run, run + timedelta(hours=lead), lats, lons, veld[i]))
    return out


# ── Plot ──────────────────────────────────────────────────────────────────────

_PROJ_EXTENT = {}


def proj_extent(extent):
    """Hoogte/breedte van het kaartvenster in projectiecoördinaten."""
    key = tuple(extent)
    if key not in _PROJ_EXTENT:
        lon = np.linspace(extent[0], extent[1], 40)
        lat = np.linspace(extent[2], extent[3], 40)
        lo, la = np.meshgrid(lon, lat)
        xy = PROJ.transform_points(PROJ_PC, lo.ravel(), la.ravel())
        x, y = xy[:, 0], xy[:, 1]
        _PROJ_EXTENT[key] = (x.min(), x.max(), y.min(), y.max())
    return _PROJ_EXTENT[key]


def teken_merkstrook(fig, bron_credit, fig_h):
    """Weerlab-merklock-up links en modelbron rechts."""
    lijn_y = FOOTER_IN / fig_h
    fig.add_artist(Line2D([0.012, 0.988], [lijn_y, lijn_y], transform=fig.transFigure,
                          color='#dfe5ec', linewidth=0.8, zorder=1))

    # Schaalbare tekstlock-up van het echte logo. Daardoor blijft de merknaam
    # ook na GIF- en MP4-compressie scherp en behoudt .nl zijn blauwe kleur.
    merknaam = HPacker(children=[
        TextArea('Weerlab.', textprops=dict(fontsize=13.5, fontweight='bold',
                                            color=MERK_INK)),
        TextArea('nl', textprops=dict(fontsize=13.5, fontweight='bold',
                                      color=MERK_ACCENT)),
    ], align='baseline', pad=0, sep=0)
    sub_props = dict(fontsize=7.0, fontweight='bold', color=MERK_MUTED,
                     fontfamily='DejaVu Sans Mono')
    logo = VPacker(children=[
        merknaam,
        TextArea(MERK_SUB_1, textprops=sub_props),
        TextArea(MERK_SUB_2, textprops=sub_props),
    ], align='left', pad=0, sep=0.8)
    fig.add_artist(AnchoredOffsetbox(
        loc='lower left', child=logo, frameon=False, pad=0, borderpad=0,
        bbox_to_anchor=(0.012, 0.035 / fig_h), bbox_transform=fig.transFigure))

    fig.text(0.988, 0.105 / fig_h, bron_credit, fontsize=7.5, ha='right',
             va='center', color=MERK_MUTED)


def _vlakkleur(var, v):
    """Kleur van het vlak waar deze waarde in valt."""
    i = int(np.searchsorted(var['levels'], v, side='right')) - 1
    if i < 0:
        return var['under']
    if i >= len(var['colors']):
        return var['over']
    return var['colors'][i]


def _tekst_op(kleur):
    """Tekst- en randkleur die leesbaar zijn op dit vlak.

    Zwarte cijfers verdwijnen in donkerrood en paars, witte in geel. Daarom
    volgt de tekstkleur de helderheid van het vlak eronder, met een randje in
    de tegenovergestelde kleur zodat een cijfer dat net over een klassegrens
    valt ook leesbaar blijft.
    """
    r, g, b = _hex_rgb(kleur)
    if (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5:
        return '#111111', '#ffffffcc'
    return '#ffffff', '#00000099'


def _bij_vast_punt(lo, la):
    """Valt dit rasterpunt zo dicht bij een vast punt dat de cijfers botsen?"""
    return any(abs(la - pla) < 0.16 and abs(lo - plo) < 0.22
               for _, pla, plo in PUNTEN)


def label_grid(lats_f, lons_f, field, extent, drempel=None, bovengrens=None):
    """Waardecijfers op een regelmatig raster (in graden).

    drempel=None toont ook lage waarden; voor de neerslagsom staat er een
    ondergrens. bovengrens wordt bij zicht gebruikt om alleen relevant beperkt
    zicht te nummeren.
    """
    # Voor X zijn iets minder maar duidelijk grotere cijfers beter leesbaar dan
    # een fijn raster dat na het verkleinen dichtloopt.
    d_lat, d_lon = 0.50, 0.58
    for la in np.arange(extent[2] + 0.12, extent[3] - 0.06, d_lat):
        for lo in np.arange(extent[0] + 0.15, extent[1] - 0.08, d_lon):
            i = int(np.argmin(np.abs(lats_f - la)))
            j = int(np.argmin(np.abs(lons_f - lo)))
            v = field[i, j]
            if _bij_vast_punt(lo, la):
                continue
            if (np.isfinite(v) and (drempel is None or v >= drempel) and
                    (bovengrens is None or v <= bovengrens)):
                yield lo, la, v


_PROJ_GRID = {}


def proj_grid(lons_f, lats_f):
    """Het tekenrooster alvast naar de kaartprojectie omrekenen, en onthouden.

    contourf kreeg tot nu toe lon/lat mee met transform=PROJ_PC. Cartopy trekt
    de contouren dan in lon/lat en zet daarna de polygonen om naar de kaart, en
    dat ging bij deze velden geregeld mis: een enkel beeld liep in een kleur vol
    of raakte juist zijn witte gebied kwijt, terwijl het beeld ervoor en erna
    klopte. Zichtbaar als een witte flits in de animatie. Door de punten zelf om
    te rekenen en in projectiecoordinaten te contouren valt die stap weg. Het
    rooster is elk beeld hetzelfde, dus een keer rekenen volstaat.
    """
    sleutel = (lons_f[0], lons_f[-1], len(lons_f), lats_f[0], lats_f[-1], len(lats_f))
    if sleutel not in _PROJ_GRID:
        lon2d, lat2d = np.meshgrid(lons_f, lats_f)
        xy = PROJ.transform_points(PROJ_PC, lon2d, lat2d)
        _PROJ_GRID[sleutel] = (xy[..., 0], xy[..., 1])
    return _PROJ_GRID[sleutel]


def plot_frame(lead, run, valid, lats, lons, veld_ruw, outfile, cfg, var, model_label,
               step_txt='', max_lead=None, eind=None):
    extent = cfg['extent']
    cmap, norm = build_cmap(var)
    lats_f, lons_f, tp = crop_and_upsample(lats, lons, veld_ruw, extent,
                                           cfg['interp_step'])
    px, py = proj_grid(lons_f, lats_f)

    x0, x1, y0, y1 = proj_extent(extent)
    fig_h = HEADER_IN + MAP_H_IN + BOTTOM_IN + FOOTER_IN
    map_w_in = (x1 - x0) / (y1 - y0) * MAP_H_IN
    fig_w = map_w_in / 0.845 + 0.85                  # kaart + kleurschaal rechts
    map_y0 = (BOTTOM_IN + FOOTER_IN) / fig_h

    fig = plt.figure(figsize=(fig_w, fig_h))
    ax = fig.add_axes([0.012, map_y0, map_w_in / fig_w, MAP_H_IN / fig_h],
                      projection=PROJ)
    ax.set_extent([x0, x1, y0, y1], crs=PROJ)

    uiteinden = 'both' if var['under'] != '#ffffff' else 'max'
    # let op: px/py staan al in projectiecoordinaten, dus geen transform= hier
    cf = ax.contourf(px, py, tp, levels=var['levels'], cmap=cmap, norm=norm,
                     extend=uiteinden, zorder=1)

    ax.add_feature(cfeature.OCEAN.with_scale('10m'), facecolor='#eef2f5', zorder=0)
    ax.add_feature(cfeature.LAND.with_scale('10m'), facecolor='#ffffff', zorder=0)
    ax.add_feature(cfeature.LAKES.with_scale('10m'), facecolor='#eef2f5',
                   edgecolor='none', zorder=0)
    ax.add_feature(cfeature.LAKES.with_scale('10m'), facecolor='none',
                   edgecolor='#5d7382', linewidth=0.45, zorder=4)
    ax.add_feature(cfeature.COASTLINE.with_scale('10m'), linewidth=0.9,
                   edgecolor='#20303c', zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale('10m'), linewidth=0.7,
                   edgecolor='#20303c', alpha=0.75, zorder=4)
    ax.add_feature(cfeature.NaturalEarthFeature(
        'cultural', 'admin_1_states_provinces_lines', '10m',
        edgecolor='#60717d', linewidth=0.38, facecolor='none'), zorder=4)

    # waardecijfers
    for lo, la, v in label_grid(lats_f, lons_f, tp, extent, var['label_min'],
                                var.get('label_max')):
        txt = var['label_fmt'](v)
        inkt, rand = _tekst_op(_vlakkleur(var, v))
        ax.text(lo, la, txt, transform=PROJ_PC, zorder=6, fontsize=10.2,
                color=inkt, ha='center', va='center', clip_on=True,
                fontweight='bold',
                path_effects=[pe.withStroke(linewidth=2.0, foreground=rand)])

    # Vaste punten: extra waarden op plekken die het raster overslaat, zonder
    # plaatsnamen zodat de kaart op sociale media rustig en direct leesbaar
    # blijft. Zelfde lettergrootte als het raster — twee maten door elkaar oogde
    # rommelig. Dezelfde ondergrens geldt als voor het raster: bij neerslag dus
    # geen 0 mm.
    for naam, la, lo in PUNTEN:
        if not (extent[0] + 0.1 < lo < extent[1] - 0.1 and
                extent[2] + 0.1 < la < extent[3] - 0.1):
            continue
        i = int(np.argmin(np.abs(lats_f - la)))
        j = int(np.argmin(np.abs(lons_f - lo)))
        v = tp[i, j]
        if (not np.isfinite(v) or
                (var['label_min'] is not None and v < var['label_min']) or
                (var.get('label_max') is not None and v > var['label_max'])):
            continue
        inkt, rand = _tekst_op(_vlakkleur(var, v))
        ax.text(lo, la, var['label_fmt'](v), transform=PROJ_PC, zorder=8,
                fontsize=10.2, fontweight='bold', color=inkt,
                ha='center', va='center', clip_on=True,
                path_effects=[pe.withStroke(linewidth=2.0, foreground=rand)])

    ax.spines['geo'].set_linewidth(1.1)
    ax.spines['geo'].set_edgecolor('#333333')

    # Kop
    def van_boven(inch):
        return 1 - inch / fig_h

    lokaal = cfg.get('tijdzone') == 'local'
    fig.text(0.014, van_boven(0.127), f'{model_label} ({fmt_run(run, lokaal)})', fontsize=13.5,
             fontweight='bold', va='top')
    # Bij een oplopende som staat "vanaf de run tot X"; bij andere velden de
    # geldigheidstijd.
    kop2 = f'{var["titel"]} ({var["eenheid"]}) — ' + (
        f'vanaf {fmt_valid(run, lokaal)}' if var['soort'] == 'som' else var['subtitel'])
    fig.text(0.014, van_boven(0.477), kop2, fontsize=10.5, va='top', color='#444444')
    geldig = (f'tot {fmt_valid(valid, lokaal)}' if var['soort'] == 'som'
              else fmt_valid(valid, lokaal))
    fig.text(0.988, van_boven(0.127), f'{geldig}  (+{lead}u)', fontsize=12,
             fontweight='bold', va='top', ha='right')
    span = (f'{step_txt} +{max_lead}u' if eind and max_lead else '')
    fig.text(0.988, van_boven(0.456), span, fontsize=9.5, va='top', ha='right',
             color='#666666')

    # Verticale kleurschaal rechts
    cb_x = 0.012 + map_w_in / fig_w + 0.014
    cb_y0 = map_y0 + 0.498 / fig_h                   # zelfde marges als voorheen
    cb_h = (MAP_H_IN - 0.95) / fig_h
    cax = fig.add_axes([cb_x, cb_y0, 0.016, cb_h])
    niveaus = var['levels']
    cb = fig.colorbar(cf, cax=cax, orientation='vertical', extend=uiteinden)
    if var['cb_klassen']:
        # Kleurvlak = één windkracht, dus het klassenummer hoort midden in het
        # vlak te staan, niet op de grens ertussen.
        midden = [(niveaus[i] + niveaus[i + 1]) / 2 for i in range(len(niveaus) - 1)]
        cb.set_ticks(midden)
        cb.set_ticklabels(var['cb_klassen'])
        cb.ax.text(1.5, 1.024, '12+', transform=cb.ax.transAxes, ha='left',
                   va='center', fontsize=9.5, color='#333333')
        eenheid_hoog = 0.34
    else:
        cb.set_ticks(niveaus)
        cb.set_ticklabels([f'{v:g}' for v in niveaus])
        eenheid_hoog = 0.18
    cb.ax.tick_params(labelsize=9.5, length=2)
    cb.outline.set_linewidth(0.7)
    fig.text(cb_x, cb_y0 + cb_h + eenheid_hoog / fig_h, var['eenheid'], fontsize=11,
             va='bottom', ha='left', color='#444444')

    teken_merkstrook(fig, cfg['credit'], fig_h)

    fig.patch.set_facecolor('white')
    fig.savefig(outfile, dpi=110, facecolor='white')
    plt.close(fig)
    # grof monster van het veld dat hier daadwerkelijk getekend is, zodat
    # bouw_veld achteraf kan controleren wat er op de kaart terechtkwam
    return np.array(tp[::8, ::8])


# ── Animatie ──────────────────────────────────────────────────────────────────

def _hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _gif_palet(imgs, var, kleuren=128):
    """Eén palet voor alle beelden, met de schaalkleuren exact erin.

    PIL leidde het palet af uit beeld 1. Dat beeld is +1u en vrijwel droog, dus
    geel/oranje/rood/paars zaten er niet in en alle latere beelden kregen de
    dichtstbijzijnde verkeerde kleur — 18 van de 24 schaalkleuren sneuvelden zo.

    Hier komt het palet uit alle beelden samen; daarna wordt per schaalkleur de
    dichtstbijzijnde paletplek op de exacte waarde gezet, zodat de kleurschaal
    hoe dan ook klopt en niet meer per beeld verschuift.
    """
    from PIL import Image
    stap = max(1, len(imgs) // 15)
    monsters = [im.resize((im.width // 3, im.height // 3), Image.NEAREST)
                for im in imgs[::stap]]
    # Kop en merkstrook staan op elk beeld hetzelfde, beslaan weinig pixels en
    # verdwijnen vrijwel helemaal in een 1-op-3 monster. Ze legden het daardoor
    # af tegen wat de kaart nodig had: letterrandjes werden roze en mintgroen en
    # het logo kreeg een andere tint zodra je de gif bekeek in plaats van de png.
    # Die twee stroken gaan er nu onverkleind bij.
    eerste = imgs[0]
    monsters += [eerste.crop((0, 0, eerste.width, int(eerste.height * 0.09))),
                 eerste.crop((0, int(eerste.height * 0.92), eerste.width, eerste.height))]

    breedte = max(m.width for m in monsters)
    master = Image.new('RGB', (breedte, sum(m.height for m in monsters)), 'white')
    y = 0
    for m in monsters:
        master.paste(m, (0, y)); y += m.height

    # De schaalkleuren plus een grijstrap voor de letters krijgen een eigen plek
    # achteraan het palet, in plaats van dat ze over een bestaande plek heen
    # worden geschreven. Elke overschreven plek was namelijk een kleur die
    # ergens op de kaart of in het logo stond, en precies die raakten we kwijt.
    vast = [_hex_rgb(c) for c in [var['under']] + list(var['colors']) + [var['over']]]
    vast += [(w, w, w) for w in range(0, 256, 17)]
    # Vaste kleuren van de kaart zelf: zee, kust, grenzen, de merkstrook en het
    # logo. Weinig pixels, maar juist daar viel de verkleuring op.
    vast += [_hex_rgb(c) for c in ('#eef2f5', '#dfe5ec', '#20303c', '#5d7382',
                                   MERK_INK, MERK_ACCENT, MERK_MUTED)]
    uniek = []
    for kleur in vast:
        if kleur not in uniek:
            uniek.append(kleur)

    vrij = kleuren - len(uniek)
    palet = master.convert('P', palette=Image.ADAPTIVE, colors=vrij)
    ruw = list(palet.getpalette() or [])
    tabel = ruw[:vrij * 3] + [0] * max(0, vrij * 3 - len(ruw))
    for kleur in uniek:
        tabel += list(kleur)
    palet.putpalette(tabel + [0] * (768 - len(tabel)))
    return palet


# X weigert zware gif's en toont brede beelden klein in de tijdlijn. De eerste
# poging is daarom direct 720 px; minder paletkleuren besparen veel ruimte
# zonder de vaste weerklassen aan te tasten. De grotere bronletters houden de
# cijfers ook na deze verkleining goed leesbaar.
GIF_POGINGEN = ((720, 96), (680, 80), (640, 72), (600, 64))
GIF_MAX_MB = 8.0


def build_gif(frames, outfile, var, frame_ms=320, hold_ms=2200,
              pogingen=GIF_POGINGEN, max_mb=GIF_MAX_MB):
    """Gif die onder de uploadgrens van X blijft.

    Op 900 px met een vol palet kwam een natte run boven de 15 MB uit en
    weigerde X het bestand. Een drukke run is duurder dan een rustige, dus het
    blijft schatten: daarom wordt de grootte na het schrijven gecontroleerd en
    valt hij zo nodig een maat terug.
    """
    from PIL import Image
    for i, (width, kleuren) in enumerate(pogingen):
        imgs = []
        for f in frames:
            im = Image.open(f).convert('RGB')
            if im.width > width:
                im = im.resize((width, round(im.height * width / im.width)),
                               Image.LANCZOS)
            imgs.append(im)
        _schrijf_gif(imgs, outfile, var, frame_ms, hold_ms, kleuren)
        mb = os.path.getsize(outfile) / 1e6
        if mb <= max_mb or i == len(pogingen) - 1:
            print(f'  {os.path.basename(outfile)}  ({mb:.1f} MB, '
                  f'{width} px, {kleuren} kleuren)')
            return
        print(f'  {os.path.basename(outfile)}: {mb:.1f} MB bij {width} px / '
              f'{kleuren} kleuren is te groot voor X — opnieuw een maat kleiner')


def _schrijf_gif(imgs, outfile, var, frame_ms, hold_ms, kleuren):
    from PIL import Image
    palet = _gif_palet(imgs, var, kleuren)
    # dither uit: de vlakken zijn effen, ruis erin zou de kleurklassen vervagen.
    kwant = [im.quantize(palette=palet, dither=Image.NONE) for im in imgs]
    durations = [frame_ms] * (len(kwant) - 1) + [hold_ms]
    # optimize=False: PIL zou anders opnieuw kleuren samenvoegen en het net
    # rechtgezette palet weer stukmaken.
    # disposal=1 (niet 2): met 2 wist de decoder het doek na elk beeld naar de
    # achtergrondkleur (wit) voordat het volgende beeld getekend is. Bij deze
    # zware beelden duurt dat tekenen merkbaar lang, dus flitste er tussen de
    # frames wit door - de 'witte randen'. Met 1 blijft het vorige beeld staan
    # en wordt het nieuwe eroverheen getekend. Extra winst: bij disposal=1 mag
    # PIL alleen het gewijzigde rechthoekje wegschrijven, wat het bestand fors
    # kleiner maakt. Het palet blijft ongemoeid.
    kwant[0].save(outfile, save_all=True, append_images=kwant[1:], loop=0,
                  duration=durations, optimize=False, disposal=1)


MP4_FPS = 10
MP4_BITRATE = '650k'


def build_mp4(frame_glob, outfile, fps=MP4_FPS):
    if not shutil.which('ffmpeg'):
        print('  ffmpeg niet gevonden — mp4 overgeslagen')
        return
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(fps),
           '-pattern_type', 'glob', '-i', frame_glob,
           '-vf', 'scale=792:-2',
           '-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p',
           '-b:v', MP4_BITRATE, '-maxrate', '750k', '-bufsize', '1300k',
           '-movflags', '+faststart', outfile]
    subprocess.run(cmd, check=True)
    print(f'  {os.path.basename(outfile)}  ({os.path.getsize(outfile)/1e6:.1f} MB)')


# ── Main ──────────────────────────────────────────────────────────────────────

def bouw_veld(args, cfg, var_naam, bron_dir=None):
    """Eén model × één veld: frames, GIF, mp4, eindkaart en meta."""
    var = VARS[var_naam]
    prefix = prefix_van(args.model, var_naam)

    frame_dir = os.path.join(FRAME_ROOT, args.model, var_naam)
    os.makedirs(frame_dir, exist_ok=True)
    for old in glob.glob(os.path.join(frame_dir, '*.png')):
        os.remove(old)

    # Toon de nominale modelresolutie in elke kaartkop.
    model_label = cfg['label']
    if args.model == 'harmonie':
        model_label = f'{model_label} 2,5 km'
    if args.demo:
        if args.model == 'harmonie':
            steps = list(range(1, min(args.max_step or HARMONIE_MAX, HARMONIE_MAX) + 1))
        else:
            steps = ecmwf_steps(args.run if args.run is not None else 0, args.max_step)
        data = demo_fields(steps)
        model_label += ' (DEMO)'
    elif args.model == 'harmonie':
        data = harmonie_fields(var_naam, args.max_step, bron_dir)
    else:
        data = ecmwf_fields(var_naam, args.run, args.max_step, refresh=args.refresh)

    max_lead = data[-1][0]
    run = data[0][1]
    run_tag = f'{run:%Y%m%d%H}'
    leads = [d[0] for d in data]
    if args.model == 'harmonie':
        step_txt = '+1u t/m'
    else:
        step_txt = '+3u t/m'

    print(f'[{args.model}/{var_naam}] {len(data)} frames renderen '
          f'(+{leads[0]}..+{max_lead}u)...')
    extent = cfg['extent']
    frames = []
    getekend = []
    for lead, run_, valid, lats, lons, veld in data:
        f = os.path.join(frame_dir, f'{var_naam}_{run_tag}_{lead:03d}.png')
        getekend.append(
            plot_frame(lead, run_, valid, lats, lons, veld, f, cfg, var, model_label,
                       step_txt=step_txt, max_lead=max_lead,
                       eind=run + timedelta(hours=max_lead)))
        frames.append(f)

    # Controleer wat er getekend is, niet alleen wat er ingelezen werd. De bin
    # kwam door de monotonie-controle heen en toch liep er af en toe een beeld
    # in één kleur vol (19 aug: de +8u en de +60u van de 06z-reeks, met normale
    # beelden ertussen). Liever geen nieuwe animatie dan een verkeerde: bij een
    # afwijking blijft de vorige gewoon staan en probeert de volgende ronde het
    # opnieuw. Het verdachte beeld gaat naar een .npz zodat de oorzaak de
    # volgende keer wél te achterhalen is.
    if var['soort'] == 'som' and len(getekend) > 1:
        def _staak(reden, stap):
            dump = os.path.join(OUTPUT_DIR, f'{prefix}_probleem_{run_tag}.npz')
            lo, hi = max(0, stap - 1), min(len(data), stap + 2)
            np.savez_compressed(dump, getekend=np.stack(getekend[lo:hi]),
                                ruw=np.stack([data[k][5] for k in range(lo, hi)]),
                                eerste_stap=lo + 1)
            raise SystemExit(f'{prefix}: {reden} — kaarten NIET gepubliceerd, '
                             f'de vorige blijven staan. Veld weggeschreven naar '
                             f'{os.path.basename(dump)}')

        reeks = np.stack(getekend)
        zakt = np.where((reeks[1:] < reeks[:-1] - 0.05).any(axis=(1, 2)))[0]
        if zakt.size:
            _staak(f'de getekende som daalt bij stap +{int(zakt[0]) + 2}u',
                   int(zakt[0]) + 1)

        grenzen = np.asarray(var['levels'])
        for i, vlak in enumerate(getekend):
            eindig = vlak[np.isfinite(vlak)]
            if eindig.size == 0 or np.median(eindig) < 2.0:
                continue                      # droge beginbeelden mogen vlak zijn
            _, tel = np.unique(np.digitize(eindig, grenzen), return_counts=True)
            deel = tel.max() / tel.sum()
            if deel > 0.60:
                _staak(f'stap +{i + 1}u loopt voor {100 * deel:.0f}% in één '
                       'kleurklasse vol', i)
    m = (data[-1][3] >= extent[2]) & (data[-1][3] <= extent[3])
    n = (data[-1][4] >= extent[0]) & (data[-1][4] <= extent[1])
    laatste = data[-1][5][np.ix_(m, n)]
    print(f'  laatste stap: {np.nanmin(laatste):.1f} .. {np.nanmax(laatste):.1f} '
          f'({"km/u" if var["cb_klassen"] else var["eenheid"]})')

    suffix = '_DEMO' if args.demo else ''
    if not args.no_gif:
        build_gif(frames, os.path.join(OUTPUT_DIR, f'{prefix}_{run_tag}{suffix}.gif'), var)
    if not args.no_mp4:
        build_mp4(os.path.join(frame_dir, f'{var_naam}_{run_tag}_*.png'),
                  os.path.join(OUTPUT_DIR, f'{prefix}_{run_tag}{suffix}.mp4'))

    # laatste stap ook als losse kaart: bij de som is dat het totaal, bij de
    # andere velden het verste beeld van de reeks
    shutil.copyfile(frames[-1], os.path.join(OUTPUT_DIR,
                    f'{prefix}_totaal_{run_tag}{suffix}.png'))

    if not args.demo:
        meta = {
            'model': cfg['bron'],
            'model_id': args.model,
            'var': var_naam,
            'var_titel': var['titel'],
            'eenheid': var['eenheid'],
            'soort': var['soort'],
            'run': f'{run:%Y-%m-%dT%H:00Z}',
            'run_tag': run_tag,
            'stap_uren': 1 if args.model == 'harmonie' else 3,
            'stap_uren_lang': None,
            'stap_wissel_uur': None,
            'lead_min': leads[0],
            'lead_max': max_lead,
            'leads': leads,
            'frames': len(data),
            'video_fps': MP4_FPS,
            'gemaakt': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
            'bestanden': {
                'gif': f'{prefix}_{run_tag}.gif',
                'mp4': f'{prefix}_{run_tag}.mp4',
                'totaal_png': f'{prefix}_totaal_{run_tag}.png',
            },
        }
        with open(os.path.join(OUTPUT_DIR, f'{prefix}_meta.json'), 'w') as fh:
            json.dump(meta, fh, indent=2, ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', choices=sorted(MODELS), default='ecmwf')
    ap.add_argument('--var', choices=sorted(VARS) + ['alle'], default='alle',
                    help='veld om te bouwen (standaard: alle vier)')
    ap.add_argument('--demo', action='store_true', help='synthetische data, geen download')
    ap.add_argument('--run', type=int, choices=list(ECMWF_RUN_HOURS), default=None,
                    help='ECMWF-runuur UTC (standaard: laatste beschikbare)')
    ap.add_argument('--max-step', type=int, default=None,
                    help=f'hoogste lead time (ECMWF max {ECMWF_MAX}, '
                         f'HARMONIE max {HARMONIE_MAX})')
    ap.add_argument('--refresh', action='store_true', help='GRIB opnieuw downloaden')
    ap.add_argument('--no-mp4', action='store_true')
    ap.add_argument('--no-gif', action='store_true')
    ap.add_argument('--latest-run', action='store_true',
                    help='print alleen het runlabel van de nieuwste volledige run')
    args = ap.parse_args()

    cfg = MODELS[args.model]

    if args.latest_run:
        print(harmonie_latest_run() if args.model == 'harmonie' else latest_run(args.run))
        return

    velden = list(VARS) if args.var == 'alle' else [args.var]
    if args.model == 'ecmwf':
        velden = [v for v in velden if VARS[v].get('ecmwf_params')]

    # Alle velden uit één momentopname, anders kan veld 4 uit een nieuwere run
    # komen dan veld 1 terwijl de meta één run noemt.
    bron_dir = None
    if args.model == 'harmonie' and not args.demo:
        bron_dir = harmonie_snapshot(velden)
    try:
        for var_naam in velden:
            bouw_veld(args, cfg, var_naam, bron_dir)
    finally:
        if bron_dir:
            shutil.rmtree(bron_dir, ignore_errors=True)

    print(f'Klaar → {OUTPUT_DIR}')


if __name__ == '__main__':
    main()
