#!/usr/bin/env python3
"""
Een deterministisch globaal model via Open-Meteo naar het canvas-formaat van
harmonie_canvas.html en het modellen-vierluik.

Schrijft lokaal metadata + binaire rasterbestanden en uploadt die standaard
naar R2. Gebruik --no-upload voor een uitsluitend lokale test.
Gebruik voor demo:
    python3 scripts/ecmwf_openmeteo_update.py --prefix ecmwf_om
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import struct
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import requests

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from open_meteo import (  # noqa: E402
    _load_key,
    bulk_sessie,
    herstart_sessie,
)

try:
    from open_meteo import registreer_gebruik
except ImportError:  # Older deployed helpers predate usage accounting.
    def registreer_gebruik(**kwargs):
        pass


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
    "shortwave_radiation",
    "direct_radiation",
    # Zicht: alleen GFS en UKMO leveren het; ECMWF en ICON geven null en
    # krijgen dan geen zicht-bestand (de viewer meldt de laag als afwezig).
    "visibility",
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--run", help="Expliciete initialisatie in UTC; gebruikt de Single Runs API")
    p.add_argument("--prefix", default="ecmwf_om")
    p.add_argument("--model", default="ecmwf_ifs025")
    p.add_argument("--model-label", default="ECMWF IFS")
    p.add_argument("--days", type=int, default=4)
    p.add_argument("--max-steps", type=int, default=90)
    p.add_argument("--grid-step", type=float, default=0.1)
    p.add_argument("--batch-size", type=int, default=80)
    p.add_argument("--lon-min", type=float, default=-1.0)
    p.add_argument("--lon-max", type=float, default=13.0)
    p.add_argument("--lat-min", type=float, default=47.5)
    p.add_argument("--lat-max", type=float, default=56.5)
    p.add_argument("--no-upload", action="store_true", help="Schrijf alleen lokale bestanden")
    return p.parse_args()


def relhum_from_t_td(t: np.ndarray, td: np.ndarray) -> np.ndarray:
    es = 6.112 * np.exp((17.67 * t) / (t + 243.5))
    e = 6.112 * np.exp((17.67 * td) / (td + 243.5))
    return np.clip((e / es) * 100.0, 0, 100).astype(np.float32)


def wind_to_uv(speed_kmh: np.ndarray, direction_deg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    speed_ms = speed_kmh / 3.6
    rad = np.deg2rad(direction_deg)
    u = -speed_ms * np.sin(rad)
    v = -speed_ms * np.cos(rad)
    return u.astype(np.float32), v.astype(np.float32)


def post_bulk(batch: list[tuple[int, int, float, float]], args: argparse.Namespace) -> list[dict]:
    key = _load_key()
    host = "customer-api.open-meteo.com" if key else "api.open-meteo.com"
    if getattr(args, "run", None):
        host = "customer-single-runs-api.open-meteo.com" if key else "single-runs-api.open-meteo.com"
    url = f"https://{host}/v1/forecast"
    payload = {
        "latitude": [x[2] for x in batch],
        "longitude": [x[3] for x in batch],
        "hourly": HOURLY,
        "models": [args.model],
        "forecast_days": args.days,
        "timezone": ["UTC"],
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm",
        "cell_selection": "nearest",
    }
    if getattr(args, "run", None):
        payload["run"] = args.run
    if key:
        payload["apikey"] = key

    last_err: Exception | None = None
    for attempt in range(4):
        try:
            r = bulk_sessie().post(url, json=payload, timeout=120)
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
    raise RuntimeError(f"Open-Meteo {args.model_label} call mislukt: {last_err}")


def has_data(arr: np.ndarray) -> bool:
    return bool(np.isfinite(arr).any())


def bron_afdruk(loc: dict) -> str | None:
    """Hash tijdas en alle velden van één ankerpunt om nieuwe runs te herkennen."""
    hourly = loc.get("hourly") or {}
    if not hourly.get("time"):
        return None
    delen = [",".join(str(t) for t in hourly["time"])]
    for var in HOURLY:
        vals = hourly.get(var) or []
        delen.append(",".join("" if v is None else f"{v:g}" for v in vals))
    return hashlib.sha256("|".join(delen).encode()).hexdigest()[:24]


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


def local_forecast_times(times: list[str]) -> list[str]:
    result = []
    for value in times:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        result.append(dt.astimezone(LOCAL_TZ).isoformat())
    return result


def main() -> int:
    args = parse_args()
    os.chdir(WORK_DIR)

    lats = np.arange(args.lat_min, args.lat_max + args.grid_step / 2, args.grid_step)
    lons = np.arange(args.lon_min, args.lon_max + args.grid_step / 2, args.grid_step)
    n_lat, n_lon = len(lats), len(lons)
    coords = [(i, j, float(lat), float(lon)) for i, lat in enumerate(lats) for j, lon in enumerate(lons)]
    batches = [coords[i : i + args.batch_size] for i in range(0, len(coords), args.batch_size)]

    print(f"{args.model_label} via Open-Meteo: {n_lat}x{n_lon} = {len(coords)} punten, {len(batches)} batches")
    print(f"Model: {args.model}, forecast_days={args.days}, prefix={args.prefix}")

    # Eén goedkoop ankerpunt bepaalt of Open-Meteo inmiddels een andere run
    # serveert. De configuratie telt mee, zodat een gewijzigd domein of raster
    # altijd opnieuw wordt opgebouwd.
    anker = (-1, -1, float(lats[len(lats) // 2]), float(lons[len(lons) // 2]))
    anker_loc = post_bulk([anker], args)[0]
    source_fingerprint = bron_afdruk(anker_loc)
    source_request = {
        "model": args.model,
        "timezone": "UTC",
        "days": args.days,
        "max_steps": args.max_steps,
        "grid": {
            "n_lat": n_lat, "n_lon": n_lon,
            "lat_min": float(lats[0]), "lat_max": float(lats[-1]),
            "lon_min": float(lons[0]), "lon_max": float(lons[-1]),
        },
    }
    if getattr(args, "run", None):
        source_request["run_utc"] = args.run
    out_meta = WORK_DIR / f"{args.prefix}_canvas_meta.json"
    if source_fingerprint and out_meta.exists():
        try:
            bestaande_meta = json.loads(out_meta.read_text())
        except (OSError, ValueError):
            bestaande_meta = {}
        if (bestaande_meta.get("source_fingerprint") == source_fingerprint
                and bestaande_meta.get("source_request") == source_request):
            print("  dezelfde Open-Meteo-bronrun; volledig raster en R2-upload overgeslagen")
            registreer_gebruik(
                consumer=args.prefix, model=args.model, resultaat="ongewijzigd",
                locaties=1, verzoeken=1, variabelen=len(HOURLY), dagen=args.days,
            )
            return 0

    arrays: dict[str, np.ndarray] = {}
    times: list[str] | None = None

    for bi, batch in enumerate(batches, start=1):
      locs = post_bulk(batch, args)
      if len(locs) != len(batch):
          print(f"  waarschuwing batch {bi}: {len(locs)} locaties terug voor {len(batch)} gevraagd")

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

    if getattr(args, "run", None):
        first = datetime.fromisoformat(times[0].replace("Z", "+00:00")).replace(tzinfo=timezone.utc)
        chosen = datetime.fromisoformat(args.run.replace("Z", "+00:00")).replace(tzinfo=timezone.utc)
        if first != chosen:
            raise ValueError("Single Runs API leverde een andere starttijd")

    # Haal uren in UTC op, zodat beide 02:00-uren bij wintertijd behouden blijven.
    # Publiceer expliciete offsets voor bestaande lokale datumlabels.
    times = local_forecast_times(times)

    # Trim naar max_steps
    if args.max_steps and len(times) > args.max_steps:
        times = times[:args.max_steps]
        for var in list(arrays.keys()):
            arrays[var] = arrays[var][:args.max_steps]
    print(f"  Tijdstappen na trim: {len(times)} ({times[0]} t/m {times[-1]})")

    if getattr(args, "run", None):
        for key in ("temperature_2m", "pressure_msl", "wind_speed_10m", "wind_direction_10m"):
            if not np.isfinite(arrays[key]).all():
                raise ValueError("Onvolledige gekozen modelrun: " + key)

    # Open-Meteo ECMWF geeft 2m-RV niet; bereken die uit T en Td.
    rv = relhum_from_t_td(arrays["temperature_2m"], arrays["dew_point_2m"])
    wind_u, wind_v = wind_to_uv(arrays["wind_speed_10m"], arrays["wind_direction_10m"])
    gust_ms = (arrays["wind_gusts_10m"] / 3.6).astype(np.float32)
    zeros = np.zeros_like(gust_ms, dtype=np.float32)
    prefix = args.prefix
    write_bin(WORK_DIR / f"{prefix}_data_temp.bin", (arrays["temperature_2m"],))
    write_bin(WORK_DIR / f"{prefix}_data_dauwpunt.bin", (arrays["dew_point_2m"],))
    write_bin(WORK_DIR / f"{prefix}_data_rv.bin", (rv,))
    write_bin(WORK_DIR / f"{prefix}_data_neerslag.bin", (arrays["precipitation"],))
    cumul = np.cumsum(np.maximum(arrays["precipitation"], 0), axis=0).astype(np.float32)
    write_bin(WORK_DIR / f"{prefix}_data_cumul.bin", (cumul,))
    write_bin(
        WORK_DIR / f"{prefix}_data_bewolking.bin",
        (
            arrays["cloud_cover_high"] / 100.0,
            arrays["cloud_cover_mid"] / 100.0,
            arrays["cloud_cover_low"] / 100.0,
        ),
    )
    write_bin(WORK_DIR / f"{prefix}_data_wind.bin", (wind_u, wind_v))
    write_bin(WORK_DIR / f"{prefix}_data_windstoten.bin", (gust_ms, zeros))
    write_bin(WORK_DIR / f"{prefix}_data_druk.bin", (arrays["pressure_msl"] * 100.0,))
    write_bin(WORK_DIR / f"{prefix}_data_cape.bin", (arrays["cape"],))
    write_bin(WORK_DIR / f"{prefix}_data_straling.bin", (np.maximum(arrays["shortwave_radiation"], 0).astype(np.float32),))
    write_bin(WORK_DIR / f"{prefix}_data_straling_direct.bin", (np.maximum(arrays["direct_radiation"], 0).astype(np.float32),))
    # Zonneschijn in minuten per uur. Bewust niet Open-Meteo's eigen
    # sunshine_duration: die legt de WMO-drempel op het uurgemiddelde en telt
    # dan vrijwel elk zonnig uur als 60 minuten (voor ECMWF +18 min/uur t.o.v.
    # de gemeten zonneschijn). zonuren.py leidt de zonnige fractie af uit de
    # directe straling; zie de toets in dat bestand.
    from zonuren import zonminuten_uit_direct
    zon_tijden = [datetime.fromisoformat(tt).astimezone(timezone.utc)
                  for tt in times]
    heeft_zicht = bool(np.isfinite(arrays["visibility"]).any())
    if heeft_zicht:
        zicht = np.nan_to_num(arrays["visibility"], nan=50000.0).astype(np.float32)
        write_bin(WORK_DIR / f"{prefix}_data_zicht.bin", (zicht,))
    zon_min = zonminuten_uit_direct(
        np.maximum(np.nan_to_num(arrays["direct_radiation"], nan=0), 0),
        zon_tijden, lats, lons, model=args.model)
    write_bin(WORK_DIR / f"{prefix}_data_zon.bin", (zon_min,))

    now = datetime.now(tz=LOCAL_TZ)
    meta = {
        "model": f"{args.model_label} via Open-Meteo ({args.model})",
        "run": f"geldig vanaf {times[0]} LT",
        "bijgewerkt": now.strftime("%d %b %Y %H:%M"),
        "uren": len(times),
        "tijden": times,
        "grid": {
            "n_lat": n_lat,
            "n_lon": n_lon,
            "lat_min": float(lats[0]),
            "lat_max": float(lats[-1]),
            "lon_min": float(lons[0]),
            "lon_max": float(lons[-1]),
        },
        "parameters": {
            "neerslag": {"file": f"{prefix}_data_neerslag.bin", "components": 1, "label": "Neerslag voorgaande uur (mm)", "unit": "mm", "interval_hours": 1},
            "cumul": {"file": f"{prefix}_data_cumul.bin", "components": 1, "label": "Cumulatieve neerslag (mm)"},
            "temp": {"file": f"{prefix}_data_temp.bin", "components": 1, "label": "Temperatuur 2m (°C)"},
            "dauwpunt": {"file": f"{prefix}_data_dauwpunt.bin", "components": 1, "label": "Dauwpuntstemperatuur 2m (°C)"},
            "rv": {"file": f"{prefix}_data_rv.bin", "components": 1, "label": "Relatieve vochtigheid 2m (%)"},
            "bewolking": {"file": f"{prefix}_data_bewolking.bin", "components": 3, "label": "Bewolking (hoog/midden/laag)"},
            "wind": {"file": f"{prefix}_data_wind.bin", "components": 2, "label": "Wind 10m U/V (m/s)", "unit": "m/s"},
            "windstoten": {"file": f"{prefix}_data_windstoten.bin", "components": 2, "label": "Windstoten 10m (m/s)", "unit": "m/s"},
            "druk": {"file": f"{prefix}_data_druk.bin", "components": 1, "label": "Luchtdruk zeeniveau (Pa)", "unit": "Pa"},
            "cape": {"file": f"{prefix}_data_cape.bin", "components": 1, "label": "CAPE (J/kg)"},
            "straling": {"file": f"{prefix}_data_straling.bin", "components": 1, "label": "Globale straling (W/m²)"},
            "straling_direct": {"file": f"{prefix}_data_straling_direct.bin", "components": 1, "label": "Directe kortgolvige straling (W/m²)"},
            "zon": {"file": f"{prefix}_data_zon.bin", "components": 1, "label": "Zonneschijn (minuten per uur)"},
            **({"zicht": {"file": f"{prefix}_data_zicht.bin", "components": 1, "label": "Zicht (m)"}} if heeft_zicht else {}),
        },
        "overlay": "harmonie_overlay.png",
        "source_fingerprint": source_fingerprint,
        "source_request": source_request,
        "source_checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    if getattr(args, "run", None):
        meta["run_utc"] = datetime.fromisoformat(args.run.replace("Z", "+00:00")).replace(tzinfo=timezone.utc).isoformat()
        meta["run"] = "ECMWF initialisatie " + meta["run_utc"]
    out_meta.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    print(f"  {out_meta.name}: {len(times)} stappen, {times[0]} t/m {times[-1]}")

    if args.no_upload:
        print("R2 upload overgeslagen (--no-upload).")
        registreer_gebruik(
            consumer=args.prefix, model=args.model, resultaat="ververst-lokaal",
            locaties=1 + len(coords), verzoeken=1 + len(batches),
            variabelen=len(HOURLY), dagen=args.days,
        )
        print("Klaar.")
        return 0

    # Upload via de centrale rclone-config; credentials blijven buiten de repo.
    bestanden = [str(out_meta.name)]
    for f2 in sorted(os.listdir(WORK_DIR)):
        if f2.startswith(f"{prefix}_data_") and f2.endswith(".bin"):
            bestanden.append(f2)
    subprocess.run(
        ["bash", str(WORK_DIR / "shell/r2_publish_harmonie.sh"), *bestanden],
        cwd=WORK_DIR, check=True,
    )
    print("R2 upload klaar.")

    print("Klaar.")
    registreer_gebruik(
        consumer=args.prefix, model=args.model, resultaat="ververst",
        locaties=1 + len(coords), verzoeken=1 + len(batches),
        variabelen=len(HOURLY), dagen=args.days,
    )
    return 0


if __name__ == "__main__":
    result = main()
    cloud_args = parse_args()
    if result == 0 and cloud_args.prefix == "ecmwf_om":
        from ecmwf_cloud_height import update
        update(WORK_DIR, upload=not cloud_args.no_upload)
    raise SystemExit(result)
