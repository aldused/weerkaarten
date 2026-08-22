#!/usr/bin/env python3
"""Genereer demo: ESRI World Shaded Relief over radar-bbox + NL-grenzen.

Output: demo_topo_basemap.png (in KNMI_Project root) met echte topo i.p.v. fake gradient.
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import cartopy.io.img_tiles as cimgt

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

EXTENT = [1.0, 10.0, 49.5, 54.5]


class ShadedRelief(cimgt.GoogleTiles):
    """ESRI World Shaded Relief — gratis tegels met attribution."""
    def _image_url(self, tile):
        x, y, z = tile
        return (
            f"https://server.arcgisonline.com/ArcGIS/rest/services/"
            f"World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}"
        )


class WorldTopo(cimgt.GoogleTiles):
    """ESRI World Topographic Map — kleur + reliëf + labels."""
    def _image_url(self, tile):
        x, y, z = tile
        return (
            f"https://server.arcgisonline.com/ArcGIS/rest/services/"
            f"World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
        )


def render(tile_provider, fname, alpha=1.0):
    fig = plt.figure(figsize=(11, 12))
    ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
    ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    # Reliëf-tegels
    ax.add_image(tile_provider, 7, alpha=alpha, interpolation="bilinear")
    # Subtiele oceaan-blue cover
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),
                   facecolor=(0.65, 0.78, 0.86, 0.55), zorder=2)
    # Kustlijn fijn
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"),
                   edgecolor="#456", linewidth=0.5, zorder=3)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),
                   edgecolor="#456", linewidth=0.6, zorder=3)
    # Demo radar-blob
    halo = [pe.withStroke(linewidth=2.5, foreground="white")]
    ax.scatter([5.3, 3.5], [52.0, 53.2], s=[14000, 7000],
               c=["#cc0000", "#ff9900"], alpha=0.55, zorder=4,
               transform=ccrs.PlateCarree())
    # Stadsnamen
    for lat, lon, naam in [
        (52.37, 4.89, "Amsterdam"), (51.92, 4.48, "Rotterdam"),
        (52.09, 5.12, "Utrecht"),   (51.44, 5.47, "Eindhoven"),
        (53.22, 6.57, "Groningen"), (51.22, 4.40, "Antwerpen"),
    ]:
        ax.plot(lon, lat, "o", color="#222", markersize=2.5,
                transform=ccrs.PlateCarree(), zorder=5)
        ax.text(lon + 0.05, lat + 0.03, naam, fontsize=7,
                color="#222", fontweight="bold",
                path_effects=halo,
                transform=ccrs.PlateCarree(), zorder=6)
    ax.axis("off")
    plt.savefig(fname, dpi=140, pad_inches=0)
    plt.close()
    print(f"  {fname} ({os.path.getsize(fname)/1024:.0f} KB)")


if __name__ == "__main__":
    render(ShadedRelief(), "demo_topo_shaded_relief.png", alpha=1.0)
    render(WorldTopo(),    "demo_topo_world_topo.png",   alpha=1.0)
    print("klaar")
