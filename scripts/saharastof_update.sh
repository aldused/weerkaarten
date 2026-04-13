#!/bin/bash
# Saharastof kaarten: CAMS European Air Quality via Open-Meteo
# Variabelen: dust (μg/m³), PM10 (μg/m³), Aerosol Optical Depth
cd "/Users/aldus/KNMI_Project/weerkaarten 2"

echo "$(date): Saharastof update gestart"

/usr/local/bin/python3 << 'PYEOF'
import os, json, struct, time
import numpy as np
import requests
import boto3
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

os.chdir("/Users/aldus/KNMI_Project/weerkaarten 2")
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

# Grid: heel Europa, 0.8° stap (voldoende voor stofconcentratie)
# Van Noord-Afrika tot Scandinavië, Atlantische Oceaan tot Oost-Europa
LAT_MIN, LAT_MAX = 30.0, 62.0
LON_MIN, LON_MAX = -15.0, 35.0
STEP = 0.8

lats = np.arange(LAT_MIN, LAT_MAX + STEP/2, STEP)
lons = np.arange(LON_MIN, LON_MAX + STEP/2, STEP)
n_lat = len(lats)
n_lon = len(lons)
print(f"Grid: {n_lat}x{n_lon} = {n_lat*n_lon} punten, stap {STEP}°")

# Alle gridpunten als lijsten
all_lats = []
all_lons = []
for lat in lats:
    for lon in lons:
        all_lats.append(round(lat, 2))
        all_lons.append(round(lon, 2))

# Batch-grootte (Open-Meteo free API limiet)
BATCH = 200
HOURLY = "dust,pm10,pm2_5,aerosol_optical_depth"
DAYS = 5

# Ophalen
print(f"Ophalen: {len(all_lats)} punten in {(len(all_lats)-1)//BATCH + 1} batches...")
t0 = time.time()

# Resultaat arrays: [variabele][punt][tijdstap]
results = {}
n_times = None
times_raw = None

for b_start in range(0, len(all_lats), BATCH):
    b_end = min(b_start + BATCH, len(all_lats))
    b_lats = all_lats[b_start:b_end]
    b_lons = all_lons[b_start:b_end]

    params = {
        "latitude": ",".join(map(str, b_lats)),
        "longitude": ",".join(map(str, b_lons)),
        "hourly": HOURLY,
        "forecast_days": DAYS,
        "timezone": "auto",
    }

    for attempt in range(5):
        try:
            r = requests.get("https://air-quality-api.open-meteo.com/v1/air-quality",
                             params=params, timeout=60)
            if r.status_code == 200:
                break
            elif r.status_code == 429:
                wait = 10 * (attempt + 1)
                print(f"    Rate limit, wacht {wait}s...")
                time.sleep(wait)
            else:
                time.sleep(2)
        except:
            time.sleep(2)

    if r.status_code != 200:
        print(f"  FOUT batch {b_start}: HTTP {r.status_code}")
        continue

    data = r.json()
    if not isinstance(data, list):
        data = [data]

    if times_raw is None:
        times_raw = data[0]["hourly"]["time"]
        n_times = len(times_raw)
        for var in HOURLY.split(","):
            results[var] = np.full((len(all_lats), n_times), np.nan, dtype=np.float32)

    for i, d in enumerate(data):
        idx = b_start + i
        hourly = d.get("hourly", {})
        for var in HOURLY.split(","):
            vals = hourly.get(var, [])
            for t in range(min(len(vals), n_times)):
                if vals[t] is not None:
                    results[var][idx, t] = vals[t]

    print(f"  Batch {b_start//BATCH + 1}/{(len(all_lats)-1)//BATCH + 1}: {b_end - b_start} punten ({time.time()-t0:.0f}s)")
    time.sleep(3)  # Voorkom rate limiting

print(f"Ophalen klaar in {time.time()-t0:.0f}s, {n_times} tijdstappen")

# Reshape naar grid: [tijd][lat][lon]
def reshape_var(var_name):
    flat = results[var_name]  # (n_punten, n_times)
    out = np.zeros((n_times, n_lat, n_lon), dtype=np.float32)
    for t in range(n_times):
        grid = flat[:, t].reshape(n_lat, n_lon)
        out[t] = grid
    return out

dust_grid = reshape_var("dust")
pm10_grid = reshape_var("pm10")
pm25_grid = reshape_var("pm2_5")
aod_grid  = reshape_var("aerosol_optical_depth")

# Schrijf binaire bestanden
def write_bin(fn, data, n_comp=1):
    """data shape: (n_steps, n_lat, n_lon) voor 1-comp"""
    n_steps = data.shape[0]
    with open(fn, "wb") as f:
        f.write(struct.pack("<HHHH", n_lat, n_lon, n_steps, n_comp))
        f.write(b"\x00" * 8)
        for s in range(n_steps):
            f.write(np.nan_to_num(data[s], nan=0).astype(np.float32).tobytes())
    print(f"  {fn}: {os.path.getsize(fn)/1024/1024:.1f} MB")

PREFIX = "saharastof"
print("Exporteren...")
write_bin(f"{PREFIX}_data_dust.bin", dust_grid)
write_bin(f"{PREFIX}_data_pm10.bin", pm10_grid)
write_bin(f"{PREFIX}_data_pm25.bin", pm25_grid)
write_bin(f"{PREFIX}_data_aod.bin", aod_grid)

# Metadata
now_local = datetime.now(tz=LOCAL_TZ)
# Parse eerste tijdstap voor run-info
first_time = datetime.fromisoformat(times_raw[0]).replace(tzinfo=LOCAL_TZ)
_nl_dagen = ['maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag','zondag']

meta = {
    "model": "CAMS (Saharastof)",
    "run": _nl_dagen[now_local.weekday()] + " " + now_local.strftime("%d.%m.%Y %H:%M LT"),
    "run_utc": now_local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
    "bijgewerkt": str(now_local.day) + " " + ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'][now_local.month-1] + now_local.strftime(" %Y %H:%M"),
    "uren": n_times,
    "tijden": times_raw,
    "grid": {
        "n_lat": n_lat, "n_lon": n_lon,
        "lat_min": float(lats[0]), "lat_max": float(lats[-1]),
        "lon_min": float(lons[0]), "lon_max": float(lons[-1]),
    },
    "parameters": {
        "dust":  {"file": f"{PREFIX}_data_dust.bin", "components": 1, "label": "Saharastof (μg/m³)"},
        "pm10":  {"file": f"{PREFIX}_data_pm10.bin", "components": 1, "label": "PM10 (μg/m³)"},
        "pm25":  {"file": f"{PREFIX}_data_pm25.bin", "components": 1, "label": "PM2.5 (μg/m³)"},
        "aod":   {"file": f"{PREFIX}_data_aod.bin",  "components": 1, "label": "Aerosol Optical Depth"},
    },
    "overlay": "europa_overlay.png",
}

META_FILE = f"{PREFIX}_canvas_meta.json"
with open(META_FILE, "w") as f:
    json.dump(meta, f, indent=2, ensure_ascii=False)

# Upload naar R2
print("Uploaden naar R2...")
R2_ENDPOINT = "https://05da71c7c88b8ce49fbb2c2d0a570416.r2.cloudflarestorage.com"
R2_ACCESS_KEY = "baf991003ce3e4075d91b89f8726bc0f"
R2_SECRET_KEY = "0f33229e2e03fe7bc7f9fdf7f9fa0acd5336c40718c6e25fe0b6a631ade8ac97"
R2_BUCKET = "weerlab-harmonie"

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
    print(f"  {f2} ({os.path.getsize(f2)/1024/1024:.1f} MB)")

print(f"\nKlaar! Saharastof kaarten, {n_times} uur, {n_lat}x{n_lon} grid")
PYEOF

echo "$(date): Saharastof update klaar"
