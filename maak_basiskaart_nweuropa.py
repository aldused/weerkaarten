#!/usr/bin/env python3
"""
Genereer kaart_basis_nweuropa.png — basis voor bliksem-kaart inclusief
Noord-Frankrijk, BeNeLux, West-Duitsland.

bbox: -1.5 .. 8.5 lon, 48.0 .. 54.5 lat
Equirectangular projectie (zelfde als andere weerlab-kaarten).
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent

LON_MIN, LON_MAX = -1.5, 8.5
LAT_MIN, LAT_MAX = 48.0, 54.5
W = 1080
H = round(W * (LAT_MAX - LAT_MIN) / (LON_MAX - LON_MIN))  # equirectangular
print(f"output: {W}x{H} px")

ZEE = (216, 227, 237)         # lichtblauw
LAND = (232, 238, 222)        # lichtgroen
GRENS_LAND = (140, 160, 175)  # donkerblauw-grijs voor landgrenzen
GRENS_REGIO = (190, 200, 210) # licht voor regio-grenzen
RIVIER = (180, 200, 220)


def lonlat_to_xy(lon, lat):
    x = (lon - LON_MIN) / (LON_MAX - LON_MIN) * W
    y = (1 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * H
    return x, y


def teken_geojson(draw, path, fill=None, outline=None, width=1):
    if not path.exists():
        print(f"  ! ontbreekt: {path.name}")
        return
    data = json.loads(path.read_text())
    feats = data.get("features", [data]) if data.get("type") == "FeatureCollection" else [data]
    n = 0
    for feat in feats:
        geom = feat.get("geometry", feat)
        gtype = geom.get("type")
        coords = geom.get("coordinates", [])
        if gtype == "Polygon":
            polys = [coords]
        elif gtype == "MultiPolygon":
            polys = coords
        elif gtype == "LineString":
            pts = [lonlat_to_xy(lon, lat) for lon, lat in coords]
            if len(pts) >= 2:
                draw.line(pts, fill=outline or GRENS_REGIO, width=width)
            continue
        elif gtype == "MultiLineString":
            for line in coords:
                pts = [lonlat_to_xy(lon, lat) for lon, lat in line]
                if len(pts) >= 2:
                    draw.line(pts, fill=outline or GRENS_REGIO, width=width)
            continue
        else:
            continue
        for poly in polys:
            outer = poly[0]
            pts = [lonlat_to_xy(lon, lat) for lon, lat in outer]
            if len(pts) < 3:
                continue
            if fill:
                draw.polygon(pts, fill=fill, outline=outline)
            elif outline:
                pts_closed = pts + [pts[0]]
                draw.line(pts_closed, fill=outline, width=width)
            n += 1
    print(f"  {path.name}: {n} polygonen")


def main():
    img = Image.new("RGB", (W, H), ZEE)
    draw = ImageDraw.Draw(img)

    print("land vullen…")
    teken_geojson(draw, ROOT / "europa_land.geojson", fill=LAND)

    print("regiogrenzen…")
    teken_geojson(draw, ROOT / "nl_provincies.geojson", outline=GRENS_REGIO, width=1)
    teken_geojson(draw, ROOT / "be_provincies.geojson", outline=GRENS_REGIO, width=1)
    teken_geojson(draw, ROOT / "fr_regions.geojson", outline=GRENS_REGIO, width=1)
    teken_geojson(draw, ROOT / "germany_bundeslander.geojson", outline=GRENS_REGIO, width=1)

    print("rivieren…")
    teken_geojson(draw, ROOT / "nl_rivieren.geojson", outline=RIVIER, width=1)

    print("landgrenzen…")
    teken_geojson(draw, ROOT / "europa_land.geojson", outline=GRENS_LAND, width=2)

    out = ROOT / "kaart_basis_nweuropa.png"
    img.save(out, optimize=True)
    print(f"klaar: {out} ({out.stat().st_size // 1024} kB)")


if __name__ == "__main__":
    main()
