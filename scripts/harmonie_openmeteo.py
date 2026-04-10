#!/usr/bin/env python3
"""
harmonie_openmeteo.py — Vult de Harmonie canvas-pipeline aan met
500 / 850 hPa hoogtekaart-data via Open-Meteo Pro (model:
knmi_harmonie_arome_europe, dat wél pressure-level variabelen levert
in tegenstelling tot de Netherlands-variant).

Werkwijze
---------
1. Lees `harmonie_canvas_meta.json` om het bestaande grid/tijdenrooster
   over te nemen.
2. Bouw een coarse grid (~0.15° ≈ 17 km) binnen dezelfde extent —
   ruim voldoende voor synoptische 500/850 hPa velden en past in een
   paar bulk-calls (Open-Meteo staat tot ~1000 coördinaten per call toe).
3. Vraag per batch geopotentiële hoogte, temperatuur en wind (u/v) op
   voor beide drukniveaus, voor dezelfde tijden als de KNMI-run.
4. Schrijf twee binaire bestanden (4 componenten elk: gp_hgt, T, u, v)
   in het zelfde formaat als de rest van de pipeline.
5. Voeg beide parameters toe aan `harmonie_canvas_meta.json`.

Losse tool — wordt aangeroepen nadat `harmonie_update.sh` de KNMI-export
heeft gedaan, vóór de R2-upload.
"""

from __future__ import annotations

import json
import math
import os
import struct
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import requests

# open_meteo helper
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))
from open_meteo import _load_key, has_key  # noqa: E402


def _post_bulk(latitudes, longitudes, hourly: list[str]) -> list:
    """Bulk-call via POST (GET URL wordt te lang bij honderden coördinaten).

    Let op: Open-Meteo verwacht alle niet-numerieke/niet-boolean velden als
    arrays in een POST-body, inclusief `models`, `timezone` en `hourly`.
    De apikey hoort IN de payload, niet als URL-parameter.
    """
    key = _load_key()
    host = "customer-api.open-meteo.com" if key else "api.open-meteo.com"
    url = f"https://{host}/v1/forecast"
    payload = {
        "latitude": [float(x) for x in latitudes],
        "longitude": [float(x) for x in longitudes],
        "models": [MODEL],
        "hourly": list(hourly),
        "timezone": ["Europe/Amsterdam"],
        "forecast_days": 3,
    }
    if key:
        payload["apikey"] = key
    last_err = None
    for poging in range(3):
        try:
            r = requests.post(url, json=payload, timeout=90)
            if r.status_code == 429:
                time.sleep(4 * (poging + 1))
                continue
            if r.status_code >= 500:
                time.sleep(2 * (poging + 1))
                continue
            r.raise_for_status()
            data = r.json()
            return data if isinstance(data, list) else [data]
        except requests.RequestException as e:
            last_err = e
            time.sleep(2)
    raise RuntimeError(f"Open-Meteo POST mislukt: {last_err}")

MODEL = "knmi_harmonie_arome_europe"
META_FILE = "harmonie_canvas_meta.json"

# Grid-resolutie voor de hoogtekaarten (graden)
GRID_STEP = 0.15  # ~16–17 km — ruim voldoende voor 500/850 hPa

# Max coördinaten per bulk-call via POST (413 boven ~300)
BATCH_SIZE = 200

HOURLY_VARS_500 = [
    "geopotential_height_500hPa",
    "temperature_500hPa",
    "wind_speed_500hPa",
    "wind_direction_500hPa",
]
HOURLY_VARS_850 = [
    "geopotential_height_850hPa",
    "temperature_850hPa",
    "wind_speed_850hPa",
    "wind_direction_850hPa",
]


def kmh_to_ms(v: float) -> float:
    return v / 3.6


def wind_spd_dir_to_uv(spd_kmh: float, dir_deg: float) -> tuple[float, float]:
    """Open-Meteo geeft windrichting als *van waar de wind komt* in graden
    (meteorologische conventie). Retourneer u,v in m/s met standaard
    meteo-conventie (u = oost-comp, v = noord-comp)."""
    spd = kmh_to_ms(spd_kmh)
    rad = math.radians(dir_deg)
    # wind waait náár (dir + 180) — u = -spd*sin(rad), v = -spd*cos(rad)
    u = -spd * math.sin(rad)
    v = -spd * math.cos(rad)
    return u, v


def fetch_level(
    level: int,
    batches: list[list[tuple[int, int, float, float]]],
    times: list[str],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Haal alle coordinaten op voor één drukniveau, gesorteerd batch-gewijs.

    Retourneert vier (n_steps, n_lat, n_lon) arrays:
      gp_hgt (m), T (°C), u (m/s), v (m/s)
    """
    if level == 500:
        hourly_vars = HOURLY_VARS_500
        prefix = "500hPa"
    elif level == 850:
        hourly_vars = HOURLY_VARS_850
        prefix = "850hPa"
    else:
        raise ValueError(f"Onbekend level: {level}")

    n_lat = max(lat_i for b in batches for (lat_i, _, _, _) in b) + 1
    n_lon = max(lon_i for b in batches for (_, lon_i, _, _) in b) + 1
    n_steps = len(times)

    gp = np.full((n_steps, n_lat, n_lon), np.nan, dtype=np.float32)
    tt = np.full((n_steps, n_lat, n_lon), np.nan, dtype=np.float32)
    uu = np.full((n_steps, n_lat, n_lon), np.nan, dtype=np.float32)
    vv = np.full((n_steps, n_lat, n_lon), np.nan, dtype=np.float32)

    time_set = set(times)

    for bi, batch in enumerate(batches):
        lats = [lat for (_, _, lat, _) in batch]
        lons = [lon for (_, _, _, lon) in batch]
        locs = _post_bulk(lats, lons, hourly_vars)
        if len(locs) != len(batch):
            print(
                f"  [waarschuwing] batch {bi}: {len(locs)} locaties terug "
                f"voor {len(batch)} gevraagd — vul bij met NaN"
            )
        for li, loc in enumerate(locs):
            if li >= len(batch):
                break
            lat_i, lon_i, _, _ = batch[li]
            h = loc.get("hourly") or {}
            tlist = h.get("time") or []
            gp_list = h.get(f"geopotential_height_{prefix}") or []
            t_list = h.get(f"temperature_{prefix}") or []
            ws_list = h.get(f"wind_speed_{prefix}") or []
            wd_list = h.get(f"wind_direction_{prefix}") or []
            # Bouw tijd -> idx map
            idx_map = {t: k for k, t in enumerate(tlist) if t in time_set}
            for step_i, tstr in enumerate(times):
                k = idx_map.get(tstr)
                if k is None:
                    continue
                g_val = gp_list[k] if k < len(gp_list) else None
                t_val = t_list[k] if k < len(t_list) else None
                s_val = ws_list[k] if k < len(ws_list) else None
                d_val = wd_list[k] if k < len(wd_list) else None
                if g_val is not None:
                    gp[step_i, lat_i, lon_i] = g_val
                if t_val is not None:
                    tt[step_i, lat_i, lon_i] = t_val
                if s_val is not None and d_val is not None:
                    u, v = wind_spd_dir_to_uv(float(s_val), float(d_val))
                    uu[step_i, lat_i, lon_i] = u
                    vv[step_i, lat_i, lon_i] = v
        print(f"  batch {bi + 1}/{len(batches)}: {len(batch)} punten klaar")

    return gp, tt, uu, vv


def write_bin(path: str, arrs: tuple[np.ndarray, ...]) -> None:
    """Schrijf 4-component binair bestand in het canvas-formaat.

    Verwacht arrs = (gp, T, u, v) elk met shape (n_steps, n_lat, n_lon).
    Layout per step: comp0 (n_lat*n_lon floats), comp1, comp2, comp3.
    """
    n_comp = len(arrs)
    n_steps, n_lat, n_lon = arrs[0].shape
    with open(path, "wb") as f:
        f.write(struct.pack("<HHHH", n_lat, n_lon, n_steps, n_comp))
        f.write(b"\x00" * 8)
        for s in range(n_steps):
            for a in arrs:
                f.write(a[s].astype(np.float32).tobytes())


def main() -> int:
    if not has_key():
        print("[harmonie_openmeteo] geen Open-Meteo key — overslaan")
        return 0

    work_dir = Path("/Users/aldus/KNMI_Project/weerkaarten 2")
    os.chdir(work_dir)
    meta_path = work_dir / META_FILE
    if not meta_path.exists():
        print(f"[harmonie_openmeteo] {META_FILE} ontbreekt — run KNMI-export eerst")
        return 1

    with meta_path.open() as f:
        meta = json.load(f)

    grid = meta["grid"]
    tijden = meta.get("tijden", [])
    if not tijden:
        print("[harmonie_openmeteo] geen tijden in meta")
        return 1

    lat_min = float(grid["lat_min"])
    lat_max = float(grid["lat_max"])
    lon_min = float(grid["lon_min"])
    lon_max = float(grid["lon_max"])

    n_lat = int(round((lat_max - lat_min) / GRID_STEP)) + 1
    n_lon = int(round((lon_max - lon_min) / GRID_STEP)) + 1
    lats = np.linspace(lat_min, lat_max, n_lat)
    lons = np.linspace(lon_min, lon_max, n_lon)

    coords: list[tuple[int, int, float, float]] = []
    for i, la in enumerate(lats):
        for j, lo in enumerate(lons):
            coords.append((i, j, float(la), float(lo)))

    batches = [coords[i : i + BATCH_SIZE] for i in range(0, len(coords), BATCH_SIZE)]
    print(
        f"[harmonie_openmeteo] grid {n_lat}×{n_lon} = {len(coords)} punten, "
        f"{len(batches)} batches, {len(tijden)} tijdstappen"
    )

    t0 = time.time()
    print("500 hPa ophalen...")
    gp500, t500, u500, v500 = fetch_level(500, batches, tijden)
    print("850 hPa ophalen...")
    gp850, t850, u850, v850 = fetch_level(850, batches, tijden)
    print(f"Ophalen klaar in {time.time() - t0:.1f}s")

    # Vul ontbrekende punten bij door nearest-neighbor
    def fill_nan(a: np.ndarray) -> np.ndarray:
        # a: (n_steps, n_lat, n_lon) — per step horizontaal invullen
        out = a.copy()
        for s in range(out.shape[0]):
            layer = out[s]
            mask = np.isnan(layer)
            if not mask.any():
                continue
            if mask.all():
                continue
            # Eenvoudige nearest-neighbor via iteratieve uitbreiding
            from scipy.ndimage import distance_transform_edt  # lokale import

            idx = distance_transform_edt(
                mask, return_distances=False, return_indices=True
            )
            out[s] = layer[tuple(idx)]
        return out

    try:
        gp500 = fill_nan(gp500)
        t500 = fill_nan(t500)
        u500 = fill_nan(u500)
        v500 = fill_nan(v500)
        gp850 = fill_nan(gp850)
        t850 = fill_nan(t850)
        u850 = fill_nan(u850)
        v850 = fill_nan(v850)
    except ImportError:
        print("[harmonie_openmeteo] scipy ontbreekt — NaN niet ingevuld")

    print("Exporteren...")
    write_bin("harmonie_data_hoogte500.bin", (gp500, t500, u500, v500))
    write_bin("harmonie_data_hoogte850.bin", (gp850, t850, u850, v850))

    # Meta bijwerken
    meta_grid_500 = {
        "file": "harmonie_data_hoogte500.bin",
        "components": 4,
        "label": "500 hPa — hoogte/temp/wind",
        "source": "open-meteo knmi_harmonie_arome_europe",
        "grid": {
            "n_lat": n_lat,
            "n_lon": n_lon,
            "lat_min": lat_min,
            "lat_max": lat_max,
            "lon_min": lon_min,
            "lon_max": lon_max,
        },
    }
    meta_grid_850 = dict(meta_grid_500)
    meta_grid_850["file"] = "harmonie_data_hoogte850.bin"
    meta_grid_850["label"] = "850 hPa — hoogte/temp/wind"

    meta.setdefault("parameters", {})
    meta["parameters"]["hoogte_500"] = meta_grid_500
    meta["parameters"]["hoogte_850"] = meta_grid_850

    with meta_path.open("w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    print(
        f"[harmonie_openmeteo] klaar: "
        f"{os.path.getsize('harmonie_data_hoogte500.bin') / 1024 / 1024:.1f} MB + "
        f"{os.path.getsize('harmonie_data_hoogte850.bin') / 1024 / 1024:.1f} MB"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
