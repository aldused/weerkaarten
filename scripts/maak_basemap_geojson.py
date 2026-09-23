#!/usr/bin/env python3
"""Bouw de vectorondergrond voor de Leaflet-kaarten (basemap/*.json).

Aanleiding: CARTO levert sinds eind augustus 2026 zonder API-sleutel tegels met
een watermerk. In plaats van een nieuwe tegelleverancier tekenen de kaarten hun
ondergrond nu zelf, net als radar.html sinds 11 september 2026.

Bron: de Natural Earth-bestanden die cartopy al lokaal heeft staan
(~/.local/share/cartopy/shapefiles/natural_earth). Natural Earth is publiek
domein. Er wordt niets gedownload; draaien kan dus offline.

    python3 scripts/maak_basemap_geojson.py

Twee detailniveaus, zodat een wereldkaart licht blijft en een regiokaart scherp:
  wereld_*   50m, hele wereld       -> altijd geladen
  europa_*   10m, Europa + Noordzee -> pas vanaf zoom 6
Nederland zelf komt uit de bestaande bestanden (nl_land_detail.geojson enz.).
De uitvoer heet .json en niet .geojson: alleen application/json wordt door
GitHub Pages en Cloudflare gecomprimeerd (scheelt hier een factor drie).
"""
import json
import shutil
from pathlib import Path

import shapefile  # pyshp
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

NE = Path.home() / ".local/share/cartopy/shapefiles/natural_earth"
ROOT = Path(__file__).resolve().parent.parent
UIT = ROOT / "basemap"

# Ruim genoeg voor alle Europese kaarten: IJsland en de Azoren-rand links,
# de Zwarte Zee rechts, Noord-Afrika onder en Spitsbergen-kant boven.
EUROPA = box(-32, 24, 52, 75)


def lees(soort: str, naam: str):
    """Geometrieën uit een Natural Earth-shapefile als shapely-objecten."""
    pad = NE / soort / f"{naam}.shp"
    if not pad.exists():
        raise SystemExit(f"ontbreekt: {pad}\nDraai eerst een cartopy-kaart, of zet het bestand er handmatig neer.")
    with shapefile.Reader(str(pad)) as sf:
        return [shape(s.__geo_interface__) for s in sf.shapes()]


def afronden(obj, cijfers: int):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(v), cijfers) for v in obj]
        return [afronden(x, cijfers) for x in obj]
    if isinstance(obj, dict):
        return {k: afronden(v, cijfers) for k, v in obj.items()}
    return obj


def schrijf(naam: str, geometrieen, tolerantie: float, cijfers: int, knip=None):
    kenmerken = []
    for g in geometrieen:
        if knip is not None:
            if not g.intersects(knip):
                continue
            g = g.intersection(knip)
        if g.is_empty:
            continue
        g = g.simplify(tolerantie, preserve_topology=True)
        if g.is_empty:
            continue
        kenmerken.append({"type": "Feature", "properties": {}, "geometry": afronden(mapping(g), cijfers)})
    pad = UIT / naam
    pad.write_text(json.dumps({"type": "FeatureCollection", "features": kenmerken}, separators=(",", ":")))
    print(f"{naam:26s} {len(kenmerken):5d} vormen  {pad.stat().st_size / 1024:7.0f} kB")


def main():
    UIT.mkdir(exist_ok=True)

    # Wereld: grof genoeg voor zoom 2-5, waar één graad nog geen 10 pixels is.
    schrijf("wereld_land.json", lees("physical", "ne_50m_land"), 0.05, 3)
    schrijf("wereld_grenzen.json", lees("cultural", "ne_50m_admin_0_boundary_lines_land"), 0.05, 3)
    schrijf("wereld_meren.json",
            [g for g in lees("physical", "ne_50m_lakes") if g.area > 0.05], 0.05, 3)

    # Europa: 10m, geknipt op het kaartgebied. 0,004° ≈ 300 m, ofwel minder dan
    # een pixel tot zoom 11; Nederland zelf komt uit het CBS-landvlak.
    schrijf("europa_land.json", lees("physical", "ne_10m_land"), 0.004, 4, knip=EUROPA)
    schrijf("europa_grenzen.json", lees("cultural", "ne_10m_admin_0_boundary_lines_land"), 0.004, 4, knip=EUROPA)
    meren = lees("physical", "ne_10m_lakes_europe") + [g for g in lees("physical", "ne_10m_lakes") if g.area > 0.02]
    schrijf("europa_meren.json", meren, 0.004, 4, knip=EUROPA)

    # Provinciegrenzen alleen op land. De PDOK-provincies lopen tot in zee en
    # over het IJsselmeer; ongeknipt tekent Leaflet die lijnen dwars door het
    # water. radar.html clipt ze op het landvlak, hier gebeurt dat vooraf.
    # make_valid: het CBS-landvlak heeft zelfdoorsnijdingen (union faalt anders).
    def vormen(bestand):
        return [make_valid(shape(f["geometry"])) for f in json.loads((ROOT / bestand).read_text())["features"]]

    provincies = vormen("nl_provincies_detail.geojson")
    landvlak = unary_union(vormen("nl_land_detail.geojson"))
    grenzen = unary_union([g.boundary for g in provincies]).intersection(landvlak.buffer(0.0005))
    schrijf("nl_provinciegrenzen.json", [grenzen], 0.0005, 5)

    # Plaatsnamen: dezelfde GeoNames-selectie als Weerkaart Europa, met
    # Nederlandse namen en een minimale zoom per plaats.
    bron = ROOT / "ecmwf_weerradar/assets/cities.json"
    doel = UIT / "plaatsen.json"
    shutil.copyfile(bron, doel)
    print(f"{'plaatsen.json':26s} {len(json.loads(doel.read_text())):5d} plaatsen  {doel.stat().st_size / 1024:7.0f} kB")


if __name__ == "__main__":
    main()
