#!/usr/bin/env python3
"""
DMI Harmonie AROME Europe (2 km) via Open-Meteo naar het canvas-formaat van demo_vierluik_neerslag.html.

DMI = Danmarks Meteorologiske Institut. Draait HARMONIE-AROME (zelfde NWP-familie
als KNMI), domein "Europe" — dekt Noordzee + Benelux op 2 km, ~60 u vooruit.
Open-Meteo model-id: dmi_harmonie_arome_europe (pure DMI, geen ECMWF-blend).

Gebruik:
    python3 scripts/dmi_update.py
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import sys
import time
from datetime import datetime, timezone as _timezone

UTC = _timezone.utc
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import requests

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from open_meteo import _load_key, bulk_sessie, herstart_sessie  # noqa: E402

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
WORK_DIR = Path("/Users/aldus/KNMI_Project/weerlab")

HOURLY = [
    "temperature_2m",
    "dew_point_2m",
    "precipitation",
    "cloud_cover_high",
    "cloud_cover_mid",
    "cloud_cover_low",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "pressure_msl",
    "cape",
    "visibility",
    "shortwave_radiation",
    "direct_radiation",
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--prefix", default="dmi_om")
    p.add_argument("--model", default="dmi_harmonie_arome_europe")
    p.add_argument("--days", type=int, default=3)
    p.add_argument("--max-steps", type=int, default=61)
    p.add_argument("--grid-step", type=float, default=0.08)
    p.add_argument("--batch-size", type=int, default=80)
    p.add_argument("--lon-min", type=float, default=-1.0)
    p.add_argument("--lon-max", type=float, default=13.0)
    p.add_argument("--lat-min", type=float, default=47.5)
    p.add_argument("--lat-max", type=float, default=56.5)
    return p.parse_args()


def relhum_from_t_td(t: np.ndarray, td: np.ndarray) -> np.ndarray:
    es = 6.112 * np.exp((17.67 * t) / (t + 243.5))
    e  = 6.112 * np.exp((17.67 * td) / (td + 243.5))
    return np.clip((e / es) * 100.0, 0, 100).astype(np.float32)


def wind_to_uv(speed_kmh: np.ndarray, direction_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    speed_ms = speed_kmh / 3.6
    rad = np.deg2rad(direction_deg)
    u = -speed_ms * np.sin(rad)
    v = -speed_ms * np.cos(rad)
    return u.astype(np.float32), v.astype(np.float32)


def post_bulk(batch: list[tuple[int, int, float, float]], args: argparse.Namespace) -> list[dict] | None:
    key = _load_key()
    host = "customer-api.open-meteo.com" if key else "api.open-meteo.com"
    url = f"https://{host}/v1/forecast"
    payload = {
        "latitude":  [x[2] for x in batch],
        "longitude": [x[3] for x in batch],
        "hourly": HOURLY,
        "models": [args.model],
        "forecast_days": args.days,
        "timezone": ["Europe/Amsterdam"],
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm",
        "cell_selection": "nearest",
    }
    if key:
        payload["apikey"] = key

    last_err: Exception | None = None
    for attempt in range(4):
        try:
            r = bulk_sessie().post(url, json=payload, timeout=120)
            if r.status_code == 400 and "No data is available" in r.text:
                return None
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(3 * (attempt + 1))
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"{r.status_code} {r.text[:500]}")
            r.raise_for_status()
            data = r.json()
            return data if isinstance(data, list) else [data]
        except requests.RequestException as exc:
            last_err = exc
            herstart_sessie()   # verbinding kan dood zijn; opnieuw opbouwen
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Open-Meteo DMI call mislukt: {last_err}")


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

    lats = np.arange(args.lat_min, args.lat_max + args.grid_step / 2, args.grid_step)
    lons = np.arange(args.lon_min, args.lon_max + args.grid_step / 2, args.grid_step)
    n_lat, n_lon = len(lats), len(lons)
    coords  = [(i, j, float(lat), float(lon)) for i, lat in enumerate(lats) for j, lon in enumerate(lons)]
    batches = [coords[i : i + args.batch_size] for i in range(0, len(coords), args.batch_size)]

    print(f"DMI: {n_lat}x{n_lon} = {len(coords)} punten, {len(batches)} batches")
    print(f"Model: {args.model}, forecast_days={args.days}, prefix={args.prefix}")

    arrays: dict[str, np.ndarray] = {}
    times: list[str] | None = None

    for bi, batch in enumerate(batches, start=1):
        locs = post_bulk(batch, args)
        if locs is None:
            print(f"  batch {bi}/{len(batches)} buiten modeldomein — overgeslagen")
            continue
        if len(locs) != len(batch):
            print(f"  waarschuwing batch {bi}: {len(locs)} locaties voor {len(batch)} gevraagd")

        for li, loc in enumerate(locs[: len(batch)]):
            lat_i, lon_i, _, _ = batch[li]
            hourly = loc.get("hourly") or {}
            loc_times = hourly.get("time") or []
            if times is None:
                times = loc_times
                for var in HOURLY:
                    arrays[var] = np.full((len(times), n_lat, n_lon), np.nan, dtype=np.float32)
            if not times:
                continue
            time_to_idx = {t: k for k, t in enumerate(loc_times)}
            for step_i, tstr in enumerate(times):
                src_i = time_to_idx.get(tstr)
                if src_i is None:
                    continue
                for var in HOURLY:
                    vals = hourly.get(var) or []
                    if src_i < len(vals) and vals[src_i] is not None:
                        arrays[var][step_i, lat_i, lon_i] = float(vals[src_i])

        print(f"  batch {bi}/{len(batches)} klaar")

    if times is None:
        raise RuntimeError("Geen tijdstappen ontvangen van Open-Meteo")

    if args.max_steps and len(times) > args.max_steps:
        times = times[:args.max_steps]
        for var in list(arrays.keys()):
            arrays[var] = arrays[var][:args.max_steps]
    print(f"  Tijdstappen na trim: {len(times)} ({times[0]} t/m {times[-1]})")

    rv       = relhum_from_t_td(arrays["temperature_2m"], arrays["dew_point_2m"])
    wind_u, wind_v = wind_to_uv(arrays["wind_speed_10m"], arrays["wind_direction_10m"])
    gust_ms  = (arrays["wind_gusts_10m"] / 3.6).astype(np.float32)
    zeros    = np.zeros_like(gust_ms, dtype=np.float32)
    cumul    = np.cumsum(np.maximum(arrays["precipitation"], 0), axis=0).astype(np.float32)

    prefix = args.prefix
    write_bin(WORK_DIR / f"{prefix}_data_neerslag.bin",        (arrays["precipitation"],))
    write_bin(WORK_DIR / f"{prefix}_data_cumul.bin",           (cumul,))
    write_bin(WORK_DIR / f"{prefix}_data_temp.bin",            (arrays["temperature_2m"],))
    write_bin(WORK_DIR / f"{prefix}_data_dauwpunt.bin",        (arrays["dew_point_2m"],))
    write_bin(WORK_DIR / f"{prefix}_data_rv.bin",              (rv,))
    write_bin(WORK_DIR / f"{prefix}_data_bewolking.bin",       (
        arrays["cloud_cover_high"] / 100.0,
        arrays["cloud_cover_mid"]  / 100.0,
        arrays["cloud_cover_low"]  / 100.0,
    ))
    write_bin(WORK_DIR / f"{prefix}_data_wind.bin",            (wind_u, wind_v))
    write_bin(WORK_DIR / f"{prefix}_data_windstoten.bin",      (gust_ms, zeros))
    write_bin(WORK_DIR / f"{prefix}_data_druk.bin",            (arrays["pressure_msl"] * 100.0,))
    write_bin(WORK_DIR / f"{prefix}_data_cape.bin",            (arrays["cape"],))
    zicht = np.nan_to_num(arrays["visibility"], nan=50000.0).astype(np.float32)
    write_bin(WORK_DIR / f"{prefix}_data_zicht.bin",           (zicht,))
    write_bin(WORK_DIR / f"{prefix}_data_straling.bin",        (np.maximum(arrays["shortwave_radiation"], 0).astype(np.float32),))
    write_bin(WORK_DIR / f"{prefix}_data_straling_direct.bin", (np.maximum(arrays["direct_radiation"], 0).astype(np.float32),))

    # Zonneschijnduur volgens de WMO-regel (DNI boven 120 W/m²), afgeleid uit de
    # directe straling — zelfde rekenregel als Open-Meteo zelf hanteert, zodat de
    # modellen in het vierluik onderling vergelijkbaar blijven.
    heeft_zon = False
    try:
        from zonuren import zonminuten_uit_direct
        zon_tijden = [datetime.fromisoformat(t).replace(tzinfo=LOCAL_TZ).astimezone(UTC)
                      for t in times]
        zon_min = zonminuten_uit_direct(
            np.maximum(np.nan_to_num(arrays["direct_radiation"], nan=0), 0),
            zon_tijden, lats, lons, model=args.model)
        write_bin(WORK_DIR / f"{prefix}_data_zon.bin", (zon_min,))
        heeft_zon = True
    except Exception as exc:
        print(f"  [waarschuwing] zonneschijn overgeslagen: {exc}")

    now = datetime.now(tz=LOCAL_TZ)
    # Open-Meteo geeft de model-init niet terug. DMI Harmonie draait elke 3 u;
    # leid de nominale run af uit de 3-uurscyclus met 3 u marge zodat we nooit
    # een nog-niet-gepubliceerde run claimen.
    from datetime import timezone as _tz, timedelta as _td
    _ref = datetime.now(_tz.utc) - _td(hours=3)
    _run_dt = _ref.replace(hour=(_ref.hour // 3) * 3, minute=0, second=0, microsecond=0)
    run_utc_str = _run_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    meta = {
        "model": f"DMI Harmonie AROME via Open-Meteo ({args.model})",
        "run": f"geldig vanaf {times[0]} LT",
        "run_utc": run_utc_str,
        "bijgewerkt": now.strftime("%d %b %Y %H:%M"),
        "uren": len(times),
        "tijden": times,
        "grid": {
            "n_lat": n_lat, "n_lon": n_lon,
            "lat_min": float(lats[0]),  "lat_max": float(lats[-1]),
            "lon_min": float(lons[0]),  "lon_max": float(lons[-1]),
        },
        "parameters": {
            "neerslag":        {"file": f"{prefix}_data_neerslag.bin",        "components": 1, "label": "Neerslag (mm/u)"},
            "cumul":           {"file": f"{prefix}_data_cumul.bin",           "components": 1, "label": "Cumulatieve neerslag (mm)"},
            "temp":            {"file": f"{prefix}_data_temp.bin",            "components": 1, "label": "Temperatuur 2m (°C)"},
            "dauwpunt":        {"file": f"{prefix}_data_dauwpunt.bin",        "components": 1, "label": "Dauwpuntstemperatuur 2m (°C)"},
            "rv":              {"file": f"{prefix}_data_rv.bin",              "components": 1, "label": "Relatieve vochtigheid 2m (%)"},
            "bewolking":       {"file": f"{prefix}_data_bewolking.bin",       "components": 3, "label": "Bewolking (hoog/midden/laag)"},
            "wind":            {"file": f"{prefix}_data_wind.bin",            "components": 2, "label": "Wind 10m (Bft)"},
            "windstoten":      {"file": f"{prefix}_data_windstoten.bin",      "components": 2, "label": "Windstoten 10m (km/u)"},
            "druk":            {"file": f"{prefix}_data_druk.bin",            "components": 1, "label": "Luchtdruk zeeniveau (hPa)"},
            "cape":            {"file": f"{prefix}_data_cape.bin",            "components": 1, "label": "CAPE (J/kg)"},
            "zicht":           {"file": f"{prefix}_data_zicht.bin",           "components": 1, "label": "Zicht (m)"},
            "straling":        {"file": f"{prefix}_data_straling.bin",        "components": 1, "label": "Globale straling (W/m²)"},
            "straling_direct": {"file": f"{prefix}_data_straling_direct.bin", "components": 1, "label": "Directe kortgolvige straling (W/m²)"},
            **({"zon": {"file": f"{prefix}_data_zon.bin", "components": 1, "label": "Zonneschijn (minuten per uur)"}} if heeft_zon else {}),
        },
        "overlay": "harmonie_overlay.png",
    }
    out_meta = WORK_DIR / f"{prefix}_canvas_meta.json"
    out_meta.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    print(f"  {out_meta.name}: {len(times)} stappen, {times[0]} t/m {times[-1]}")

    try:
        import boto3
        s3 = boto3.client(
            "s3",
            endpoint_url="https://05da71c7c88b8ce49fbb2c2d0a570416.r2.cloudflarestorage.com",
            aws_access_key_id="baf991003ce3e4075d91b89f8726bc0f",
            aws_secret_access_key="0f33229e2e03fe7bc7f9fdf7f9fa0acd5336c40718c6e25fe0b6a631ade8ac97",
            region_name="auto",
        )
        R2_BUCKET = "weerlab-harmonie"
        bestanden = [str(out_meta.name)]
        for f2 in sorted(os.listdir(WORK_DIR)):
            if f2.startswith(f"{prefix}_data_") and f2.endswith(".bin"):
                bestanden.append(f2)
        for f2 in bestanden:
            ct = "application/json" if f2.endswith(".json") else "application/octet-stream"
            s3.upload_file(str(WORK_DIR / f2), R2_BUCKET, f2, ExtraArgs={"ContentType": ct})
            print(f"   R2: {f2} ({(WORK_DIR / f2).stat().st_size / 1024 / 1024:.1f} MB)")
        print("R2 upload klaar.")
    except Exception as exc:
        print(f"R2 upload mislukt: {exc}")

    print("Klaar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
