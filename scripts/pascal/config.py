import json
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).parent
GEO = json.loads((HERE / "provincies.geojson").read_text())

# Eigen Weerlab-criteria; p_A-definitie uit TR-395. Geen KNMI-waarschuwingsdrempels.
CRITERIA = [
    {"id":"wind40", "label":"Wind ≥40 km/h", "element":"wind10m", "aggr":"dag-max", "drempel":"40 km/h"},
    {"id":"wind60", "label":"Wind ≥60 km/h", "element":"wind10m", "aggr":"dag-max", "drempel":"60 km/h"},
    {"id":"gust60",  "label":"Windstoten \u226560 km/h",  "icon":"wind0",  "element":"gust10m", "aggr":"dag-max", "drempel":"16.7 m/s"},
    {"id":"gust75",  "label":"Windstoten \u226575 km/h",  "icon":"wind",   "element":"gust10m", "aggr":"dag-max", "drempel":"20.8 m/s"},
    {"id":"gust100", "label":"Windstoten \u2265100 km/h", "icon":"wind2",  "element":"gust10m", "aggr":"dag-max", "drempel":"27.8 m/s"},
    {"id":"rr10",    "label":"Neerslag \u226510 mm/24h",  "icon":"rain_mini","element":"tp",    "aggr":"rol-24u",  "drempel":"10 mm"},
    {"id":"rr25",    "label":"Neerslag \u226525 mm/24h",  "icon":"rain0",  "element":"tp",      "aggr":"rol-24u",  "drempel":"25 mm"},
    {"id":"rr50",    "label":"Neerslag \u226550 mm/24h",  "icon":"rain",   "element":"tp",      "aggr":"rol-24u",  "drempel":"50 mm"},
    {"id":"rr75",    "label":"Neerslag \u226575 mm/24h",  "icon":"rain2",  "element":"tp",      "aggr":"rol-24u",  "drempel":"75 mm"},
    {"id":"thunder", "label":"Onweerproxy",               "icon":"bolt",   "element":"MUCAPE + neerslag", "aggr":"6u-venster", "drempel":"CAPE \u2265500 J/kg + 2 mm/6u"},
    {"id":"svr",     "label":"Sterke-convectieproxy",      "icon":"bolt2",  "element":"MUCAPE + neerslag", "aggr":"6u-venster", "drempel":"CAPE \u22651500 J/kg + 2 mm/6u"},
    {"id":"vis500",  "label":"Zicht \u2264500 m",         "icon":"fog0",   "element":"visibility", "aggr":"uur-min", "drempel":"500 m"},
    {"id":"vis200",  "label":"Zicht \u2264200 m",         "icon":"fog",    "element":"visibility", "aggr":"uur-min", "drempel":"200 m"},
    {"id":"vis50",   "label":"Zicht \u226450 m",          "icon":"fog2",   "element":"visibility", "aggr":"uur-min", "drempel":"50 m"},
    {"id":"t25",     "label":"Maximumtemp. \u226525\u00b0C","icon":"hot0",  "element":"Tmax2m",  "aggr":"dag-max", "drempel":"25\u00b0C"},
    {"id":"t27",     "label":"Maximumtemp. \u226527\u00b0C","icon":"hot0",  "element":"Tmax2m",  "aggr":"dag-max", "drempel":"27\u00b0C"},
    {"id":"t30",     "label":"Maximumtemp. \u226530\u00b0C","icon":"hot",   "element":"Tmax2m",  "aggr":"dag-max", "drempel":"30\u00b0C"},
    {"id":"t35",     "label":"Maximumtemp. \u226535\u00b0C","icon":"hot2",  "element":"Tmax2m",  "aggr":"dag-max", "drempel":"35\u00b0C"},
    {"id":"t40",     "label":"Maximumtemp. \u226540\u00b0C","icon":"hot3",  "element":"Tmax2m",  "aggr":"dag-max", "drempel":"40\u00b0C"},
]

# Splits Waddeneilanden uit Fryslân / Noord-Holland / Groningen:
# Waddeneilanden = alle niet-grootste polygonen van deze provincies.
def poly_area(ring):
    a = 0.0
    for i in range(len(ring)-1):
        a += ring[i][0]*ring[i+1][1] - ring[i+1][0]*ring[i][1]
    return abs(a)/2

wadden_polys = []
for f in GEO["features"]:
    n = f["properties"]["statnaam"]
    if n not in ("Fryslân", "Noord-Holland", "Groningen"):
        continue
    g = f["geometry"]
    if g["type"] != "MultiPolygon":
        continue
    polys = g["coordinates"]  # list of polygons; polygon = list of rings
    # grootste polygoon = vasteland
    sizes = [poly_area(p[0]) for p in polys]
    biggest = sizes.index(max(sizes))
    mainland = polys[biggest]
    islands = [p for i,p in enumerate(polys) if i != biggest]
    # alleen islands met min-lat > 52.9 (sluit Texel-achtige grote eilanden in, sluit kleine kust-anomalie zuidelijker uit)
    for isl in islands:
        minlat = min(pt[1] for pt in isl[0])
        if minlat > 52.9:
            wadden_polys.append(isl)
    # update feature tot alleen mainland
    f["geometry"] = {"type":"Polygon", "coordinates": mainland}

# voeg Waddeneilanden-feature toe
wadden_feature = {
    "type": "Feature",
    "properties": {"statnaam": "Waddeneilanden"},
    "geometry": {"type": "MultiPolygon", "coordinates": wadden_polys}
}
GEO["features"].append(wadden_feature)

PROVINCIES = [f["properties"]["statnaam"] for f in GEO["features"]]

ABBR = {
    "Drenthe":"DR", "Flevoland":"FL", "Fryslân":"FR", "Gelderland":"GD",
    "Groningen":"GR", "Limburg":"LB", "Noord-Brabant":"NB", "Noord-Holland":"NH",
    "Overijssel":"OV", "Utrecht":"UT", "Zuid-Holland":"ZH", "Zeeland":"ZL",
    "Waddeneilanden":"WA", "Nederland":"NL",
}

for c in CRITERIA:
    cid = c["id"]
    c["group"] = ("Wind" if cid.startswith("wind") else "Windstoten" if cid.startswith("gust") else "Neerslag" if cid.startswith("rr") else "Zicht" if cid.startswith("vis") else "Convectie" if cid in ("thunder", "svr") else "Temperatuur")
    c["proxy"] = cid in ("thunder", "svr")
    c["window"] = ("Volledige rollende 24 uur; eindtijd op deze dag" if cid.startswith("rr") else "6 uur met CAPE en neerslag op hetzelfde modelpunt; eindtijd op deze dag" if c["proxy"] else "Bemonsterde modeltijden binnen de lokale kalenderdag")
