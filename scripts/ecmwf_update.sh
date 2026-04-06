#!/bin/bash
# ECMWF IFS data update script
cd "/Users/aldus/KNMI_Project/weerkaarten 2"
echo "$(date): ECMWF update gestart"

/usr/local/bin/python3 << 'PYEOF'
import os, json, struct, time, tempfile
import numpy as np
import eccodes
import boto3
from ecmwf.opendata import Client
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

os.chdir("/Users/aldus/KNMI_Project/weerkaarten 2")
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
EXTENT = [0.5, 12.5, 47.5, 56.5]

R2_ENDPOINT = "https://05da71c7c88b8ce49fbb2c2d0a570416.r2.cloudflarestorage.com"
R2_ACCESS_KEY = "baf991003ce3e4075d91b89f8726bc0f"
R2_SECRET_KEY = "0f33229e2e03fe7bc7f9fdf7f9fa0acd5336c40718c6e25fe0b6a631ade8ac97"
R2_BUCKET = "weerlab-harmonie"

# ECMWF stappen (elke 3u tot 144h, dan 6u tot 240h)
STEPS = list(range(0, 145, 3)) + list(range(150, 241, 6))

# Parameters: ECMWF param code → onze naam
PARAMS = {
    "2t":    {"naam": "temp",      "conv": lambda v: v - 273.15},
    "2d":    {"naam": "dauwpunt",  "conv": lambda v: v - 273.15},
    "10u":   {"naam": "uw",        "conv": lambda v: v},
    "10v":   {"naam": "vw",        "conv": lambda v: v},
    "tp":    {"naam": "cum_precip","conv": lambda v: v * 1000},  # m -> mm
    "tcc":   {"naam": "tcc",       "conv": lambda v: v},         # 0-1
    "hcc":   {"naam": "hoog",      "conv": lambda v: v},
    "mcc":   {"naam": "mid",       "conv": lambda v: v},
    "lcc":   {"naam": "laag",      "conv": lambda v: v},
    "msl":   {"naam": "druk",      "conv": lambda v: v},         # Pa
    "cape":  {"naam": "cape",      "conv": lambda v: v},
    "i10fg": {"naam": "windstoten","conv": lambda v: v},         # m/s
    "vis":   {"naam": "zicht",     "conv": lambda v: v},         # m (niet altijd beschikbaar)
}

client = Client()
t0 = time.time()

# 1. Laatste run
print("1. ECMWF laatste run...")
run_dt_raw = client.latest(type="fc", step=12, stream="oper", levtype="sfc")
run_dt = run_dt_raw.replace(tzinfo=timezone.utc)
run_local = run_dt.astimezone(LOCAL_TZ)
run_str = run_local.strftime("%a %d.%m.%Y %H:%M LT").lower()
print(f"   Run: {run_dt.strftime('%Y%m%d%Hz')} = {run_str}")

# 2. Download alle parameters per stap (gebundeld per stap = minder API-calls)
# Drie groepen: basis, bewolking en instabiliteit apart (niet alle beschikbaar)
PARAM_GROEP_A = ["2t", "2d", "10u", "10v", "msl", "tp"]
PARAM_GROEP_B = ["tcc", "hcc", "mcc", "lcc"]
PARAM_GROEP_C = ["cape", "i10fg"]

# Lookup: ecmwf_code → info
PARAM_LOOKUP = {code: info for code, info in PARAMS.items()}

all_data = {v["naam"]: {} for v in PARAMS.values()}
lats = lons = None

def parse_grib(fname, step):
    global lats, lons
    with open(fname, "rb") as f:
        while True:
            msgid = eccodes.codes_grib_new_from_file(f)
            if msgid is None:
                break
            try:
                shortName = eccodes.codes_get(msgid, "shortName")
                ni = eccodes.codes_get(msgid, "Ni")
                nj = eccodes.codes_get(msgid, "Nj")
                vals = eccodes.codes_get_values(msgid).reshape(nj, ni)

                if shortName in PARAM_LOOKUP:
                    info = PARAM_LOOKUP[shortName]
                    vals = info["conv"](vals)
                    all_data[info["naam"]][step] = vals

                if lats is None:
                    lat1 = eccodes.codes_get(msgid, "latitudeOfFirstGridPointInDegrees")
                    lat2 = eccodes.codes_get(msgid, "latitudeOfLastGridPointInDegrees")
                    lon1 = eccodes.codes_get(msgid, "longitudeOfFirstGridPointInDegrees")
                    lon2 = eccodes.codes_get(msgid, "longitudeOfLastGridPointInDegrees")
                    lats = np.linspace(lat1, lat2, nj)
                    # ECMWF: lon kan wrappen (180→179.75 = via 360/0)
                    if lon2 < lon1:
                        lons = np.linspace(lon1, lon2 + 360, ni) % 360
                    else:
                        lons = np.linspace(lon1, lon2, ni)
                    print(f"   Grid: {ni}x{nj}, lat {lat1:.2f}→{lat2:.2f}, lon {lon1:.2f}→{lon2:.2f}")
                    print(f"   Lons range: {lons.min():.2f}→{lons.max():.2f} (na wrap-fix)")
            finally:
                eccodes.codes_release(msgid)

print(f"\n2. Downloaden ({len(STEPS)} stappen, params gebundeld)...")

for step in STEPS:
    for groep in [PARAM_GROEP_A, PARAM_GROEP_B, PARAM_GROEP_C]:
        for poging in range(3):
            try:
                with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as tmp:
                    tmpname = tmp.name
                client.retrieve(type="fc", step=step, param=groep,
                               target=tmpname, stream="oper", levtype="sfc")
                parse_grib(tmpname, step)
                os.unlink(tmpname)
                break
            except Exception as e:
                if poging < 2:
                    time.sleep(2 * (poging + 1))
                else:
                    print(f"   ! Stap {step}, groep {groep[0]}...: {e}")
                try:
                    os.unlink(tmpname)
                except:
                    pass

    if step % 24 == 0:
        print(f"   Stap {step}h ({time.time()-t0:.0f}s)")
    time.sleep(0.5)  # voorkom rate-limiting

print(f"   Download klaar in {time.time()-t0:.0f}s")

# Lats van noord naar zuid -> zuid naar noord
if lats[0] > lats[-1]:
    lats = lats[::-1]
    for key in all_data:
        for step in all_data[key]:
            all_data[key][step] = all_data[key][step][::-1, :]

# 3. Crop en exporteer (alleen de stappen die we hebben)
print("\n3. Exporteren...")
lat_idx = np.where((lats >= EXTENT[2]) & (lats <= EXTENT[3]))[0]
lon_idx = np.where((lons >= EXTENT[0]) & (lons <= EXTENT[1]))[0]
c_lats = lats[lat_idx]; c_lons = lons[lon_idx]
n_lat = len(c_lats); n_lon = len(c_lons)

# Gebruik alleen stappen waarvoor we temp data hebben
available_steps = sorted(all_data["temp"].keys())
available_steps = [s for s in available_steps if s > 0]  # skip step 0
n_steps = len(available_steps)
print(f"   Crop grid: {n_lat}x{n_lon}, {n_steps} stappen")

def crop(d):
    return np.nan_to_num(d[np.ix_(lat_idx, lon_idx)], nan=0).astype(np.float32)

def get_or_zero(naam, step):
    if step in all_data[naam]:
        return all_data[naam][step]
    return np.zeros((len(lats), len(lons)))

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

PREFIX = "ecmwf"

# Uurlijkse neerslag (verschil cumulatief)
precip_list = []
prev_step = 0
for step in available_steps:
    if step in all_data["cum_precip"] and prev_step in all_data["cum_precip"]:
        diff = all_data["cum_precip"][step] - all_data["cum_precip"][prev_step]
        precip_list.append(np.maximum(diff, 0))
    else:
        precip_list.append(np.zeros((len(lats), len(lons))))
    prev_step = step

write_bin(f"{PREFIX}_data_neerslag.bin", precip_list)
write_bin(f"{PREFIX}_data_temp.bin", [get_or_zero("temp", s) for s in available_steps])
write_bin(f"{PREFIX}_data_dauwpunt.bin", [get_or_zero("dauwpunt", s) for s in available_steps])
write_bin(f"{PREFIX}_data_bewolking.bin",
          [(get_or_zero("hoog",s), get_or_zero("mid",s), get_or_zero("laag",s)) for s in available_steps], 3)
write_bin(f"{PREFIX}_data_wind.bin",
          [(get_or_zero("uw",s), get_or_zero("vw",s)) for s in available_steps], 2)
write_bin(f"{PREFIX}_data_windstoten.bin",
          [(get_or_zero("windstoten",s), np.zeros_like(get_or_zero("windstoten",s))) for s in available_steps], 2)
write_bin(f"{PREFIX}_data_druk.bin", [get_or_zero("druk", s) for s in available_steps])
write_bin(f"{PREFIX}_data_cape.bin", [get_or_zero("cape", s) for s in available_steps])

# 4. Metadata
print("\n4. Metadata...")
times_str = []
for step in available_steps:
    dt_valid = run_dt + timedelta(hours=step)
    times_str.append(dt_valid.astimezone(LOCAL_TZ).strftime("%Y-%m-%dT%H:%M"))

meta = {
    "model": "ECMWF IFS",
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
        "neerslag":   {"file": f"{PREFIX}_data_neerslag.bin",   "components": 1, "label": "Neerslag (mm/3u)"},
        "temp":       {"file": f"{PREFIX}_data_temp.bin",       "components": 1, "label": "Temperatuur 2m (°C)"},
        "dauwpunt":   {"file": f"{PREFIX}_data_dauwpunt.bin",   "components": 1, "label": "Dauwpuntstemperatuur 2m (°C)"},
        "bewolking":  {"file": f"{PREFIX}_data_bewolking.bin",  "components": 3, "label": "Bewolking (hoog/midden/laag)"},
        "wind":       {"file": f"{PREFIX}_data_wind.bin",       "components": 2, "label": "Wind 10m (Bft)"},
        "windstoten": {"file": f"{PREFIX}_data_windstoten.bin", "components": 2, "label": "Windstoten 10m (km/u)"},
        "druk":       {"file": f"{PREFIX}_data_druk.bin",       "components": 1, "label": "Luchtdruk (hPa)"},
        "cape":       {"file": f"{PREFIX}_data_cape.bin",       "components": 1, "label": "CAPE (J/kg)"},
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

print(f"\nKlaar! ECMWF run {run_str}, {n_steps} stappen tot {available_steps[-1]}h")
PYEOF

echo "$(date): ECMWF update klaar"
