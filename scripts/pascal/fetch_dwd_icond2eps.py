"""
DWD ICON-D2-EPS visibility voor PASCAL (dag 1-2).

Bron: https://opendata.dwd.de/weather/nwp/icon-d2-eps/grib/HH/vis/
  - 20 members, 49 steps (0-48h), icosahedral 2.0 km grid over DE + buurlanden
  - Echte visibility-parameter (m) per member per step
  - clat/clon 1× downloaden voor grid-coords

Output: pascal_real_icond2eps.json  — p_A per provincie × vis-criterium × dag
Merge-doel: build_hybrid.py integreert dit in grand ensemble voor vis-criteria.
"""
import os, sys, json, time, tempfile, bz2
from pathlib import Path
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from urllib.request import urlopen, Request
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
from probability import METHOD_VERSION, complete_day_indices, event_probability
from native import calculate
from engine import visibility_m
from shapely.geometry import shape, Point
import eccodes as ec

HERE = Path(__file__).parent
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
BASE = "https://opendata.dwd.de/weather/nwp/icon-d2-eps/grib"
N_MEMBERS = 20
N_STEPS = 49  # 0..48 uur
UA = "pascal-icond2eps/1.0 (weerlab.nl)"

# Provincies + Waddeneilanden (zelfde splitsing als andere scripts)
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

def latest_run():
    """Zoek meest recente gepubliceerde run (ICON-D2-EPS loopt elke 3 uur)."""
    now = datetime.now(timezone.utc)
    # Try last 6 hours, recent first
    for h_off in range(6):
        t = (now - timedelta(hours=h_off)).replace(minute=0, second=0, microsecond=0)
        hh = f"{t.hour:02d}"
        # Check of vis-map bestaat en files heeft
        url = f"{BASE}/{hh}/vis/"
        try:
            with urlopen(Request(url, headers={"User-Agent": UA}), timeout=20) as r:
                txt = r.read().decode()
                # Check laatste step (048) — als die er is, is run compleet
                if f"_{t.strftime('%Y%m%d%H')}_048_2d_vis.grib2.bz2" in txt:
                    return t
        except Exception:
            continue
    raise RuntimeError("Geen complete ICON-D2-EPS run gevonden in laatste 6 uur")

def download_bz2(url, retry=3):
    for attempt in range(retry):
        try:
            with urlopen(Request(url, headers={"User-Agent": UA}), timeout=120) as r:
                return bz2.decompress(r.read())
        except Exception as e:
            if attempt == retry-1: raise
            time.sleep(2)

def read_grib_values(raw_bytes):
    """Decodeer GRIB2-bestand. Return dict member_num -> np.array[n_cells].
    Voor clat/clon files: return enkelwaardige array."""
    with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as tf:
        tf.write(raw_bytes); tmp_path = tf.name
    try:
        result = {}
        with open(tmp_path, "rb") as f:
            while True:
                gid = ec.codes_grib_new_from_file(f)
                if gid is None: break
                try:
                    try:
                        mem = ec.codes_get(gid, "perturbationNumber", int)
                    except Exception:
                        mem = 0
                    vals = ec.codes_get_values(gid).astype(np.float32)
                    # Decode missing GRIB values explicitly, including visibility.
                    if ec.codes_get(gid, "numberOfMissing", int):
                        vals[vals == ec.codes_get(gid, "missingValue")] = np.nan
                    if ec.codes_get(gid, "shortName").lower() in ("clat", "clon"):
                        units = ec.codes_get(gid, "units").lower()
                        if units in ("rad", "radian", "radians"): vals = np.rad2deg(vals)
                        elif units not in ("degree", "degrees", "degrees_north", "degrees_east"):
                            raise ValueError(f"Onbekende coördinaateenheid: {units}")
                    if ec.codes_get(gid, "shortName").lower() == "vis":
                        vals = visibility_m(vals, ec.codes_get(gid, "units"))
                    result[mem] = vals
                finally:
                    ec.codes_release(gid)
        return result
    finally:
        os.unlink(tmp_path)

def main():
    run_dt = latest_run()
    hh = f"{run_dt.hour:02d}"
    run_ymd = run_dt.strftime("%Y%m%d")
    prefix = f"icon-d2-eps_germany_icosahedral"
    print(f"Run: {run_ymd} {hh}Z")

    # 1) Grid-coords (clat/clon) — time-invariant, eenmalig per run
    print("Download clat/clon...")
    t0 = time.time()
    clat_url = f"{BASE}/{hh}/clat/{prefix}_time-invariant_{run_ymd}{hh}_000_0_clat.grib2.bz2"
    clon_url = f"{BASE}/{hh}/clon/{prefix}_time-invariant_{run_ymd}{hh}_000_0_clon.grib2.bz2"
    clat = next(iter(read_grib_values(download_bz2(clat_url)).values()))
    clon = next(iter(read_grib_values(download_bz2(clon_url)).values()))
    print(f"  {len(clat)} cellen in {time.time()-t0:.1f}s")

    # 2) NL-masker: welke cellen in welke provincie
    print("Bouw NL-masker...")
    # Eerst bbox-filter NL (50-54°N, 3-8°E) om geom.contains() te versnellen
    nl_bbox = (clat >= 50.0) & (clat <= 54.5) & (clon >= 3.0) & (clon <= 8.0)
    nl_idx = np.where(nl_bbox)[0]
    print(f"  {len(nl_idx)} cellen in NL-bbox (van {len(clat)})")
    masker = {p: [] for p in PROV_GEOM}
    for i in nl_idx:
        pt = Point(float(clon[i]), float(clat[i]))
        for p, geom in PROV_GEOM.items():
            if geom.contains(pt):
                masker[p].append(int(i)); break
    total = sum(len(c) for c in masker.values())
    print(f"  {total} cellen verdeeld over 13 provincies")
    for p,c in masker.items():
        print(f"    {p}: {len(c)}")

    # 3) Download + decode alle vis-files parallel
    print(f"\nDownload + decode {N_STEPS} vis-files (~17 MB/file = {N_STEPS*17} MB bzipped)...")
    t0 = time.time()
    # arrs[step][member] = np.array[n_cells]
    arrs = [None] * N_STEPS

    def fetch_step(step):
        url = f"{BASE}/{hh}/vis/{prefix}_single-level_{run_ymd}{hh}_{step:03d}_2d_vis.grib2.bz2"
        try:
            return step, read_grib_values(download_bz2(url))
        except Exception as e:
            return step, {"_err": str(e)}

    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = [ex.submit(fetch_step, s) for s in range(N_STEPS)]
        done = 0
        for fut in as_completed(futures):
            step, data = fut.result()
            if "_err" in data:
                print(f"  step {step:03d} FAIL: {data['_err']}", flush=True)
                continue
            arrs[step] = data
            done += 1
            if done % 10 == 0 or done == N_STEPS:
                print(f"  [{done}/{N_STEPS}]  t={time.time()-t0:.1f}s", flush=True)
    print(f"Download+decode klaar in {time.time()-t0:.0f}s")

    if not done: raise RuntimeError('Geen ICON-D2-velden ontvangen')
    member_ids = sorted({m for a in arrs if a for m in a})
    if len(member_ids)<2: raise RuntimeError('Onvoldoende ICON-D2-leden')
    # Stable member IDs across steps; absent members are NaN, never shifted.
    cells=[c for group in masker.values() for c in group]
    values=np.full((len(member_ids),N_STEPS,len(cells)),np.nan,dtype=np.float32)
    for si,a in enumerate(arrs):
        for mi,m in enumerate(member_ids):
            if a and m in a: values[mi,si]=a[m][cells]
    areas={};offset=0
    for area,group in masker.items():
        areas[area]=list(range(offset,offset+len(group)));offset+=len(group)
    areas['Nederland']=list(range(len(cells)))
    times=[run_dt+timedelta(hours=h) for h in range(N_STEPS)]
    meta=dict(run=run_dt.strftime('%Y%m%d%HZ'),fetched_at=datetime.now(timezone.utc).isoformat(),
              source='DWD ICON-D2-EPS',areas=areas,member_ids=member_ids,times=[t.isoformat() for t in times])
    np.savez_compressed(HERE/'icon_decoded.npz',vis=values,metadata=json.dumps(meta))
    result=calculate({'vis':values},times,areas,run_dt,member_ids)
    result['run_complete']=done==N_STEPS and len(member_ids)==N_MEMBERS and all(a and set(a)==set(member_ids) for a in arrs)
    result.update({k:meta[k] for k in ['run','fetched_at','source']})
    out=HERE/'pascal_real_icond2eps.json'
    temp=out.with_suffix('.json.tmp');temp.write_text(json.dumps(result,allow_nan=False));temp.replace(out)
    print('Geschreven:',out)

if __name__ == '__main__': main()
