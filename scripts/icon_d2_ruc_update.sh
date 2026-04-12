#!/bin/bash
# ICON-D2-RUC (Rapid Update Cycle) data update script
# Download DWD ICON-D2-RUC GRIB2 data, exporteer naar binair, upload naar R2
# RUC: elk uur een nieuwe run, 14 uur vooruit, 2.2 km resolutie
cd "/Users/aldus/KNMI_Project/weerkaarten 2"

echo "$(date): ICON-D2-RUC update gestart"

/usr/local/bin/python3 << 'PYEOF'
import os, json, struct, time, tempfile
import numpy as np
import requests
import eccodes
import boto3
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

os.chdir("/Users/aldus/KNMI_Project/weerkaarten 2")
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
EXTENT = [0.5, 11.3, 49.0, 56.0]  # Zelfde bereik als Harmonie/ICON-D2

DWD_BASE = "https://opendata.dwd.de/weather/nwp/v1/m/icon-d2-ruc/p"
R2_ENDPOINT = "https://05da71c7c88b8ce49fbb2c2d0a570416.r2.cloudflarestorage.com"
R2_ACCESS_KEY = "baf991003ce3e4075d91b89f8726bc0f"
R2_SECRET_KEY = "0f33229e2e03fe7bc7f9fdf7f9fa0acd5336c40718c6e25fe0b6a631ade8ac97"
R2_BUCKET = "weerlab-harmonie"

# Parameters: DWD naam (uppercase) → onze naam + conversie
PARAMS = {
    "T_2M":      {"naam": "temp",       "conv": lambda v: v - 273.15},     # K -> °C
    "TD_2M":     {"naam": "dauwpunt",   "conv": lambda v: v - 273.15},
    "RELHUM_2M": {"naam": "rv",         "conv": lambda v: v},              # al in %
    "TOT_PREC":  {"naam": "cum_precip", "conv": lambda v: v},              # cumulatief mm
    "U_10M":     {"naam": "uw",         "conv": lambda v: v},              # m/s
    "V_10M":     {"naam": "vw",         "conv": lambda v: v},
    "VMAX_10M":  {"naam": "windstoten", "conv": lambda v: v},              # m/s
    "CLCH":      {"naam": "hoog",       "conv": lambda v: v / 100.0},      # % -> fractie
    "CLCM":      {"naam": "mid",        "conv": lambda v: v / 100.0},
    "CLCL":      {"naam": "laag",       "conv": lambda v: v / 100.0},
    "VIS":       {"naam": "zicht",      "conv": lambda v: v},              # m
    "CAPE_ML":   {"naam": "cape",       "conv": lambda v: v},              # J/kg
    "PMSL":      {"naam": "druk",       "conv": lambda v: v},              # Pa
}

MAX_HOURS = 14  # RUC gaat tot 14 uur vooruit

# ────────────────────────────────────────────────────────────────────────
# 1. Bepaal laatste run via directorylijst van T_2M
# ────────────────────────────────────────────────────────────────────────
print("1. Laatste ICON-D2-RUC run bepalen...")
r = requests.get(f"{DWD_BASE}/T_2M/r/", timeout=15)
# Parse run-mappen: "2026-04-12T06:00/" (href bevat %3A i.p.v. :)
runs = []
for line in r.text.split("\n"):
    if 'href="' in line and '2026' in line:
        folder = line.split('href="')[1].split('"')[0].strip('/')
        # URL-decode %3A → :
        from urllib.parse import unquote
        folder = unquote(folder)
        try:
            dt = datetime.strptime(folder, "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)
            runs.append((dt, folder))
        except:
            continue
runs.sort(key=lambda x: x[0])

if not runs:
    print("   Geen runs gevonden!")
    raise SystemExit(1)

# Check of de laatste run compleet is (PT014H00M.grib2 aanwezig)
run_dt = None
run_folder = None
for dt, folder in reversed(runs):
    check_url = f"{DWD_BASE}/T_2M/r/{folder}/s/PT{MAX_HOURS:03d}H00M.grib2"
    try:
        head = requests.head(check_url, timeout=10)
        if head.status_code == 200:
            run_dt = dt
            run_folder = folder
            break
    except:
        continue

if run_dt is None:
    # Fallback: pak de op-één-na-laatste
    run_dt, run_folder = runs[-2] if len(runs) > 1 else runs[-1]
    print(f"   Geen complete run gevonden, gebruik {run_folder}")

print(f"   Nieuwste complete run: {run_folder}")

# Check of deze run al verwerkt is
run_utc_str = run_dt.strftime('%Y-%m-%dT%H:%MZ')
META_FILE = "icond2ruc_canvas_meta.json"
if os.path.exists(META_FILE):
    with open(META_FILE) as mf:
        old_meta = json.load(mf)
    if old_meta.get('run_utc') == run_utc_str:
        print(f'   Run {run_utc_str} al verwerkt, skip.')
        raise SystemExit(0)

print(f'   Nieuwe run: {run_utc_str}')
run_local = run_dt.astimezone(LOCAL_TZ)
_nl_dagen = ['maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag','zondag']
run_str = _nl_dagen[run_local.weekday()] + ' ' + run_local.strftime("%d.%m.%Y %H:%M LT")
print(f"   Run: {run_folder} = {run_str}")

# ────────────────────────────────────────────────────────────────────────
# 2. Download alle parameters
# ────────────────────────────────────────────────────────────────────────
print(f"\n2. Downloaden ({len(PARAMS)} parameters x {MAX_HOURS+1} stappen)...")
t0 = time.time()

all_data = {v["naam"]: [] for v in PARAMS.values()}
lats = lons = None
grid_type = None

for hour in range(MAX_HOURS + 1):
    for dwd_name, info in PARAMS.items():
        url = f"{DWD_BASE}/{dwd_name}/r/{run_folder}/s/PT{hour:03d}H00M.grib2"

        grib_data = None
        for poging in range(3):
            try:
                r = requests.get(url, timeout=30)
                if r.status_code == 200:
                    grib_data = r.content
                    break
            except:
                time.sleep(1)

        if grib_data is None:
            if lats is not None:
                all_data[info["naam"]].append(np.full((len(lats), len(lons)), np.nan))
            continue

        with tempfile.NamedTemporaryFile(suffix=".grib2", delete=True) as tmp:
            tmp.write(grib_data)
            tmp.flush()

            with open(tmp.name, "rb") as fh:
                msgid = eccodes.codes_grib_new_from_file(fh)
                if msgid:
                    gtype = eccodes.codes_get(msgid, "gridType")

                    if gtype in ("regular_ll", "rotated_ll"):
                        # Regulier lat-lon grid
                        ni = eccodes.codes_get(msgid, "Ni")
                        nj = eccodes.codes_get(msgid, "Nj")
                        vals = eccodes.codes_get_values(msgid).reshape(nj, ni)
                        vals[vals > 9000] = np.nan
                        vals = info["conv"](vals)

                        if lats is None:
                            grid_type = "regular"
                            lat1 = eccodes.codes_get(msgid, "latitudeOfFirstGridPointInDegrees")
                            lat2 = eccodes.codes_get(msgid, "latitudeOfLastGridPointInDegrees")
                            lon1 = eccodes.codes_get(msgid, "longitudeOfFirstGridPointInDegrees")
                            lon2 = eccodes.codes_get(msgid, "longitudeOfLastGridPointInDegrees")
                            if lon1 > 180: lon1 -= 360
                            lats = np.linspace(lat1, lat2, nj)
                            lons = np.linspace(lon1, lon2, ni)
                            print(f"   Grid: {ni}x{nj} ({gtype}), lat {lat1:.2f}-{lat2:.2f}, lon {lon1:.2f}-{lon2:.2f}")

                        all_data[info["naam"]].append(vals)

                    elif gtype in ("unstructured_grid", "triangular_grid"):
                        # Icosahedral grid — regrid naar regulier
                        n_pts = eccodes.codes_get(msgid, "numberOfDataPoints")
                        vals_flat = eccodes.codes_get_values(msgid)
                        vals_flat[vals_flat > 9000] = np.nan
                        vals_flat = info["conv"](vals_flat)

                        if lats is None:
                            grid_type = "unstructured"
                            # Download CLAT/CLON voor gridcoördinaten
                            print(f"   Ongestructureerd grid ({n_pts} punten), download CLAT/CLON...")
                            clat_url = f"{DWD_BASE}/CLAT/r/{run_folder}/s/PT000H00M.grib2"
                            clon_url = f"{DWD_BASE}/CLON/r/{run_folder}/s/PT000H00M.grib2"
                            clat_r = requests.get(clat_url, timeout=30)
                            clon_r = requests.get(clon_url, timeout=30)

                            def read_grib_values(data):
                                with tempfile.NamedTemporaryFile(suffix=".grib2", delete=True) as t:
                                    t.write(data)
                                    t.flush()
                                    with open(t.name, "rb") as ff:
                                        mid = eccodes.codes_grib_new_from_file(ff)
                                        v = eccodes.codes_get_values(mid)
                                        eccodes.codes_release(mid)
                                        return v

                            grid_lats_flat = read_grib_values(clat_r.content)
                            grid_lons_flat = read_grib_values(clon_r.content)
                            # Converteer radialen → graden als nodig
                            if np.max(np.abs(grid_lats_flat)) < 2:
                                grid_lats_flat = np.degrees(grid_lats_flat)
                                grid_lons_flat = np.degrees(grid_lons_flat)
                            if np.any(grid_lons_flat > 180):
                                grid_lons_flat[grid_lons_flat > 180] -= 360

                            # Maak regulier doelgrid (~0.02° ≈ 2.2 km)
                            res = 0.02
                            lats = np.arange(EXTENT[2], EXTENT[3] + res, res)
                            lons = np.arange(EXTENT[0], EXTENT[1] + res, res)
                            print(f"   Doelgrid: {len(lats)}x{len(lons)} @ {res}°")

                            # KDTree voor nearest-neighbor interpolatie
                            from scipy.spatial import cKDTree
                            # Filter alleen punten in/rond ons domein
                            mask = ((grid_lats_flat >= EXTENT[2] - 1) & (grid_lats_flat <= EXTENT[3] + 1) &
                                    (grid_lons_flat >= EXTENT[0] - 1) & (grid_lons_flat <= EXTENT[1] + 1))
                            idx_mask = np.where(mask)[0]
                            cos_mid = np.cos(np.radians(np.mean(EXTENT[2:4])))
                            tree_pts = np.column_stack([grid_lats_flat[idx_mask],
                                                        grid_lons_flat[idx_mask] * cos_mid])
                            tree = cKDTree(tree_pts)

                            # Query voor elk doelpunt
                            lon_grid, lat_grid = np.meshgrid(lons, lats)
                            query_pts = np.column_stack([lat_grid.ravel(),
                                                         lon_grid.ravel() * cos_mid])
                            _, nn_idx = tree.query(query_pts)
                            nn_source_idx = idx_mask[nn_idx]
                            print(f"   KDTree gebouwd, regridding actief")

                        # Regrid via nearest neighbor
                        regridded = vals_flat[nn_source_idx].reshape(len(lats), len(lons))
                        all_data[info["naam"]].append(regridded)
                    else:
                        print(f"   Onbekend gridtype: {gtype}")
                        if lats is not None:
                            all_data[info["naam"]].append(np.full((len(lats), len(lons)), np.nan))

                    eccodes.codes_release(msgid)

    if hour % 5 == 0:
        print(f"   Stap {hour}/{MAX_HOURS} ({time.time()-t0:.0f}s)")

print(f"   Download klaar in {time.time()-t0:.0f}s")

if lats is None:
    print("FOUT: Geen data ontvangen!")
    raise SystemExit(1)

# Lats van noord naar zuid → zuid naar noord
if lats[0] > lats[-1]:
    lats = lats[::-1]
    for key in all_data:
        all_data[key] = [d[::-1, :] if d is not None else d for d in all_data[key]]

# ────────────────────────────────────────────────────────────────────────
# 3. Afgeleide velden
# ────────────────────────────────────────────────────────────────────────
# Uurlijkse neerslag uit cumulatieve
hourly_precip = []
for i in range(1, len(all_data["cum_precip"])):
    diff = all_data["cum_precip"][i] - all_data["cum_precip"][i-1]
    hourly_precip.append(np.maximum(np.nan_to_num(diff, nan=0), 0))

# Windstoten: scalar → 2-component met V=0
windstoten_uv = [(all_data["windstoten"][i], np.zeros_like(all_data["windstoten"][i]))
                 for i in range(1, len(all_data["windstoten"]))]

# ────────────────────────────────────────────────────────────────────────
# 4. Crop en exporteer
# ────────────────────────────────────────────────────────────────────────
print("\n3. Exporteren...")
if grid_type == "regular":
    lat_idx = np.where((lats >= EXTENT[2]) & (lats <= EXTENT[3]))[0]
    lon_idx = np.where((lons >= EXTENT[0]) & (lons <= EXTENT[1]))[0]
    c_lats = lats[lat_idx]; c_lons = lons[lon_idx]
else:
    # Al gecropte data bij unstructured grid
    lat_idx = np.arange(len(lats))
    lon_idx = np.arange(len(lons))
    c_lats = lats; c_lons = lons

n_lat = len(c_lats); n_lon = len(c_lons)
n_steps = min(MAX_HOURS, len(hourly_precip))
print(f"   Grid: {n_lat}x{n_lon}, {n_steps} uur")

def crop(d):
    return np.nan_to_num(d[np.ix_(lat_idx, lon_idx)], nan=0).astype(np.float32)

def write_bin(fn, data_list, nc=1):
    with open(fn, "wb") as f:
        f.write(struct.pack("<HHHH", n_lat, n_lon, len(data_list), nc))
        f.write(b"\x00" * 8)
        for item in data_list:
            if nc == 1:
                f.write(crop(item).tobytes())
            else:
                for comp in item:
                    f.write(crop(comp).tobytes())
    print(f"   {fn}: {os.path.getsize(fn)/1024/1024:.1f} MB")

PREFIX = "icond2ruc"
write_bin(f"{PREFIX}_data_neerslag.bin", hourly_precip[:n_steps])
write_bin(f"{PREFIX}_data_temp.bin", all_data["temp"][1:n_steps+1])
write_bin(f"{PREFIX}_data_dauwpunt.bin", all_data["dauwpunt"][1:n_steps+1])
write_bin(f"{PREFIX}_data_rv.bin", all_data["rv"][1:n_steps+1])
write_bin(f"{PREFIX}_data_bewolking.bin",
          list(zip(all_data["hoog"][1:n_steps+1], all_data["mid"][1:n_steps+1], all_data["laag"][1:n_steps+1])), 3)
write_bin(f"{PREFIX}_data_wind.bin",
          list(zip(all_data["uw"][1:n_steps+1], all_data["vw"][1:n_steps+1])), 2)
write_bin(f"{PREFIX}_data_windstoten.bin", windstoten_uv[:n_steps], 2)
write_bin(f"{PREFIX}_data_zicht.bin", all_data["zicht"][1:n_steps+1])
write_bin(f"{PREFIX}_data_cape.bin", all_data["cape"][1:n_steps+1])
write_bin(f"{PREFIX}_data_druk.bin", all_data["druk"][1:n_steps+1])

# ────────────────────────────────────────────────────────────────────────
# 5. Metadata
# ────────────────────────────────────────────────────────────────────────
print("\n4. Metadata...")
times_str = []
for h in range(1, n_steps + 1):
    dt_valid = run_dt + timedelta(hours=h)
    times_str.append(dt_valid.astimezone(LOCAL_TZ).strftime("%Y-%m-%dT%H:%M"))

meta = {
    "model": "ICON-D2-RUC",
    "run": run_str,
    "run_utc": run_dt.strftime("%Y-%m-%dT%H:%MZ"),
    "bijgewerkt": (lambda d: str(d.day) + ' ' + ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'][d.month-1] + d.strftime(' %Y %H:%M'))(datetime.now(tz=LOCAL_TZ)),
    "uren": len(times_str),
    "tijden": times_str,
    "grid": {
        "n_lat": n_lat, "n_lon": n_lon,
        "lat_min": float(c_lats[0]), "lat_max": float(c_lats[-1]),
        "lon_min": float(c_lons[0]), "lon_max": float(c_lons[-1]),
    },
    "parameters": {
        "neerslag":   {"file": f"{PREFIX}_data_neerslag.bin",   "components": 1, "label": "Gesimuleerde radar (dBZ)"},
        "temp":       {"file": f"{PREFIX}_data_temp.bin",       "components": 1, "label": "Temperatuur 2m (°C)"},
        "dauwpunt":   {"file": f"{PREFIX}_data_dauwpunt.bin",   "components": 1, "label": "Dauwpuntstemperatuur 2m (°C)"},
        "rv":         {"file": f"{PREFIX}_data_rv.bin",         "components": 1, "label": "Relatieve vochtigheid (%)"},
        "bewolking":  {"file": f"{PREFIX}_data_bewolking.bin",  "components": 3, "label": "Bewolking (hoog/midden/laag)"},
        "wind":       {"file": f"{PREFIX}_data_wind.bin",       "components": 2, "label": "Wind 10m (Bft)"},
        "windstoten": {"file": f"{PREFIX}_data_windstoten.bin", "components": 2, "label": "Windstoten 10m (km/u)"},
        "zicht":      {"file": f"{PREFIX}_data_zicht.bin",      "components": 1, "label": "Zicht"},
        "cape":       {"file": f"{PREFIX}_data_cape.bin",       "components": 1, "label": "CAPE (J/kg)"},
        "druk":       {"file": f"{PREFIX}_data_druk.bin",       "components": 1, "label": "Luchtdruk (hPa)"},
    },
    "overlay": "harmonie_overlay.png",
}
with open(META_FILE, "w") as f:
    json.dump(meta, f, indent=2, ensure_ascii=False)

# ────────────────────────────────────────────────────────────────────────
# 6. Upload naar R2
# ────────────────────────────────────────────────────────────────────────
print("\n5. Uploaden naar R2...")
s3 = boto3.client("s3",
    endpoint_url=R2_ENDPOINT,
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY,
    region_name="auto")

bestanden = [META_FILE]
for f2 in sorted(os.listdir(".")):
    if f2.startswith(f"{PREFIX}_data_") and f2.endswith(".bin"):
        bestanden.append(f2)

for f2 in bestanden:
    ct = "application/json" if f2.endswith(".json") else "application/octet-stream"
    s3.upload_file(f2, R2_BUCKET, f2, ExtraArgs={"ContentType": ct})
    print(f"   {f2} ({os.path.getsize(f2)/1024/1024:.1f} MB)")

print(f"\nKlaar! ICON-D2-RUC run {run_str}, {n_steps} uur")
PYEOF

echo "$(date): ICON-D2-RUC update klaar"
