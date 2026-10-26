"""
raster.py — Het KNMI-radarraster (RAD_NL25) en de Nederlandse uitsnede.

Bron van waarheid voor de geometrie. Alles hier is gecontroleerd tegen de
HDF5-attributen van RTCOR- en RFCOR-bestanden (oktober 2026):

  projectie   +proj=stere +lat_0=90 +lon_0=0 +lat_ts=60
              +a=6378137 +b=6356752 +x_0=0 +y_0=0 +units=km
  raster      765 rijen × 700 kolommen, pixel 1,0 × -1,0 km (rasterkm)
  offsets     geo_column_offset = 0, geo_row_offset = 3650
  pixel_def   'LU': index (rij, kol) is de linkerbovenhoek van de cel:
                 x = (kol + col_off) * px        y = (rij + row_off) * py
              Het celcentrum ligt dus op (kol + 0,5, rij + 0,5).

Koppeling locatie → cel: de cel waarin het punt valt, dus floor() van de
fractionele index — geen afronding naar het dichtstbijzijnde celcentrum en
geen interpolatie. Dat is precies de cel waarvoor KNMI de waarde levert.

Let op schaal: polaire stereografie met ware schaal op 60°N is op 52°N
ca. 4% vergroot (k ≈ 1,044). Eén rasterkm is daar dus ~0,96 km op aarde.
Afstanden (straalgemiddelde, ontdubbelen toplijst) rekenen we daarom in
echte km via schaalfactor_k().

Uitsnede: rij 200..647, kol 192..575 (448 × 384 cellen) — Nederland met
~30 km marge (50,45–53,85°N, 2,9–7,7°O valt er volledig binnen). Dat is
32% van het volledige raster: kleinere bestanden, zelfde cellen.
"""
from __future__ import annotations

import math

import numpy as np

# ── Volledig KNMI-raster ────────────────────────────────────────────────────
PROJ4 = ("+proj=stere +lat_0=90 +lon_0=0 +lat_ts=60 "
         "+a=6378137 +b=6356752 +x_0=0 +y_0=0 +units=km")
A_KM = 6378.137
B_KM = 6356.752
LAT_TS = 60.0
NRIJ_VOL, NKOL_VOL = 765, 700
PX, PY = 1.0, -1.0
COL_OFF, ROW_OFF = 0.0, 3650.0

# ── Uitsnede ────────────────────────────────────────────────────────────────
R0, R1 = 200, 648          # rijen [R0, R1)
K0, K1 = 192, 576          # kolommen [K0, K1)
NRIJ, NKOL = R1 - R0, K1 - K0
CHUNK = 32                 # tijdreeks-tegels van 32×32 cellen
NCHUNK_R, NCHUNK_K = NRIJ // CHUNK, NKOL // CHUNK
assert NRIJ % CHUNK == 0 and NKOL % CHUNK == 0

# Ellipsoïde-afgeleiden (Snyder 1987, polaire stereografie variant B)
_E2 = 1.0 - (B_KM / A_KM) ** 2
_E = math.sqrt(_E2)


def _t(phi):
    s = np.sin(phi)
    return np.tan(np.pi / 4 - phi / 2) / ((1 - _E * s) / (1 + _E * s)) ** (_E / 2)


def _m(phi):
    return np.cos(phi) / np.sqrt(1 - _E2 * np.sin(phi) ** 2)


_PHI_C = math.radians(LAT_TS)
_MC = float(_m(_PHI_C))
_TC = float(_t(_PHI_C))


def vooruit(lon, lat):
    """(lon, lat) graden → (x, y) rasterkm. Zelfde formule als proj (stere)."""
    lam = np.radians(np.asarray(lon, dtype=np.float64))
    phi = np.radians(np.asarray(lat, dtype=np.float64))
    rho = A_KM * _MC * _t(phi) / _TC
    return rho * np.sin(lam), -rho * np.cos(lam)


def terug(x, y):
    """(x, y) rasterkm → (lon, lat) graden. Iteratief (Snyder 7-9), < 1e-12 rad."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    rho = np.hypot(x, y)
    t = rho * _TC / (A_KM * _MC)
    phi = np.pi / 2 - 2 * np.arctan(t)
    for _ in range(15):
        s = np.sin(phi)
        phi = np.pi / 2 - 2 * np.arctan(t * ((1 - _E * s) / (1 + _E * s)) ** (_E / 2))
    lam = np.arctan2(x, -y)
    return np.degrees(lam), np.degrees(phi)


def schaalfactor_k(lat):
    """Lineaire schaalfactor van de projectie op breedte lat (rasterkm per echte km)."""
    phi = np.radians(np.asarray(lat, dtype=np.float64))
    rho = A_KM * _MC * _t(phi) / _TC
    return rho / (A_KM * _m(phi))


# ── Index-conversies ────────────────────────────────────────────────────────
def xy_naar_index_vol(x, y):
    """Rasterkm → fractionele (rij, kol) in het volledige raster (LU-conventie)."""
    kol = x / PX - COL_OFF
    rij = y / PY - ROW_OFF
    return rij, kol


def cel_van_lonlat(lon, lat):
    """(lon, lat) → (rij, kol) in de UITSNEDE, of (-1, -1) buiten de uitsnede.

    floor() van de fractionele index: het punt valt in die cel."""
    x, y = vooruit(lon, lat)
    rij_f, kol_f = xy_naar_index_vol(x, y)
    rij = np.floor(rij_f).astype(np.int64) - R0
    kol = np.floor(kol_f).astype(np.int64) - K0
    buiten = (rij < 0) | (rij >= NRIJ) | (kol < 0) | (kol >= NKOL)
    rij = np.where(buiten, -1, rij)
    kol = np.where(buiten, -1, kol)
    return rij, kol


def celcentrum_lonlat(rij, kol):
    """(rij, kol) in de uitsnede → lon/lat van het celcentrum."""
    rij = np.asarray(rij, dtype=np.float64) + R0 + 0.5
    kol = np.asarray(kol, dtype=np.float64) + K0 + 0.5
    x = (kol + COL_OFF) * PX
    y = (rij + ROW_OFF) * PY
    return terug(x, y)


def celcentra_uitsnede():
    """lon, lat arrays (NRIJ, NKOL) van alle celcentra in de uitsnede."""
    rr, kk = np.meshgrid(np.arange(NRIJ), np.arange(NKOL), indexing="ij")
    return celcentrum_lonlat(rr, kk)


def controleer_geo(attrs_geo: dict, proj4: str) -> None:
    """Weiger een bestand waarvan de geometrie afwijkt van wat we verwachten.

    attrs_geo: attributen van de HDF5-groep 'geographic'. Wij herschalen nooit
    stilzwijgend: een ander raster zou cellen verschuiven en sommen vervalsen."""
    def f(k):
        return float(np.asarray(attrs_geo[k]).ravel()[0])

    def i(k):
        return int(np.asarray(attrs_geo[k]).ravel()[0])

    fouten = []
    if i("geo_number_rows") != NRIJ_VOL or i("geo_number_columns") != NKOL_VOL:
        fouten.append(f"rastergrootte {i('geo_number_rows')}x{i('geo_number_columns')}")
    # Oudere bestanden (t/m ~2022) noteren pixel 1,0000013–1,0000055 km en
    # rij-offset 3649,98: hetzelfde raster binnen enkele meters. We toetsen
    # daarom de ligging van de hoekpunten, niet de losse getallen.
    px, py = f("geo_pixel_size_x"), f("geo_pixel_size_y")
    co, ro = f("geo_column_offset"), f("geo_row_offset")
    afw = 0.0
    for rij in (0, NRIJ_VOL):
        for kol in (0, NKOL_VOL):
            x, y = (kol + co) * px, (rij + ro) * py
            x0, y0 = (kol + COL_OFF) * PX, (rij + ROW_OFF) * PY
            afw = max(afw, abs(x - x0), abs(y - y0))
    if afw > 0.02:
        fouten.append(f"hoekpunten wijken {afw * 1000:.0f} m af (pixel {px},{py}; offsets {co},{ro})")
    pd = attrs_geo.get("geo_pixel_def", b"LU")
    pd = pd.decode() if isinstance(pd, bytes) else str(pd)
    if pd.strip().upper() != "LU":
        fouten.append(f"geo_pixel_def {pd!r}")
    p = proj4.decode() if isinstance(proj4, bytes) else str(proj4)
    if "+proj=stere" not in p or "+lat_0=90" not in p or "+lat_ts=60" not in p or "+lon_0=0" not in p:
        fouten.append(f"projectie {p!r}")
    else:
        # oudere bestanden: a/b in km (6378.14/6356.75), nieuwere in m-notatie met units=km
        a = float(p.split("+a=")[1].split()[0])
        b = float(p.split("+b=")[1].split()[0])
        if a > 10000:
            a, b = a / 1000.0, b / 1000.0
        if abs(a - A_KM) > 0.01 or abs(b - B_KM) > 0.01:
            fouten.append(f"ellipsoïde a={a} b={b}")
    if fouten:
        raise ValueError("Onverwachte radargeometrie: " + "; ".join(fouten))
