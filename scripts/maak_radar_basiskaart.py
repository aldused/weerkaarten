#!/usr/bin/env python3
"""
maak_radar_basiskaart.py — Genereer basiskaart + overlay voor de regenradar.

Maakt twee PNG's met identieke afmetingen en projectie:
  radar_kaart_bg.png      — achtergrond (land, zee, meren)
  radar_kaart_overlay.png — transparante voorgrond (kustlijn, grenzen, steden)

Eenmalig draaien; upload resultaat naar Cloudflare R2.
"""

import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
import cartopy.crs as ccrs
import cartopy.feature as cfeature

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# Kaartgrenzen: Nederland + stukje omgeving
EXTENT = [3.0, 7.5, 50.4, 53.9]  # lon_min, lon_max, lat_min, lat_max

# Bereken juiste beeldverhouding
# Op 52°N: 1° lon ≈ 68.5 km, 1° lat ≈ 111.3 km
LAT_MID = (EXTENT[2] + EXTENT[3]) / 2
KM_PER_LON = 111.32 * np.cos(np.radians(LAT_MID))
KM_PER_LAT = 111.32
MAP_W_KM = (EXTENT[1] - EXTENT[0]) * KM_PER_LON  # ~308 km
MAP_H_KM = (EXTENT[3] - EXTENT[2]) * KM_PER_LAT  # ~389 km
ASPECT = MAP_H_KM / MAP_W_KM  # ~1.26 → kaart is hoger dan breed

DPI = 150
PX_W = 900   # breedte in pixels
PX_H = int(PX_W * ASPECT)  # ~1134 pixels
FIG_W = PX_W / DPI   # inches
FIG_H = PX_H / DPI

# Steden voor op de overlay
STEDEN = [
    (52.37, 4.89, "Amsterdam"), (52.09, 5.12, "Utrecht"),
    (51.92, 4.48, "Rotterdam"), (52.08, 4.31, "Den Haag"),
    (51.44, 5.47, "Eindhoven"), (53.22, 6.57, "Groningen"),
    (51.84, 5.86, "Arnhem"), (52.51, 6.09, "Zwolle"),
    (51.69, 5.30, "Den Bosch"), (53.20, 5.80, "Leeuwarden"),
    (52.22, 6.90, "Enschede"), (51.56, 4.47, "Breda"),
    (52.93, 4.79, "Den Helder"), (51.45, 3.57, "Vlissingen"),
    (52.70, 5.75, "Emmeloord"), (52.46, 5.52, "Lelystad"),
    (51.59, 4.78, "Tilburg"), (52.96, 5.94, "Assen"),
    # Belgie (rand)
    (51.22, 4.40, "Antwerpen"), (51.05, 3.72, "Gent"),
    # Duitsland (rand)
    (51.96, 7.63, "Munster"),
]


def maak_kaart(fname, modus="bg"):
    """Genereer achtergrond- of overlay-PNG."""
    fig = plt.figure(figsize=(FIG_W, FIG_H))
    ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
    ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    # Gebruik correcte geo-aspect ratio (NIET auto!)
    ax.set_aspect(KM_PER_LAT / KM_PER_LON)

    if modus == "bg":
        # Achtergrond: land + zee + meren
        ax.add_feature(cfeature.OCEAN.with_scale("10m"), facecolor="#c8e0f0", zorder=0)
        ax.add_feature(cfeature.LAND.with_scale("10m"),  facecolor="#eaf3e8", zorder=1)
        ax.add_feature(cfeature.LAKES.with_scale("10m"), facecolor="#c8e0f0", zorder=2)
    else:
        # Overlay: transparante achtergrond
        fig.patch.set_alpha(0)
        ax.patch.set_alpha(0)

        # Lijnen — kustlijn subtiel (achtergrond land/zee geeft al de contour)
        ax.add_feature(cfeature.RIVERS.with_scale("10m"),
                        edgecolor="#89b8d4", linewidth=0.4, zorder=3)
        ax.add_feature(cfeature.COASTLINE.with_scale("10m"),
                        edgecolor="#666666", linewidth=0.4, zorder=4)
        ax.add_feature(cfeature.BORDERS.with_scale("10m"),
                        edgecolor="#888888", linewidth=0.5, linestyle="--", zorder=4)

        # Stadsnamen
        halo = [pe.withStroke(linewidth=2.5, foreground="white")]
        for lat, lon, naam in STEDEN:
            ax.plot(lon, lat, "o", color="#333333", markersize=2.5,
                    transform=ccrs.PlateCarree(), zorder=6)
            ax.text(lon + 0.04, lat + 0.02, naam, fontsize=6.5,
                    color="#222222", fontweight="bold",
                    path_effects=halo,
                    transform=ccrs.PlateCarree(), zorder=7)

    ax.axis("off")
    # GEEN bbox_inches="tight" — dat knipt elke PNG anders bij!
    # De axes vullen al 100% van de figuur via add_axes([0,0,1,1])
    plt.savefig(fname, dpi=DPI, pad_inches=0,
                transparent=(modus == "overlay"))
    plt.close()
    print(f"  {fname} ({os.path.getsize(fname)/1024:.0f} KB)")


if __name__ == "__main__":
    print(f"Radar basiskaart genereren...")
    print(f"  Verhouding: {MAP_W_KM:.0f} km breed × {MAP_H_KM:.0f} km hoog (aspect {ASPECT:.2f})")
    print(f"  Afbeelding: {PX_W}×{PX_H} px")
    maak_kaart("radar_kaart_bg.png", "bg")
    maak_kaart("radar_kaart_overlay.png", "overlay")
    print("Klaar!")
