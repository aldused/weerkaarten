#!/usr/bin/env python3
"""
haal_radar.py — Haal KNMI radardata op en exporteer als binair bestand voor de webviewer.

Dataset: radar_reflectivity_composites v2.0  (5-min neerslag composieten, HDF5)
Output:  radar_data.bin + radar_meta.json → upload naar Cloudflare R2

Draait elke 5 minuten via cron.
"""

import os
import sys
import json
import struct
import time
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

DATASET = "radar_reflectivity_composites"
VERSION = "2.0"
API_BASE = "https://api.dataplatform.knmi.nl/open-data/v1"
N_FRAMES = 24  # 2 uur à 5 min

# Target grid (PlateCarree, NL)
LON_MIN, LON_MAX = 3.0, 7.5
LAT_MIN, LAT_MAX = 50.4, 53.9
TARGET_NLON = 450
TARGET_NLAT = 350

# KNMI radar projectie
KNMI_PROJ = Proj("+proj=stere +lat_0=90 +lon_0=0 +lat_ts=60 "
                 "+a=6378137 +b=6356752 +x_0=0 +y_0=0 +units=km")

# Cloudflare R2
R2_ENDPOINT = "https://05da71c7c88b8ce49fbb2c2d0a570416.r2.cloudflarestorage.com"
R2_ACCESS_KEY = "baf991003ce3e4075d91b89f8726bc0f"
R2_SECRET_KEY = "0f33229e2e03fe7bc7f9fdf7f9fa0acd5336c40718c6e25fe0b6a631ade8ac97"
R2_BUCKET = "weerlab-harmonie"

# Neerslag levels voor uint8 encoding (mm/u index)
# PV in HDF5: dBZ = 0.5 * PV - 32
# dBZ → mm/u via Marshall-Palmer: R = (10^(dBZ/10) / 200)^(1/1.6)
# We slaan de ruwe PV op (uint8) — de JS-kant doet de kleuring
# PV=0 = geen data, PV=255 = buiten beeld

nl_dagen = ["ma", "di", "wo", "do", "vr", "za", "zo"]
nl_maanden = ["", "jan", "feb", "mrt", "apr", "mei", "jun",
              "jul", "aug", "sep", "okt", "nov", "dec"]


def _maak_lookup_tabel():
    """
    Maak eenmalig een lookup tabel: voor elke target pixel de bron row/col.
    Target: PlateCarree [LON_MIN..LON_MAX, LAT_MAX..LAT_MIN] (top-down)
    Bron: KNMI stereografisch grid (765×700)
    """
    target_lons = np.linspace(LON_MIN, LON_MAX, TARGET_NLON)
    target_lats = np.linspace(LAT_MAX, LAT_MIN, TARGET_NLAT)  # top-down
    lon_grid, lat_grid = np.meshgrid(target_lons, target_lats)

    # Forward projectie: lat/lon → stere x,y
    x_stere, y_stere = KNMI_PROJ(lon_grid.ravel(), lat_grid.ravel())
    x_stere = np.array(x_stere).reshape(lon_grid.shape)
    y_stere = np.array(y_stere).reshape(lon_grid.shape)

    # KNMI pixel coords:  x = col * 1.0,  y = -(row_offset + row) * 1.0
    # → col = x,  row = -y - row_offset
    ROW_OFFSET = 3649.98
    col_idx = x_stere / 1.0
    row_idx = -y_stere - ROW_OFFSET

    return row_idx.astype(np.float32), col_idx.astype(np.float32)


# Eenmalig berekenen
print("Lookup tabel berekenen...", end=" ", flush=True)
LUT_ROW, LUT_COL = _maak_lookup_tabel()
print("klaar")


def haal_bestanden_lijst():
    """Haal lijst van laatste N_FRAMES radar bestanden op."""
    url = f"{API_BASE}/datasets/{DATASET}/versions/{VERSION}/files"
    params = {"maxKeys": N_FRAMES, "orderBy": "created", "sorting": "desc"}
    r = knmi_get(url, params=params, timeout=30)
    r.raise_for_status()
    files = r.json().get("files", [])
    # Sorteer op naam (bevat timestamp) → chronologisch
    files.sort(key=lambda f: f["filename"])
    return files


def download_h5(filename):
    """Download een radar HDF5 bestand en return het pad."""
    url = f"{API_BASE}/datasets/{DATASET}/versions/{VERSION}/files/{filename}/url"
    r = knmi_get(url, timeout=15)
    r.raise_for_status()
    dl_url = r.json()["temporaryDownloadUrl"]
    r2 = requests.get(dl_url, timeout=30)
    r2.raise_for_status()
    path = os.path.join(tempfile.gettempdir(), filename)
    with open(path, "wb") as f:
        f.write(r2.content)
    return path


def parse_h5(path):
    """
    Parse KNMI radar HDF5 en reproject naar target grid.
    Return: 2D uint8 array (TARGET_NLAT × TARGET_NLON) met ruwe PV-waarden.
    """
    with h5py.File(path, "r") as f:
        data = f["image1/image_data"][:]  # (765, 700) uint8

    # Nearest-neighbour interpolatie via lookup tabel
    row_i = np.clip(np.round(LUT_ROW).astype(int), 0, data.shape[0] - 1)
    col_i = np.clip(np.round(LUT_COL).astype(int), 0, data.shape[1] - 1)
    reprojected = data[row_i, col_i]

    return reprojected.astype(np.uint8)


def parse_timestamp(filename):
    """Extract timestamp uit bestandsnaam: RAD_NL25_PCP_NA_202604061415.h5"""
    parts = filename.replace(".h5", "").split("_")
    ts_str = parts[-1]  # 202604061415
    dt = datetime.strptime(ts_str, "%Y%m%d%H%M")
    dt = dt.replace(tzinfo=timezone.utc)
    return dt


def format_tijd(dt):
    """Formatteer datetime naar Nederlandse string."""
    lt = dt.astimezone(LOCAL_TZ)
    dag = nl_dagen[lt.weekday()]
    mnd = nl_maanden[lt.month]
    return f"{dag} {lt.day} {mnd} {lt.hour:02d}:{lt.minute:02d}"


def main():
    print(f"=== Radar update {datetime.now(LOCAL_TZ).strftime('%H:%M')} ===")

    # 1. Bestanden ophalen
    print("1. Bestandenlijst ophalen...")
    files = haal_bestanden_lijst()
    if not files:
        print("  Geen bestanden gevonden!")
        return
    print(f"  {len(files)} bestanden gevonden")

    # 2. Check of we al up-to-date zijn
    nieuwste = files[-1]["filename"]
    meta_path = "radar_meta.json"
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            old_meta = json.load(f)
        if old_meta.get("nieuwste") == nieuwste:
            print("  Al up-to-date, niets te doen.")
            return

    # 3. Download en verwerk alle frames
    print("2. Downloaden en verwerken...")
    frames = []
    tijden = []
    for i, fi in enumerate(files):
        fn = fi["filename"]
        ts = parse_timestamp(fn)
        print(f"  [{i+1}/{len(files)}] {fn}...", end=" ", flush=True)
        try:
            path = download_h5(fn)
            frame = parse_h5(path)
            frames.append(frame)
            tijden.append(ts)
            os.remove(path)
            print("ok")
        except Exception as e:
            print(f"FOUT: {e}")
            # Voeg lege frame toe als fallback
            frames.append(np.zeros((TARGET_NLAT, TARGET_NLON), dtype=np.uint8))
            tijden.append(ts)

    if not frames:
        print("  Geen frames verwerkt!")
        return

    # 4. Schrijf binair bestand
    print("3. Binair bestand schrijven...")
    n_steps = len(frames)
    # Header: 16 bytes (4x uint16 + 8 bytes padding)
    header = struct.pack("<HHHH", TARGET_NLAT, TARGET_NLON, n_steps, 1)
    header += b"\x00" * 8  # padding tot 16 bytes

    bin_path = "radar_data.bin"
    with open(bin_path, "wb") as f:
        f.write(header)
        for frame in frames:
            f.write(frame.tobytes())

    size_mb = os.path.getsize(bin_path) / (1024 * 1024)
    print(f"  {bin_path} ({size_mb:.1f} MB, {n_steps} frames)")

    # 5. Metadata JSON
    print("4. Metadata schrijven...")
    lt_nu = datetime.now(LOCAL_TZ)
    meta = {
        "product": "KNMI Regenradar",
        "bijgewerkt": format_tijd(lt_nu),
        "nieuwste": nieuwste,
        "frames": n_steps,
        "interval_min": 5,
        "tijden": [t.isoformat() for t in tijden],
        "tijden_tekst": [format_tijd(t) for t in tijden],
        "grid": {
            "n_lat": TARGET_NLAT,
            "n_lon": TARGET_NLON,
            "lat_min": LAT_MIN,
            "lat_max": LAT_MAX,
            "lon_min": LON_MIN,
            "lon_max": LON_MAX,
        },
        "calibratie": {
            "formule": "dBZ = 0.5 * PV - 32",
            "geen_data": 0,
            "buiten_beeld": 255,
        },
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    # 6. Upload naar R2
    print("5. Uploaden naar Cloudflare R2...")
    try:
        s3 = boto3.client("s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY,
            aws_secret_access_key=R2_SECRET_KEY,
            region_name="auto")

        bestanden = [
            (bin_path, "application/octet-stream"),
            (meta_path, "application/json"),
        ]
        # Upload ook de kaart-PNG's als ze bestaan
        for png in ["radar_kaart_bg.png", "radar_kaart_overlay.png"]:
            if os.path.exists(png):
                bestanden.append((png, "image/png"))

        for fpath, ct in bestanden:
            s3.upload_file(fpath, R2_BUCKET, fpath,
                           ExtraArgs={"ContentType": ct})
            sz = os.path.getsize(fpath) / 1024
            print(f"  {fpath} ({sz:.0f} KB)")

        print("Upload klaar!")
    except Exception as e:
        print(f"  R2 upload fout: {e}")
        print("  Bestanden staan lokaal klaar.")

    print(f"\nKlaar! {n_steps} frames, nieuwste: {format_tijd(tijden[-1])}")


if __name__ == "__main__":
    main()
