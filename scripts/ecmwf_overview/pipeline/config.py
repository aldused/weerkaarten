"""Centrale pipelineconfig voor de ECMWF Overview-kaart.

Alles wat browser en pipeline moeten delen (domein, codering, projectie) komt
in het run-manifest terecht; de browser leest het daar en hardcodeert niets.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get('OVERVIEW_DATA_DIR', os.path.join(ROOT, 'data'))
LOG_DIR = os.path.join(ROOT, 'logs')

SCHEMA = 1

# Datadomein (regulier lon/lat-raster, uitsnede uit het globale 0,1°-veld).
# Ruim genoeg voor de grootste regio inclusief rand bij uitzoomen.
DOMAIN = {'lon_min': -90.0, 'lon_max': 95.0, 'lat_min': 8.0, 'lat_max': 86.0, 'step': 0.1}

KEEP_RUNS = 8            # 2 dagen aan 00/06/12/18-runs bewaren
WORKERS = 6              # parallelle stappen (download + verwerking)

# Codering van de waardetexturen (8-bit grijs-PNG, 0 = geen waarde/geen neerslag)
# value = clip(round((x - offset) / scale), lo, 255); terugrekenen: x = v * scale + offset
ENC = {
    't2m':  {'kind': 'linear', 'unit': '°C',   'scale': 0.5, 'offset': -50.5, 'lo': 1},
    # max/min 2 m over de voorgaande 6 uur
    'tmax': {'kind': 'linear', 'unit': '°C',   'scale': 0.5, 'offset': -50.5, 'lo': 1},
    'tmin': {'kind': 'linear', 'unit': '°C',   'scale': 0.5, 'offset': -50.5, 'lo': 1},
    # drukvlakken: lager bereik dan 2 m (500 hPa kan onder -50 °C)
    'feel': {'kind': 'linear', 'unit': '°C',   'scale': 0.5, 'offset': -50.5, 'lo': 1},
    'td2m': {'kind': 'linear', 'unit': '°C',   'scale': 0.5, 'offset': -50.5, 'lo': 1},
    # bodemtemperatuur 0-7 cm; zee gevuld met de dichtstbijzijnde landwaarde, de kaart toont alleen land
    'st1':  {'kind': 'linear', 'unit': '°C',   'scale': 0.5, 'offset': -50.5, 'lo': 1},
    # 0 °C-niveau in meter boven zeeniveau; 0 = overal koud
    'frz':  {'kind': 'linear', 'unit': 'm',    'scale': 25.0, 'offset': 0.0, 'lo': 0},
    # bovenlucht: vocht 700 hPa, wind 850 hPa (kt), vorticiteit 500 hPa (10^-5 /s), omega 700 hPa (Pa/s), waterdamp (mm)
    'rh700': {'kind': 'linear', 'unit': '%',   'scale': 1.0, 'offset': 0.0, 'lo': 0},
    'w850': {'kind': 'linear', 'unit': 'kt',   'scale': 1.0, 'offset': 0.0, 'lo': 0},
    'vo500': {'kind': 'linear', 'unit': '10⁻⁵/s', 'scale': 0.5, 'offset': -64.0, 'lo': 1},
    'w700': {'kind': 'linear', 'unit': 'Pa/s', 'scale': 0.04, 'offset': -5.12, 'lo': 1},
    'tcwv': {'kind': 'linear', 'unit': 'mm',   'scale': 0.5, 'offset': 0.0, 'lo': 0},
    # zonuren over 24 uur, geschat uit straling
    'sun24': {'kind': 'linear', 'unit': 'uur', 'scale': 0.1, 'offset': 0.0, 'lo': 0},
    # bewolking per laag, wind op 100 m (m/s), verse sneeuw in 24 uur (cm bij 10:1)
    'lcc':  {'kind': 'linear', 'unit': '%',    'scale': 5.0, 'offset': 0.0, 'lo': 0},
    'mcc':  {'kind': 'linear', 'unit': '%',    'scale': 5.0, 'offset': 0.0, 'lo': 0},
    'hcc':  {'kind': 'linear', 'unit': '%',    'scale': 5.0, 'offset': 0.0, 'lo': 0},
    'w100': {'kind': 'linear', 'unit': 'm/s',  'scale': 0.25, 'offset': 0.0, 'lo': 0},
    'snow24': {'kind': 'log2', 'unit': 'cm', 'base': 0.5, 'k': 24.0},
    # theta-e op 850 hPa, dikte 500-1000 hPa in decameter
    'te850': {'kind': 'linear', 'unit': '°C', 'scale': 0.5, 'offset': -40.5, 'lo': 1},
    'thk':  {'kind': 'linear', 'unit': 'dam', 'scale': 0.5, 'offset': 470.0, 'lo': 1},
    # 500 hPa-hoogte in decameter
    'z500': {'kind': 'linear', 'unit': 'dam',  'scale': 0.7, 'offset': 430.0, 'lo': 1},
    't850': {'kind': 'linear', 'unit': '°C',   'scale': 0.5, 'offset': -70.5, 'lo': 1},
    't500': {'kind': 'linear', 'unit': '°C',   'scale': 0.5, 'offset': -70.5, 'lo': 1},
    # afwijking 2 m t.o.v. klimatologie (zie climate.py)
    'anom': {'kind': 'linear', 'unit': '°C',   'scale': 0.25, 'offset': -32.0, 'lo': 1},
    'a850': {'kind': 'linear', 'unit': '°C',   'scale': 0.25, 'offset': -32.0, 'lo': 1},
    # neerslagsommen: 24 uur en totaal sinds de start van de run
    'p24':  {'kind': 'log2', 'unit': 'mm', 'base': 0.1, 'k': 16.0},
    'ptot': {'kind': 'log2', 'unit': 'mm', 'base': 0.1, 'k': 16.0},
    # windstoot (hoogste in de voorgaande 6 uur), rechtstreeks in km/u
    'gust': {'kind': 'linear', 'unit': 'km/u', 'scale': 1.0, 'offset': 0.0, 'lo': 0},
    # sneeuwdek in cm, logaritmisch: cm = base * (2^(v/k) - 1)
    'sdep': {'kind': 'log2', 'unit': 'cm', 'base': 0.5, 'k': 24.0},
    # convectie en straalstroom; 0 is hier een echte waarde (wit op de kaart)
    'cape': {'kind': 'linear', 'unit': 'J/kg', 'scale': 30.0, 'offset': 0.0, 'lo': 0},
    'shear': {'kind': 'linear', 'unit': 'kt', 'scale': 1.0, 'offset': 0.0, 'lo': 0},
    'jet':  {'kind': 'linear', 'unit': 'kt', 'scale': 1.0, 'offset': 0.0, 'lo': 0},
    'tcc':  {'kind': 'linear', 'unit': '%',    'scale': 5.0, 'offset': 0.0,   'lo': 0},
    # aandeel van de bewolking dat alleen hoog is (0..1), zie process.high_share
    'hsh':  {'kind': 'linear', 'unit': '',     'scale': 0.1, 'offset': 0.0,   'lo': 0},
    'msl':  {'kind': 'linear', 'unit': 'hPa',  'scale': 0.5, 'offset': 930.0, 'lo': 0},
    'lsm':  {'kind': 'linear', 'unit': '',     'scale': 0.004, 'offset': 0.0, 'lo': 0},
    # 10 m wind: snelheid als veld, u/v alleen voor de vaantjes (zie process.write_step)
    'ws':   {'kind': 'linear', 'unit': 'm/s',  'scale': 0.25, 'offset': 0.0,  'lo': 0},
    'wuv':  {'kind': 'linear', 'unit': 'm/s',  'scale': 0.5,  'offset': -64.0, 'lo': 1},
    # bovenwind voor de pijlen: ruimer bereik, een straalstroom gaat boven 64 m/s
    'juv':  {'kind': 'linear', 'unit': 'm/s',  'scale': 1.0,  'offset': -128.0, 'lo': 1},
    # neerslagintensiteit logaritmisch: mm/u = base * (2^(v/k) - 1)
    'rain': {'kind': 'log2', 'unit': 'mm/u', 'base': 0.02, 'k': 12.0},
    'snow': {'kind': 'log2', 'unit': 'mm/u', 'base': 0.02, 'k': 12.0},
    # alleen op het winteroverzicht; zitten óók in rain en snow
    'fzra': {'kind': 'log2', 'unit': 'mm/u', 'base': 0.02, 'k': 12.0},
    'ipel': {'kind': 'log2', 'unit': 'mm/u', 'base': 0.02, 'k': 12.0},
}

# Onder de weergavedrempel (neerslag 0,1 mm/u, wolken vrijwel onzichtbaar) wordt 0 opgeslagen:
# niet zichtbaar in de kaart, wel ~35 % kleinere bestanden. Uitlezing toont dan '<'.
PRECIP_ZERO_BELOW = 0.05  # mm/u
TCC_ZERO_BELOW = 5.0      # %
SUM_ZERO_BELOW = 0.5      # mm, neerslagsom
SNOW_ZERO_BELOW = 0.5     # cm, sneeuwdek
CAPE_ZERO_BELOW = 25.0    # J/kg
# Zonuren: zonfractie van de daglengte per Kt, gefit op ECMWF-dagstraling (Open-Meteo ecmwf_ifs025) tegen KNMI SQ,
# 13 AWS, 26sep-30okt 2026; onafhankelijke helft: bias +0,23 u, MAE 1,05 u. Alleen herfst NL; met gemeten straling
# blijkt de curve over de seizoenen stabiel (bias <= 0,43 u), buiten NL niet getoetst.
SUN_KT = [0.157, 0.221, 0.274, 0.32, 0.371, 0.425, 0.475, 0.53, 0.576, 0.623, 0.669, 0.704]
SUN_FRAC = [0.025, 0.056, 0.116, 0.166, 0.228, 0.287, 0.328, 0.46, 0.627, 0.757, 0.89, 0.986]
SUN_MIN_ELEV = 3.0        # graden, zon lager telt niet als zonuur
DYN_SMOOTH_DEG = 0.4      # vorticiteit en omega: gaussisch, anders vooral ruis boven bergen

# Reliëfschaduw uit de orografie: licht uit het noordwesten, 128 = vlak
SHADE_AZIMUTH = 315.0
SHADE_ALTITUDE = 45.0
SHADE_EXAGGERATION = 4.0
SHADE_GAIN = 130.0

ISOBAR_STEP = 2          # hPa
ISOBAR_SMOOTH = 2.5      # gauss-sigma in rastercellen (0,1°) tegen orografische ruis
ISOBAR_SIMPLIFY_KM = 1.2
CENTRE_DEPTHS = (1, 2, 4, 8, 16)   # hPa, gesloten isobaar rond een H/L-kern
LOW_MAX_HPA = 1020    # 'lagen' boven deze druk zijn vrijwel altijd gebergte-artefacten in hogedruk
HIGH_MIN_HPA = 1008

# Vaantjes hebben geen fijner raster nodig dan dit (°): hoogste 1 op n rasterpunten
WIND_VEC_STEP = 0.25

# Neerslagtype (ECMWF ptype, code table 4.201): wat telt als 'sneeuw' in de kaart
PTYPE_FROZEN = (5, 6, 7, 8)   # sneeuw, natte sneeuw, regen/sneeuw-mix, ijskorrels
PTYPE_FREEZING = (3, 12)      # ijsregen, onderkoelde motregen
PTYPE_PELLETS = (8,)          # ijskorrels

# Dikte 500-1000 hPa: alleen deze lijnen (dam), net als het voorbeeld om de 18 dam
THICK_BASE = 546
THICK_STEP = 18

# Hoogtelijnen (dam) op de CAPE-, shear- en straalstroomkaart
Z500_STEP = 4
Z300_STEP = 8

MODELS = {
    'ecmwf': {
        'label': 'ECMWF IFS HRES',
        'source': 'ecmwf_opendata',
        'cycles': (0, 6, 12, 18),
        'resolution': '0p1',
        'step': 0.1,
        'attribution': 'Bron: ECMWF Open Data (CC BY 4.0). Bewerking: Weerlab.',
    },
    # zelfde model, ~2 uur eerder bij ECMWF dan 0,1°: dit is wat de kaart standaard toont
    'ecmwf025': {
        'label': 'ECMWF IFS HRES',
        'source': 'ecmwf_opendata',
        'cycles': (0, 6, 12, 18),
        'resolution': '0p25',
        'step': 0.25,
        'attribution': 'Bron: ECMWF Open Data (CC BY 4.0). Bewerking: Weerlab.',
    },
    # AI-model van ECMWF: stap voor stap online zodra gerekend, tot 1¾ uur vóór IFS; 6-uurlijks, minder velden
    'aifs': {
        'label': 'ECMWF AIFS',
        'source': 'aifs_opendata',
        'cycles': (0, 6, 12, 18),
        'resolution': '0p25',
        'step': 0.25,
        'attribution': 'Bron: ECMWF Open Data (CC BY 4.0). Bewerking: Weerlab.',
    },
    # ensemblegemiddelden, alleen het overzicht; alleen 00/12 UTC (±13 resp. 7 GB download per run)
    'ifsens': {
        'label': 'ECMWF IFS ENS gemiddelde',
        'source': 'ifs_ens',
        'cycles': (0, 12),
        'resolution': '0p25',
        'step': 0.25,
        'attribution': 'Bron: ECMWF Open Data (CC BY 4.0). Bewerking: Weerlab.',
    },
    'aifsens': {
        'label': 'ECMWF AIFS ENS gemiddelde',
        'source': 'aifs_ens',
        'cycles': (0, 12),
        'resolution': '0p25',
        'step': 0.25,
        'attribution': 'Bron: ECMWF Open Data (CC BY 4.0). Bewerking: Weerlab.',
    },
}
