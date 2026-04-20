#!/usr/bin/env python3
"""Genereer harmonie_land.png — groene landmask voor bewolkingskaarten.

Output:
  harmonie_land.png — RGBA, groen (#87b946) op land, transparant op water
                      (IJsselmeer, Markermeer, overige meren uitgeknipt)

Matcht de extent van harmonie_overlay.png: 0.5-12.5E, 47.5-56.5N, 1641×1231.
Bron: Natural Earth 10m physical (land, lakes, lakes_europe).

Eenmalig draaien; upload resultaat naar R2 via harmonie_update.sh.
"""
import os
from PIL import Image, ImageDraw
import cartopy.io.shapereader as shpreader
from shapely.geometry import box

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

LON_MIN, LON_MAX = 0.5, 12.5
LAT_MIN, LAT_MAX = 47.5, 56.5
PX_W, PX_H = 1641, 1231
GREEN = (135, 185, 70, 255)
BBOX = box(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX)


def xy(lon, lat):
    return ((lon - LON_MIN) / (LON_MAX - LON_MIN) * PX_W,
            (1 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * PX_H)


def paint(draw, geom, fill):
    if geom.is_empty:
        return
    if geom.geom_type == "Polygon":
        draw.polygon([xy(x, y) for x, y in geom.exterior.coords], fill=fill)
        for ring in geom.interiors:
            draw.polygon([xy(x, y) for x, y in ring.coords], fill=(0, 0, 0, 0))
    elif geom.geom_type in ("MultiPolygon", "GeometryCollection"):
        for g in geom.geoms:
            paint(draw, g, fill)


def main():
    img = Image.new("RGBA", (PX_W, PX_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 1. Groen land (ne_10m_land)
    land_shp = shpreader.natural_earth(resolution="10m", category="physical", name="land")
    land_count = 0
    for rec in shpreader.Reader(land_shp).records():
        g = rec.geometry
        if g.bounds[0] > LON_MAX or g.bounds[2] < LON_MIN: continue
        if g.bounds[1] > LAT_MAX or g.bounds[3] < LAT_MIN: continue
        paint(d, g.intersection(BBOX), GREEN)
        land_count += 1

    # 2. Meren uit mask knippen (globaal + Europees voor IJsselmeer, Markermeer, etc.)
    lake_count = 0
    for src in ["lakes", "lakes_europe"]:
        shp = shpreader.natural_earth(resolution="10m", category="physical", name=src)
        for rec in shpreader.Reader(shp).records():
            g = rec.geometry
            if g.bounds[0] > LON_MAX or g.bounds[2] < LON_MIN: continue
            if g.bounds[1] > LAT_MAX or g.bounds[3] < LAT_MIN: continue
            paint(d, g.intersection(BBOX), (0, 0, 0, 0))
            lake_count += 1

    img.save("harmonie_land.png", optimize=True)
    size_kb = os.path.getsize("harmonie_land.png") / 1024
    print(f"harmonie_land.png: {PX_W}×{PX_H}, {land_count} land + {lake_count} lakes, {size_kb:.0f} KB")


if __name__ == "__main__":
    main()
