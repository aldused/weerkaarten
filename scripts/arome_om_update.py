#!/usr/bin/env python3
"""
Open-Meteo modellen naar het canvas-formaat van de modelviewer (vierluik).

Presets:
  arome  — Météo-France AROME France HD (1,5 km) voor de high-res velden; druk
           en straling ontbreken in HD en komen uit AROME France (2,5 km).
           Beide modellen in één multi-model bulk-call.
  arpege — Météo-France ARPEGE Europe (~11 km), alle velden uit één model,
           bereik ~5 dagen.

Schrijft full-res bins (neerslag/cumul/radar als uint8-sqrt), bouwt metadata
en uploadt gzipped naar Cloudflare R2.

    python3 scripts/arome_om_update.py --preset arome    # volledige run AROME
    python3 scripts/arome_om_update.py --preset arpege   # volledige run ARPEGE
    python3 scripts/arome_om_update.py --preset arpege --test   # 2 batches, geen upload
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import struct
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
from open_meteo import _load_key, bulk_sessie, herstart_sessie  # noqa: E402

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
WORK_DIR = Path("/Users/aldus/KNMI_Project/weerlab")

# High-res velden (uit het primaire model) en velden die soms apart moeten
# (AROME HD mist druk/straling → uit het 2,5 km-model)
HI_VARS = [
    "temperature_2m", "dew_point_2m", "precipitation",
    "cloud_cover_high", "cloud_cover_mid", "cloud_cover_low",
    "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "cape",
]
LO_VARS = ["pressure_msl", "shortwave_radiation", "direct_radiation"]

# Per preset: prefix, modellabel, bronmodel high-res velden, bronmodel druk/straling,
# grid-step, domein, dagen, max stappen
PRESETS = {
    "arome": {
        "prefix": "arome_om", "label": "AROME 1.5",
        "model_hi": "meteofrance_arome_france_hd",
        "model_lo": "meteofrance_arome_france",
        # Breed domein ~gelijk aan HARMONIE/ICON (AROME HD reikt tot lat ~55).
        # 0.04°/0.03° (~3 km) houdt het puntenaantal en de bestandsgrootte beheersbaar.
        "grid_step": 0.04, "grid_step_lat": 0.03, "days": 3, "max_steps": 61,
        "lon": (0.5, 11.3), "lat": (49.0, 55.0),
    },
    "arpege": {
        "prefix": "arpege_om", "label": "ARPEGE",
        "model_hi": "meteofrance_arpege_europe",
        "model_lo": "meteofrance_arpege_europe",   # alle velden uit één model
        "grid_step": 0.1, "days": 5, "max_steps": 120,
        "lon": (2.0, 8.2), "lat": (49.2, 54.2),
    },
    "ukmo": {
        "prefix": "ukmo_om", "label": "UKMO 2km",
        "model_hi": "ukmo_uk_deterministic_2km",
        "model_lo": "ukmo_uk_deterministic_2km",   # alle velden uit één model
        # Benelux-domein. cell_selection=nearest puntsampelt UKV's ~2 km rotated-pole
        # grid; lat-stap 0.02°≈2.2 km lag nét bóven native → N-Z-aliasing (horizontale
        # strepen). lat 0.015°≈1.6 km oversamplet onder native → geen rij-skip, geen
        # banding (viewer-bilineair maakt blokjes glad). lon 0.03°≈2.0 km matcht al.
        # Brede UKV-domeinen gaven via Open-Meteo hardnekkig afgekapte bulk-responses;
        # dit smalle domein draait betrouwbaar binnen ~2-3 min.
        "grid_step": 0.03, "grid_step_lat": 0.015, "days": 3, "max_steps": 65,
        "lon": (2.5, 7.8), "lat": (49.6, 54.0),
        "visibility": True,
    },
}

R2_ENDPOINT = "https://05da71c7c88b8ce49fbb2c2d0a570416.r2.cloudflarestorage.com"
R2_ACCESS_KEY = "baf991003ce3e4075d91b89f8726bc0f"
R2_SECRET_KEY = "0f33229e2e03fe7bc7f9fdf7f9fa0acd5336c40718c6e25fe0b6a631ade8ac97"
R2_BUCKET = "weerlab-harmonie"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--preset", choices=list(PRESETS.keys()), default="arome")
    p.add_argument("--batch-size", type=int, default=60)
    p.add_argument("--test", action="store_true", help="2 batches, geen upload")
    return p.parse_args()


def relhum_from_t_td(t: np.ndarray, td: np.ndarray) -> np.ndarray:
    es = 6.112 * np.exp((17.67 * t) / (t + 243.5))
    e = 6.112 * np.exp((17.67 * td) / (td + 243.5))
    return np.clip((e / es) * 100.0, 0, 100).astype(np.float32)


def wind_to_uv(speed_kmh: np.ndarray, direction_deg: np.ndarray):
    speed_ms = speed_kmh / 3.6
    rad = np.deg2rad(direction_deg)
    u = -speed_ms * np.sin(rad)
    v = -speed_ms * np.cos(rad)
    return u.astype(np.float32), v.astype(np.float32)


# Open-Meteo antwoordt voor punten buiten het modeldomein met HTTP 200 en
# letterlijk {"latitude":nan,"longitude":nan,...}. Dat is geen geldige JSON, dus
# json.loads() liep stuk en de hele batch belandde in de retry-/halveerlus — bij
# UKMO leek dat op "hardnekkig afgekapte respons". Zulke punten horen simpelweg
# leeg te zijn; we vertalen nan/inf naar null en laten ze als NaN in het rooster.
_NIET_JSON = re.compile(r'(?<=[:\[,])\s*-?(?:nan|inf|Infinity)\s*(?=[,}\]])', re.IGNORECASE)


def _parse_respons(text: str):
    try:
        return json.loads(text)
    except ValueError:
        return json.loads(_NIET_JSON.sub('null', text))


# ── Bronconsistentie ────────────────────────────────────────────────────────
# Open-Meteo verdeelt aanvragen over meerdere nodes en die lopen niet gelijk.
# Een deel serveert onder `meteofrance_arome_france_hd` gewoon de 2,5 km-velden
# van `meteofrance_arome_france` (gemeten: dezelfde reeks tot op de decimaal);
# bij UKMO verschillen nodes eveneens. Met een losse requests.post() per batch
# opende elke batch een nieuwe verbinding en dus vaak een andere node, waardoor
# het rooster een lappendeken van twee bronnen werd — zichtbaar als horizontale
# strepen precies op de batchgrenzen (gemeten: sprong 2,6× groter op index % 60).
# Eén keep-alive-sessie blijft aan dezelfde node hangen (10/10 identiek in de
# test, tegen 8/2 met losse requests); het ankerpunt hieronder bewaakt dat en
# dwingt een nieuwe sessie af zodra de node alsnog wisselt.
ANKER_VARS = ["temperature_2m", "wind_speed_10m", "precipitation"]


def anker_afdruk(loc: dict, model: str) -> str | None:
    """Vingerafdruk van de ankerreeks; verandert zodra een andere node antwoordt."""
    hourly = loc.get("hourly") or {}
    if not hourly.get("time"):
        return None
    delen = []
    for var in ANKER_VARS:
        vals = hourly_get(hourly, var, model)
        delen.append(",".join("" if v is None else f"{v:g}" for v in vals))
    return hashlib.md5("|".join(delen).encode()).hexdigest()[:12]


def echte_hires(loc: dict, model_hi: str, model_lo: str) -> bool:
    """Node zonder het HD-model stuurt daarvoor de velden van het grovere model
    terug. Identieke reeksen = fallback, dus niet bruikbaar als bron."""
    hourly = loc.get("hourly") or {}
    for var in ("temperature_2m", "wind_speed_10m"):
        hi = list(hourly_get(hourly, var, model_hi))
        lo = list(hourly_get(hourly, var, model_lo))
        if hi and lo and hi != lo:
            return True
    return False


def post_bulk(batch, days, models, variables):
    key = _load_key()
    host = "customer-api.open-meteo.com" if key else "api.open-meteo.com"
    url = f"https://{host}/v1/forecast"
    payload = {
        "latitude": [x[2] for x in batch],
        "longitude": [x[3] for x in batch],
        "hourly": variables,
        "models": models,
        "forecast_days": days,
        "timezone": ["Europe/Amsterdam"],
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm",
        "cell_selection": "nearest",
    }
    if key:
        payload["apikey"] = key
    last_err = None
    # Groeiende backoff (6,12,24,48,72s) zodat een rate-limit-venster kan herstellen
    for attempt in range(5):
        try:
            r = bulk_sessie().post(url, json=payload, timeout=120)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(min(72, 6 * (attempt + 1) * (attempt + 1)))
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"{r.status_code} {r.text[:200]}")
            data = _parse_respons(r.text)
            return data if isinstance(data, list) else [data]
        except Exception as exc:
            last_err = exc
            herstart_sessie()   # verbinding kan dood zijn; opnieuw opbouwen
            time.sleep(min(72, 6 * (attempt + 1) * (attempt + 1)))
    # Hardnekkig afgekapte respons: batch halveren om het kapotte deel te isoleren
    # (pacing houdt de rate-limit onder controle, dus dit cascadeert niet).
    if len(batch) > 4:
        mid = len(batch) // 2
        time.sleep(1)
        return (post_bulk(batch[:mid], days, models, variables)
                + post_bulk(batch[mid:], days, models, variables))
    # Kleine sub-batch blijft falen → sla deze paar punten over (worden NaN/leeg).
    # Voorkomt dat één flaky respons de hele run laat crashen.
    print(f"   [skip] {len(batch)} punt(en) overgeslagen: {last_err}")
    return [{} for _ in batch]


def hourly_get(hourly: dict, var: str, model: str):
    """Pak var uit multi-model respons; val terug op suffixloze sleutel."""
    return hourly.get(f"{var}_{model}") or hourly.get(var) or []


def main() -> int:
    args = parse_args()
    os.chdir(WORK_DIR)
    cfg = PRESETS[args.preset]
    PREFIX = cfg["prefix"]
    model_hi, model_lo = cfg["model_hi"], cfg["model_lo"]
    single_model = (model_hi == model_lo)
    req_models = [model_hi] if single_model else [model_hi, model_lo]
    hi_vars = HI_VARS + (["visibility"] if cfg.get("visibility") else [])
    requested_vars = hi_vars + LO_VARS
    gs_lon = cfg["grid_step"]
    gs_lat = cfg.get("grid_step_lat", gs_lon)   # apart als native lat/lon-res verschilt (UKV)

    lats = np.arange(cfg["lat"][0], cfg["lat"][1] + gs_lat / 2, gs_lat)
    lons = np.arange(cfg["lon"][0], cfg["lon"][1] + gs_lon / 2, gs_lon)
    n_lat, n_lon = len(lats), len(lons)
    coords = [(i, j, round(float(la), 4), round(float(lo), 4))
              for i, la in enumerate(lats) for j, lo in enumerate(lons)]
    batches = [coords[i:i + args.batch_size] for i in range(0, len(coords), args.batch_size)]
    if args.test:
        batches = batches[:2]

    print(f"{cfg['label']} Open-Meteo: {n_lat}x{n_lon} = {len(coords)} punten, {len(batches)} batches"
          f"{' (TEST)' if args.test else ''}")

    # Ankerpunt in het midden van het domein: gaat mee in élke batch en bewaakt
    # dat het hele rooster van dezelfde node (en dus dezelfde bron) komt.
    anker = (-1, -1,
             round((cfg["lat"][0] + cfg["lat"][1]) / 2, 4),
             round((cfg["lon"][0] + cfg["lon"][1]) / 2, 4))
    ref_afdruk = None
    for poging in range(1, 9):
        anker_loc = post_bulk([anker], cfg["days"], req_models, requested_vars)[0]
        if anker_loc.get("hourly") and (single_model or echte_hires(anker_loc, model_hi, model_lo)):
            ref_afdruk = anker_afdruk(anker_loc, model_hi)
            break
        print(f"   [bron] node levert geen {model_hi}-data, nieuwe verbinding ({poging})")
        herstart_sessie()
        time.sleep(1)
    if ref_afdruk is None:
        print(f"   [bron] geen node met {model_hi} gevonden; rooster kan gemengd zijn")
    else:
        print(f"   bron vastgezet op node {ref_afdruk}")

    arrays: dict[str, np.ndarray] = {}
    times: list[str] | None = None
    hersteld = 0
    gemengd = 0
    t0 = time.time()

    for bi, batch in enumerate(batches, start=1):
        if bi > 1:
            time.sleep(0.12)   # pacing tegen per-minuut rate-limit
        for poging in range(4):
            locs = post_bulk(batch + [anker], cfg["days"], req_models, requested_vars)
            afdruk = anker_afdruk(locs[len(batch)], model_hi) if len(locs) > len(batch) else None
            if ref_afdruk is None or afdruk is None or afdruk == ref_afdruk:
                break
            herstart_sessie()     # andere node: verbinding weg, batch opnieuw
            hersteld += 1
            time.sleep(0.5)
        else:
            gemengd += 1
        for li, loc in enumerate(locs[:len(batch)]):
            lat_i, lon_i = batch[li][0], batch[li][1]
            hourly = loc.get("hourly") or {}
            loc_times = hourly.get("time") or []
            if times is None and loc_times:
                times = loc_times
                for var in requested_vars:
                    arrays[var] = np.full((len(times), n_lat, n_lon), np.nan, dtype=np.float32)
            if not times:
                continue
            idx = {t: k for k, t in enumerate(loc_times)}
            for var in requested_vars:
                model = model_hi if var in hi_vars else model_lo
                vals = hourly_get(hourly, var, model)
                arr = arrays[var]
                for step_i, tstr in enumerate(times):
                    si = idx.get(tstr)
                    if si is not None and si < len(vals) and vals[si] is not None:
                        arr[step_i, lat_i, lon_i] = float(vals[si])
        if bi % 10 == 0 or bi == len(batches):
            print(f"  batch {bi}/{len(batches)} ({time.time()-t0:.0f}s)")

    if hersteld or gemengd:
        print(f"  bronbewaking: {hersteld} batch(es) opnieuw opgehaald na nodewissel"
              + (f", {gemengd} batch(es) blijven afwijken" if gemengd else ""))

    if times is None:
        raise RuntimeError("Geen tijdstappen ontvangen")

    if cfg["max_steps"] and len(times) > cfg["max_steps"]:
        times = times[:cfg["max_steps"]]
        for var in arrays:
            arrays[var] = arrays[var][:cfg["max_steps"]]

    # Knip lege staart-stappen: modellen leveren soms minder uren dan gevraagd
    # (bv. ARPEGE ~117u i.p.v. 120). Laatste stap met geldige temperatuur bepaalt het einde.
    valid = np.isfinite(arrays["temperature_2m"]).any(axis=(1, 2))
    last = int(np.max(np.where(valid)[0])) if valid.any() else -1
    if last + 1 < len(times):
        print(f"  staart {len(times) - (last + 1)} lege stappen verwijderd")
        times = times[:last + 1]
        for var in arrays:
            arrays[var] = arrays[var][:last + 1]
    n_steps = len(times)
    print(f"  {n_steps} tijdstappen ({times[0]} t/m {times[-1]})")

    # Afgeleide velden
    rv = relhum_from_t_td(arrays["temperature_2m"], arrays["dew_point_2m"])
    wind_u, wind_v = wind_to_uv(arrays["wind_speed_10m"], arrays["wind_direction_10m"])
    gust_ms = (arrays["wind_gusts_10m"] / 3.6).astype(np.float32)
    zeros = np.zeros_like(gust_ms, dtype=np.float32)
    precip = np.maximum(np.nan_to_num(arrays["precipitation"], nan=0), 0).astype(np.float32)

    # ── Bin-writers ──────────────────────────────────────────────
    def write_bin(name, comps):
        path = WORK_DIR / name
        with path.open("wb") as f:
            f.write(struct.pack("<HHHH", n_lat, n_lon, n_steps, len(comps)))
            f.write(b"\x00" * 8)
            for s in range(n_steps):
                for arr in comps:
                    f.write(np.nan_to_num(arr[s], nan=0).astype(np.float32).tobytes())
        print(f"  {name}: {path.stat().st_size/1024/1024:.1f} MB")

    # q = round(waarde**(1/power)*scale); exponent staat als 'power' in de meta.
    # Zie harmonie_update.sh: de wortel met scale 16 liet tussen 0,03 en
    # 0,06 mm/u maar één representeerbare waarde over en verspilde tegelijk de
    # bovenste 60% van het bytebereik.
    def write_bin_u8(name, series, scale, power=2):
        inv = 1.0 / power
        path = WORK_DIR / name
        with path.open("wb") as f:
            f.write(struct.pack("<HHHH", n_lat, n_lon, n_steps, 1))
            f.write(bytes([1]) + b"\x00" * 7)
            for s in range(n_steps):
                q = np.clip(np.round(np.maximum(series[s], 0) ** inv * scale), 0, 255).astype(np.uint8)
                f.write(q.tobytes())
        print(f"  {name}: {path.stat().st_size/1024/1024:.1f} MB (u8)")

    # Neerslag + cumul (uint8-sqrt)
    write_bin_u8(f"{PREFIX}_data_neerslag.bin", precip, 50, 3)
    cumul = np.cumsum(precip, axis=0).astype(np.float32)
    write_bin_u8(f"{PREFIX}_data_cumul.bin", cumul, 32, 3)

    # Pseudo-radar: Marshall-Palmer Z=200*R^1.6 op uurneerslag
    pseudo_dbz = np.where(precip >= 0.05,
                          10 * np.log10(np.maximum(200 * np.maximum(precip, 0.001) ** 1.6, 1)),
                          0).astype(np.float32)
    write_bin_u8(f"{PREFIX}_data_radar.bin", pseudo_dbz, 3, 1)

    write_bin(f"{PREFIX}_data_temp.bin", (arrays["temperature_2m"],))
    write_bin(f"{PREFIX}_data_dauwpunt.bin", (arrays["dew_point_2m"],))
    write_bin(f"{PREFIX}_data_rv.bin", (rv,))
    write_bin(f"{PREFIX}_data_bewolking.bin",
              (arrays["cloud_cover_high"] / 100.0,
               arrays["cloud_cover_mid"] / 100.0,
               arrays["cloud_cover_low"] / 100.0))
    write_bin(f"{PREFIX}_data_wind.bin", (wind_u, wind_v))
    write_bin(f"{PREFIX}_data_windstoten.bin", (gust_ms, zeros))
    write_bin(f"{PREFIX}_data_druk.bin", (arrays["pressure_msl"] * 100.0,))
    write_bin(f"{PREFIX}_data_cape.bin", (arrays["cape"],))
    if cfg.get("visibility"):
        # Een overgeslagen Open-Meteo-puntsample mag nooit als dichte mist (0 m)
        # op de kaart verschijnen. Neutraal invullen als onbeperkt/modelmaximum.
        zicht = np.nan_to_num(arrays["visibility"], nan=50000.0).astype(np.float32)
        write_bin(f"{PREFIX}_data_zicht.bin", (zicht,))

    stral = np.maximum(np.nan_to_num(arrays["shortwave_radiation"], nan=0), 0).astype(np.float32)
    write_bin(f"{PREFIX}_data_straling.bin", (stral,))

    # Zonneschijnduur volgens de WMO-regel (DNI boven 120 W/m²), afgeleid uit de
    # directe straling. AROME levert geen kant-en-klare sunshine_duration via
    # Open-Meteo; deze rekenregel is dezelfde die Open-Meteo zelf toepast, dus de
    # modellen in het vierluik blijven onderling vergelijkbaar.
    heeft_zon = False
    try:
        from zonuren import zonminuten_uit_direct
        zon_tijden = [datetime.fromisoformat(tt).replace(tzinfo=LOCAL_TZ).astimezone(timezone.utc)
                      for tt in times]
        zon_min = zonminuten_uit_direct(
            np.maximum(np.nan_to_num(arrays["direct_radiation"], nan=0), 0),
            zon_tijden, lats, lons)
        write_bin(f"{PREFIX}_data_zon.bin", (zon_min,))
        heeft_zon = True
    except Exception as exc:
        print(f"  [waarschuwing] zonneschijn overgeslagen: {exc}")
    # Dagsom: reset om middernacht lokale tijd (Kachelmann-conventie)
    cs = np.zeros((n_steps, n_lat, n_lon), dtype=np.float32)
    acc = None
    prev_date = None
    for i in range(n_steps):
        d = datetime.fromisoformat(times[i]).date()
        acc = stral[i].copy() if (acc is None or d != prev_date) else acc + stral[i]
        prev_date = d
        cs[i] = acc
    write_bin(f"{PREFIX}_data_cumstraling.bin", (cs,))

    # ── Metadata ─────────────────────────────────────────────────
    grid_hr = {"n_lat": n_lat, "n_lon": n_lon,
               "lat_min": float(lats[0]), "lat_max": float(lats[-1]),
               "lon_min": float(lons[0]), "lon_max": float(lons[-1])}
    now = datetime.now(tz=LOCAL_TZ)
    # Open-Meteo geeft de model-init niet terug. Leid de nominale run af uit de
    # synoptische 6-uurscyclus (00/06/12/18 UTC) met 3u marge zodat we nooit een
    # nog-niet-gepubliceerde run claimen.
    from datetime import timezone as _tz, timedelta as _td
    _ref = datetime.now(_tz.utc) - _td(hours=3)
    _run_dt = _ref.replace(hour=(_ref.hour // 6) * 6, minute=0, second=0, microsecond=0)
    run_utc_str = _run_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    _run_lt = _run_dt.astimezone(LOCAL_TZ)
    meta = {
        "model": cfg["label"],
        "run": _run_lt.strftime("%A %d.%m.%Y %H:%M LT"),
        "run_utc": run_utc_str,
        "bijgewerkt": (str(now.day) + " " + ["januari", "februari", "maart", "april", "mei", "juni",
                       "juli", "augustus", "september", "oktober", "november", "december"][now.month-1]
                       + now.strftime(" %Y %H:%M")),
        "uren": n_steps,
        "tijden": times,
        "grid": grid_hr,
        "parameters": {
            "neerslag": {"file": f"{PREFIX}_data_neerslag.bin", "components": 1,
                         "label": "Uurlijkse neerslag (mm/u)", "dtype": "u8sqrt", "scale": 50, "power": 3, "grid": grid_hr},
            "radar": {"file": f"{PREFIX}_data_radar.bin", "components": 1,
                      "label": "Radar afgeleid uit uursom (Marshall-Palmer dBZ)",
                      "dtype": "u8sqrt", "scale": 3, "power": 1, "grid": grid_hr},
            "cumul": {"file": f"{PREFIX}_data_cumul.bin", "components": 1,
                      "label": "Cumulatieve neerslag (mm)", "dtype": "u8sqrt", "scale": 32, "power": 3, "grid": grid_hr},
            "temp": {"file": f"{PREFIX}_data_temp.bin", "components": 1, "label": "Temperatuur 2m (°C)"},
            "dauwpunt": {"file": f"{PREFIX}_data_dauwpunt.bin", "components": 1, "label": "Dauwpuntstemperatuur 2m (°C)"},
            "rv": {"file": f"{PREFIX}_data_rv.bin", "components": 1, "label": "Relatieve vochtigheid 2m (%)"},
            "bewolking": {"file": f"{PREFIX}_data_bewolking.bin", "components": 3, "label": "Bewolking (hoog/midden/laag)"},
            "wind": {"file": f"{PREFIX}_data_wind.bin", "components": 2, "label": "Wind 10m (Bft)"},
            "windstoten": {"file": f"{PREFIX}_data_windstoten.bin", "components": 2, "label": "Windstoten 10m (km/u)"},
            "druk": {"file": f"{PREFIX}_data_druk.bin", "components": 1, "label": "Luchtdruk zeeniveau (hPa)"},
            "cape": {"file": f"{PREFIX}_data_cape.bin", "components": 1, "label": "CAPE (J/kg)"},
            "straling": {"file": f"{PREFIX}_data_straling.bin", "components": 1, "label": "Globale straling (W/m²)"},
            **({"zon": {"file": f"{PREFIX}_data_zon.bin", "components": 1, "label": "Zonneschijn (minuten per uur)"}} if heeft_zon else {}),
            "cumstraling": {"file": f"{PREFIX}_data_cumstraling.bin", "components": 1,
                            "label": "Straling dagsom (Wh/m², reset middernacht)"},
        },
        "overlay": "harmonie_overlay.png",
    }
    if cfg.get("visibility"):
        meta["parameters"]["zicht"] = {
            "file": f"{PREFIX}_data_zicht.bin", "components": 1, "label": "Zicht (m)"
        }
    meta_name = f"{PREFIX}_canvas_meta.json"
    (WORK_DIR / meta_name).write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    print(f"  {meta_name}: {n_steps} stappen")

    if args.test:
        print("TEST: geen upload.")
        return 0

    # ── Upload (gzip) ────────────────────────────────────────────
    import boto3
    s3 = boto3.client("s3", endpoint_url=R2_ENDPOINT,
                      aws_access_key_id=R2_ACCESS_KEY, aws_secret_access_key=R2_SECRET_KEY,
                      region_name="auto")
    bestanden = [meta_name]
    for f2 in sorted(os.listdir(WORK_DIR)):
        if f2.startswith(f"{PREFIX}_data_") and f2.endswith(".bin"):
            bestanden.append(f2)
    for f2 in bestanden:
        ct = "application/json" if f2.endswith(".json") else "application/octet-stream"
        with open(WORK_DIR / f2, "rb") as fh:
            body = gzip.compress(fh.read(), compresslevel=6)
        s3.put_object(Bucket=R2_BUCKET, Key=f2, Body=body, ContentType=ct, ContentEncoding="gzip")
        print(f"   R2: {f2} ({(WORK_DIR / f2).stat().st_size/1024/1024:.1f} MB → {len(body)/1024/1024:.1f} gz)")
    print("Klaar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
