"""
maak_rivieren.py — Nauwkeurige grote rivieren en kanalen als watervlakken (TOP10NL).

Bron: Kadaster BRT TOP10NL (1:10.000, PDOK OGC API, CC BY 4.0), collectie
'waterdeel_vlak'. De API filtert niet op soort water, dus we vragen vakken van
0,05° op langs de grote rivieren (corridor van ~5 km rond een grove ligging)
en houden lokaal alleen de hoofdafwatering (rivieren, kanalen en hun
verbredingen) of benoemde grote waterlopen over. Samengevoegd, kleine stukjes
(< 0,05 km²) weg, vereenvoudigd tot ~6 m in RD.

Uitvoer: weerlab/nl_rivieren_top10nl.geojson (lon/lat), gebruikt door de
kaart, de exports en het kaartarchief van de neerslagaccumulatie. Het grote
open water (IJsselmeer, Haringvliet, Westerschelde …) zit al als gat in het
CBS-landvlak (nl_land_detail.geojson).

  python3 -m accumulatie.maak_rivieren
"""
from __future__ import annotations

import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from pyproj import Transformer
from shapely.geometry import LineString, box, mapping, shape
from shapely.ops import transform, unary_union

REPO = Path(__file__).resolve().parent.parent
CACHE = Path.home() / "Library" / "Caches" / "weerlab" / "top10nl_water"
API = "https://api.pdok.nl/brt/top10nl/ogc/v1/collections/waterdeel_vlak/items"
UIT = REPO / "nl_rivieren_top10nl.geojson"

# Grove ligging (lon, lat) — alleen om de corridor te kiezen; de vorm komt uit TOP10NL.
EXTRA = {
    "Nieuwe Waterweg/Nieuwe Maas": [(4.05, 51.98), (4.25, 51.92), (4.40, 51.90), (4.50, 51.905), (4.62, 51.90)],
    "Hollandse IJssel": [(4.62, 51.90), (4.75, 51.98), (4.95, 52.03)],
    "Oude Maas/Spui": [(4.25, 51.88), (4.40, 51.83), (4.55, 51.84), (4.66, 51.82), (4.38, 51.78), (4.25, 51.78)],
    "Noord/Merwedes": [(4.60, 51.90), (4.65, 51.84), (4.75, 51.82), (4.90, 51.83), (5.00, 51.82), (5.10, 51.83)],
    "Dordtsche Kil/Hollands Diep/Amer": [(4.63, 51.80), (4.62, 51.72), (4.70, 51.70), (4.85, 51.71), (5.00, 51.72), (5.10, 51.74)],
    "Bergsche Maas": [(4.85, 51.71), (5.05, 51.72), (5.20, 51.74), (5.30, 51.76)],
    "Noordzeekanaal": [(4.57, 52.47), (4.70, 52.43), (4.85, 52.41), (4.92, 52.39)],
    "Amsterdam-Rijnkanaal": [(4.92, 52.38), (5.02, 52.30), (5.08, 52.15), (5.10, 52.05), (5.25, 51.97)],
    "Zwarte Water/Ketelmeer": [(6.05, 52.52), (6.10, 52.58), (5.90, 52.58)],
}
CORRIDOR_KM = 5.0
VAK = 0.05


def corridors():
    rd = Transformer.from_crs(4326, 28992, always_xy=True).transform
    wgs = Transformer.from_crs(28992, 4326, always_xy=True).transform
    lijnen = []
    g = json.loads((REPO / "nl_rivieren.geojson").read_text())
    for f in g["features"]:
        geo = f["geometry"]
        delen = geo["coordinates"] if geo["type"] == "MultiLineString" else [geo["coordinates"]]
        for d in delen:
            if len(d) > 1:
                lijnen.append(LineString([(c[0], c[1]) for c in d]))
    lijnen += [LineString(v) for v in EXTRA.values()]
    zone = transform(wgs, unary_union([transform(rd, l) for l in lijnen]).buffer(CORRIDOR_KM * 1000))
    x0, y0, x1, y1 = zone.bounds
    vakken = []
    x = math.floor(x0 / VAK) * VAK
    while x < x1:
        y = math.floor(y0 / VAK) * VAK
        while y < y1:
            if zone.intersects(box(x, y, x + VAK, y + VAK)):
                vakken.append((round(x, 3), round(y, 3)))
            y += VAK
        x += VAK
    return vakken


def haal_vak(v):
    x, y = v
    pad = CACHE / f"{x:.3f}_{y:.3f}.json"
    if pad.exists():
        return json.loads(pad.read_text())
    url = f"{API}?f=json&limit=1000&bbox={x},{y},{x + VAK},{y + VAK}"
    uit = []
    for _ in range(50):
        for poging in range(4):
            try:
                r = requests.get(url, timeout=120)
                r.raise_for_status()
                break
            except requests.RequestException:
                time.sleep(3 * (poging + 1))
        else:
            raise RuntimeError(f"PDOK onbereikbaar voor vak {v}")
        d = r.json()
        for f in d["features"]:
            p = f["properties"]
            groot = p.get("hoofdafwatering") == "ja" or p.get("vaarwegklasse") or \
                (p.get("typewater") == "waterloop" and (p.get("naamnl") or p.get("naamofficieel")))
            if groot and p.get("typewater") in ("waterloop", "meer, plas", "zee"):
                uit.append({"geometry": f["geometry"], "lokaal_id": p.get("lokaal_id")})
        volgende = [l["href"] for l in d.get("links", []) if l.get("rel") == "next"]
        if not volgende:
            break
        url = volgende[0]
    CACHE.mkdir(parents=True, exist_ok=True)
    pad.write_text(json.dumps(uit))
    return uit


def main():
    vakken = corridors()
    print(f"{len(vakken)} vakken van {VAK}° langs de rivieren")
    gezien, vormen = set(), []
    t0 = time.time()
    with ThreadPoolExecutor(6) as ex:
        for i, res in enumerate(ex.map(haal_vak, vakken), 1):
            for f in res:
                if f["lokaal_id"] in gezien:      # objecten op vakgrenzen komen dubbel terug
                    continue
                gezien.add(f["lokaal_id"])
                vormen.append(shape(f["geometry"]))
            if i % 50 == 0:
                print(f"  {i}/{len(vakken)} vakken, {len(vormen)} watervlakken, {time.time() - t0:.0f}s", flush=True)
    rd = Transformer.from_crs(4326, 28992, always_xy=True).transform
    wgs = Transformer.from_crs(28992, 4326, always_xy=True).transform
    samen = unary_union([transform(rd, v).buffer(0.5) for v in vormen]).buffer(-0.5)
    delen = [p for p in getattr(samen, "geoms", [samen]) if p.area > 50_000]
    samen = unary_union(delen).simplify(6, preserve_topology=True)
    print(f"{len(delen)} samenhangende wateren, {samen.area / 1e6:.1f} km²")
    geo = transform(wgs, samen)
    uit = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {
        "naam": "Grote rivieren en kanalen", "bron": "Kadaster BRT TOP10NL (PDOK), CC BY 4.0"}, "geometry": mapping(geo)}]}
    tekst = json.dumps(uit, separators=(",", ":"))
    tekst = __import__("re").sub(r"(\d+\.\d{5})\d+", r"\1", tekst)     # ~1 m precisie
    UIT.write_text(tekst)
    print(f"{UIT.name}: {len(tekst) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
