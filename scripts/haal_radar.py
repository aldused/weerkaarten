#!/usr/bin/env python3
"""
haal_radar.py — Haal KNMI radardata op (gauge-gecorrigeerd) + 2u nowcast,
exporteer als binair bestand voor de webviewer.

Datasets:
  • nl_rdr_data_rtcor_5m v1.0  → 5-min real-time accumulaties, gauge-gecorrigeerd
  • radar_forecast v2.0        → pySTEPS nowcast, +0..+120 min in 5-min stappen

De HDF5 bestanden geven beide ACCUMULATION_[MM] per 5 min op een 765×700
stereografisch grid. We resamplen naar PlateCarree en encoderen iedere pixel
als uint8 "fake-PV" via Marshall-Palmer zodat de JS-frontend dezelfde
PV→dBZ→mm/u keten kan gebruiken.

Output: radar_data.bin + radar_meta.json → upload naar Cloudflare R2
"""

import os
import sys
import json
import struct
import gzip
import tempfile
import numpy as np
import h5py
import requests
import boto3
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pyproj import Proj

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, "scripts")
from knmi_api import knmi_get

# ── Configuratie ─────────────────────────────────────────────────────────────
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
API_BASE = "https://api.dataplatform.knmi.nl/open-data/v1"

DS_HISTORY  = ("nl_rdr_data_rtcor_5m", "1.0")  # gauge-gecorrigeerd, 1 image/file
DS_FORECAST = ("radar_forecast",       "2.0")  # 25 images/file (+0..+120 min)

N_HIST_FRAMES = 24   # 2 uur historie (24 × 5 min)
N_FCST_FRAMES = 24   # 2 uur nowcast (24 × 5 min, slaan +0 over want = nu)

# Target grid (PlateCarree, NL + ruime omgeving — UK-kust, BE, NW-Duitsland)
LON_MIN, LON_MAX = 1.0, 10.0
LAT_MIN, LAT_MAX = 49.5, 54.5
TARGET_NLON = 900
TARGET_NLAT = 500

# 700 hPa-blend (warp KNMI nowcast met HARMONIE 700 hPa stuurwind)
T_HALF_MIN = 60.0           # α(t) = t / (t + t½) — bij +60 min: 50% blend
BLEND_LAT, BLEND_LON = 52.1, 5.4   # NL-centrum voor 700 hPa-fetch
KM_PER_CELL_X = ((LON_MAX - LON_MIN) / TARGET_NLON
                 * 111.32 * np.cos(np.deg2rad((LAT_MIN + LAT_MAX) / 2)))
KM_PER_CELL_Y = (LAT_MAX - LAT_MIN) / TARGET_NLAT * 111.32

# KNMI radar projectie
KNMI_PROJ = Proj("+proj=stere +lat_0=90 +lon_0=0 +lat_ts=60 "
                 "+a=6378137 +b=6356752 +x_0=0 +y_0=0 +units=km")
ROW_OFFSET = 3649.98  # uit geo_row_offset attribuut

# Cloudflare R2
R2_ENDPOINT = "https://05da71c7c88b8ce49fbb2c2d0a570416.r2.cloudflarestorage.com"
R2_ACCESS_KEY = "baf991003ce3e4075d91b89f8726bc0f"
R2_SECRET_KEY = "0f33229e2e03fe7bc7f9fdf7f9fa0acd5336c40718c6e25fe0b6a631ade8ac97"
R2_BUCKET = "weerlab-harmonie"

nl_dagen = ["ma", "di", "wo", "do", "vr", "za", "zo"]
nl_maanden = ["", "jan", "feb", "mrt", "apr", "mei", "jun",
              "jul", "aug", "sep", "okt", "nov", "dec"]


# ─────────────────────────────────────────────────────────────────────────────
# Lookup tabel: target (PlateCarree) → bron (KNMI stere) row/col
# ─────────────────────────────────────────────────────────────────────────────
def _maak_lookup_tabel():
    target_lons = np.linspace(LON_MIN, LON_MAX, TARGET_NLON)
    target_lats = np.linspace(LAT_MAX, LAT_MIN, TARGET_NLAT)  # top-down
    lon_grid, lat_grid = np.meshgrid(target_lons, target_lats)
    x_stere, y_stere = KNMI_PROJ(lon_grid.ravel(), lat_grid.ravel())
    x_stere = np.asarray(x_stere).reshape(lon_grid.shape)
    y_stere = np.asarray(y_stere).reshape(lon_grid.shape)
    col_idx = x_stere
    row_idx = -y_stere - ROW_OFFSET
    return row_idx.astype(np.float32), col_idx.astype(np.float32)


print("Lookup tabel berekenen...", end=" ", flush=True)
LUT_ROW, LUT_COL = _maak_lookup_tabel()
print("klaar")


# ─────────────────────────────────────────────────────────────────────────────
# mm/h → uint8 fake-PV (compat met JS: dBZ = 0.5*PV - 32)
# ─────────────────────────────────────────────────────────────────────────────
def mmh_to_pv(mmh):
    """
    mm/h (float array) → uint8 PV-byte zodat JS dBZ = 0.5*PV - 32 correct
    decodeert via Marshall-Palmer (Z = 200 R^1.6).
      0   = no-data (skipped door JS)
      1   = aanwezig maar dBZ ver onder drempel
      255 = out-of-image (skipped door JS)
    """
    out = np.zeros_like(mmh, dtype=np.uint8)
    valid = (mmh > 0) & np.isfinite(mmh)
    if not valid.any():
        return out
    # Marshall-Palmer: dBZ = 10 * log10(200 * R^1.6)
    dbz = 10.0 * np.log10(200.0 * np.power(mmh[valid], 1.6))
    pv = np.round(2.0 * dbz + 64.0)
    pv = np.clip(pv, 1, 254).astype(np.uint8)
    out[valid] = pv
    return out


# ─────────────────────────────────────────────────────────────────────────────
# HDF5 → mm/h reproject naar target grid
# ─────────────────────────────────────────────────────────────────────────────
def _img_to_mmh(image_data):
    """
    KNMI HDF5 image_data (uint16 op 765×700, 0.01 mm per 5 min, met
    65534=missing, 65535=out_of_image) → mm/h op target grid (uint8 PV).
    """
    # Mask out missing/out-of-image vóór resampling
    src = image_data.astype(np.float32)
    out_of_image = src >= 65535
    missing      = src >= 65534
    src[missing] = 0.0  # behandel missing als geen neerslag i.p.v. NaN

    # PV * 0.01 = mm per 5 min  →  × 12 = mm/h
    src_mmh = src * 0.01 * 12.0

    # Nearest-neighbour resample
    row_i = np.clip(np.round(LUT_ROW).astype(int), 0, src.shape[0] - 1)
    col_i = np.clip(np.round(LUT_COL).astype(int), 0, src.shape[1] - 1)
    mmh = src_mmh[row_i, col_i]
    oob = out_of_image[row_i, col_i]

    pv = mmh_to_pv(mmh)
    pv[oob] = 255  # markeer out-of-image
    return pv


def parse_h5_history(path):
    """RTCOR-5m bevat 1 frame in image1; geef uint8 PV-frame terug."""
    with h5py.File(path, "r") as f:
        return _img_to_mmh(f["image1/image_data"][:])


def parse_h5_forecast(path, n_frames):
    """
    radar_forecast bevat 25 frames (image1=t+0, image25=t+120 min).
    We slaan image1 over (= "nu", overlapt met laatste history-frame) en
    pakken image2..image{n_frames+1} als toekomstframes.
    """
    frames, tijden_valid = [], []
    with h5py.File(path, "r") as f:
        for i in range(2, 2 + n_frames):
            key = f"image{i}"
            if key not in f:
                break
            g = f[key]
            frames.append(_img_to_mmh(g["image_data"][:]))
            tv = g.attrs.get("image_datetime_valid", b"").decode().strip()
            tijden_valid.append(tv)
    return frames, tijden_valid


# ─────────────────────────────────────────────────────────────────────────────
# KNMI API helpers
# ─────────────────────────────────────────────────────────────────────────────
def lijst_bestanden(dataset, version, max_keys):
    url = f"{API_BASE}/datasets/{dataset}/versions/{version}/files"
    params = {"maxKeys": max_keys, "orderBy": "created", "sorting": "desc"}
    r = knmi_get(url, params=params, timeout=30)
    r.raise_for_status()
    files = r.json().get("files", [])
    files.sort(key=lambda f: f["filename"])
    return files


def download_h5(dataset, version, filename):
    url = f"{API_BASE}/datasets/{dataset}/versions/{version}/files/{filename}/url"
    r = knmi_get(url, timeout=15)
    r.raise_for_status()
    dl_url = r.json()["temporaryDownloadUrl"]
    r2 = requests.get(dl_url, timeout=30)
    r2.raise_for_status()
    path = os.path.join(tempfile.gettempdir(), filename)
    with open(path, "wb") as f:
        f.write(r2.content)
    return path


def parse_timestamp(filename):
    """RAD_NL25_RAC_RT_202604200515.h5 → datetime UTC."""
    parts = filename.replace(".h5", "").split("_")
    return datetime.strptime(parts[-1], "%Y%m%d%H%M").replace(tzinfo=timezone.utc)


def parse_forecast_valid(s):
    """'20-APR-2026;05:15:00.000' → datetime UTC."""
    try:
        return datetime.strptime(s.split(".")[0], "%d-%b-%Y;%H:%M:%S").replace(tzinfo=timezone.utc)
    except Exception:
        return None


def format_tijd(dt, prefix=""):
    lt = dt.astimezone(LOCAL_TZ)
    dag = nl_dagen[lt.weekday()]
    mnd = nl_maanden[lt.month]
    return f"{prefix}{dag} {lt.day} {mnd} {lt.hour:02d}:{lt.minute:02d}"


# ─────────────────────────────────────────────────────────────────────────────
# 700 hPa-blend
# ─────────────────────────────────────────────────────────────────────────────
def _dirspd_to_uv(dir_deg, spd):
    """Meteo-conventie: dir = waar wind vandaan komt. u=oost+, v=noord+."""
    if dir_deg is None or spd is None:
        return None
    rad = np.deg2rad(dir_deg)
    u = -spd * np.sin(rad)
    v = -spd * np.cos(rad)
    return float(u), float(v)


def fetch_700hpa_wind():
    """700 hPa-wind (km/u) over NL via Open-Meteo (KNMI HARMONIE-model).
    Returns (u, v) eastward/northward in km/u, of None bij fout."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": BLEND_LAT,
        "longitude": BLEND_LON,
        "hourly": "wind_speed_700hPa,wind_direction_700hPa",
        "models": "knmi_harmonie_arome_europe",
        "forecast_days": 1,
        "timezone": "UTC",
    }
    try:
        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        data = r.json()
        h = data.get("hourly", {}) or {}
        times = h.get("time") or []
        spds = h.get("wind_speed_700hPa") or []
        dirs = h.get("wind_direction_700hPa") or []
        if not times:
            return None
        now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        for i, ts in enumerate(times):
            try:
                tt = datetime.fromisoformat(ts).replace(tzinfo=timezone.utc)
            except Exception:
                continue
            if tt >= now:
                spd = spds[i] if i < len(spds) else None
                dr  = dirs[i] if i < len(dirs) else None
                return _dirspd_to_uv(dr, spd)
        return None
    except Exception as e:
        print(f"  700 hPa-fetch fout: {e}")
        return None


def estimate_radar_flow(frame_now, frame_prev):
    """Phase correlation tussen twee opeenvolgende PV-frames (5 min apart).
    Returns (u, v) in km/u eastward/northward, of None bij te weinig signaal."""
    a = frame_prev.astype(np.float32)
    b = frame_now.astype(np.float32)
    a[a == 255] = 0.0
    b[b == 255] = 0.0
    if (a > 0).sum() < 200 or (b > 0).sum() < 200:
        return None
    a -= a.mean()
    b -= b.mean()
    A = np.fft.rfft2(a)
    B = np.fft.rfft2(b)
    R = A.conj() * B
    R = R / (np.abs(R) + 1e-9)
    r = np.fft.irfft2(R, s=a.shape)
    py, px = np.unravel_index(np.argmax(r), r.shape)
    H, W = r.shape
    if py > H // 2: py -= H
    if px > W // 2: px -= W
    # px,py = displacement (cellen) van b t.o.v. a binnen 5 min
    # rij 0 = LAT_MAX (noord), dus py>0 = naar zuid
    dt_h = 5.0 / 60.0
    u_kmh = px * KM_PER_CELL_X / dt_h
    v_kmh = -py * KM_PER_CELL_Y / dt_h
    if np.hypot(u_kmh, v_kmh) > 200:
        return None
    return float(u_kmh), float(v_kmh)


def warp_forecast_frames(fcst_frames, uv_radar, uv_700, t_half_min=T_HALF_MIN):
    """Warp KNMI-nowcast frames met cumulatieve blend-shift
    Δ(t) = α(t) · (uv_700 − uv_radar) · t.   α(t) = t / (t + t½)."""
    from scipy.ndimage import shift as ndshift
    du = uv_700[0] - uv_radar[0]
    dv = uv_700[1] - uv_radar[1]
    out = []
    log = []
    for i, fr in enumerate(fcst_frames):
        t_min = (i + 1) * 5.0
        alpha = t_min / (t_min + t_half_min)
        dx_km = alpha * du * (t_min / 60.0)
        dy_km = alpha * dv * (t_min / 60.0)
        sx = dx_km / KM_PER_CELL_X
        sy = -dy_km / KM_PER_CELL_Y   # rij toeneemt naar zuid
        shifted = ndshift(fr, shift=(sy, sx), order=0,
                          mode="constant", cval=0, prefilter=False)
        out.append(shifted.astype(np.uint8))
        log.append((round(float(sx), 2), round(float(sy), 2)))
    return out, log


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main():
    now_utc = datetime.now(timezone.utc)
    print(f"=== Radar update {now_utc.astimezone(LOCAL_TZ).strftime('%H:%M')} ===")

    # 1. Lijst historische bestanden (gauge-gecorrigeerd)
    print(f"1. Historie: lijst {DS_HISTORY[0]} v{DS_HISTORY[1]}...")
    hist_files = lijst_bestanden(*DS_HISTORY, N_HIST_FRAMES + 6)
    hist_files = [f for f in hist_files if parse_timestamp(f["filename"]) <= now_utc]
    hist_files = hist_files[-N_HIST_FRAMES:]
    if not hist_files:
        print("  Geen historische bestanden gevonden!")
        return
    print(f"  {len(hist_files)} historische frames")

    # 2. Lijst nowcast (laatste run = 1 bestand met 25 frames)
    print(f"2. Nowcast: lijst {DS_FORECAST[0]} v{DS_FORECAST[1]}...")
    fcst_files = lijst_bestanden(*DS_FORECAST, 8)
    if not fcst_files:
        print("  Geen nowcast bestand gevonden — ga door zonder forecast.")
    else:
        nieuwste_hist_time = parse_timestamp(hist_files[-1]["filename"])
        fcst_files = [f for f in fcst_files if parse_timestamp(f["filename"]) <= nieuwste_hist_time]
        if fcst_files:
            fcst_files = fcst_files[-1:]
            print(f"  Nowcast run: {fcst_files[-1]['filename']}")
        else:
            print("  Geen passende nowcast run gevonden — ga door zonder forecast.")

    # 3. Skip als alles up-to-date
    nieuwste_hist = hist_files[-1]["filename"]
    nieuwste_fcst = fcst_files[-1]["filename"] if fcst_files else None
    meta_path = "radar_meta.json"
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            old = json.load(f)
        if old.get("nieuwste") == nieuwste_hist and old.get("nieuwste_forecast") == nieuwste_fcst:
            print("  Al up-to-date.")
            return

    # 4. Historische frames downloaden
    print("3. Historie verwerken...")
    hist_frames, hist_tijden = [], []
    for i, fi in enumerate(hist_files):
        fn = fi["filename"]
        ts = parse_timestamp(fn)
        print(f"  [{i+1}/{len(hist_files)}] {fn}...", end=" ", flush=True)
        try:
            path = download_h5(*DS_HISTORY, fn)
            hist_frames.append(parse_h5_history(path))
            hist_tijden.append(ts)
            os.remove(path)
            print("ok")
        except Exception as e:
            print(f"FOUT: {e}")
            hist_frames.append(np.zeros((TARGET_NLAT, TARGET_NLON), dtype=np.uint8))
            hist_tijden.append(ts)

    # 5. Nowcast frames downloaden + parsen
    print("4. Nowcast verwerken...")
    fcst_frames, fcst_tijden = [], []
    if fcst_files:
        try:
            path = download_h5(*DS_FORECAST, nieuwste_fcst)
            frames, tijden_str = parse_h5_forecast(path, N_FCST_FRAMES)
            os.remove(path)
            for fr, ts_str in zip(frames, tijden_str):
                ts = parse_forecast_valid(ts_str)
                if ts is None:
                    # fallback: extrapolatie vanaf bestandsnaam
                    base = parse_timestamp(nieuwste_fcst)
                    ts = base + timedelta(minutes=5 * (len(fcst_frames) + 1))
                fcst_frames.append(fr)
                fcst_tijden.append(ts)
            print(f"  {len(fcst_frames)} nowcast frames (+5 t/m +{5*len(fcst_frames)} min)")
        except Exception as e:
            print(f"  Nowcast download mislukt: {e}")

    # 5b. 700 hPa-blend (warp KNMI nowcast met α(t)·(uv_700 − uv_radar))
    blend_meta = {"active": False, "reason": "geen forecast"}
    if fcst_frames and len(hist_frames) >= 2:
        try:
            uv7 = fetch_700hpa_wind()
            uvR = estimate_radar_flow(hist_frames[-1], hist_frames[-2])
            if uv7 is None:
                blend_meta = {"active": False, "reason": "geen 700 hPa-data"}
            elif uvR is None:
                blend_meta = {"active": False, "reason": "te weinig radar-signaal"}
            else:
                spd_diff = float(np.hypot(uv7[0] - uvR[0], uv7[1] - uvR[1]))
                print(f"  Radar-flow: ({uvR[0]:+.1f}, {uvR[1]:+.1f}) km/u")
                print(f"  700 hPa:    ({uv7[0]:+.1f}, {uv7[1]:+.1f}) km/u")
                print(f"  Δ-snelheid: {spd_diff:.1f} km/u")
                fcst_frames, shift_log = warp_forecast_frames(fcst_frames, uvR, uv7)
                blend_meta = {
                    "active": True,
                    "t_half_min": T_HALF_MIN,
                    "uv_radar_kmh": [round(uvR[0], 1), round(uvR[1], 1)],
                    "uv_700hpa_kmh": [round(uv7[0], 1), round(uv7[1], 1)],
                    "delta_kmh": round(spd_diff, 1),
                    "max_shift_cells": shift_log[-1] if shift_log else None,
                    "bron_700hpa": "Open-Meteo / knmi_harmonie_arome_europe",
                }
                print(f"  Blend actief, max shift cellen = {shift_log[-1]}")
        except Exception as e:
            blend_meta = {"active": False, "reason": f"fout: {e}"}
            print(f"  Blend fout: {e}")
        if not blend_meta["active"]:
            print(f"  Blend overgeslagen: {blend_meta['reason']}")

    # 6. Combineer
    all_frames = hist_frames + fcst_frames
    all_tijden = hist_tijden + fcst_tijden
    frame_types = ["history"] * len(hist_frames) + ["forecast"] * len(fcst_frames)
    t_now_index = len(hist_frames) - 1  # laatste history-frame = "nu"

    n_steps = len(all_frames)
    if n_steps == 0:
        print("  Geen frames!")
        return

    # 7. Schrijf binair bestand
    print("5. Binair bestand schrijven...")
    header = struct.pack("<HHHH", TARGET_NLAT, TARGET_NLON, n_steps, 1)
    header += b"\x00" * 8

    bin_path = "radar_data.bin"
    with open(bin_path, "wb") as f:
        f.write(header)
        for frame in all_frames:
            f.write(frame.tobytes())
    raw_size = os.path.getsize(bin_path)
    print(f"  {bin_path} ({raw_size/1024/1024:.1f} MB, {n_steps} frames)")

    # 7b. Pre-gzip variant (Cloudflare serveert het met Content-Encoding: gzip)
    bin_gz_path = "radar_data.bin.gz"
    with open(bin_path, "rb") as src, gzip.open(bin_gz_path, "wb", compresslevel=6) as dst:
        dst.write(src.read())
    gz_size = os.path.getsize(bin_gz_path)
    print(f"  {bin_gz_path} ({gz_size/1024/1024:.1f} MB)")

    # 8. Metadata JSON
    print("6. Metadata schrijven...")
    lt_nu = datetime.now(LOCAL_TZ)
    product_naam = "KNMI Regenradar (gauge-gecorrigeerd) + pySTEPS nowcast"
    if blend_meta.get("active"):
        product_naam += " + 700 hPa-blend"

    meta = {
        "product": product_naam,
        "blend_700hpa": blend_meta,
        "bijgewerkt": format_tijd(lt_nu),
        "nieuwste": nieuwste_hist,
        "nieuwste_forecast": nieuwste_fcst,
        "frames": n_steps,
        "n_history": len(hist_frames),
        "n_forecast": len(fcst_frames),
        "t_now_index": t_now_index,
        "interval_min": 5,
        "tijden": [t.isoformat() for t in all_tijden],
        "tijden_tekst": [
            format_tijd(t, prefix="" if ft == "history" else "+ ")
            if ft == "history"
            else format_tijd(t)
            for t, ft in zip(all_tijden, frame_types)
        ],
        "frame_types": frame_types,
        "grid": {
            "n_lat": TARGET_NLAT,
            "n_lon": TARGET_NLON,
            "lat_min": LAT_MIN,
            "lat_max": LAT_MAX,
            "lon_min": LON_MIN,
            "lon_max": LON_MAX,
        },
        "calibratie": {
            "encoding": "uint8 PV (Marshall-Palmer terug-encoded)",
            "formule": "dBZ = 0.5 * PV - 32  ;  R = (10^(dBZ/10) / 200)^(1/1.6)",
            "geen_data": 0,
            "buiten_beeld": 255,
        },
        "bronnen": {
            "history":  f"{DS_HISTORY[0]} v{DS_HISTORY[1]}",
            "forecast": f"{DS_FORECAST[0]} v{DS_FORECAST[1]}",
        },
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    # 9. Upload naar R2
    print("7. Uploaden naar Cloudflare R2...")
    try:
        s3 = boto3.client("s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY,
            aws_secret_access_key=R2_SECRET_KEY,
            region_name="auto")

        # Hoofd-bin: gzipped variant uploaden onder dezelfde naam met
        # Content-Encoding: gzip → browsers decompresseren automatisch.
        s3.upload_file(bin_gz_path, R2_BUCKET, bin_path,
                       ExtraArgs={"ContentType": "application/octet-stream",
                                  "ContentEncoding": "gzip"})
        print(f"  {bin_path} (gz, {gz_size/1024:.0f} KB)")

        s3.upload_file(meta_path, R2_BUCKET, meta_path,
                       ExtraArgs={"ContentType": "application/json"})
        print(f"  {meta_path} ({os.path.getsize(meta_path)/1024:.0f} KB)")

        # Optionele extra's
        for png in ["radar_kaart_bg.png", "radar_kaart_overlay.png"]:
            if os.path.exists(png):
                s3.upload_file(png, R2_BUCKET, png,
                               ExtraArgs={"ContentType": "image/png"})

        print("Upload klaar!")
    except Exception as e:
        print(f"  R2 upload fout: {e}")
        print("  Bestanden staan lokaal klaar.")

    print(f"\nKlaar! {len(hist_frames)} historie + {len(fcst_frames)} nowcast frames")
    print(f"  laatste historie: {format_tijd(hist_tijden[-1])}")
    if fcst_tijden:
        print(f"  laatste nowcast:  {format_tijd(fcst_tijden[-1])}")


if __name__ == "__main__":
    main()
