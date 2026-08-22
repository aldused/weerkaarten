#!/usr/bin/env python3
"""Bouw point-major modelbestanden voor snelle locatiequeries.

De canvasbestanden zijn geordend als [tijd][component][roosterpunt]. Voor een
puntverwachting zou daardoor voor ieder uur een losse range nodig zijn. Deze
helper herschikt alleen de parameters die Weerbewaking gebruikt naar
[roosterpunt][tijd][component]. Alle tijden van nabijgelegen roosterpunten
staan dan in één klein aaneengesloten R2-bereik.
"""

from __future__ import annotations

import argparse
import json
import shutil
import struct
from pathlib import Path

import numpy as np


DEFAULT_PARAMETERS = (
    "temp",
    "rv",
    "neerslag",
    "wind",
    "windstoten",
    "bewolking",
    "cape",
    "onweer",
)


def _dtype(info: dict, header_dtype: int) -> tuple[np.dtype, str, int]:
    name = info.get("dtype") or ("u8sqrt" if header_dtype == 1 else "float32")
    if name == "u8sqrt":
        return np.dtype("u1"), name, 1
    if name == "float32":
        return np.dtype("<f4"), name, 4
    raise ValueError(f"Niet-ondersteund dtype voor point-source: {name}")


def _read_header(path: Path) -> tuple[int, int, int, int, int]:
    raw = path.read_bytes()[:16]
    if len(raw) != 16:
        raise ValueError(f"Ongeldige rasterheader: {path}")
    n_lat, n_lon, n_steps, n_comp = struct.unpack_from("<HHHH", raw, 0)
    return n_lat, n_lon, n_steps, n_comp, raw[8]


def build_point_source(
    model: str,
    meta_path: str | Path,
    output_root: str | Path,
    parameters: tuple[str, ...] = DEFAULT_PARAMETERS,
    chunk_points: int = 4096,
) -> tuple[Path, list[Path]]:
    meta_path = Path(meta_path)
    source_dir = meta_path.parent
    output_dir = Path(output_root) / model
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    manifest = {
        "version": 1,
        "layout": "point-time-component",
        "model": model,
        "label": meta.get("model") or model,
        "run": meta.get("run"),
        "run_utc": meta.get("run_utc"),
        "bijgewerkt": meta.get("bijgewerkt"),
        "tijden": meta.get("tijden") or [],
        "parameters": {},
    }
    outputs: list[Path] = []

    for key in parameters:
        info = (meta.get("parameters") or {}).get(key)
        if not info:
            continue
        source = source_dir / info["file"]
        if not source.exists():
            continue

        n_lat, n_lon, n_steps, n_comp, header_dtype = _read_header(source)
        dtype, dtype_name, bytes_per_value = _dtype(info, header_dtype)
        n_points = n_lat * n_lon
        expected = 16 + n_points * n_steps * n_comp * bytes_per_value
        if source.stat().st_size != expected:
            raise ValueError(
                f"Rastergrootte klopt niet voor {source.name}: "
                f"{source.stat().st_size} != {expected}"
            )

        source_array = np.memmap(
            source,
            mode="r",
            dtype=dtype,
            offset=16,
            shape=(n_steps, n_comp, n_points),
        )
        target = output_dir / f"{key}.bin"
        with target.open("wb") as handle:
            handle.write(struct.pack("<HHHH", n_lat, n_lon, n_steps, n_comp))
            # byte 8=dtype (bestaande conventie), byte 9=layout 1 (point-major)
            handle.write(bytes([1 if dtype_name == "u8sqrt" else 0, 1]) + b"\x00" * 6)
            for start in range(0, n_points, chunk_points):
                end = min(n_points, start + chunk_points)
                block = np.ascontiguousarray(source_array[:, :, start:end].transpose(2, 0, 1))
                handle.write(block.tobytes(order="C"))

        grid = info.get("grid") or meta.get("grid")
        manifest["parameters"][key] = {
            "key": f"point-source/{model}/{key}.bin",
            "components": n_comp,
            "steps": n_steps,
            "dtype": dtype_name,
            "scale": info.get("scale"),
            "bytes_per_value": bytes_per_value,
            "grid": grid,
        }
        outputs.append(target)
        print(f"point-source {model}/{key}: {target.stat().st_size / 1024 / 1024:.1f} MB")

    manifest_path = output_dir / "meta.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    outputs.append(manifest_path)
    return manifest_path, outputs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--meta", required=True)
    parser.add_argument("--output", default="/tmp/weerlab-point-source")
    args = parser.parse_args()
    manifest, files = build_point_source(args.model, args.meta, args.output)
    print(f"Manifest: {manifest} ({len(files) - 1} parameters)")


if __name__ == "__main__":
    main()
