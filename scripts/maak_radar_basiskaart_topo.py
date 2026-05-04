#!/usr/bin/env python3
"""maak_radar_basiskaart_topo.py — Shaded-relief basemap-PNG voor radar.html.

Render via ESRI World Shaded Relief tiles, exact radar-bbox van radar.html.
Output: radar_basemap_topo.png (1800×1625, geen demo-elementen).
Eenmalig draaien, commit naar git voor weerlab.nl/Pages.

Bbox + aspect MOETEN matchen radar.html basemap-config:
  PROJ_LON_MIN=1.0, PROJ_LON_MAX=10.0
  PROJ_LAT_MIN=49.5, PROJ_LAT_MAX=54.5
  BASEMAP_W=1800
"""
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.io.img_tiles as cimgt

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# Bbox = radar.html PROJ_*
LON_MIN, LON_MAX = 1.0, 10.0
LAT_MIN, LAT_MAX = 49.5, 54.5
EXTENT = [LON_MIN, LON_MAX, LAT_MIN, LAT_MAX]

# Pixel-aligned met radar.html BASEMAP_W=1800
LAT_MID = (LAT_MIN + LAT_MAX) / 2
KM_LON = 111.32 * np.cos(np.radians(LAT_MID))
ASPECT = ((LAT_MAX - LAT_MIN) * 111.32) / ((LON_MAX - LON_MIN) * KM_LON)

PX_W = 1800
PX_H = int(round(PX_W * ASPECT))   # ~1625
DPI = 150
FIG_W = PX_W / DPI
FIG_H = PX_H / DPI


class ShadedRelief(cimgt.GoogleTiles):
    def _image_url(self, tile):
        x, y, z = tile
        return (
            f"https://server.arcgisonline.com/ArcGIS/rest/services/"
            f"World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}"
        )


def main():
    print(f"Render shaded-relief basemap {PX_W}×{PX_H} px (aspect {ASPECT:.3f})")
    fig = plt.figure(figsize=(FIG_W, FIG_H))
    ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
    ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    # Geo-aspect
    ax.set_aspect(KM_LON / 111.32 ** 0 * (LAT_MAX - LAT_MIN) / (LON_MAX - LON_MIN) /
                  (PX_H / PX_W))  # neutralize, set_extent + add_axes [0,0,1,1] zorgt al voor fill
    ax.set_aspect("auto")  # forceer fill
    ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    # Tegels op zoom 8 — detail genoeg voor 1800px breed
    ax.add_image(ShadedRelief(), 8, interpolation="bilinear")
    ax.axis("off")
    out = "radar_basemap_topo.png"
    plt.savefig(out, dpi=DPI, pad_inches=0)
    plt.close()
    print(f"  {out} ({os.path.getsize(out)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
