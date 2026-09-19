"""
HarmonEPS (KNMI Cy43 P2a) integratie voor PASCAL.

Download 2× per dag (00Z + 12Z) de ~2.1 GB tar, streaming-extract GRIB1 per file,
decodeer met KNMI tabel 253 + level, accumuleer per member × step × NL grid.

Tijdelijke opslag: /tmp/pascal_harm_<random>/ — auto-cleanup via TemporaryDirectory.

Output: pascal_real_harmoneps.json met p_A per provincie × criterium × dag (dag 1-2).
Merge-doel: build_hybrid.py hangt HarmonEPS aan het grand ensemble.
"""
import os, sys, json, time, tempfile, shutil, gc, tarfile
from pathlib import Path
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from urllib.request import urlopen, Request
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
from probability import METHOD_VERSION, complete_day_indices, event_probability, cumulative_windows
from native import calculate
from engine import visibility_m
from shapely.geometry import shape, Point
import eccodes as ec

HERE = Path(__file__).parent
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
# load .env
for line in ((HERE / ".env").read_text().splitlines() if (HERE / ".env").exists() else []):
    if "=" in line and not line.startswith("#"):
        k,v = line.split("=",1); os.environ[k.strip()] = v.strip()
API_KEY = os.environ["KNMI_API_KEY"]
API_BASE = "https://api.dataplatform.knmi.nl/open-data/v1"
DATASET = "harmonie_arome_cy43_p2a"; VERSION = "1.0"

# Provincies + Waddeneilanden
GEO = json.loads((HERE / "provincies.geojson").read_text())
def poly_area(ring):
    a=0
    for i in range(len(ring)-1):
        a += ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1]
    return abs(a)/2
wadden=[]
for f in GEO["features"]:
    n=f["properties"]["statnaam"]
    if n not in ("Fryslân","Noord-Holland","Groningen"): continue
    g=f["geometry"]
    if g["type"]!="MultiPolygon": continue
    ps=g["coordinates"]; bi=max(range(len(ps)), key=lambda i: poly_area(ps[i][0]))
    for i,p in enumerate(ps):
        if i==bi: continue
        if min(pt[1] for pt in p[0])>52.9: wadden.append(p)
    f["geometry"]={"type":"Polygon","coordinates":ps[bi]}
GEO["features"].append({"type":"Feature","properties":{"statnaam":"Waddeneilanden"},
                        "geometry":{"type":"MultiPolygon","coordinates":wadden}})
PROV_GEOM = {f["properties"]["statnaam"]: shape(f["geometry"]) for f in GEO["features"]}

# ---- Param-mapping in KNMI tabel 253
# (ind, level_type, level) -> variabele
PARAM_MAP = {
    (11, "heightAboveGround", 2):  "t2m",           # Temperatuur 2m (K)
    (33, "heightAboveGround", 10): "u10",           # u-wind 10m
    (34, "heightAboveGround", 10): "v10",
    (162,"heightAboveGround", 10): "gust_u",        # u-component max gust
    (163,"heightAboveGround", 10): "gust_v",
    (181,"heightAboveGround", 0):  "rain",            # Accumulatieve neerslag (kg/m² ≈ mm)
    (20, "heightAboveGround", 0):  "vis",           # Zicht (m)
    (209,"entireAtmosphere",  0):  "lightning",          # CAPE (J/kg)
    (71, "heightAboveGround", 0):  "tcc",           # Total cloud cover (0-1)
    (73, "heightAboveGround", 0):  "lcc",           # Low cloud cover
    (74, "heightAboveGround", 0):  "mcc",           # Medium cloud cover
    (75, "heightAboveGround", 0):  "hcc",           # High cloud cover
    (52, "heightAboveGround", 2):  "rh2m",          # Relative humidity 2m (0-1)
    (1,  "heightAboveSea",    0):  "msl",           # Mean sea level pressure (Pa)
    (33, "heightAboveGround", 50): "u50",           # u-wind 50m (jet level)
    (34, "heightAboveGround", 50): "v50",
    (186,"entireAtmosphere",  0):  "cloudbase",          # Precipitable water (kg/m²)
}
PARAM_MAP.update({(184,"heightAboveGround",0):"snow", (201,"heightAboveGround",0):"graupel"})
WANT_KEYS = set(PARAM_MAP.values())
PACKING_ERRORS = []

# -------- Dataset file-listing & download
def latest_tar_for_run(run_hour_utc: int, date: str):
    """Zoek latest tar-bestand horend bij een specifieke run-uur van een datum."""
    url = f"{API_BASE}/datasets/{DATASET}/versions/{VERSION}/files?maxKeys=30&sorting=desc"
    req = Request(url, headers={"Authorization": API_KEY})
    data = json.loads(urlopen(req, timeout=20).read())
    want = f"harm43_v1_P2a_{date}{run_hour_utc:02d}.tar"
    for f in data["files"]:
        if f["filename"] == want:
            return want, f["size"]
    raise RuntimeError(f"Run-tar niet gevonden: {want}")

def download_tar(filename: str, target_path: str):
    url = f"{API_BASE}/datasets/{DATASET}/versions/{VERSION}/files/{filename}/url"
    req = Request(url, headers={"Authorization": API_KEY})
    dlu = json.loads(urlopen(req, timeout=20).read())["temporaryDownloadUrl"]
    with urlopen(dlu, timeout=300) as r, open(target_path, "wb") as out:
        while True:
            buf = r.read(1<<20)  # 1 MB chunks
            if not buf: break
            out.write(buf)

# -------- Decode
def parse_grib_message(gid):
    ind = ec.codes_get(gid, "indicatorOfParameter", int)
    lt  = ec.codes_get(gid, "typeOfLevel")
    lv  = ec.codes_get(gid, "level", int)
    key = PARAM_MAP.get((ind, lt, lv))
    if not key: return None
    if key in ('rain','snow','graupel'):
        if ec.codes_get(gid,'timeRangeIndicator',int) != 4: return None
        PACKING_ERRORS.append(float(ec.codes_get(gid,'packingError')))

    vals = ec.codes_get_values(gid).astype(np.float32)
    if ec.codes_get(gid, "numberOfMissing", int):
        vals[vals == ec.codes_get(gid, "missingValue")] = np.nan
    if key == "vis": vals = visibility_m(vals, "m")  # KNMI table 253, parameter 20, level 105/0
    ni = ec.codes_get(gid, "Ni", int)
    nj = ec.codes_get(gid, "Nj", int)
    lat_first = ec.codes_get(gid, "latitudeOfFirstGridPointInDegrees", float)
    lat_last  = ec.codes_get(gid, "latitudeOfLastGridPointInDegrees", float)
    lon_first = ec.codes_get(gid, "longitudeOfFirstGridPointInDegrees", float)
    lon_last  = ec.codes_get(gid, "longitudeOfLastGridPointInDegrees", float)
    return key, vals.reshape(nj, ni), (lat_first, lat_last, lon_first, lon_last), (nj, ni)

# -------- Main
def main():
    # Pak de meest recent beschikbare run.
    # KEPS publiceert ~2.5h na init: 00Z@02:30, 06Z@08:30, 12Z@14:30, 18Z@20:30 UTC.
    now = datetime.now(timezone.utc)
    candidates = []
    for d_off in (0, -1):
        base = (now + timedelta(days=d_off)).replace(minute=0, second=0, microsecond=0)
        for h in (18, 12, 6, 0):
            avail = base.replace(hour=h) + timedelta(hours=2, minutes=30)
            if avail <= now:
                candidates.append((avail, base.replace(hour=h)))
    candidates.sort(reverse=True)
    if not candidates:
        raise RuntimeError("Geen run beschikbaar — KEPS-cycle nog niet gepubliceerd?")
    run_dt = candidates[0][1]
    run_date = run_dt.strftime("%Y%m%d")
    run_hour = run_dt.hour
    age_h = (now - candidates[0][0]).total_seconds() / 3600
    print(f"Run: {run_date} {run_hour:02d}Z  (~{age_h:.1f}h oud sinds publicatie)")

    with tempfile.TemporaryDirectory(prefix="pascal_harm_", dir="/tmp") as tmp:
        print(f"Tempdir: {tmp}")
        tar_path = Path(tmp) / "run.tar"

        # Download tar (+retry)
        for attempt in range(3):
            try:
                filename, size = latest_tar_for_run(run_hour, run_date)
                t0 = time.time()
                print(f"Downloading {filename} ({size/1e9:.2f} GB)...")
                download_tar(filename, tar_path)
                dt = time.time()-t0
                actual = tar_path.stat().st_size/1e9
                print(f"  {actual:.2f} GB in {dt:.0f}s = {actual*1e3/dt:.0f} MB/s")
                break
            except Exception as e:
                print(f"  attempt {attempt+1} FAIL: {e}")
                if attempt==2: raise
                time.sleep(5)

        # Extract + decode streaming: iterate tar members, decode GRIB1, store in arrays
        print("Extracting & decoding...")
        t0 = time.time()
        # Arrays: {var: np.zeros((n_members, n_steps, nj, ni))}
        # Discover steps + members first by scanning members list
        with tarfile.open(tar_path, "r") as t:
            names = t.getnames()
        members = sorted({n.split("_")[5] for n in names if len(n.split("_"))>5})
        steps = sorted({int(n.split("_")[7]) for n in names if len(n.split("_"))>7})
        n_m = len(members); n_s = len(steps)
        print(f"  members: {members}")
        print(f"  steps: {n_s} (0..{max(steps)} in units of 100 = minutes×10 of hours?)")

        # Probe 1 file voor grid-info
        with tarfile.open(tar_path, "r") as t:
            m = next(m for m in t.getmembers() if m.name == names[0])
            fobj = t.extractfile(m)
            tmp_gb = Path(tmp)/"_probe.gb"; tmp_gb.write_bytes(fobj.read())
        grid = None
        with open(tmp_gb, "rb") as f:
            while True:
                gid = ec.codes_grib_new_from_file(f)
                if gid is None: break
                try:
                    r = parse_grib_message(gid)
                    if r and grid is None:
                        grid = r[2]  # bounds
                        nj_ni = r[3]
                finally:
                    ec.codes_release(gid)
        tmp_gb.unlink()
        lat1, lat2, lon1, lon2 = grid
        nj, ni = nj_ni
        lats = np.linspace(lat1, lat2, nj)
        lons = np.linspace(lon1, lon2, ni)
        print(f"  grid: {nj}×{ni} ({nj*ni} cellen), lat {lat1:.2f}..{lat2:.2f}, lon {lon1:.2f}..{lon2:.2f}")

        # Voorbereiden arrays
        arrs = {k: np.full((n_m, n_s, nj, ni), np.nan, dtype=np.float32) for k in WANT_KEYS}
        m_idx = {m:i for i,m in enumerate(members)}
        s_idx = {s:i for i,s in enumerate(steps)}

        # Extract streaming, per file decode needed vars
        processed = 0
        with tarfile.open(tar_path, "r") as t:
            for entry in t:
                if not entry.isfile(): continue
                parts = entry.name.split("_")
                if len(parts) < 8: continue
                mem = parts[5]; st = int(parts[7])
                mi, si = m_idx.get(mem), s_idx.get(st)
                if mi is None or si is None: continue
                fobj = t.extractfile(entry)
                if not fobj: continue
                buf = fobj.read()
                tmp_gb = Path(tmp)/"_m.gb"; tmp_gb.write_bytes(buf)
                # Decode all messages we want
                with open(tmp_gb, "rb") as f:
                    while True:
                        gid = ec.codes_grib_new_from_file(f)
                        if gid is None: break
                        try:
                            r = parse_grib_message(gid)
                            if r:
                                key, arr2d, _, _ = r
                                arrs[key][mi, si] = arr2d
                        finally:
                            ec.codes_release(gid)
                tmp_gb.unlink()
                processed += 1
                if processed % 50 == 0:
                    print(f"  [{processed}/{len(members)*len(steps)}]  t={time.time()-t0:.0f}s")
        tar_path.unlink()
        gc.collect()
        print(f"Decode: {processed} files in {time.time()-t0:.0f}s")

        # Total precipitation consists of liquid rain, snow and graupel.
        arrs['tp']=arrs['rain']+arrs['snow']+arrs['graupel']
        # Afgeleide: gust = sqrt(u² + v²)
        if "gust_u" in arrs and "gust_v" in arrs:
            arrs["gust"] = np.hypot(arrs["gust_u"], arrs["gust_v"]) * 3.6  # m/s → km/h

        # ---- Provinciemasker op HARMONIE grid (2.5km native)
        print("Building province mask...")
        cell_prov = {}  # (i,j) -> prov name
        masker = {p: [] for p in PROV_GEOM}
        for i in range(nj):
            for j in range(ni):
                pt = Point(float(lons[j]), float(lats[i]))
                for p, geom in PROV_GEOM.items():
                    if geom.contains(pt):
                        masker[p].append((i,j)); break
        total_cells = sum(len(c) for c in masker.values())
        print(f"  {total_cells} cellen in 13 provincies")
        for p,c in list(masker.items())[:4]:
            print(f"    {p}: {len(c)}")

        # ---- Step mapping: HarmonEPS step format lijkt "HHmmm" (in units of 10min),
        # dus 00000=0h, 00100=1h, 00600=6h... of "00100"=1.00u = 100 represents something
        # Gebaseerd op 61 steps van 0..60000 max → lijkt 1h per step, 00100=1h, 06000=60h
        step_hours = [int(s/100) for s in steps]   # 100 per uur

        # Flatten only Dutch grid cells; archive decoded fields for reproducible replay.
        cells = [c for group in masker.values() for c in group]
        ci=np.asarray(cells); areas={}; offset=0
        for area,group in masker.items():
            areas[area]=list(range(offset,offset+len(group)));offset+=len(group)
        areas['Nederland']=list(range(len(cells)))
        fields={k:arrs[k][:,:,ci[:,0],ci[:,1]] for k in ['gust','t2m','tp','vis']}
        fields['t2m']=fields['t2m']-273.15
        fields['wind']=np.hypot(arrs['u10'][:,:,ci[:,0],ci[:,1]],arrs['v10'][:,:,ci[:,0],ci[:,1]])*3.6
        valid_times=[run_dt+timedelta(hours=h) for h in step_hours]
        meta=dict(run=run_dt.strftime('%Y%m%d%HZ'),fetched_at=datetime.now(timezone.utc).isoformat(),
                  source='KNMI HarmonEPS',areas=areas,member_ids=members,times=[t.isoformat() for t in valid_times],rain_tolerance=max(0.01,6*max(PACKING_ERRORS,default=0)))
        np.savez_compressed(HERE/'harm_decoded.npz',**fields,metadata=json.dumps(meta))
        # KNMI regular-grid interpolation introduces sub-0.01 mm drift in dry
        # cumulative cells (observed -0.0054 mm). Bound this numerical correction
        # to 0.01 mm or the encoded uncertainty; real resets remain invalid.
        RESULT=calculate(fields,valid_times,areas,run_dt,members,rain_tolerance=meta["rain_tolerance"])
        RESULT['run_complete']=processed==n_m*n_s
        RESULT.update({k:meta[k] for k in ['run','fetched_at','source']})
        out_path=HERE/'pascal_real_harmoneps.json'
        temp_path=out_path.with_suffix('.json.tmp');temp_path.write_text(json.dumps(RESULT,allow_nan=False));temp_path.replace(out_path)
        print('Geschreven:',out_path)

        if os.environ.get("PASCAL_NO_PLUMES") == "1": return

        # ---- Bonus: extract per-station pluim voor viewer
        print("\nStation-pluimen extracten...")
        STATIONS = [
            # KNMI hoofd-stations
            {"id":"debilt","naam":"De Bilt","lat":52.101,"lon":5.178},
            {"id":"schiphol","naam":"Schiphol","lat":52.309,"lon":4.764},
            {"id":"rotterdam","naam":"Rotterdam","lat":51.926,"lon":4.477},
            {"id":"eindhoven","naam":"Eindhoven","lat":51.441,"lon":5.477},
            {"id":"groningen","naam":"Groningen","lat":53.220,"lon":6.567},
            {"id":"maastricht","naam":"Maastricht","lat":50.846,"lon":5.685},
            {"id":"dekooy","naam":"De Kooy","lat":52.924,"lon":4.781},
            {"id":"vlissingen","naam":"Vlissingen","lat":51.442,"lon":3.573},
            {"id":"leeuwarden","naam":"Leeuwarden","lat":53.202,"lon":5.774},
            {"id":"eelde","naam":"Eelde","lat":53.125,"lon":6.583},
            {"id":"twente","naam":"Twente","lat":52.271,"lon":6.896},
            {"id":"deelen","naam":"Deelen","lat":52.061,"lon":5.873},
            {"id":"volkel","naam":"Volkel","lat":51.658,"lon":5.707},
            {"id":"herwijnen","naam":"Herwijnen","lat":51.858,"lon":5.146},
            {"id":"cabauw","naam":"Cabauw","lat":51.971,"lon":4.927},
            # Grote steden
            {"id":"amsterdam","naam":"Amsterdam","lat":52.378,"lon":4.897},
            {"id":"denhaag","naam":"Den Haag","lat":52.071,"lon":4.292},
            {"id":"utrecht","naam":"Utrecht","lat":52.091,"lon":5.122},
            {"id":"haarlem","naam":"Haarlem","lat":52.387,"lon":4.636},
            {"id":"arnhem","naam":"Arnhem","lat":51.985,"lon":5.899},
            {"id":"nijmegen","naam":"Nijmegen","lat":51.812,"lon":5.838},
            {"id":"enschede","naam":"Enschede","lat":52.221,"lon":6.894},
            {"id":"zwolle","naam":"Zwolle","lat":52.515,"lon":6.082},
            {"id":"deventer","naam":"Deventer","lat":52.251,"lon":6.160},
            {"id":"apeldoorn","naam":"Apeldoorn","lat":52.211,"lon":5.970},
            {"id":"amersfoort","naam":"Amersfoort","lat":52.156,"lon":5.388},
            {"id":"almere","naam":"Almere","lat":52.374,"lon":5.214},
            {"id":"lelystad","naam":"Lelystad","lat":52.508,"lon":5.475},
            {"id":"breda","naam":"Breda","lat":51.571,"lon":4.768},
            {"id":"tilburg","naam":"Tilburg","lat":51.560,"lon":5.091},
            {"id":"denbosch","naam":"'s-Hertogenbosch","lat":51.697,"lon":5.304},
            {"id":"venlo","naam":"Venlo","lat":51.370,"lon":6.172},
            {"id":"roermond","naam":"Roermond","lat":51.195,"lon":5.987},
            {"id":"heerlen","naam":"Heerlen","lat":50.888,"lon":5.978},
            {"id":"sittard","naam":"Sittard","lat":51.000,"lon":5.871},
            {"id":"assen","naam":"Assen","lat":52.995,"lon":6.564},
            {"id":"emmen","naam":"Emmen","lat":52.780,"lon":6.905},
            {"id":"hoogeveen","naam":"Hoogeveen","lat":52.723,"lon":6.478},
            {"id":"meppel","naam":"Meppel","lat":52.694,"lon":6.193},
            {"id":"alkmaar","naam":"Alkmaar","lat":52.632,"lon":4.749},
            {"id":"hoorn","naam":"Hoorn","lat":52.645,"lon":5.064},
            {"id":"lemmer","naam":"Lemmer","lat":52.843,"lon":5.713},
            {"id":"heerenveen","naam":"Heerenveen","lat":52.957,"lon":5.920},
            {"id":"dordrecht","naam":"Dordrecht","lat":51.813,"lon":4.690},
            {"id":"middelburg","naam":"Middelburg","lat":51.499,"lon":3.613},
            {"id":"goes","naam":"Goes","lat":51.504,"lon":3.888},
            {"id":"terneuzen","naam":"Terneuzen","lat":51.336,"lon":3.829},
            # Waddeneilanden
            {"id":"texel","naam":"Texel","lat":53.068,"lon":4.800},
            {"id":"vlieland","naam":"Vlieland","lat":53.302,"lon":5.080},
            {"id":"terschelling","naam":"Terschelling","lat":53.362,"lon":5.228},
            {"id":"ameland","naam":"Ameland","lat":53.449,"lon":5.740},
            {"id":"schiermonnikoog","naam":"Schiermonnikoog","lat":53.475,"lon":6.170},
            # Noordzeekust / extra
            {"id":"ijmuiden","naam":"IJmuiden","lat":52.459,"lon":4.571},
            {"id":"hoekvanholland","naam":"Hoek van Holland","lat":51.976,"lon":4.130},
            {"id":"westkapelle","naam":"Westkapelle","lat":51.525,"lon":3.436},
            {"id":"stavoren","naam":"Stavoren","lat":52.887,"lon":5.362},
            {"id":"harlingen","naam":"Harlingen","lat":53.173,"lon":5.423},
            {"id":"denhelder","naam":"Den Helder","lat":52.956,"lon":4.760},
        ]
        def nearest_ij(lat, lon):
            i = int(round((lat - lat1) / (lat2 - lat1) * (nj - 1)))
            j = int(round((lon - lon1) / (lon2 - lon1) * (ni - 1)))
            return max(0,min(nj-1,i)), max(0,min(nj-1 if False else ni-1, j))

        PLUIM_VARS = {
            "t2m":   ("t2m",    lambda v: v - 273.15),               # °C
            "gust":  ("gust",   lambda v: v),                        # km/h (already)
            "wind":  (None,     None),                               # computed
            "precip": ("tp",    None),                               # mm cumulative → per-hour diff later
            "rh":    (None,     None),                               # not in our vars, skip
            "vis":   ("vis",    lambda v: v / 1000),                 # km
        }
        times = [(run_dt + timedelta(hours=h)).isoformat() for h in step_hours]
        pluim_dir = HERE.parent / "weerlab" / "pluim_harmoneps"
        pluim_dir.mkdir(exist_ok=True)
        for st in STATIONS:
            i,j = nearest_ij(st["lat"], st["lon"])
            data = {
                "station": st,
                "grid_lat": round(float(lats[i]), 4),
                "grid_lon": round(float(lons[j]), 4),
                "run": f"{run_date}{run_hour:02d}Z",
                "n_members": n_m,
                "times": times,
                "vars": {},
            }
            # T2m in °C
            if "t2m" in arrs:
                t = arrs["t2m"][:, :, i, j].copy()  # (n_m, n_s)
                data["vars"]["t2m_c"] = [[round(float(x - 273.15), 1) if not np.isnan(x) else None for x in t[m]] for m in range(n_m)]
            if "gust" in arrs:
                g = arrs["gust"][:, :, i, j]
                data["vars"]["gust_kmh"] = [[round(float(x), 1) if not np.isnan(x) else None for x in g[m]] for m in range(n_m)]
            if "u10" in arrs and "v10" in arrs:
                u = arrs["u10"][:, :, i, j]; v = arrs["v10"][:, :, i, j]
                ws = np.hypot(u, v) * 3.6
                wd = (270 - np.degrees(np.arctan2(v, u))) % 360  # meteo-convention (from-direction)
                data["vars"]["wind_kmh"] = [[round(float(x), 1) if not np.isnan(x) else None for x in ws[m]] for m in range(n_m)]
                data["vars"]["wind_dir_deg"] = [[round(float(x)) if not np.isnan(x) else None for x in wd[m]] for m in range(n_m)]
            # Bewolking (fractie → %)
            for k_cc, src in [("tcc_pct","tcc"),("lcc_pct","lcc"),("mcc_pct","mcc"),("hcc_pct","hcc")]:
                if src in arrs:
                    c = arrs[src][:, :, i, j] * 100
                    data["vars"][k_cc] = [[round(float(x)) if not np.isnan(x) else None for x in c[m]] for m in range(n_m)]
            if "rh2m" in arrs:
                r = arrs["rh2m"][:, :, i, j] * 100
                data["vars"]["rh_pct"] = [[round(float(x)) if not np.isnan(x) else None for x in r[m]] for m in range(n_m)]
            if "msl" in arrs:
                p = arrs["msl"][:, :, i, j] / 100.0  # Pa → hPa
                data["vars"]["msl_hpa"] = [[round(float(x), 1) if not np.isnan(x) else None for x in p[m]] for m in range(n_m)]
            if "u50" in arrs and "v50" in arrs:
                u = arrs["u50"][:, :, i, j]; v = arrs["v50"][:, :, i, j]
                ws = np.hypot(u, v) * 3.6
                data["vars"]["wind50_kmh"] = [[round(float(x), 1) if not np.isnan(x) else None for x in ws[m]] for m in range(n_m)]
            if "pwat" in arrs:
                pw = arrs["pwat"][:, :, i, j]
                data["vars"]["pwat_mm"] = [[round(float(x), 1) if not np.isnan(x) else None for x in pw[m]] for m in range(n_m)]
            if "tp" in arrs:
                tp = arrs["tp"][:, :, i, j]
                # cumulative → per-hour diff
                diff = np.diff(tp, axis=1, prepend=0)
                data["vars"]["precip_mm_per_h"] = [[round(max(0,float(x)), 2) if not np.isnan(x) else None for x in diff[m]] for m in range(n_m)]
            if "vis" in arrs:
                vi = arrs["vis"][:, :, i, j]
                data["vars"]["vis_km"] = [[round(float(x)/1000, 2) if not np.isnan(x) else None for x in vi[m]] for m in range(n_m)]
            (pluim_dir / f"{st['id']}.json").write_text(json.dumps(data))
        # Index-bestand voor frontend nearest-search
        (pluim_dir / "_index.json").write_text(json.dumps(STATIONS))
        print(f"  {len(STATIONS)} stations → weerlab/pluim_harmoneps/*.json")

    print("✓ Tempdir opgeruimd\n")

if __name__ == "__main__":
    main()
