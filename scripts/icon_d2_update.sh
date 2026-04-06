#!/bin/bash
# ICON-D2 data update script
# Download DWD ICON-D2 GRIB2 data, exporteer naar binair, upload naar R2
cd "/Users/aldus/KNMI_Project/weerkaarten 2"

echo "$(date): ICON-D2 update gestart"

/usr/local/bin/python3 << 'PYEOF'
import os, json, struct, time, bz2, tempfile
import numpy as np
import requests
import eccodes
import boto3
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

os.chdir("/Users/aldus/KNMI_Project/weerkaarten 2")
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
EXTENT = [0.5, 12.5, 47.5, 56.5]  # NL+BE+DE-west, 5:6 portret

DWD_BASE = "https://opendata.dwd.de/weather/nwp/icon-d2/grib"
R2_ENDPOINT = "https://05da71c7c88b8ce49fbb2c2d0a570416.r2.cloudflarestorage.com"
R2_ACCESS_KEY = "baf991003ce3e4075d91b89f8726bc0f"
R2_SECRET_KEY = "0f33229e2e03fe7bc7f9fdf7f9fa0acd5336c40718c6e25fe0b6a631ade8ac97"
R2_BUCKET = "weerlab-harmonie"

# Parameters om te downloaden: DWD naam → onze naam
PARAMS = {
    "t_2m":      {"naam": "temp",       "conv": lambda v: v - 273.15},     # K -> °C
    "td_2m":     {"naam": "dauwpunt",   "conv": lambda v: v - 273.15},
    "relhum_2m": {"naam": "rv",         "conv": lambda v: v},              # al in %
    "tot_prec":  {"naam": "cum_precip", "conv": lambda v: v},              # cumulatief mm
    "u_10m":     {"naam": "uw",         "conv": lambda v: v},              # m/s
    "v_10m":     {"naam": "vw",         "conv": lambda v: v},
    "vmax_10m":  {"naam": "windstoten", "conv": lambda v: v},              # m/s
    "clch":      {"naam": "hoog",       "conv": lambda v: v / 100.0},      # % -> fractie
    "clcm":      {"naam": "mid",        "conv": lambda v: v / 100.0},
    "clcl":      {"naam": "laag",       "conv": lambda v: v / 100.0},
    "vis":       {"naam": "zicht",      "conv": lambda v: v},              # m
    "cape_ml":   {"naam": "cape",       "conv": lambda v: v},              # J/kg
    "pmsl":      {"naam": "druk",       "conv": lambda v: v},              # Pa
}

MAX_HOURS = 48

# 1. Bepaal laatste run
print("1. Laatste ICON-D2 run bepalen...")
r = requests.get(f"{DWD_BASE}/", timeout=15)
runs = sorted([l.split('href="')[1].split('"')[0].strip('/') for l in r.text.split("\n")
               if 'href="' in l and '/' in l and '..' not in l])
run_utc = int(runs[-1])  # bijv "06"

# Check of de run compleet is (laatste uur moet er zijn)
url_check = f"{DWD_BASE}/{run_utc:02d}/t_2m/"
r_check = requests.get(url_check, timeout=15)
has_last = f"_{MAX_HOURS:03d}_" in r_check.text
if not has_last:
    # Neem vorige run
    run_utc = int(runs[-2])
    print(f"   Laatste run ({runs[-1]}) niet compleet, gebruik {run_utc:02d}z")
else:
    print(f"   Run: {run_utc:02d}z")

# Run datum (vandaag)
now = datetime.now(tz=timezone.utc)
run_dt = now.replace(hour=run_utc, minute=0, second=0, microsecond=0)
if run_dt > now:
    run_dt -= timedelta(days=1)

# Bepaal run datum uit bestandsnaam
r_files = requests.get(f"{DWD_BASE}/{run_utc:02d}/t_2m/", timeout=15)
for line in r_files.text.split("\n"):
    if 'regular-lat-lon' in line and '_000_' in line:
        fname = line.split('href="')[1].split('"')[0]
        # icon-d2_germany_regular-lat-lon_single-level_2026040600_000_2d_t_2m.grib2.bz2
        date_str = fname.split("_")[4]  # "2026040600"
        run_dt = datetime.strptime(date_str, "%Y%m%d%H").replace(tzinfo=timezone.utc)
        break

# Check of deze run al verwerkt is
run_utc_str = run_dt.strftime('%Y-%m-%dT%H:%MZ')
if os.path.exists('icond2_canvas_meta.json'):
    with open('icond2_canvas_meta.json') as mf:
        old_meta = json.load(mf)
    if old_meta.get('run_utc') == run_utc_str:
        print(f'   Run {run_utc_str} al verwerkt, skip.')
        raise SystemExit(0)

print(f'   Nieuwe run: {run_utc_str}')

run_local = run_dt.astimezone(LOCAL_TZ)
run_str = run_local.strftime("%a %d.%m.%Y %H:%M LT").lower()
print(f"   Run: {run_dt.strftime('%Y%m%d%Hz')} = {run_str}")

# 2. Download alle parameters
print(f"\n2. Downloaden ({len(PARAMS)} parameters x {MAX_HOURS+1} uren)...")
t0 = time.time()

all_data = {v["naam"]: [] for v in PARAMS.values()}
lats = lons = None

for hour in range(MAX_HOURS + 1):
    for dwd_name, info in PARAMS.items():
        fname = f"icon-d2_germany_regular-lat-lon_single-level_{run_dt.strftime('%Y%m%d%H')}_{hour:03d}_2d_{dwd_name}.grib2.bz2"
        url = f"{DWD_BASE}/{run_utc:02d}/{dwd_name}/{fname}"

        for poging in range(3):
            try:
                r = requests.get(url, timeout=30)
                if r.status_code == 200:
                    break
                elif r.status_code == 404:
                    # Probeer zonder "2d_" prefix
                    fname2 = fname.replace("_2d_", "_")
                    url2 = f"{DWD_BASE}/{run_utc:02d}/{dwd_name}/{fname2}"
                    r = requests.get(url2, timeout=30)
                    if r.status_code == 200:
                        break
            except:
                time.sleep(1)

        if r.status_code != 200:
            # Vul met NaN
            if lats is not None:
                all_data[info["naam"]].append(np.full((len(lats), len(lons)), np.nan))
            continue

        # Decomprimeer bz2 en lees GRIB2
        try:
            grib_data = bz2.decompress(r.content)
        except:
            if lats is not None:
                all_data[info["naam"]].append(np.full((len(lats), len(lons)), np.nan))
            continue

        with tempfile.NamedTemporaryFile(suffix=".grib2", delete=True) as tmp:
            tmp.write(grib_data)
            tmp.flush()

            with open(tmp.name, "rb") as fh:
                msgid = eccodes.codes_grib_new_from_file(fh)
                if msgid:
                    ni = eccodes.codes_get(msgid, "Ni")
                    nj = eccodes.codes_get(msgid, "Nj")
                    vals = eccodes.codes_get_values(msgid).reshape(nj, ni)

                    # Missende waarden (9999) -> NaN
                    vals[vals > 9000] = np.nan

                    # Conversie toepassen
                    vals = info["conv"](vals)

                    if lats is None:
                        lat1 = eccodes.codes_get(msgid, "latitudeOfFirstGridPointInDegrees")
                        lat2 = eccodes.codes_get(msgid, "latitudeOfLastGridPointInDegrees")
                        lon1 = eccodes.codes_get(msgid, "longitudeOfFirstGridPointInDegrees")
                        lon2 = eccodes.codes_get(msgid, "longitudeOfLastGridPointInDegrees")
                        # ICON-D2 longitude: 356-20 = -4 tot 20
                        if lon1 > 180: lon1 -= 360
                        lats = np.linspace(lat1, lat2, nj)
                        lons = np.linspace(lon1, lon2, ni)
                        print(f"   Grid: {ni}x{nj}, lat {lat1:.1f}-{lat2:.1f}, lon {lon1:.1f}-{lon2:.1f}")

                    all_data[info["naam"]].append(vals)
                    eccodes.codes_release(msgid)

    if hour % 12 == 0:
        print(f"   Uur {hour}/{MAX_HOURS} ({time.time()-t0:.0f}s)")

print(f"   Download klaar in {time.time()-t0:.0f}s")

# Lats van noord naar zuid -> zuid naar noord
if lats is not None and lats[0] > lats[-1]:
    lats = lats[::-1]
    for key in all_data:
        all_data[key] = [d[::-1, :] if d is not None else d for d in all_data[key]]

# Uurlijkse neerslag
hourly_precip = []
for i in range(1, len(all_data["cum_precip"])):
    diff = all_data["cum_precip"][i] - all_data["cum_precip"][i-1]
    hourly_precip.append(np.maximum(np.nan_to_num(diff, nan=0), 0))

# Windstoten: vmax_10m is al in m/s, maar we moeten U en V splitsen
# vmax_10m is scalar, niet vector — we slaan het op als 2-component met V=0
windstoten_uv = [(all_data["windstoten"][i], np.zeros_like(all_data["windstoten"][i]))
                 for i in range(1, len(all_data["windstoten"]))]

# 3. Crop en exporteer
print("\n3. Exporteren...")
lat_idx = np.where((lats >= EXTENT[2]) & (lats <= EXTENT[3]))[0]
lon_idx = np.where((lons >= EXTENT[0]) & (lons <= EXTENT[1]))[0]
c_lats = lats[lat_idx]; c_lons = lons[lon_idx]
n_lat = len(c_lats); n_lon = len(c_lons)
n_steps = min(MAX_HOURS, len(hourly_precip))
print(f"   Crop grid: {n_lat}x{n_lon}, {n_steps} uur")

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

PREFIX = "icond2"
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

# Straling: niet direct beschikbaar als 1 veld, skip voor nu

# 4. Metadata
print("\n4. Metadata...")
times_str = []
for h in range(1, n_steps + 1):
    dt_valid = run_dt + timedelta(hours=h)
    times_str.append(dt_valid.astimezone(LOCAL_TZ).strftime("%Y-%m-%dT%H:%M"))

meta = {
    "model": "ICON-D2",
    "run": run_str,
    "run_utc": run_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "bijgewerkt": datetime.now(tz=LOCAL_TZ).strftime("%d %b %Y %H:%M"),
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
with open(f"{PREFIX}_canvas_meta.json", "w") as f:
    json.dump(meta, f, indent=2, ensure_ascii=False)

# 5. Upload naar R2
print("\n5. Uploaden naar R2...")
s3 = boto3.client("s3",
    endpoint_url=R2_ENDPOINT,
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY,
    region_name="auto")

bestanden = [f"{PREFIX}_canvas_meta.json"]
for f2 in sorted(os.listdir(".")):
    if f2.startswith(f"{PREFIX}_data_") and f2.endswith(".bin"):
        bestanden.append(f2)

for f2 in bestanden:
    ct = "application/json" if f2.endswith(".json") else "application/octet-stream"
    s3.upload_file(f2, R2_BUCKET, f2, ExtraArgs={"ContentType": ct})
    print(f"   {f2} ({os.path.getsize(f2)/1024/1024:.1f} MB)")

print(f"\nKlaar! ICON-D2 run {run_str}, {n_steps} uur")
PYEOF

echo "$(date): ICON-D2 update klaar"
