"""
PASCAL via ECMWF Open Data GRIB2 — streaming pipeline.

Downloads + extracts + processes 5 parameters (10fg, tp, mucape, mx2t3, mx2t6) voor
14 forecast-dagen, op native 0.25° grid. ECMWF Open Data levert hier de 50
perturbed ENS-leden (pf); een aparte control forecast (cf) is niet beschikbaar
voor deze native ENS-files. Data wordt per file meteen verwerkt en de GRIB2-file
verwijderd; alleen een compacte numpy-stack blijft in geheugen.

Tijdelijke locatie: /tmp/pascal_grib_<random>/ — auto-cleanup via
TemporaryDirectory (ook bij crash).

Output: pascal_real_grib.json (zelfde format als pascal_real.json).
"""
import tempfile, os, gc, time, json, sys, urllib.request
from pathlib import Path
from datetime import date, timedelta, datetime, timezone
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor, as_completed

from ecmwf.opendata import Client
import xarray as xr
import numpy as np
from native import calculate
import eccodes as ec
from probability import METHOD_VERSION, complete_day_indices, cumulative_windows
from shapely.geometry import shape, Point

HERE = Path(__file__).parent
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

# ---- Provincies + Waddeneilanden splitsen
GEO = json.loads((HERE / "provincies.geojson").read_text())
def poly_area(ring):
    a=0
    for i in range(len(ring)-1):
        a += ring[i][0]*ring[i+1][1] - ring[i+1][0]*ring[i][1]
    return abs(a)/2
wadden=[]
for f in GEO["features"]:
    n=f["properties"]["statnaam"]
    if n not in ("Fryslân","Noord-Holland","Groningen"): continue
    g=f["geometry"]
    if g["type"]!="MultiPolygon": continue
    polys=g["coordinates"]
    sizes=[poly_area(p[0]) for p in polys]
    bi=sizes.index(max(sizes))
    mainland=polys[bi]
    for i,p in enumerate(polys):
        if i==bi: continue
        if min(pt[1] for pt in p[0])>52.9: wadden.append(p)
    f["geometry"]={"type":"Polygon","coordinates":mainland}
GEO["features"].append({"type":"Feature","properties":{"statnaam":"Waddeneilanden"},
                        "geometry":{"type":"MultiPolygon","coordinates":wadden}})
PROV_GEOM = {f["properties"]["statnaam"]: shape(f["geometry"]) for f in GEO["features"]}

# ---- Config
NL_LAT = (50.7, 53.6)
NL_LON = (3.0, 7.3)

# ECMWF Open Data ENS: 3u tot +144, dan 6u tot +240 (10d). Beyond +240 also 6u.
STEPS_3H = list(range(3, 147, 3))       # 3..144
STEPS_6H = list(range(150, 246, 6))     # 150..240

PARAMS = {
    "10fg":   STEPS_3H + STEPS_6H,  # max-over-3h of max-over-6h wind gust
    "tp":     STEPS_3H + STEPS_6H,  # cumulatieve neerslag
    "mucape": STEPS_3H + STEPS_6H,  # CAPE (instantaneous)
    "mx2t3":  STEPS_3H,             # Tmax-3h tot +144 (dag 1-6)
    "mx2t6":  STEPS_6H,             # Tmax-6h voor +150..+240 (dag 7-10); echte venster-max
                                    # i.p.v. instantane 2t die de middagpiek tussen samples mist
}

# ---- Download + extract per file, parallel (4 workers, veilig binnen 500 conn limit)
# Sinds de IFS-cycluswissel (mei 2026) heet de 3-uurs windstoot in de open-data
# index op steps 93..144 '10fg3' in plaats van '10fg'; t/m +90 en vanaf +150
# blijft het '10fg'. Probeer daarom per step meerdere namen. Een 'Cannot find
# index entries'-fout betekent "naam bestaat niet in deze index" en is geen
# reden voor backoff-retry; netwerkfouten/429 wel.
def param_candidates(param, step):
    if param == "10fg":
        if 93 <= step <= 144:
            return ["10fg3", "10fg"]
        if step >= 150:
            return ["10fg", "10fg6"]
        return ["10fg", "10fg3"]
    return [param]

def resolve_run():
    """Zoek de nieuwste gepubliceerde 12z/00z-run, met expliciete datum en cyclus."""
    today = datetime.now(timezone.utc).date()
    for cand, hour in ((today, 12), (today, 0),
                       (today - timedelta(days=1), 12), (today - timedelta(days=1), 0)):
        ymd = cand.strftime("%Y%m%d")
        hh = f"{hour:02d}"
        url = (f"https://data.ecmwf.int/forecasts/{ymd}/{hh}z/ifs/0p25/enfo/"
               f"{ymd}{hh}0000-3h-enfo-ef.index")
        try:
            req = urllib.request.Request(url, method="HEAD",
                                         headers={"User-Agent": "pascal-fetch/1.0 (weerlab.nl)"})
            with urllib.request.urlopen(req, timeout=30):
                return cand, hour
        except Exception:
            continue
    raise RuntimeError("Geen gepubliceerde 12z/00z-run gevonden voor vandaag of gisteren")

def fallback_download(param, step, target, run_date, run_hour):
    """Directe download van één param via de open-data index + HTTP Range-requests.

    multiurl (t/m 0.3.9) heeft een multipart-parserbug (assert len(chunk) <
    chunk_size) die voor sommige files deterministisch een AssertionError geeft.
    Enkelvoudige Range-requests omzeilen de multipart-parser volledig."""
    ymd = run_date.strftime("%Y%m%d")
    hh = f"{run_hour:02d}"
    base = f"https://data.ecmwf.int/forecasts/{ymd}/{hh}z/ifs/0p25/enfo/{ymd}{hh}0000-{step}h-enfo-ef"
    ua = {"User-Agent": "pascal-fetch/1.0 (weerlab.nl)"}
    req = urllib.request.Request(base + ".index", headers=ua)
    with urllib.request.urlopen(req, timeout=60) as r:
        entries = [json.loads(l) for l in r.read().decode().splitlines() if l.strip()]
    parts = sorted((int(e["_offset"]), int(e["_length"])) for e in entries
                   if e.get("param") == param and e.get("type") == "pf")
    if not parts:
        raise ValueError(f"Cannot find index entries matching {param}@{step} (fallback)")
    merged = []   # aaneengesloten GRIB-messages samenvoegen tot zo min mogelijk requests
    for off, ln in parts:
        if merged and off == merged[-1][0] + merged[-1][1]:
            merged[-1][1] += ln
        else:
            merged.append([off, ln])
    with open(target, "wb") as f:
        for off, ln in merged:
            rq = urllib.request.Request(base + ".grib2",
                    headers={**ua, "Range": f"bytes={off}-{off+ln-1}"})
            with urllib.request.urlopen(rq, timeout=300) as r:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)

def extract_one(client, tmpdir, param, step, run_date, run_hour, max_retry=3):
    target = Path(tmpdir) / f"{param}_{step:03d}.grib2"
    t0 = time.time()
    last_err = None
    for attempt in range(max_retry):
        for name in param_candidates(param, step):
            try:
                client.retrieve(date=run_date, time=run_hour, stream="enfo",
                                type="pf", step=step, param=name,
                                target=str(target))
                last_err = None
                break
            except AssertionError:
                # multiurl multipart-bug: bytes zelf ophalen via de index
                try:
                    fallback_download(name, step, target, run_date, run_hour)
                    last_err = None
                    break
                except Exception as e2:
                    last_err = e2
                    if target.exists(): target.unlink()
                    if "Cannot find index entries" not in str(e2):
                        break
            except Exception as e:
                last_err = e
                if target.exists(): target.unlink()
                if "Cannot find index entries" not in str(e):
                    break   # netwerk/429 e.d.: backoff en opnieuw proberen
        if last_err is None:
            break
        time.sleep(2 + attempt*2)
    if last_err is not None:
        raise last_err
    sz = target.stat().st_size / 1e6
    # Packing error belongs to each field; cumulative differences can be slightly
    # negative even without a physical reset. Record the encoded uncertainty.
    errors=[]
    with open(target,'rb') as f:
        while True:
            gid=ec.codes_grib_new_from_file(f)
            if gid is None: break
            try:
                errors.append(float(ec.codes_get(gid,'packingError')))
                if param=='tp' and ec.codes_get(gid,'startStep') != 0:
                    raise ValueError('tp is not cumulative from run start')
            finally:ec.codes_release(gid)
    packing_error=max(errors,default=0)
    # Parse pf. ECMWF Open Data heeft voor deze ENS-native files geen aparte cf.
    ds_pf = xr.open_dataset(target, engine="cfgrib",
          backend_kwargs={"indexpath":"", "filter_by_keys":{"dataType":"pf"}})
    varname = list(ds_pf.data_vars)[0]
    # NL subset (lat descending gebruikelijk)
    lat_first = float(ds_pf.latitude.values[0])
    lat_slice = slice(NL_LAT[1], NL_LAT[0]) if lat_first > 50 else slice(NL_LAT[0], NL_LAT[1])
    v_pf = ds_pf[varname].sel(latitude=lat_slice, longitude=slice(NL_LON[0], NL_LON[1]))
    v_pf = v_pf.sortby("number")
    if list(v_pf.number.values) != list(range(1, 51)):
        raise ValueError(f"Onvolledige ECMWF leden voor {param}@{step}")
    arr = v_pf.transpose("number", "latitude", "longitude").values.astype(np.float32)
    lats = v_pf.latitude.values.copy()
    lons = v_pf.longitude.values.copy()
    ds_pf.close()
    target.unlink()
    for idx in target.parent.glob(f"{target.stem}.*.idx"): idx.unlink(missing_ok=True)
    gc.collect()
    return param, step, arr, lats, lons, sz, time.time()-t0, packing_error

def main():
    with tempfile.TemporaryDirectory(prefix="pascal_grib_", dir="/tmp") as tmpdir:
        print(f"Tijdelijk: {tmpdir}")
        print(f"Provincies: {len(PROV_GEOM)}\n")

        run_date, run_hour = resolve_run()
        print(f"Run: {run_date.strftime('%Y%m%d')} {run_hour:02d}z")

        tasks = [(p,s) for p,steps in PARAMS.items() for s in steps]
        total = len(tasks)
        print(f"Download-taken: {total} files ({len(PARAMS)} params × gem {total/len(PARAMS):.0f} steps)")

        source = os.getenv("PASCAL_ECMWF_SOURCE", "aws")
        workers = max(1, min(4, int(os.getenv("PASCAL_ECMWF_WORKERS", "2"))))
        print(f"Downloadbron: {source}; workers: {workers}")
        clients = [Client(source=source, model="ifs", resol="0p25") for _ in range(workers)]
        data = {p: {} for p in PARAMS}  # param -> step -> arr
        coords = [None]  # placeholder
        failures = []
        packing_errors = {}
        total_mb = 0; done = 0
        t_total = time.time()

        def work(args):
            i, (p,s) = args
            if i < len(clients):
                time.sleep(i * 1.5)   # eerste golf spreiden tegen 429-burst op data.ecmwf.int
            cli = clients[i % len(clients)]
            return extract_one(cli, tmpdir, p, s, run_date, run_hour)

        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(work, (i,t)): t for i,t in enumerate(tasks)}
            for fut in as_completed(futures):
                try:
                    param, step, arr, lats, lons, sz, dt, error = fut.result()
                    packing_errors[(param,step)] = error
                    data[param][step] = arr
                    if coords[0] is None: coords[0] = (lats, lons)
                    total_mb += sz; done += 1
                    if done % 10 == 0 or done == total:
                        print(f"  [{done:3d}/{total}]  {total_mb:5.0f} MB  t={time.time()-t_total:4.0f}s  "
                              f"= {total_mb/(time.time()-t_total):.1f} MB/s", flush=True)
                except Exception as e:
                    p,s = futures[fut]
                    print(f"  FAIL {p}@{s}: {e}", flush=True)
                    failures.append((p, s, str(e)))

        if failures:
            p, s, msg = failures[0]
            print(f"{len(failures)} velden ontbreken; geldige velden worden afzonderlijk verwerkt")
        if coords[0] is None:
            raise RuntimeError("Geen GRIB-data verwerkt; pascal_real_grib.json wordt niet overschreven")

        dt_total = time.time()-t_total
        print(f"\nDownload klaar: {total_mb:.0f} MB in {dt_total:.0f}s "
              f"(= {total_mb/dt_total:.1f} MB/s)\n")

        # ---- Bouw provinciemasker op native grid (shapely point-in-polygon)
        lats, lons = coords[0]
        nlat, nlon = len(lats), len(lons)
        print(f"NL native 0.25° grid: {nlat}×{nlon} = {nlat*nlon} cellen\n")
        masker = {p: [] for p in PROV_GEOM}
        for i,la in enumerate(lats):
            for j,lo in enumerate(lons):
                pt = Point(float(lo), float(la))
                for p, geom in PROV_GEOM.items():
                    if geom.contains(pt):
                        masker[p].append((i,j)); break  # elke cel aan 1 provincie
        print("Cellen per provincie:")
        for p,c in masker.items(): print(f"  {p:18s} {len(c)}")

        run_time=datetime.combine(run_date,datetime.min.time()).replace(hour=run_hour,tzinfo=timezone.utc)
        steps=sorted({s for values in PARAMS.values() for s in values})
        times=[run_time+timedelta(hours=s) for s in steps]
        cells=[c for group in masker.values() for c in group];ci=np.asarray(cells)
        fields={};areas={};offset=0
        for area,group in masker.items():
            areas[area]=list(range(offset,offset+len(group)));offset+=len(group)
        areas['Nederland']=list(range(len(cells)))
        for key,params in {'gust':['10fg'],'tp':['tp'],'cape':['mucape'],'t2m':['mx2t3','mx2t6']}.items():
            a=np.full((50,len(steps),len(cells)),np.nan,dtype=np.float32)
            for param in params:
                for step,v in data[param].items():a[:,steps.index(step)]=v[:,ci[:,0],ci[:,1]]
            if key=='gust':a*=3.6
            if key=='tp':a*=1000
            if key=='t2m':a-=273.15
            fields[key]=a
        tolerance=2*max((e for (p,s),e in packing_errors.items() if p=='tp'),default=0)*1000
        meta=dict(run=run_time.strftime('%Y%m%d%HZ'),fetched_at=datetime.now(timezone.utc).isoformat(),
                  source='ECMWF native 50 perturbed leden',areas=areas,member_ids=list(range(1,51)),
                  times=[t.isoformat() for t in times],rain_tolerance=tolerance)
        np.savez_compressed(HERE/'ifs_decoded.npz',**fields,metadata=json.dumps(meta))
        # 3h/6h source grid; evaluate day-specific cadence rather than a global 6h assumption.
        OUT=calculate(fields,times,areas,run_time,list(range(1,51)),cadence=[3 if s<=144 else 6 for s in steps],rain_tolerance=tolerance)
        OUT['run_complete']=not failures
        OUT.update({k:meta[k] for k in ['run','fetched_at','source']})
        out=HERE/'pascal_real_grib.json';temp=out.with_suffix('.json.tmp')
        temp.write_text(json.dumps(OUT,allow_nan=False));temp.replace(out)
        print('Geschreven:',out)

    print("✓ Tijdelijke directory opgeruimd\n")

if __name__ == "__main__":
    main()
