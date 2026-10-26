"""
gebieden.py — Gebiedsmasker voor de uitsnede: per cel de provincie en Rijnmond.

Uitvoer pub/raster/gebieden.u8.gz (uint8, rijen×kolommen, rij 0 = noord):
  bits 0..3  provinciecode 1..12 (0 = buiten Nederland); volgorde in meta.json
  bit 7      cel ligt in de regio Rijnmond
Een cel hoort bij een gebied als zijn CENTRUM erin ligt (zelfde koppeling als
voor een locatie: geen gedeeltelijke cellen, geen interpolatie).

Rijnmond = het gebied van de Weerlab-regiokaart (#regiokaart), afgeleid uit
de ondergrond van die kaart (zie regiokaart.py); omlijning in raster/rijnmond.geojson.

  python3 -m accumulatie.gebieden
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np
from shapely.geometry import Point, Polygon, shape
from shapely.prepared import prep

from . import raster
from .opslag import Archief

REPO = Path(__file__).resolve().parent.parent
RIJNMOND = [  # (lon, lat), met de klok mee vanaf Hoek van Holland
    (4.05, 51.99), (4.20, 52.03), (4.40, 52.03), (4.62, 52.02), (4.80, 51.88),
    (4.78, 51.76), (4.55, 51.70), (4.20, 51.70), (3.95, 51.72), (3.83, 51.80),
    (3.98, 51.93),
]


def bouw(arch: Archief):
    geo = json.loads((REPO / "nl_provincies_detail.geojson").read_text())
    namen = [f["properties"]["naam"] for f in geo["features"]]
    vormen = [prep(shape(f["geometry"]).buffer(0)) for f in geo["features"]]
    from . import regiokaart
    lon, lat = raster.celcentra_uitsnede()
    rijnmond_cel = regiokaart.in_rijnmond(lon, lat)
    codes = np.zeros(lon.shape, np.uint8)
    for i in range(lon.shape[0]):
        for j in range(lon.shape[1]):
            p = Point(lon[i, j], lat[i, j])
            for c, v in enumerate(vormen, start=1):
                if v.contains(p):
                    codes[i, j] = c
                    break
            if rijnmond_cel[i, j]:
                codes[i, j] |= 0x80
    arch.schrijf_pub("raster/gebieden.u8.gz", gzip.compress(codes.tobytes(), 9, mtime=0))
    meta = {
        "rijen": raster.NRIJ, "kolommen": raster.NKOL, "r0": raster.R0, "k0": raster.K0,
        "proj4": raster.PROJ4, "provincies": namen, "rijnmond_bit": 128,
        "rijnmond_polygoon": RIJNMOND,          # verouderd (benadering); zie rijnmond_geojson
        "rijnmond_geojson": "raster/rijnmond.geojson",
        "regiokaart": {"crs": "EPSG:28992", "x0": regiokaart.X0, "y1": regiokaart.Y1, "m": regiokaart.M,
                       "breedte": regiokaart.B, "hoogte": regiokaart.H},
        "koppeling": "cel = floor van de fractionele rasterindex (punt valt in de cel); "
                     "gebied = celcentrum binnen de polygoon",
    }
    arch.schrijf_pub("raster/meta.json", json.dumps(meta, ensure_ascii=False).encode())
    arch.schrijf_pub("raster/rijnmond.geojson", json.dumps(regiokaart.omlijning_geojson(), separators=(",", ":")).encode())
    n = {nm: int(((codes & 0x0F) == c).sum()) for c, nm in enumerate(namen, start=1)}
    return n, int((codes & 0x80).astype(bool).sum())


if __name__ == "__main__":
    print(bouw(Archief()))
