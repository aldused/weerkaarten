#!/usr/bin/env python3
"""Download en converteer de experimentele KNMI HARMONIE-AROME Cy46 P1-run.

Cy46 wordt bewust naast Cy43 gepubliceerd. De bron is GRIB2; de uitvoer gebruikt
dezelfde compacte canvasindeling als de bestaande Weerlab-modelkaarten.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import struct
import tarfile
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import eccodes
import numpy as np
import requests


ROOT = Path(__file__).resolve().parents[1]
DATASET = "harmonie_arome_cy46_p1"
VERSION = "1.0"
PREFIX = "harmonie46"
META_FILE = ROOT / f"{PREFIX}_canvas_meta.json"
EXTENT = (0.5, 12.5, 47.5, 56.5)
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
TEMP_LEVELS = (2, 50, 100, 200, 300)
WIND_LEVELS = (10, 50, 100, 200, 300)


def api_key() -> str:
    key = os.environ.get("KNMI_API_KEY", "").strip()
    if key:
        return key
    # Gebruik dezelfde lokaal geconfigureerde sleutel als de Cy43-pijplijn.
    source = (ROOT / "scripts/harmonie_update.sh").read_text(encoding="utf-8")
    match = re.search(r"^KEY = '([^']+)'", source, flags=re.MULTILINE)
    if not match:
        raise RuntimeError("KNMI_API_KEY ontbreekt")
    return match.group(1)


@contextlib.contextmanager
def atomic(path: Path, mode: str = "wb"):
    tmp = path.with_name(path.name + ".tmp")
    try:
        with tmp.open(mode) as handle:
            yield handle
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def latest_file(session: requests.Session) -> str:
    url = f"https://api.dataplatform.knmi.nl/open-data/v1/datasets/{DATASET}/versions/{VERSION}/files"
    response = session.get(
        url,
        params={"maxKeys": 1, "orderBy": "created", "sorting": "desc"},
        timeout=30,
    )
    response.raise_for_status()
    files = response.json().get("files") or []
    if not files:
        raise RuntimeError("KNMI levert nog geen Cy46-bestand")
    return files[0]["filename"]


def run_datetime(filename: str) -> datetime:
    match = re.search(r"(20\d{8})", filename)
    if not match:
        raise RuntimeError(f"Geen runtijd in bestandsnaam: {filename}")
    return datetime.strptime(match.group(1), "%Y%m%d%H").replace(tzinfo=timezone.utc)


def download_archive(session: requests.Session, filename: str, target: Path) -> None:
    endpoint = (
        f"https://api.dataplatform.knmi.nl/open-data/v1/datasets/{DATASET}/"
        f"versions/{VERSION}/files/{filename}/url"
    )
    response = session.get(endpoint, timeout=30)
    response.raise_for_status()
    download_url = response.json()["temporaryDownloadUrl"]
    # De tijdelijke S3-link is al ondertekend; stuur de KNMI Authorization-header
    # daar niet nogmaals heen, want dat maakt de AWS-signature ongeldig.
    with requests.get(download_url, stream=True, timeout=600) as source, target.open("wb") as output:
        source.raise_for_status()
        for chunk in source.iter_content(chunk_size=1024 * 1024):
            if chunk:
                output.write(chunk)


def grib_files(directory: Path) -> list[Path]:
    found = sorted(
        path
        for path in directory.rglob("*")
        if path.is_file() and path.name.endswith(("_GB", ".grib", ".grib2"))
    )
    if len(found) < 2:
        raise RuntimeError(f"Onvoldoende Cy46-tijdstappen: {len(found)}")
    return found


def empty_fields() -> dict[str, np.ndarray | None]:
    return {
        "temp": None,
        "cum": None,
        "regenrate": None,
        "hoog": None,
        "mid": None,
        "laag": None,
        "uw": None,
        "vw": None,
        "ug": None,
        "vg": None,
        "zicht": None,
        "rv": None,
        "druk": None,
        "dauwpunt": None,
        "wolkenbasis": None,
        "straling": None,
    }


def read_steps(files: list[Path]):
    series = {key: [] for key in empty_fields()}
    temp_profile = {level: [] for level in TEMP_LEVELS}
    wind_profile = {level: [] for level in WIND_LEVELS}
    lats = lons = None
    ni = nj = 0

    for path in files:
        fields = empty_fields()
        temps: dict[int, np.ndarray] = {}
        u_profile: dict[int, np.ndarray] = {}
        v_profile: dict[int, np.ndarray] = {}
        with path.open("rb") as handle:
            while True:
                gid = eccodes.codes_grib_new_from_file(handle)
                if gid is None:
                    break
                try:
                    short = eccodes.codes_get_string(gid, "shortName")
                    level = eccodes.codes_get_long(gid, "level")
                    level_type = eccodes.codes_get_string(gid, "typeOfLevel")
                    ni2 = eccodes.codes_get_long(gid, "Ni")
                    nj2 = eccodes.codes_get_long(gid, "Nj")
                    values = eccodes.codes_get_values(gid).reshape(nj2, ni2)

                    if short in ("2t", "t") and level_type == "heightAboveGround":
                        if level == 2:
                            fields["temp"] = values - 273.15
                        if level in TEMP_LEVELS:
                            temps[level] = values - 273.15
                    elif short == "2d":
                        fields["dauwpunt"] = values - 273.15
                    elif short == "2r":
                        fields["rv"] = values
                    elif short == "tp":
                        fields["cum"] = values
                    elif short == "rprate":
                        # kg m-2 s-1 is voor vloeibaar water gelijk aan mm/s.
                        # Bewaar als mm/u voor de gesimuleerde radar.
                        fields["regenrate"] = np.maximum(values * 3600.0, 0)
                    elif short == "hcc":
                        fields["hoog"] = values / 100.0
                    elif short == "mcc":
                        fields["mid"] = values / 100.0
                    elif short == "lcc":
                        fields["laag"] = values / 100.0
                    elif short in ("10u", "u") and level_type == "heightAboveGround":
                        if level == 10:
                            fields["uw"] = values
                        if level in WIND_LEVELS:
                            u_profile[level] = values
                    elif short in ("10v", "v") and level_type == "heightAboveGround":
                        if level == 10:
                            fields["vw"] = values
                        if level in WIND_LEVELS:
                            v_profile[level] = values
                    elif short == "max_10efg":
                        fields["ug"] = values
                    elif short == "max_10nfg":
                        fields["vg"] = values
                    elif short == "vis":
                        fields["zicht"] = values
                    elif short == "msl":
                        fields["druk"] = values
                    elif short == "cbh":
                        fields["wolkenbasis"] = values
                    elif short == "ssrd":
                        fields["straling"] = values

                    if lats is None:
                        lat1 = eccodes.codes_get_double(gid, "latitudeOfFirstGridPointInDegrees")
                        lat2 = eccodes.codes_get_double(gid, "latitudeOfLastGridPointInDegrees")
                        lon1 = eccodes.codes_get_double(gid, "longitudeOfFirstGridPointInDegrees")
                        lon2 = eccodes.codes_get_double(gid, "longitudeOfLastGridPointInDegrees")
                        lats = np.linspace(lat1, lat2, nj2)
                        lons = np.linspace(lon1, lon2, ni2)
                        ni, nj = ni2, nj2
                finally:
                    eccodes.codes_release(gid)

        required = ("temp", "cum", "regenrate", "hoog", "mid", "laag", "uw", "vw", "ug", "vg", "zicht", "rv", "druk", "dauwpunt")
        missing = [key for key in required if fields[key] is None]
        if missing:
            raise RuntimeError(f"{path.name}: ontbrekende velden: {', '.join(missing)}")
        zero = np.zeros((nj, ni), dtype=np.float64)
        for key, value in fields.items():
            series[key].append(value if value is not None else zero)
        for level in TEMP_LEVELS:
            temp_profile[level].append(temps.get(level, zero))
        for level in WIND_LEVELS:
            u = u_profile.get(level, zero)
            v = v_profile.get(level, zero)
            wind_profile[level].append(np.hypot(u, v))

    assert lats is not None and lons is not None
    if lats[0] > lats[-1]:
        lats = lats[::-1]
        for key in series:
            series[key] = [value[::-1, :] for value in series[key]]
        for level in TEMP_LEVELS:
            temp_profile[level] = [value[::-1, :] for value in temp_profile[level]]
        for level in WIND_LEVELS:
            wind_profile[level] = [value[::-1, :] for value in wind_profile[level]]
    return lats, lons, series, temp_profile, wind_profile


def export(run: datetime, lats, lons, series, temp_profile, wind_profile) -> list[Path]:
    lon_min, lon_max, lat_min, lat_max = EXTENT
    lat_full = np.where((lats >= lat_min) & (lats <= lat_max))[0]
    lon_full = np.where((lons >= lon_min) & (lons <= lon_max))[0]
    lat_idx, lon_idx = lat_full[::2], lon_full[::2]
    n_lat, n_lon = len(lat_idx), len(lon_idx)
    n_steps = len(series["temp"]) - 1
    outputs: list[Path] = []

    def grid(indices_lat=lat_idx, indices_lon=lon_idx):
        return {
            "n_lat": len(indices_lat),
            "n_lon": len(indices_lon),
            "lat_min": float(lats[indices_lat[0]]),
            "lat_max": float(lats[indices_lat[-1]]),
            "lon_min": float(lons[indices_lon[0]]),
            "lon_max": float(lons[indices_lon[-1]]),
        }

    def crop(value, indices_lat=lat_idx, indices_lon=lon_idx):
        return np.nan_to_num(value[np.ix_(indices_lat, indices_lon)], nan=0).astype("<f4")

    def write_float(name: str, values, components: int = 1, indices_lat=lat_idx, indices_lon=lon_idx):
        path = ROOT / f"{PREFIX}_data_{name}.bin"
        with atomic(path) as handle:
            handle.write(struct.pack("<HHHH", len(indices_lat), len(indices_lon), len(values), components))
            handle.write(b"\x00" * 8)
            for value in values:
                items = (value,) if components == 1 else value
                for item in items:
                    handle.write(crop(item, indices_lat, indices_lon).tobytes())
        outputs.append(path)
        return path

    hourly_precip = [
        np.maximum(series["cum"][idx] - series["cum"][idx - 1], 0)
        for idx in range(1, len(series["cum"]))
    ]
    hourly_radiation = [
        np.maximum((series["straling"][idx] - series["straling"][idx - 1]) / 3600.0, 0)
        for idx in range(1, len(series["straling"]))
    ]

    precip_grid = grid(lat_full, lon_full)
    # q = round(waarde**(1/power)*scale); exponent staat als 'power' in de meta.
    # Zie harmonie_update.sh voor de reden dat de wortel met scale 16 onderaan
    # te grof was en bovenaan het halve bytebereik onbenut liet.
    def write_u8sqrt(name: str, values, scale: int, power: int = 2):
        path = ROOT / f"{PREFIX}_data_{name}.bin"
        with atomic(path) as handle:
            handle.write(struct.pack("<HHHH", len(lat_full), len(lon_full), len(values), 1))
            handle.write(bytes([1]) + b"\x00" * 7)
            for value in values:
                subset = np.nan_to_num(value[np.ix_(lat_full, lon_full)], nan=0)
                encoded = np.clip(np.rint(np.maximum(subset, 0) ** (1.0 / power) * scale), 0, 255).astype("u1")
                handle.write(encoded.tobytes())
        outputs.append(path)
        return path

    write_u8sqrt("neerslag", hourly_precip, 50, 3)
    # De meta biedt dit bestand aan als 'radar' in dBZ, maar rprate levert een
    # regenintensiteit in mm/u. Die ging ongewijzigd de dBZ-kleurschaal in,
    # waardoor 30 mm/u als 30 dBZ werd geverfd en alles onder 4 mm/u onder de
    # laagste dBZ-klasse verdween: het radarpaneel van V46 bleef leeg. Nu
    # dezelfde Marshall-Palmer-omrekening als bij V43 en AROME.
    _regenrate = [np.nan_to_num(v, nan=0.0) for v in series["regenrate"][1:]]
    _dbz = [np.where(r >= 0.05,
                     10 * np.log10(np.maximum(200 * np.maximum(r, 0.001) ** 1.6, 1)),
                     0.0)
            for r in _regenrate]
    write_u8sqrt("regenrate", _dbz, 3, 1)
    accum = []
    total = None
    for value in hourly_precip:
        total = value.copy() if total is None else total + value
        accum.append(total.copy())
    write_u8sqrt("cumul", accum, 32, 3)
    write_float("temp", series["temp"][1:])
    write_float("bewolking", list(zip(series["hoog"][1:], series["mid"][1:], series["laag"][1:])), 3)
    write_float("wind", list(zip(series["uw"][1:], series["vw"][1:])), 2)
    write_float("windstoten", list(zip(series["ug"][1:], series["vg"][1:])), 2)
    write_float("zicht", series["zicht"][1:])
    write_float("rv", series["rv"][1:])
    write_float("druk", series["druk"][1:])
    write_float("dauwpunt", series["dauwpunt"][1:])
    write_float("wolkenbasis", series["wolkenbasis"][1:])
    write_float("straling", hourly_radiation)

    profile_lat, profile_lon = lat_full[::3], lon_full[::3]
    profile_path = ROOT / f"{PREFIX}_data_profiel.bin"
    with atomic(profile_path) as handle:
        handle.write(struct.pack("<HHHH", len(profile_lat), len(profile_lon), n_steps, 10))
        handle.write(b"\x00" * 8)
        for step in range(1, len(series["temp"])):
            for level in TEMP_LEVELS:
                handle.write(crop(temp_profile[level][step], profile_lat, profile_lon).tobytes())
            for level in WIND_LEVELS:
                handle.write(crop(wind_profile[level][step], profile_lat, profile_lon).tobytes())
    outputs.append(profile_path)

    local_run = run.astimezone(LOCAL_TZ)
    weekdays = ("maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag")
    run_label = weekdays[local_run.weekday()] + " " + local_run.strftime("%d.%m.%Y %H:%M LT")
    times = [
        (run + timedelta(hours=hour)).astimezone(LOCAL_TZ).strftime("%Y-%m-%dT%H:%M")
        for hour in range(1, n_steps + 1)
    ]
    base_grid = grid()
    params = {
        "neerslag": {"file": f"{PREFIX}_data_neerslag.bin", "components": 1, "label": "Uurlijkse neerslag (mm/u)", "dtype": "u8sqrt", "scale": 50, "power": 3, "grid": precip_grid},
        "radar": {"file": f"{PREFIX}_data_regenrate.bin", "components": 1, "label": "Radar afgeleid uit rprate (Marshall-Palmer dBZ)", "dtype": "u8sqrt", "scale": 3, "power": 1, "grid": precip_grid},
        "cumul": {"file": f"{PREFIX}_data_cumul.bin", "components": 1, "label": "Cumulatieve neerslag (mm)", "dtype": "u8sqrt", "scale": 32, "power": 3, "grid": precip_grid},
        "temp": {"file": f"{PREFIX}_data_temp.bin", "components": 1, "label": "Temperatuur 2m (°C)"},
        "bewolking": {"file": f"{PREFIX}_data_bewolking.bin", "components": 3, "label": "Bewolking (hoog/midden/laag)"},
        "wind": {"file": f"{PREFIX}_data_wind.bin", "components": 2, "label": "Wind 10m (m/s)"},
        "windstoten": {"file": f"{PREFIX}_data_windstoten.bin", "components": 2, "label": "Windstoten 10m (m/s)"},
        "zicht": {"file": f"{PREFIX}_data_zicht.bin", "components": 1, "label": "Zicht (m)"},
        "rv": {"file": f"{PREFIX}_data_rv.bin", "components": 1, "label": "Relatieve vochtigheid (%)"},
        "druk": {"file": f"{PREFIX}_data_druk.bin", "components": 1, "label": "Luchtdruk (Pa)"},
        "dauwpunt": {"file": f"{PREFIX}_data_dauwpunt.bin", "components": 1, "label": "Dauwpunt 2m (°C)"},
        "wolkenbasis": {"file": f"{PREFIX}_data_wolkenbasis.bin", "components": 1, "label": "Wolkenbasis (m)"},
        "straling": {"file": f"{PREFIX}_data_straling.bin", "components": 1, "label": "Globale straling (W/m²)"},
        "profiel": {"file": f"{PREFIX}_data_profiel.bin", "components": 10, "label": "Temperatuur/windprofiel 2-300 m", "grid": grid(profile_lat, profile_lon), "levels": {"temperature_m": list(TEMP_LEVELS), "wind_speed_m": list(WIND_LEVELS)}},
    }
    now = datetime.now(tz=LOCAL_TZ)
    meta = {
        "model": "HARMONIE V46",
        "cycle": 46,
        "experimental": True,
        "source": "KNMI Data Platform · HARMONIE Cy46 P1-feed",
        "run": run_label,
        "run_utc": run.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bijgewerkt": now.strftime("%d-%m-%Y %H:%M"),
        "uren": n_steps,
        "tijden": times,
        "grid": base_grid,
        "parameters": params,
        "overlay": "harmonie_overlay.png",
    }
    with atomic(META_FILE, "w") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
    outputs.append(META_FILE)
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    session = requests.Session()
    session.headers.update({"Authorization": api_key()})
    filename = latest_file(session)
    run = run_datetime(filename)
    if META_FILE.exists() and not args.force:
        old = json.loads(META_FILE.read_text(encoding="utf-8"))
        if old.get("run_utc") == run.strftime("%Y-%m-%dT%H:%M:%SZ"):
            print(f"HARMONIE 46 {old['run_utc']} is al verwerkt")
            return 10

    print(f"HARMONIE 46 downloaden: {filename}")
    with tempfile.TemporaryDirectory(prefix="harmonie46_") as name:
        directory = Path(name)
        archive = directory / filename
        download_archive(session, filename, archive)
        print(f"Archief: {archive.stat().st_size / 1024 / 1024:.0f} MB")
        with tarfile.open(archive, "r") as tar:
            tar.extractall(directory, filter="data")
        files = grib_files(directory)
        print(f"GRIB2-tijdstappen: {len(files)}")
        lats, lons, series, temp_profile, wind_profile = read_steps(files)
        outputs = export(run, lats, lons, series, temp_profile, wind_profile)
    print(f"HARMONIE 46 klaar: {run:%Y-%m-%d %HZ}, {len(outputs)} bestanden")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
