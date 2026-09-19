"""
Haal ECMWF IFS ENS (0.25°, 51 members) via Open-Meteo op voor een raster van
punten in elke provincie + Waddeneilanden. Slaat ruwe data op als JSON.

~104 punten × 2 modelcalls = doorgaans enkele minuten.
"""
import json, time, urllib.request, urllib.parse
from pathlib import Path
from shapely.geometry import shape, Point, MultiPolygon

HERE = Path(__file__).parent
OUT = HERE / "om_raw.json"

# Bouw features zoals build_mockup.py: provincies met Waddeneilanden afgesplitst
GEO = json.loads((HERE / "provincies.geojson").read_text())

def poly_area(ring):
    a = 0.0
    for i in range(len(ring)-1):
        a += ring[i][0]*ring[i+1][1] - ring[i+1][0]*ring[i][1]
    return abs(a)/2

wadden_polys = []
for f in GEO["features"]:
    n = f["properties"]["statnaam"]
    if n not in ("Fryslân","Noord-Holland","Groningen"): continue
    g = f["geometry"]
    if g["type"] != "MultiPolygon": continue
    polys = g["coordinates"]
    sizes = [poly_area(p[0]) for p in polys]
    biggest = sizes.index(max(sizes))
    mainland = polys[biggest]
    for i,p in enumerate(polys):
        if i==biggest: continue
        if min(pt[1] for pt in p[0]) > 52.9:
            wadden_polys.append(p)
    f["geometry"] = {"type":"Polygon", "coordinates": mainland}
GEO["features"].append({
    "type":"Feature",
    "properties":{"statnaam":"Waddeneilanden"},
    "geometry":{"type":"MultiPolygon","coordinates":wadden_polys}
})

# Genereer raster van ~8 punten per provincie binnen de polygon
def sample_points_in_feature(feat, n_target=8, step_deg=0.25):
    geom = shape(feat["geometry"])
    minx,miny,maxx,maxy = geom.bounds
    # Gebruik 0.25° als ruwe resolutie (matcht ECMWF-grid); dichterbij clippen als nodig
    pts = []
    step = step_deg
    while len(pts) < n_target and step > 0.05:
        pts = []
        lon = minx + step/2
        while lon <= maxx:
            lat = miny + step/2
            while lat <= maxy:
                p = Point(lon, lat)
                if geom.contains(p):
                    pts.append((round(lat,3), round(lon,3)))
                lat += step
            lon += step
        step *= 0.7  # verfijnen als niet genoeg punten
    # neem max n_target punten, gespreid (gewoon first-n is ok bij dit volume)
    if len(pts) > n_target:
        stride = len(pts) // n_target
        pts = pts[::max(1,stride)][:n_target]
    if not pts:
        # fallback: centroid
        c = geom.representative_point()
        pts = [(round(c.y,3), round(c.x,3))]
    return pts

RASTER = {}
for f in GEO["features"]:
    n = f["properties"]["statnaam"]
    pts = sample_points_in_feature(f, n_target=8)
    RASTER[n] = pts
    print(f"{n}: {len(pts)} punten")

# Sla raster op voor later gebruik
(HERE / "raster.json").write_text(json.dumps(RASTER, indent=1))

# Open-Meteo Ensemble API — batch per punt
BASE = "https://om.weerlab.nl/om/ensemble"  # via commercial proxy (geen rate limit)
VARS = ["wind_gusts_10m","wind_speed_10m","temperature_2m","dew_point_2m","relative_humidity_2m","precipitation","cape","cloud_cover","cloud_cover_low","lightning_potential"]

UA = "pascal-demo/1.0 (weerlab.nl)"

def fetch_point(lat, lon, model, forecast_days, vars_list=None, retry=2):
    q = urllib.parse.urlencode({
        "latitude": lat, "longitude": lon,
        "models": model,
        "hourly": ",".join(vars_list or VARS),
        "forecast_days": forecast_days,
        "timezone": "UTC",
        "wind_speed_unit": "kmh", "temperature_unit": "celsius", "precipitation_unit": "mm",
        "past_days": 2,
    })
    url = f"{BASE}?{q}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(retry+1):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:
            if attempt < retry:
                time.sleep(1); continue
            raise

MODELS = [
    # (model, forecast_days, n_perturbed, vars_list)
    ("ecmwf_ifs025", 15, 50, VARS),    # IFS-ENS: 50 perturbed + 1 control, maximaal 15 dagen
    ("icon_d2",       3, 19, VARS),    # 3 kalenderdagen nodig om de officiële ~48u te omvatten
]

# Fetch — beide modellen per punt, parallel via threadpool
from concurrent.futures import ThreadPoolExecutor, as_completed

all_points = []
for prov, pts in RASTER.items():
    for lat,lon in pts:
        all_points.append((prov, lat, lon))
print(f"\nTotaal {len(all_points)} punten × {len(MODELS)} modellen parallel...")

def work(prov, lat, lon):
    point_models = {}
    for model, fdays, n_pert, vars_list in MODELS:
        try:
            d = fetch_point(lat, lon, model, fdays, vars_list=vars_list)
            hourly = d["hourly"]
            trimmed = {"time": hourly["time"]}
            for v in vars_list:
                # Preserve member identity even when an optional parameter/member is absent.
                members=[hourly.get(v if mm==0 else f'{v}_member{mm:02d}',[None]*len(hourly['time'])) for mm in range(n_pert+1)]
                trimmed[v]=[series if len(series)==len(hourly['time']) else [None]*len(hourly['time']) for series in members]
            point_models[model] = {"n_members": 1+n_pert, "hourly": trimmed, "units": d.get("hourly_units",{})}
        except Exception as e:
            print(f"    FAIL {model} @ {prov}({lat},{lon}): {e}", flush=True)
    return prov, lat, lon, point_models

results = {}
t0 = time.time()
done_count = 0
with ThreadPoolExecutor(max_workers=16) as ex:
    futures = [ex.submit(work, p,la,lo) for p,la,lo in all_points]
    for fut in as_completed(futures):
        prov, lat, lon, models_d = fut.result()
        results.setdefault(prov, []).append({"lat":lat,"lon":lon,"models":models_d})
        done_count += 1
        if done_count % 10 == 0 or done_count == len(all_points):
            print(f"  [{done_count:3d}/{len(all_points)}]  t={time.time()-t0:.1f}s", flush=True)

# Nooit een gedeeltelijke fetch opslaan: ontbrekende punten/modellen zouden
# gebiedskansen stilzwijgend te laag maken. Het bestaande geldige bestand blijft
# bij een storing dus intact.
missing = []
for prov, lat, lon in all_points:
    point = next((p for p in results.get(prov, []) if p["lat"] == lat and p["lon"] == lon), None)
    present = set((point or {}).get("models", {}))
    for model, *_ in MODELS:
        if model not in present:
            missing.append(f"{model}@{prov}({lat},{lon})")
if missing:
    print(f"Gedeeltelijke Open-Meteo fetch: {len(missing)} modelpunten ontbreken")
if not any(pt["models"] for pts in results.values() for pt in pts):
    raise RuntimeError("Geen enkel modelpunt ontvangen; vorige uitvoer blijft behouden")

temporary=OUT.with_suffix(".json.tmp")
temporary.write_text(json.dumps({
    "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "source": "Open-Meteo ensemble API",
    "models": {m: {"n_members": 1+n, "forecast_days": fd, "vars": vl} for m,fd,n,vl in MODELS},
    "sampling": {"method": "representative_points", "target_points_per_area": 8,
                 "actual_points_per_area": {p: len(v) for p, v in RASTER.items()}},
    "vars": VARS,
    "data": results,
}))
temporary.replace(OUT)
print(f"\n{len(all_points)} calls in {time.time()-t0:.0f}s. Geschreven: {OUT} ({OUT.stat().st_size//1024} KB)")
