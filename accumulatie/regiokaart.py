"""
regiokaart.py — Het Rijnmondgebied zoals op de Weerlab-regiokaart (#regiokaart).

De ondergrond van de regiokaart-editor (Kaartenstudio, weerbewaking_regio_kaart)
is een afbeelding van 1920×1080 in RD (EPSG:28992). Het kader is bepaald door
de CBS-kustlijn op de afbeelding te passen (overlap 0,89 op 960×540; de
kustlijn valt op de pixel samen):

    x 44 076 – 131 995 m, y 405 838 – 455 293 m, 45,791 m per pixel (vierkant)

Het Rijnmondgebied is het lichtgroene vlak op die kaart, inclusief de kleine
wateren erbinnen (sluiting 15 px ≈ 0,7 km + gaten vullen). Grote wateren
(Haringvliet, Hollands Diep) horen er net als op de regiokaart niet bij.

Uitvoer (via gebieden.py): Rijnmond-bit per radarcel en pub/raster/rijnmond.geojson.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer

REPO = Path(__file__).resolve().parent.parent
ONDERGROND = REPO / "rijnmond_regiokaart.png"
B, H = 1920, 1080
X0, Y1, M = 44075.95, 455292.51, 45.7911     # linkerbovenhoek (RD, m) en meter per pixel
X1, Y0 = X0 + B * M, Y1 - H * M
_RD = Transformer.from_crs(4326, 28992, always_xy=True)
_WGS = Transformer.from_crs(28992, 4326, always_xy=True)


def naar_pixel(lon, lat):
    x, y = _RD.transform(np.asarray(lon, float), np.asarray(lat, float))
    return (np.asarray(x) - X0) / M, (Y1 - np.asarray(y)) / M


def naar_lonlat(px, py):
    return _WGS.transform(X0 + np.asarray(px, float) * M, Y1 - np.asarray(py, float) * M)


@lru_cache(maxsize=1)
def masker() -> np.ndarray:
    """Bool (H, B): pixel ligt in het Rijnmondgebied van de regiokaart."""
    from scipy import ndimage as ndi
    im = np.asarray(Image.open(ONDERGROND).convert("RGB")).astype(int)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    licht = (g > 160) & (r > 65) & (b < 140)
    k = ndi.iterate_structure(ndi.generate_binary_structure(2, 1), 15)
    return ndi.binary_fill_holes(ndi.binary_closing(licht, structure=k))


def in_rijnmond(lon, lat) -> np.ndarray:
    px, py = naar_pixel(lon, lat)
    i, j = np.floor(py).astype(int), np.floor(px).astype(int)
    ok = (i >= 0) & (i < H) & (j >= 0) & (j < B)
    uit = np.zeros(np.shape(px), bool)
    uit[ok] = masker()[i[ok], j[ok]]
    return uit


def omlijning_geojson(stap=2) -> dict:
    """Buitenrand(en) van het gebied als GeoJSON (lon/lat), voor kaart en export."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    m = masker()[::stap, ::stap].astype(float)
    m = np.pad(m, 1)
    cs = plt.contour(m, levels=[0.5])
    polys = []
    for pad in cs.allsegs[0]:
        if len(pad) < 20:
            continue
        px = (pad[:, 0] - 1) * stap
        py = (pad[:, 1] - 1) * stap
        lon, lat = naar_lonlat(px, py)
        ring = [[round(float(a), 5), round(float(b), 5)] for a, b in zip(lon, lat)]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        polys.append([ring])
    plt.close("all")
    polys.sort(key=lambda p: -len(p[0]))
    return {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {
        "naam": "Rijnmond", "bron": "Weerlab-regiokaart (Kaartenstudio), RD-kader 44076–131995 × 405838–455293 m"},
        "geometry": {"type": "MultiPolygon", "coordinates": polys}}]}
