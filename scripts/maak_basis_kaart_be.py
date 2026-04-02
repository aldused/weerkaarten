#!/usr/bin/env python3
"""
Genereer kaart_basis_be.png — lege basiskaart voor België (eenmalig).
Vergelijkbaar met kaart_basis_nl.png maar landscape en voor België extent.
"""

import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

EXTENT = [1.5, 6.6, 49.2, 51.7]  # België + omgeving

fig = plt.figure(figsize=(12, 6))
ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
ax.set_aspect('auto')

ax.add_feature(cfeature.OCEAN.with_scale("10m"),    facecolor="#c8e0f0", zorder=0)
ax.add_feature(cfeature.LAND.with_scale("10m"),     facecolor="#eaf3e8", zorder=1)
ax.add_feature(cfeature.LAKES.with_scale("10m"),    facecolor="#c8e0f0", zorder=2)
ax.add_feature(cfeature.RIVERS.with_scale("10m"),   edgecolor="#89b8d4", linewidth=0.6, zorder=3)
ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#333333", linewidth=0.8, zorder=4)
ax.add_feature(cfeature.BORDERS.with_scale("10m"),  edgecolor="#666666", linewidth=0.7,
               linestyle="--", zorder=4)
ax.axis("off")

fname = "kaart_basis_be.png"
plt.savefig(fname, dpi=150, bbox_inches="tight", pad_inches=0)
plt.close()
print(f"Basiskaart gegenereerd: {fname} ({os.path.getsize(fname)/1024:.0f} KB)")
