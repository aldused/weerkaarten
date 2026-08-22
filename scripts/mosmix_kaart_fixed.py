#!/usr/local/bin/python3
# mosmix_kaart_fixed.py
# Maakt alleen kaart_basis_nl.png — de achtergrondkaart voor historisch.html
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

print("Basiskaart aanmaken...")

EXTENT = [3.3, 7.4, 50.45, 53.8]

fig = plt.figure(figsize=(7, 9.6))
ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree())
ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
ax.set_aspect('auto')
ax.add_feature(cfeature.OCEAN.with_scale("10m"),    facecolor="#c8e0f0", zorder=0)
ax.add_feature(cfeature.LAND.with_scale("10m"),     facecolor="#eaf3e8", zorder=1)
ax.add_feature(cfeature.LAKES.with_scale("10m"),    facecolor="#c8e0f0", zorder=2)
ax.add_feature(cfeature.RIVERS.with_scale("10m"),   edgecolor="#89b8d4", linewidth=0.5, zorder=3)
ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#333333", linewidth=0.7, zorder=4)
ax.add_feature(cfeature.BORDERS.with_scale("10m"),  edgecolor="#666666", linewidth=0.6, linestyle="--", zorder=4)
ax.axis("off")
plt.tight_layout(pad=0)
plt.savefig("kaart_basis_nl.png", dpi=150, bbox_inches="tight")
plt.close()
print("kaart_basis_nl.png aangemaakt")
