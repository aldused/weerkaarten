#!/usr/bin/env python3
"""
ECMWF Open Data 00/12z (HRES, oper) → canvas-formaat van harmonie_canvas.html.

Native 3-uurs (0..144) + 6-uurs (150..240), totaal 56 stappen → lineair
geinterpoleerd naar uurlijks (241 stappen) zodat de viewer dezelfde slider-UX
heeft als HARMONIE/ICON-D2/Open-Meteo.

Bron: https://data.ecmwf.int/ via de ecmwf-opendata Python client.
Schrijft lokaal metadata + .bin-rasters; uploadt niets.

Gebruik:
    python3 scripts/ecmwf_opendata_long.py            # auto: nieuwste 00 of 12
    python3 scripts/ecmwf_opendata_long.py --cycle 0
    python3 scripts/ecmwf_opendata_long.py --cycle 12 --date 20260427
"""

from __future__ import annotations

import argparse
import json
import os
import struct
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import eccodes
from ecmwf.opendata import Client


LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
WORK_DIR = Path("/Users/aldus/KNMI_Project/weerlab")

# Bbox Benelux op het 0.25°-rooster van ECMWF Open Data.
LAT_MIN, LAT_MAX = 49.25, 53.75
LON_MIN, LON_MAX = 2.00, 7.50

# 00/12 HRES-run: 3-uurs t/m 144, dan 6-uurs t/m 240 → 56 native stappen.
STEPS_3H = list(range(0, 145, 3))
STEPS_6H = list(range(150, 241, 6))
STEPS = STEPS_3H + STEPS_6H
N_HOURLY = STEPS[-1] + 1  # 241

# Open Data oper-index ondersteunt geen hcc/mcc/lcc/i10fg/cape voor lange runs.
PARAMS = ["2t", "2d", "msl", "10u", "10v", "tp", "tcc"]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--cycle", type=int, choices=[0, 12], default=None,
                   help="00 of 12 UTC. Default: nieuwste van die twee.")
    p.add_argument("--date", default=None,
                   help="YYYYMMDD; default: nieuwste beschikbare run.")
    p.add_argument("--prefix", default="ecmwf")
    p.add_argument("--max-step", type=int, default=240,
                   help="Hoogste native stap om op te halen. Default 240. "
                        "Gebruik 60/120/240 voor gefaseerd publiceren.")
    return p.parse_args()


def pick_cycle(client: Client, requested: int | None) -> tuple[datetime, int]:
    """Bepaal welke 00/12 run we ophalen."""
    if requested is not None:
        cycles_to_try = [requested]
    else:
        # Open Data publiceert ~7u na runtijd.
        now = datetime.now(timezone.utc) - timedelta(hours=7)
        if now.hour >= 12:
            cycles_to_try = [12, 0]
        else:
            cycles_to_try = [0, 12]

    last_err: Exception | None = None
    for cyc in cycles_to_try:
        for back in range(0, 3):
            try:
                latest = client.latest(type="fc", stream="oper", time=cyc,
                                       step=240, param="2t")
                if latest is None:
                    continue
                if back == 0:
                    return latest, cyc
                target = latest - timedelta(days=back)
                return target, cyc
            except Exception as exc:
                last_err = exc
                continue
    raise RuntimeError(f"Kon geen 00/12 run vinden: {last_err}")


def download(client: Client, run_dt: datetime, cycle: int, steps: list[int], target: Path) -> None:
    print(f"Download ECMWF Open Data: {run_dt:%Y-%m-%d} {cycle:02d}z stappen 0..{steps[-1]} → {target.name}")
    client.retrieve(
        type="fc",
        stream="oper",
        date=run_dt.strftime("%Y%m%d"),
        time=cycle,
        step=steps,
        param=PARAMS,
        target=str(target),
    )
    size_mb = target.stat().st_size / 1024 / 1024
    print(f"  GRIB: {size_mb:.1f} MB")


def crop_indices(lats_full: np.ndarray, lons_full: np.ndarray) -> tuple[slice, slice, np.ndarray, np.ndarray]:
    lons_norm = ((lons_full + 180.0) % 360.0) - 180.0
    lat_idx = np.where((lats_full >= LAT_MIN - 1e-6) & (lats_full <= LAT_MAX + 1e-6))[0]
    lon_idx = np.where((lons_norm >= LON_MIN - 1e-6) & (lons_norm <= LON_MAX + 1e-6))[0]
    if len(lat_idx) == 0 or len(lon_idx) == 0:
        raise RuntimeError(
            f"Geen punten in bbox. lats {lats_full[0]:.2f}..{lats_full[-1]:.2f}, "
            f"lons orig {lons_full[0]:.2f}..{lons_full[-1]:.2f}"
        )
    return (slice(lat_idx[0], lat_idx[-1] + 1),
            slice(lon_idx[0], lon_idx[-1] + 1),
            lats_full[lat_idx],
            lons_norm[lon_idx])


def read_grib(path: Path) -> tuple[dict[tuple[str, int], np.ndarray], np.ndarray, np.ndarray]:
    out: dict[tuple[str, int], np.ndarray] = {}
    lats_crop = lons_crop = None
    lat_slice = lon_slice = None
    with path.open("rb") as f:
        while True:
            gid = eccodes.codes_grib_new_from_file(f)
            if gid is None:
                break
            try:
                sn = eccodes.codes_get(gid, "shortName")
                step = eccodes.codes_get(gid, "step")
                ni = eccodes.codes_get(gid, "Ni")
                nj = eccodes.codes_get(gid, "Nj")
                lat_first = eccodes.codes_get(gid, "latitudeOfFirstGridPointInDegrees")
                lon_first = eccodes.codes_get(gid, "longitudeOfFirstGridPointInDegrees")
                vals = eccodes.codes_get_values(gid).reshape(nj, ni)

                if lat_slice is None:
                    di = eccodes.codes_get(gid, "iDirectionIncrementInDegrees")
                    dj = eccodes.codes_get(gid, "jDirectionIncrementInDegrees")
                    lons_full = np.array([(lon_first + k * di) % 360 for k in range(ni)], dtype=np.float64)
                    lats_full = np.array([lat_first - k * dj for k in range(nj)], dtype=np.float64)
                    lat_slice, lon_slice, lats_crop, lons_crop = crop_indices(lats_full, lons_full)

                cropped = vals[lat_slice, lon_slice].astype(np.float32)
                out[(sn, int(step))] = cropped
            finally:
                eccodes.codes_release(gid)

    if lats_crop is None or lons_crop is None:
        raise RuntimeError("Geen GRIB-berichten gelezen")
    return out, lats_crop, lons_crop


def stack_steps(messages: dict[tuple[str, int], np.ndarray], short_name: str,
                steps_used: list[int], shape: tuple[int, int],
                default_zero: bool = False) -> np.ndarray:
    """Stack steps_used in vorm (len(steps_used), n_lat, n_lon)."""
    n_lat, n_lon = shape
    arr = np.full((len(steps_used), n_lat, n_lon), np.nan, dtype=np.float32)
    for k, st in enumerate(steps_used):
        msg = messages.get((short_name, st))
        if msg is not None:
            arr[k] = msg
        elif default_zero:
            arr[k] = 0.0
    return arr


def relhum_from_t_td(t: np.ndarray, td: np.ndarray) -> np.ndarray:
    es = 6.112 * np.exp((17.67 * t) / (t + 243.5))
    e = 6.112 * np.exp((17.67 * td) / (td + 243.5))
    return np.clip((e / es) * 100.0, 0, 100).astype(np.float32)


def interp_to_hourly(arr_native: np.ndarray, steps_used: list[int]) -> np.ndarray:
    """Interpoleer native data (n_native, lat, lon) naar uurlijks (steps_used[-1]+1, lat, lon)."""
    n_out = steps_used[-1] + 1
    src_steps = np.array(steps_used, dtype=np.float32)
    out = np.empty((n_out,) + arr_native.shape[1:], dtype=np.float32)
    src_to_idx = {int(s): i for i, s in enumerate(steps_used)}
    for h in range(n_out):
        if h in src_to_idx:
            out[h] = arr_native[src_to_idx[h]]
        else:
            lo_i = int(np.searchsorted(src_steps, h, side="right")) - 1
            hi_i = lo_i + 1
            lo_h = src_steps[lo_i]
            hi_h = src_steps[hi_i]
            w = (h - lo_h) / (hi_h - lo_h)
            out[h] = (1 - w) * arr_native[lo_i] + w * arr_native[hi_i]
    return out


def deaccumulate_to_hourly(tp_native: np.ndarray, steps_used: list[int]) -> np.ndarray:
    """tp_native: cumulatief vanaf t=0 (m). Geef uurlijkse mm/u (steps_used[-1]+1, lat, lon).

    Tussen native stappen verdelen we de blok-som gelijkmatig over de uren.
    """
    tp_mm = tp_native * 1000.0
    n_out = steps_used[-1] + 1
    n_lat, n_lon = tp_native.shape[1:]
    out = np.zeros((n_out, n_lat, n_lon), dtype=np.float32)
    for k in range(1, len(steps_used)):
        prev_h = steps_used[k - 1]
        cur_h = steps_used[k]
        delta = tp_mm[k] - tp_mm[k - 1]
        delta = np.clip(delta, 0, None)
        block_hours = cur_h - prev_h
        per_uur = delta / block_hours
        out[prev_h + 1:cur_h + 1] = per_uur
    return out


def write_bin(path: Path, arrays: tuple[np.ndarray, ...]) -> None:
    n_comp = len(arrays)
    n_steps, n_lat, n_lon = arrays[0].shape
    with path.open("wb") as f:
        f.write(struct.pack("<HHHH", n_lat, n_lon, n_steps, n_comp))
        f.write(b"\x00" * 8)
        for s in range(n_steps):
            for arr in arrays:
                f.write(arr[s].astype(np.float32).tobytes())
    print(f"  {path.name}: {path.stat().st_size / 1024 / 1024:.1f} MB")


def main() -> int:
    args = parse_args()
    os.chdir(WORK_DIR)

    client = Client()

    if args.date and args.cycle is not None:
        run_dt = datetime.strptime(args.date, "%Y%m%d").replace(tzinfo=timezone.utc)
        cycle = args.cycle
    else:
        run_dt, cycle = pick_cycle(client, args.cycle)

    run_iso = f"{run_dt:%Y-%m-%d}T{cycle:02d}:00:00Z"
    print(f"Doelrun: {run_iso}")

    max_step = max(s for s in STEPS if s <= args.max_step)
    steps_used = [s for s in STEPS if s <= max_step]
    print(f"Fase tot stap {max_step} ({len(steps_used)} native stappen)")

    # Skip als deze fase al gepubliceerd is voor deze run.
    meta_path = WORK_DIR / f"{args.prefix}_canvas_meta.json"
    if meta_path.exists():
        try:
            existing = json.loads(meta_path.read_text())
            if (existing.get("run_utc") == run_iso
                    and existing.get("geladen_tot", 0) >= max_step):
                # We hebben deze fase al, maar werk wel 'bijgewerkt' bij zodat
                # de viewer ziet dat het systeem nog steeds elke ronde kijkt —
                # anders lijkt de data oud terwijl wij de run wel bewaken.
                now_local = datetime.now(tz=LOCAL_TZ)
                stamp = now_local.strftime("%d %b %Y %H:%M")
                existing["bijgewerkt"] = stamp
                existing["gecontroleerd_op"] = stamp
                meta_path.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n")
                print(f"Al gepubliceerd t/m stap {existing['geladen_tot']} voor deze run — skip (timestamp ververst).")
                return 0
        except Exception:
            pass

    cache_dir = WORK_DIR / ".ecmwf_long_cache"
    cache_dir.mkdir(exist_ok=True)
    grib_path = cache_dir / f"ecmwf_long_{run_dt:%Y%m%d}_{cycle:02d}_t{max_step:03d}.grib2"
    if not grib_path.exists() or grib_path.stat().st_size < 1_000_000:
        for attempt in range(3):
            try:
                download(client, run_dt, cycle, steps_used, grib_path)
                break
            except Exception as exc:
                print(f"  download poging {attempt+1} mislukt: {exc}")
                time.sleep(20)
        else:
            raise RuntimeError("Download mislukt na 3 pogingen")
    else:
        print(f"GRIB uit cache: {grib_path.name} ({grib_path.stat().st_size/1024/1024:.1f} MB)")

    messages, lats, lons = read_grib(grib_path)

    # Oude cache-bestanden opruimen: bewaar alleen GRIBs van deze run.
    keep_prefix = f"ecmwf_long_{run_dt:%Y%m%d}_{cycle:02d}_"
    for old in cache_dir.glob("ecmwf_long_*.grib2"):
        if not old.name.startswith(keep_prefix):
            old.unlink(missing_ok=True)

    n_lat, n_lon = len(lats), len(lons)
    print(f"Grid: {n_lat} lat × {n_lon} lon")
    print(f"Berichten: {len(messages)} (verwacht ~{len(steps_used) * len(PARAMS)})")

    shape = (n_lat, n_lon)

    t2  = stack_steps(messages, "2t",  steps_used, shape)
    td2 = stack_steps(messages, "2d",  steps_used, shape)
    msl = stack_steps(messages, "msl", steps_used, shape)
    u10 = stack_steps(messages, "10u", steps_used, shape)
    v10 = stack_steps(messages, "10v", steps_used, shape)
    tp  = stack_steps(messages, "tp",  steps_used, shape, default_zero=True)
    tcc = stack_steps(messages, "tcc", steps_used, shape)

    # Eenheidsconversies
    t2_C = t2 - 273.15
    td2_C = td2 - 273.15
    rv = relhum_from_t_td(t2_C, td2_C)

    # Interp naar uurlijks
    t2_h   = interp_to_hourly(t2_C, steps_used)
    td2_h  = interp_to_hourly(td2_C, steps_used)
    rv_h   = interp_to_hourly(rv, steps_used)
    msl_h  = interp_to_hourly(msl, steps_used)
    u10_h  = interp_to_hourly(u10, steps_used)
    v10_h  = interp_to_hourly(v10, steps_used)
    tcc_h  = interp_to_hourly(tcc, steps_used)

    # Neerslag: deaccumuleren naar uurlijkse mm/u
    neerslag_mmuur = deaccumulate_to_hourly(tp, steps_used)

    # Y-as moet oplopen (zuid→noord) voor de canvas-viewer.
    if lats[0] > lats[-1]:
        lats = lats[::-1]
        for arr in (t2_h, td2_h, rv_h, msl_h, u10_h, v10_h, tcc_h, neerslag_mmuur):
            arr[:] = arr[:, ::-1, :]

    prefix = args.prefix
    write_bin(WORK_DIR / f"{prefix}_data_temp.bin",      (t2_h,))
    write_bin(WORK_DIR / f"{prefix}_data_dauwpunt.bin",  (td2_h,))
    write_bin(WORK_DIR / f"{prefix}_data_rv.bin",        (rv_h,))
    write_bin(WORK_DIR / f"{prefix}_data_neerslag.bin",  (neerslag_mmuur,))
    write_bin(WORK_DIR / f"{prefix}_data_bewolking.bin", (tcc_h,))
    write_bin(WORK_DIR / f"{prefix}_data_wind.bin",      (u10_h, v10_h))
    write_bin(WORK_DIR / f"{prefix}_data_druk.bin",      (msl_h,))

    run_local = run_dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
    n_uitvoer = max_step + 1
    tijden = [(run_local + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(n_uitvoer)]

    now = datetime.now(tz=LOCAL_TZ)
    meta = {
        "model": "ECMWF IFS HRES (ECMWF Open Data)",
        "run": f"{cycle:02d}z {run_dt:%d %b %Y} · 3u→144, 6u→240 (interp.)",
        "run_utc": run_iso,
        "cycle": cycle,
        "bron": "data.ecmwf.int",
        "bijgewerkt": now.strftime("%d %b %Y %H:%M"),
        "uren": len(tijden),
        "tijden": tijden,
        "geladen_tot": int(max_step),
        "geladen_uren": int(max_step) + 1,
        "max_uren": 240,
        "grid": {
            "n_lat": n_lat,
            "n_lon": n_lon,
            "lat_min": float(lats[0]),
            "lat_max": float(lats[-1]),
            "lon_min": float(lons[0]),
            "lon_max": float(lons[-1]),
        },
        "parameters": {
            "neerslag":   {"file": f"{prefix}_data_neerslag.bin",   "components": 1, "label": "Neerslag (mm/u)"},
            "temp":       {"file": f"{prefix}_data_temp.bin",       "components": 1, "label": "Temperatuur 2m (°C)"},
            "dauwpunt":   {"file": f"{prefix}_data_dauwpunt.bin",   "components": 1, "label": "Dauwpuntstemperatuur 2m (°C)"},
            "rv":         {"file": f"{prefix}_data_rv.bin",         "components": 1, "label": "Relatieve vochtigheid 2m (%)"},
            "bewolking":  {"file": f"{prefix}_data_bewolking.bin",  "components": 1, "label": "Totaal bewolking (%)"},
            "wind":       {"file": f"{prefix}_data_wind.bin",       "components": 2, "label": "Wind 10m (Bft)"},
            "druk":       {"file": f"{prefix}_data_druk.bin",       "components": 1, "label": "Luchtdruk zeeniveau (hPa)"},
        },
        "overlay": "harmonie_overlay.png",
    }
    out_meta = WORK_DIR / f"{prefix}_canvas_meta.json"
    out_meta.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    print(f"  {out_meta.name}: {len(tijden)} stappen, {tijden[0]} t/m {tijden[-1]}")
    print("Klaar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
