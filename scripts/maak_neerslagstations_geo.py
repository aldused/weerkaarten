#!/usr/bin/env python3
"""
maak_neerslagstations_geo.py — voorgeprojecteerde kaartgeometrie voor
beta_neerslagstations.html (eenmalig/bij kaartwijziging draaien).

Projectie: equirectangulair met cos(52,15°)-correctie (juiste aspectverhouding
voor NL), viewBox 0 0 W 1000. Dezelfde constanten staan in de pagina (PROJ).
Vervangt het blok tussen /*GEO-START*/ en /*GEO-END*/ in de HTML.
"""
import json
import math
import re
import sys
from pathlib import Path

from shapely.geometry import box, shape, mapping
from shapely.ops import unary_union

REPO = Path(__file__).resolve().parent.parent
HTML = REPO / "beta_neerslagstations.html"

LON0, LON1, LAT0, LAT1 = 3.25, 7.30, 50.70, 53.62
COSL = math.cos(math.radians(52.15))
K = 1000 / (LAT1 - LAT0)
W = round((LON1 - LON0) * COSL * K)


def xy(lon, lat):
    return (lon - LON0) * COSL * K, (LAT1 - lat) * K


def pad(geom):
    delen = []
    polys = [geom] if geom.geom_type == "Polygon" else list(getattr(geom, "geoms", []))
    for p in polys:
        if p.geom_type != "Polygon" or p.is_empty:
            continue
        for ring in [p.exterior, *p.interiors]:
            pts = [xy(x, y) for x, y in ring.coords]
            if len(pts) < 4:
                continue
            s = "M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts[:-1]) + "Z"
            delen.append(s)
    return "".join(delen)


def main():
    kader = box(LON0 - 0.3, LAT0 - 0.3, LON1 + 0.3, LAT1 + 0.3)
    prov = json.loads((REPO / "nl_provincies.geojson").read_text())["features"]
    provincies = []
    for f in prov:
        g = shape(f["geometry"]).simplify(0.0015, preserve_topology=True)
        provincies.append({"n": f["properties"]["statnaam"], "d": pad(g)})
    nl = unary_union([shape(f["geometry"]) for f in prov]).simplify(0.0015)

    landen = json.loads((REPO / "data" / "europa_landen.geojson").read_text())["features"]
    buren = []
    for f in landen:
        naam = f["properties"].get("name") or f["properties"].get("NAME")
        if naam in ("Netherlands",):
            continue
        g = shape(f["geometry"])
        if not g.intersects(kader):
            continue
        g = g.buffer(0.012).intersection(kader).simplify(0.003)
        if not g.is_empty:
            buren.append({"n": naam, "d": pad(g)})

    geo = {"w": W, "h": 1000, "proj": [LON0, LAT1, COSL, K],
           "buren": buren, "provincies": provincies, "nl": pad(nl)}
    js = "/*GEO-START*/const GEO=" + json.dumps(geo, ensure_ascii=False, separators=(",", ":")) + ";/*GEO-END*/"
    html = HTML.read_text()
    nieuw, n = re.subn(r"/\*GEO-START\*/.*?/\*GEO-END\*/", lambda m: js, html, flags=re.S)
    if n != 1:
        sys.exit("GEO-blok niet gevonden in beta_neerslagstations.html")
    HTML.write_text(nieuw)
    print(f"GEO: {len(js)/1024:.1f} KB, W={W}, buren={[b['n'] for b in buren]}")


if __name__ == "__main__":
    main()
