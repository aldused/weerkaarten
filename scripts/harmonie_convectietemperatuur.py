#!/usr/bin/env python3
"""Maak een compacte HARMONIE-kaartlaag met de convectietemperatuur.

De convectietemperatuur is de 2m-temperatuur waarbij een vanaf de grond
verwarmd luchtpakket droogadiabatisch het convectieve condensatieniveau
(CCL) bereikt. Voor deze demo wordt het CCL bepaald uit:

* HARMONIE dauwpunt en luchtdruk aan de grond;
* HARMONIE temperatuur op 2, 50, 100, 200 en 300 meter;
* HARMONIE/Open-Meteo temperatuur en hoogte op 850, 500 en 300 hPa.

Het resultaat is een klein float32-canvasbestand op het 0,15-gradenrooster
van de drukvlakken, bestemd voor de Weerkaarten-keuzelijst.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent.parent
OUT_BIN = ROOT / "harmonie_data_convectietemp.bin"
KAPPA = 0.2854
SCALE_HEIGHT_M = 8000.0


def read_bin(path: Path) -> np.ndarray:
    with path.open("rb") as fh:
        header = fh.read(16)
        if len(header) != 16:
            raise ValueError(f"Ongeldige header in {path.name}")
        n_lat, n_lon, n_steps, n_comp = struct.unpack("<HHHH", header[:8])
        dtype = header[8]
        if dtype != 0:
            raise ValueError(f"{path.name}: alleen float32 wordt ondersteund")
        data = np.fromfile(fh, dtype="<f4")
    expected = n_steps * n_comp * n_lat * n_lon
    if data.size != expected:
        raise ValueError(f"{path.name}: {data.size} waarden, verwacht {expected}")
    return data.reshape(n_steps, n_comp, n_lat, n_lon)


def write_bin(path: Path, data: np.ndarray) -> None:
    n_steps, n_lat, n_lon = data.shape
    with path.open("wb") as fh:
        fh.write(struct.pack("<HHHH", n_lat, n_lon, n_steps, 1))
        fh.write(b"\x00" * 8)
        data.astype("<f4", copy=False).tofile(fh)


def grid_for(meta: dict, key: str) -> dict:
    return meta["parameters"][key].get("grid") or meta["grid"]


def regrid_nearest(data: np.ndarray, source: dict, target: dict) -> np.ndarray:
    """Nearest-neighbour van een regelmatig lat/lon-rooster naar target."""
    src_lat = np.linspace(source["lat_min"], source["lat_max"], source["n_lat"])
    src_lon = np.linspace(source["lon_min"], source["lon_max"], source["n_lon"])
    dst_lat = np.linspace(target["lat_min"], target["lat_max"], target["n_lat"])
    dst_lon = np.linspace(target["lon_min"], target["lon_max"], target["n_lon"])
    yi = np.abs(src_lat[:, None] - dst_lat[None, :]).argmin(axis=0)
    xi = np.abs(src_lon[:, None] - dst_lon[None, :]).argmin(axis=0)
    return np.take(np.take(data, yi, axis=-2), xi, axis=-1)


def saturation_temperature(p_hpa: np.ndarray, mixing_ratio: np.ndarray) -> np.ndarray:
    """Temperatuur (C) op de verzadigde mengverhoudingslijn bij druk p."""
    vapour_pressure = mixing_ratio * p_hpa / (0.622 + mixing_ratio)
    log_ratio = np.log(np.maximum(vapour_pressure, 0.01) / 6.112)
    return 243.5 * log_ratio / (17.67 - log_ratio)


def calculate(meta: dict) -> np.ndarray:
    required = ["temp", "dauwpunt", "druk", "profiel", "hoogte_300", "hoogte_500", "hoogte_850"]
    missing = [key for key in required if key not in meta.get("parameters", {})]
    if missing:
        raise RuntimeError("Ontbrekende HARMONIE-velden: " + ", ".join(missing))

    arrays = {}
    for key in required:
        arrays[key] = read_bin(ROOT / meta["parameters"][key]["file"])

    target = dict(grid_for(meta, "hoogte_850"))
    n_steps = min(arr.shape[0] for arr in arrays.values())
    target["n_lat"] = int(target["n_lat"])
    target["n_lon"] = int(target["n_lon"])

    def on_target(key: str) -> np.ndarray:
        return regrid_nearest(arrays[key][:n_steps], grid_for(meta, key), target)

    temp = on_target("temp")[:, 0]
    dewpoint = on_target("dauwpunt")[:, 0]
    pressure = on_target("druk")[:, 0]
    pressure = np.where(pressure > 2000, pressure / 100.0, pressure)
    profile = on_target("profiel")[:, :5]
    level_850 = on_target("hoogte_850")
    level_500 = on_target("hoogte_500")
    level_300 = on_target("hoogte_300")

    # De 2m-component in profiel hoort gelijk te zijn aan temp. Gebruik temp als
    # vangnet wanneer een profielpunt ontbreekt.
    profile[:, 0] = np.where(np.isfinite(profile[:, 0]), profile[:, 0], temp)

    vapour_pressure = 6.112 * np.exp(17.67 * dewpoint / (dewpoint + 243.5))
    mixing_ratio = 0.622 * vapour_pressure / np.maximum(pressure - vapour_pressure, 1.0)

    near_heights = [2.0, 50.0, 100.0, 200.0, 300.0]
    p_levels = [pressure * np.exp(-height / SCALE_HEIGHT_M) for height in near_heights]
    t_levels = [profile[:, idx] for idx in range(5)]
    p_levels.extend([
        np.full_like(pressure, 850.0),
        np.full_like(pressure, 500.0),
        np.full_like(pressure, 300.0),
    ])
    t_levels.extend([level_850[:, 1], level_500[:, 1], level_300[:, 1]])

    shape = pressure.shape
    ccl_pressure = np.full(shape, np.nan, dtype=np.float64)
    ccl_temperature = np.full(shape, np.nan, dtype=np.float64)

    first_mix_temp = saturation_temperature(p_levels[0], mixing_ratio)
    previous_p = p_levels[0]
    previous_diff = t_levels[0] - first_mix_temp
    saturated_surface = np.isfinite(previous_diff) & (previous_diff <= 0)
    ccl_pressure[saturated_surface] = previous_p[saturated_surface]
    ccl_temperature[saturated_surface] = first_mix_temp[saturated_surface]

    # Zoek alle kruisingen; de hoogste kruising wint (zelfde keuze als de
    # gebruikelijke 'top CCL' bij meerdere inversielagen).
    subdivisions = 10
    for level_idx in range(len(p_levels) - 1):
        p0, p1 = p_levels[level_idx], p_levels[level_idx + 1]
        t0, t1 = t_levels[level_idx], t_levels[level_idx + 1]
        valid_segment = np.isfinite(p0) & np.isfinite(p1) & np.isfinite(t0) & np.isfinite(t1) & (p0 > p1)
        log_p0 = np.log(np.maximum(p0, 1.0))
        log_p1 = np.log(np.maximum(p1, 1.0))
        for sub_idx in range(1, subdivisions + 1):
            fraction = sub_idx / subdivisions
            current_log_p = log_p0 + fraction * (log_p1 - log_p0)
            current_p = np.exp(current_log_p)
            current_t = t0 + fraction * (t1 - t0)
            mix_temp = saturation_temperature(current_p, mixing_ratio)
            current_diff = current_t - mix_temp
            crossing = (
                valid_segment
                & np.isfinite(previous_diff)
                & np.isfinite(current_diff)
                & (previous_diff > 0)
                & (current_diff <= 0)
            )
            denominator = previous_diff - current_diff
            cross_fraction = np.divide(
                previous_diff,
                denominator,
                out=np.zeros_like(previous_diff),
                where=np.abs(denominator) > 1e-9,
            )
            # Alleen echte kruisingen gebruiken dit getal. Begrenzen voorkomt
            # overflow in de vectorberekening voor alle overige roosterpunten.
            cross_fraction = np.clip(cross_fraction, 0.0, 1.0)
            cross_log_p = np.log(np.maximum(previous_p, 1.0)) + cross_fraction * (
                current_log_p - np.log(np.maximum(previous_p, 1.0))
            )
            cross_p = np.exp(cross_log_p)
            cross_t = saturation_temperature(cross_p, mixing_ratio)
            ccl_pressure[crossing] = cross_p[crossing]
            ccl_temperature[crossing] = cross_t[crossing]
            previous_p = current_p
            previous_diff = current_diff

    convective_temperature = (ccl_temperature + 273.15) * np.power(
        pressure / ccl_pressure, KAPPA
    ) - 273.15
    invalid = (
        ~np.isfinite(convective_temperature)
        | (convective_temperature < -30)
        | (convective_temperature > 60)
    )
    convective_temperature[invalid] = np.nan

    return convective_temperature.astype(np.float32)


def main() -> int:
    with (ROOT / "harmonie_canvas_meta.json").open() as fh:
        meta = json.load(fh)
    data = calculate(meta)
    write_bin(OUT_BIN, data)

    finite = data[np.isfinite(data)]
    if finite.size:
        p10, median, p90 = np.percentile(finite, [10, 50, 90])
        print(
            f"[convectietemperatuur] {data.shape[0]} stappen, "
            f"{data.shape[1]}x{data.shape[2]}, p10/mediaan/p90="
            f"{p10:.1f}/{median:.1f}/{p90:.1f} °C"
        )
    print(f"[convectietemperatuur] {OUT_BIN.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
