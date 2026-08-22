#!/usr/bin/env python3
"""
ECMWF Open Data 06/18z (HRES, oper) → canvas-formaat van demo_ecmwf_canvas.html.

Native 3-uurs (0–90u, 31 stappen) → lineair geinterpoleerd naar uurlijks
(91 stappen) zodat de viewer dezelfde slider-UX heeft als de 00/12 set.

Bron: https://data.ecmwf.int/ via de ecmwf-opendata Python client.
Schrijft lokaal metadata + .bin-rasters; uploadt niets.

Gebruik:
    python3 scripts/ecmwf_opendata_short.py            # auto: nieuwste 06 of 18
    python3 scripts/ecmwf_opendata_short.py --cycle 6
    python3 scripts/ecmwf_opendata_short.py --cycle 18 --date 20260427
"""

from __future__ import annotations

import argparse
import json
import os
import struct
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import eccodes
from ecmwf.opendata import Client


LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
WORK_DIR = Path("/Users/aldus/KNMI_Project/weerlab")

# Bbox Benelux, snapt op het 0.25°-rooster van ECMWF Open Data.
LAT_MIN, LAT_MAX = 49.25, 53.75
LON_MIN, LON_MAX = 2.00, 7.50
GRID_STEP = 0.25
STEPS = list(range(0, 91, 3))  # 0, 3, 6, ..., 90 → 31 stappen

# Open Data oper-index ondersteunt alleen tcc (geen hcc/mcc/lcc) en geen 10fg3.
# Wel beschikbaar: 2t, 2d, msl, 10u, 10v, tp, tcc.
PARAMS = ["2t", "2d", "msl", "10u", "10v", "tp", "tcc"]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--cycle", type=int, choices=[6, 18], default=None,
                   help="06 of 18 UTC. Default: nieuwste van die twee.")
    p.add_argument("--date", default=None,
                   help="YYYYMMDD; default: nieuwste beschikbare run.")
    p.add_argument("--prefix", default="ecmwf_short")
    p.add_argument("--max-step", type=int, default=90,
                   help="Hoogste native stap (3-uurs) om op te halen en te verwerken. "
                        "Default 90 = volledige run. Gebruik 30/60 voor gefaseerd publiceren.")
    return p.parse_args()


def pick_cycle(client: Client, requested: int | None) -> tuple[datetime, int]:
    """Bepaal welke run (UTC datum + cycle) we ophalen.

    Open Data publiceert ~7u na runtijd. Als de gevraagde cycle nog niet
    compleet is, valt deze terug op de vorige 06/18.
    """
    cycles_to_try: list[int]
    if requested is not None:
        cycles_to_try = [requested]
    else:
        # Nieuwste 06 of 18 dat compleet zou moeten zijn (~7u marge).
        now = datetime.now(timezone.utc) - timedelta(hours=7)
        if now.hour >= 18:
            cycles_to_try = [18, 6]
        elif now.hour >= 6:
            cycles_to_try = [6, 18]
        else:
            cycles_to_try = [18, 6]

    last_err: Exception | None = None
    for cyc in cycles_to_try:
        for back in range(0, 3):  # vandaag, gisteren, eergisteren
            try:
                latest = client.latest(type="fc", stream="oper", time=cyc,
                                       step=90, param="2t")
                if latest is None:
                    continue
                # latest is een datetime in UTC voor de meest recente complete run.
                if back == 0:
                    return latest, cyc
                target = latest - timedelta(days=back)
                return target, cyc
            except Exception as exc:
                last_err = exc
                continue
    raise RuntimeError(f"Kon geen 06/18 run vinden: {last_err}")


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
    """Bepaal bbox-indices in het globale 0.25°-rooster van Open Data."""
    # Open Data 0.25°: lats 90..-90 (721), lons 0..359.75 (1440) of -180..180.
    # Normaliseer lons naar -180..180 voor matching met onze bbox in graden Oost.
    lons_norm = ((lons_full + 180.0) % 360.0) - 180.0
    lat_idx = np.where((lats_full >= LAT_MIN - 1e-6) & (lats_full <= LAT_MAX + 1e-6))[0]
    lon_idx = np.where((lons_norm >= LON_MIN - 1e-6) & (lons_norm <= LON_MAX + 1e-6))[0]
    if len(lat_idx) == 0 or len(lon_idx) == 0:
        raise RuntimeError(
            f"Geen punten in bbox. lats {lats_full[0]:.2f}..{lats_full[-1]:.2f}, "
            f"lons orig {lons_full[0]:.2f}..{lons_full[-1]:.2f} (genorm {lons_norm.min():.2f}..{lons_norm.max():.2f})"
        )
    return (slice(lat_idx[0], lat_idx[-1] + 1),
            slice(lon_idx[0], lon_idx[-1] + 1),
            lats_full[lat_idx],
            lons_norm[lon_idx])


def read_grib(path: Path) -> tuple[dict[tuple[str, int], np.ndarray], np.ndarray, np.ndarray]:
    """Lees alle berichten uit GRIB. Retourneert {(shortName, step): array(n_lat,n_lon)}."""
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
                ni = eccodes.codes_get(gid, "Ni")  # lon-punten
                nj = eccodes.codes_get(gid, "Nj")  # lat-punten
                lat_first = eccodes.codes_get(gid, "latitudeOfFirstGridPointInDegrees")
                lat_last = eccodes.codes_get(gid, "latitudeOfLastGridPointInDegrees")
                lon_first = eccodes.codes_get(gid, "longitudeOfFirstGridPointInDegrees")
                lon_last = eccodes.codes_get(gid, "longitudeOfLastGridPointInDegrees")

                vals = eccodes.codes_get_values(gid).reshape(nj, ni)

                if lat_slice is None:
                    di = eccodes.codes_get(gid, "iDirectionIncrementInDegrees")
                    dj = eccodes.codes_get(gid, "jDirectionIncrementInDegrees")
                    # ECMWF Open Data 0.25° begint vaak op 180°E (=−180) i.p.v. 0;
                    # bouw lon-array via increment+wrap zodat we monotoon −180..180 krijgen.
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
                shape: tuple[int, int], default_zero: bool = False) -> np.ndarray:
    """Stack alle native stappen (0,3,...,90) in vorm (31, n_lat, n_lon).

    Stappen waarvoor geen bericht aanwezig is blijven NaN (of 0 bij default_zero).
    """
    n_lat, n_lon = shape
    arr = np.full((len(STEPS), n_lat, n_lon), np.nan, dtype=np.float32)
    for k, st in enumerate(STEPS):
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


def interp_linear_3h_to_1h(arr_3h: np.ndarray) -> np.ndarray:
    """(31, lat, lon) → (91, lat, lon), lineair tussen stappen 0,3,6,...,90."""
    src_steps = np.array(STEPS, dtype=np.float32)          # 0..90, 31 punten
    dst_steps = np.arange(0, 91, dtype=np.float32)          # 0..90, 91 punten
    n_steps_dst = len(dst_steps)
    out = np.empty((n_steps_dst,) + arr_3h.shape[1:], dtype=np.float32)
    # Voor elk uur: bepaal omsluitende 3u-stappen en weeg
    for i, h in enumerate(dst_steps):
        if h in src_steps:
            out[i] = arr_3h[int(h // 3)]
        else:
            lo = int(h // 3)
            hi = lo + 1
            w = (h - src_steps[lo]) / 3.0
            out[i] = (1 - w) * arr_3h[lo] + w * arr_3h[hi]
    return out


def expand_3h_block_to_1h(arr_3h: np.ndarray, divide: bool) -> np.ndarray:
    """Voor sommen (neerslag) en maxima (windstoten): 3u-blok → 3 uren herhalen.

    arr_3h heeft 31 stappen op 0,3,...,90 waarbij stap k de waarde over
    [k-3, k] beschrijft (geldt voor tp/10fg3). Stap 0 is leeg/0.

    Output (91, lat, lon): voor uur 1..3 gebruik stap 3, uur 4..6 stap 6, etc.
    Uur 0 wordt 0.
    Bij divide=True (neerslag mm): 3u-som / 3 = mm/u.
    """
    n_lat, n_lon = arr_3h.shape[1:]
    out = np.zeros((91, n_lat, n_lon), dtype=np.float32)
    for k in range(1, len(STEPS)):
        block = arr_3h[k]
        if divide:
            block = block / 3.0
        st = STEPS[k]
        out[st - 2:st + 1] = block  # uren st-2, st-1, st
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
                # We hebben deze fase al, maar werk wel het 'gecontroleerd_op'
                # veld (en bijgewerkt) bij zodat de viewer ziet dat het systeem
                # nog steeds elke ronde kijkt — anders lijkt de data oud.
                now_local = datetime.now(tz=LOCAL_TZ)
                stamp = now_local.strftime("%d %b %Y %H:%M")
                existing["bijgewerkt"] = stamp
                existing["gecontroleerd_op"] = stamp
                meta_path.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n")
                print(f"Al gepubliceerd t/m stap {existing['geladen_tot']} voor deze run — skip (timestamp ververst).")
                return 0
        except Exception:
            pass

    cache_dir = WORK_DIR / ".ecmwf_short_cache"
    cache_dir.mkdir(exist_ok=True)
    grib_path = cache_dir / f"ecmwf_short_{run_dt:%Y%m%d}_{cycle:02d}_t{max_step:03d}.grib2"
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
    keep_prefix = f"ecmwf_short_{run_dt:%Y%m%d}_{cycle:02d}_"
    for old in cache_dir.glob("ecmwf_short_*.grib2"):
        if not old.name.startswith(keep_prefix):
            old.unlink(missing_ok=True)

    n_lat, n_lon = len(lats), len(lons)
    print(f"Grid: {n_lat} lat × {n_lon} lon")
    print(f"Berichten: {len(messages)} (verwacht ~{len(STEPS) * len(PARAMS)})")

    shape = (n_lat, n_lon)

    t2  = stack_steps(messages, "2t",  shape)                       # K
    td2 = stack_steps(messages, "2d",  shape)                       # K
    msl = stack_steps(messages, "msl", shape)                       # Pa
    u10 = stack_steps(messages, "10u", shape)                       # m/s
    v10 = stack_steps(messages, "10v", shape)                       # m/s
    tp  = stack_steps(messages, "tp",  shape, default_zero=True)    # m, accumulated
    tcc = stack_steps(messages, "tcc", shape)                       # 0..1

    # Eenheidsconversies
    t2_C = t2 - 273.15
    td2_C = td2 - 273.15
    rv = relhum_from_t_td(t2_C, td2_C)

    # Neerslag deaccumuleren: tp is m, cumulatief vanaf t=0
    tp_mm_per3h = np.zeros_like(tp)
    tp_mm = tp * 1000.0  # m → mm
    tp_mm_per3h[1:] = np.diff(tp_mm, axis=0)
    tp_mm_per3h = np.clip(tp_mm_per3h, 0, None)

    # Interpoleer naar uurlijks (91 stappen)
    t2_h   = interp_linear_3h_to_1h(t2_C)
    td2_h  = interp_linear_3h_to_1h(td2_C)
    rv_h   = interp_linear_3h_to_1h(rv)
    msl_h  = interp_linear_3h_to_1h(msl)
    u10_h  = interp_linear_3h_to_1h(u10)
    v10_h  = interp_linear_3h_to_1h(v10)
    tcc_h  = interp_linear_3h_to_1h(tcc)

    # Som → 3u-blok over 3 uren spreiden (mm/u)
    neerslag_mmuur = expand_3h_block_to_1h(tp_mm_per3h, divide=True)

    # Y-as moet oplopen (zuid→noord) voor de canvas-viewer; Open Data komt van noord→zuid.
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

    # Tijdstempels in lokale tijd voor consistentie met de Open-Meteo set.
    run_local = run_dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
    if run_dt.tzinfo is None:
        run_local = run_dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
    tijden = [(run_local + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(91)]

    now = datetime.now(tz=LOCAL_TZ)
    meta = {
        "model": "ECMWF IFS HRES (ECMWF Open Data)",
        "run": f"{cycle:02d}z {run_dt:%d %b %Y} · native 3-uurs (interp.)",
        "run_utc": run_iso,
        "cycle": cycle,
        "bron": "data.ecmwf.int",
        "bijgewerkt": now.strftime("%d %b %Y %H:%M"),
        "uren": len(tijden),
        "tijden": tijden,
        "geladen_tot": int(max_step),       # hoogste native uur dat verwerkt is
        "geladen_uren": int(max_step) + 1,   # 0..max_step inclusief
        "max_uren": 90,                      # waar deze run uiteindelijk eindigt
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
