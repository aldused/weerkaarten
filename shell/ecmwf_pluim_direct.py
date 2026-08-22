#!/usr/bin/env python3
"""Build compact Weerlab plume archives directly from ECMWF Open Data.

The global GRIB messages are downloaded in small batches to a temporary
directory, sampled at the configured Weerlab stations, and unlinked as soon as
each batch has been decoded. Only the compact per-station JSON output remains.

Cycle 50r1 note: the 50 perturbed members are read from ``enfo/pf``. The
control member is no longer part of that stream and is read from ``oper/fc``.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import signal
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Iterable

import eccodes
import numpy as np
import ecmwf.opendata.client as ecmwf_client_module
from ecmwf.opendata import Client
from multiurl.base import NoBar


DEFAULT_REPO = Path("/Users/aldus/KNMI_Project/weerlab")
PERTURBED_MEMBERS = tuple(range(1, 51))
ALL_CYCLES = (0, 6, 12, 18)
DEFAULT_DIRECT_CYCLES = (12, 18)
LONG_CYCLES = (0, 12)
LONG_STEPS = tuple(range(0, 145, 3)) + tuple(range(150, 361, 6))
SHORT_STEPS = tuple(range(0, 145, 3))
ECMWF_ROOT = "https://data.ecmwf.int/forecasts"

FIELD_SETS = {
    "basic": ("2t", "tp"),
    "core": ("2t", "tp", "10u", "10v", "tcc", "10fg", "mucape"),
}

OUTPUT_FIELDS = {
    "basic": ("temperature_2m", "precipitation"),
    "core": (
        "temperature_2m", "precipitation", "wind_speed_10m",
        "wind_direction_10m", "cloud_cover", "wind_gusts_10m", "cape",
    ),
}

# The 00Z/06Z O1280 feed is already native 9 km and includes these complete
# 51-member fields. Once all station archives contain that same pre-scheduled
# run, downloading the later 0.25-degree core for the identical cycle would be
# a resolution downgrade and would discard three useful specialist fields.
PRESCHEDULED_FIELDS = (
    "temperature_2m",
    "precipitation",
    "wind_speed_10m",
    "wind_direction_10m",
    "cloud_cover",
    "wind_gusts_10m",
    "dew_point_2m",
    "relative_humidity_2m",
    "snowfall",
)

# ECMWF indexes can name the native interval gust according to its aggregation
# window. Only one of these is present for a member/step; all map to the same
# Weerlab wind-gust field after decoding.
GUST_REQUEST_NAMES = ("10fg", "10fg3", "10fg6")
SHORT_NAME_ALIASES = {"10fg3": "10fg", "10fg6": "10fg"}

RAW_TO_OUTPUT = {
    "2t": "temperature_2m",
    "tp": "precipitation",
    "10fg": "wind_gusts_10m",
    "mucape": "cape",
}

DIGEST_KEYS = (
    "run",
    "times_ms",
    "temp_members",
    "temp_hres",
    "precip_members",
    "precip_hres",
    "wind_members",
    "cloud_members",
    "members",
)


def use_safe_multipart_chunk_size() -> None:
    """Avoid multiurl's 1-MiB multipart boundary assertion.

    multiurl 0.3.x can assert when an ECMWF multipart boundary lands exactly
    on its default 1-MiB read boundary. A smaller read chunk leaves the HTTP
    request and byte ranges unchanged while avoiding that parser edge case.
    """

    current = ecmwf_client_module.download
    if not getattr(current, "_weerlab_small_chunks", False):
        def download_with_small_chunks(url, target, **kwargs):
            kwargs.setdefault("chunk_size", 256 * 1024)
            kwargs.setdefault("progress_bar", lambda *args, **inner_kwargs: NoBar())
            # multiurl defaults to 500 attempts with 120-second sleeps. A
            # minute poller must fail in bounded time and retry cleanly later.
            kwargs.setdefault("maximum_retries", 3)
            kwargs.setdefault("retry_after", (2, 20, 2))
            kwargs.setdefault("timeout", 60)
            return current(url, target, **kwargs)

        download_with_small_chunks._weerlab_small_chunks = True
        ecmwf_client_module.download = download_with_small_chunks

    current_robust = ecmwf_client_module.robust
    if not getattr(current_robust, "_weerlab_bounded", False):
        def bounded_robust(
            call,
            maximum_tries=3,
            retry_after=(2, 20, 2),
            mirrors=None,
            use_server_retry_after=False,
        ):
            return current_robust(
                call,
                maximum_tries=min(int(maximum_tries), 3),
                retry_after=(2, 20, 2) if retry_after == 120 else retry_after,
                mirrors=mirrors,
                use_server_retry_after=use_server_retry_after,
            )

        bounded_robust._weerlab_bounded = True
        ecmwf_client_module.robust = bounded_robust


def configure_client_timeouts(client: Client) -> None:
    """Bound every ECMWF index GET; the upstream client has no timeout."""

    original_get = client.session.get

    def bounded_get(url, *args, **kwargs):
        kwargs.setdefault("timeout", 60)
        return original_get(url, *args, **kwargs)

    client.session.get = bounded_get


def prune_stale_runtime(current_checkpoint: Path | None, out_dir: Path) -> None:
    """Remove only abandoned artifacts owned by this direct-plume producer."""

    current = current_checkpoint.resolve() if current_checkpoint is not None else None
    for path in Path("/tmp").glob("weerlab_ecmwf_pluim_*"):
        if current is not None and path.resolve() == current:
            continue
        if path.is_symlink() or path.is_file():
            path.unlink(missing_ok=True)
        elif path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
    for path in out_dir.glob(".pluim-direct-staging-*"):
        if path.is_symlink() or path.is_file():
            path.unlink(missing_ok=True)
        elif path.is_dir():
            shutil.rmtree(path, ignore_errors=True)


def prune_prescheduled_checkpoints(temp_root: Path = Path("/tmp")) -> list[Path]:
    """Remove only 00Z/06Z checkpoints no longer owned by the default job."""

    removed: list[Path] = []
    for cycle in ("00", "06"):
        for field_set in FIELD_SETS:
            pattern = (
                "weerlab_ecmwf_pluim_checkpoint_????????_"
                f"{cycle}_{field_set}.npz"
            )
            for path in temp_root.glob(pattern):
                date_text = path.name.removeprefix(
                    "weerlab_ecmwf_pluim_checkpoint_"
                ).split("_", 1)[0]
                if len(date_text) != 8 or not date_text.isdigit():
                    continue
                if path.is_file() or path.is_symlink():
                    path.unlink(missing_ok=True)
                    removed.append(path)
    return removed


@dataclass(frozen=True)
class Station:
    name: str
    slug: str
    lat: float
    lon: float


@dataclass(frozen=True)
class GridPoint:
    index: int
    lat: float
    lon: float
    distance_km: float


@dataclass(frozen=True)
class RunSelection:
    run: datetime
    cycle: int
    source_ready_at: datetime
    discovered_at: datetime
    source_ready_verified: bool = True


@dataclass
class Metrics:
    started_monotonic: float
    grib_bytes: int = 0
    download_seconds: float = 0.0
    decode_seconds: float = 0.0
    batches: int = 0
    peak_temp_bytes: int = 0


def checkpoint_path(run: datetime, field_set: str) -> Path:
    return Path("/tmp") / f"weerlab_ecmwf_pluim_checkpoint_{run:%Y%m%d_%H}_{field_set}.npz"


def save_checkpoint(
    path: Path,
    run: datetime,
    steps: tuple[int, ...],
    stations: list[Station],
    raw_params: tuple[str, ...],
    raw: dict[str, np.ndarray],
    grid_points: tuple[GridPoint, ...],
    metrics: Metrics,
) -> None:
    metadata = {
        "run": iso_z(run),
        "steps": list(steps),
        "stations": [station.slug for station in stations],
        "raw_params": list(raw_params),
        "metrics": {
            "grib_bytes": metrics.grib_bytes,
            "download_seconds": metrics.download_seconds,
            "decode_seconds": metrics.decode_seconds,
            "batches": metrics.batches,
            "peak_temp_bytes": metrics.peak_temp_bytes,
        },
    }
    temporary = Path(f"{path}.tmp")
    try:
        with temporary.open("wb") as handle:
            np.savez_compressed(
                handle,
                metadata=np.array(json.dumps(metadata)),
                grid_index=np.array([point.index for point in grid_points], dtype=np.int64),
                grid_lat=np.array([point.lat for point in grid_points], dtype=np.float64),
                grid_lon=np.array([point.lon for point in grid_points], dtype=np.float64),
                grid_distance=np.array([point.distance_km for point in grid_points], dtype=np.float64),
                **{f"raw_{param}": values for param, values in raw.items()},
            )
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def load_checkpoint(
    path: Path,
    run: datetime,
    steps: tuple[int, ...],
    stations: list[Station],
    raw_params: tuple[str, ...],
    shape: tuple[int, int, int],
) -> tuple[dict[str, np.ndarray], tuple[GridPoint, ...], dict] | None:
    if not path.exists():
        return None
    try:
        with np.load(path, allow_pickle=False) as saved:
            metadata = json.loads(str(saved["metadata"].item()))
            expected = {
                "run": iso_z(run),
                "steps": list(steps),
                "stations": [station.slug for station in stations],
                "raw_params": list(raw_params),
            }
            if any(metadata.get(key) != value for key, value in expected.items()):
                raise RuntimeError("checkpoint identity does not match this run")
            raw = {
                param: np.array(saved[f"raw_{param}"], dtype=np.float64, copy=True)
                for param in raw_params
            }
            if any(values.shape != shape for values in raw.values()):
                raise RuntimeError("checkpoint array shape is invalid")
            indexes = np.asarray(saved["grid_index"])
            lats = np.asarray(saved["grid_lat"])
            lons = np.asarray(saved["grid_lon"])
            distances = np.asarray(saved["grid_distance"])
            if not all(len(values) == len(stations) for values in (indexes, lats, lons, distances)):
                raise RuntimeError("checkpoint grid-point count is invalid")
            grid_points = tuple(
                GridPoint(int(indexes[i]), float(lats[i]), float(lons[i]), float(distances[i]))
                for i in range(len(stations))
            )
            return raw, grid_points, metadata.get("metrics") or {}
    except Exception as error:
        path.unlink(missing_ok=True)
        raise RuntimeError(f"invalid direct-plume checkpoint {path}: {error}") from error


def iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_meta_datetime(value: object) -> datetime | None:
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None


def install_signal_handlers() -> None:
    def terminate(signum, _frame):
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, terminate)
    signal.signal(signal.SIGINT, terminate)


def load_meta_document(path: Path | None) -> dict:
    if path is None or not path.exists():
        return {}
    try:
        document = json.loads(path.read_text())
    except Exception as error:
        raise RuntimeError(f"invalid direct-plume metadata: {path}") from error
    if not isinstance(document, dict):
        raise RuntimeError(f"invalid direct-plume metadata object: {path}")
    return document


def complete_meta_identity(
    document: dict,
    field_set: str,
    station_count: int,
) -> tuple[datetime, datetime | None] | None:
    # The rollback floor is deliberately schema-independent. A future field
    # set or station-list expansion must never make an already published newer
    # run invisible and permit an older manifest to replace it. Exact schema
    # matching is handled separately by the normal skip/validation gate.
    _ = field_set, station_count
    if document.get("complete") is not True:
        return None
    run = parse_meta_datetime(document.get("run"))
    if run is None or run.hour not in ALL_CYCLES:
        raise RuntimeError("complete direct-plume metadata has an invalid run")
    # Do not reinterpret the legacy processing-complete timestamp as an
    # upstream-ready timestamp. A still-available source index can enrich old
    # manifests precisely without another GRIB download.
    ready_at = parse_meta_datetime(document.get("last_run_source_ready_time"))
    return run, ready_at


def newest_complete_floor(
    paths: Iterable[Path | None],
    field_set: str,
    station_count: int,
) -> tuple[datetime | None, datetime | None]:
    identities = [
        identity
        for path in paths
        if (identity := complete_meta_identity(
            load_meta_document(path), field_set, station_count
        )) is not None
    ]
    if not identities:
        return None, None
    return max(identities, key=lambda identity: identity[0])


def assert_not_rollback(candidate: datetime, floor: datetime | None, no_write: bool) -> None:
    if floor is not None and candidate < floor and not no_write:
        raise RuntimeError(
            f"refusing direct-plume rollback from {iso_z(floor)} to {iso_z(candidate)}"
        )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-dir", type=Path, default=DEFAULT_REPO)
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument("--published-state", type=Path)
    parser.add_argument("--cycle", type=int, choices=ALL_CYCLES)
    parser.add_argument("--date", help="YYYYMMDD; requires --cycle")
    parser.add_argument("--fields", choices=sorted(FIELD_SETS), default="basic")
    parser.add_argument("--batch-steps", type=int, default=1)
    parser.add_argument("--keep", type=int, default=8)
    parser.add_argument("--slug", action="append", default=[])
    parser.add_argument("--max-temp-gib", type=float, default=3.0)
    parser.add_argument(
        "--limit-steps",
        type=int,
        help="test only: process the first N native steps; requires --no-write",
    )
    parser.add_argument(
        "--test-step",
        type=int,
        action="append",
        default=[],
        help="test only: process selected native step(s); requires --no-write",
    )
    parser.add_argument("--force", action="store_true")
    parser.add_argument(
        "--probe-only",
        action="store_true",
        help="check and report the newest safe complete run without downloading GRIB data",
    )
    parser.add_argument(
        "--no-write",
        action="store_true",
        help="download, decode and validate but do not write compact JSON",
    )
    args = parser.parse_args(argv)
    if args.date and args.cycle is None:
        parser.error("--date requires --cycle")
    if args.batch_steps < 1:
        parser.error("--batch-steps must be at least 1")
    if args.keep < 1:
        parser.error("--keep must be at least 1")
    if args.max_temp_gib <= 0:
        parser.error("--max-temp-gib must be positive")
    if args.limit_steps is not None:
        if args.limit_steps < 2:
            parser.error("--limit-steps must be at least 2")
        if not args.no_write:
            parser.error("--limit-steps requires --no-write")
    if args.test_step:
        if not args.no_write:
            parser.error("--test-step requires --no-write")
        if args.limit_steps is not None:
            parser.error("--test-step and --limit-steps cannot be combined")
        if len(set(args.test_step)) < 2:
            parser.error("--test-step requires at least two unique steps")
    if args.slug and not args.no_write:
        parser.error("--slug is only allowed together with --no-write")
    args.repo_dir = args.repo_dir.expanduser().resolve()
    args.out_dir = (args.out_dir or args.repo_dir).expanduser().resolve()
    if args.published_state is not None:
        args.published_state = args.published_state.expanduser().resolve()
    return args


def load_trend_cache_module(repo_dir: Path):
    cache_script = repo_dir / "shell" / "pluim_trend_cache.py"
    if not cache_script.exists():
        raise RuntimeError(f"station source not found: {cache_script}")
    spec = importlib.util.spec_from_file_location("weerlab_pluim_trend_cache", cache_script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load station source: {cache_script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_stations(repo_dir: Path, selected_slugs: set[str]) -> list[Station]:
    module = load_trend_cache_module(repo_dir)
    stations = [Station(str(name), str(slug), float(lat), float(lon)) for name, slug, lat, lon in module.STATIONS]
    if selected_slugs:
        known = {station.slug for station in stations}
        unknown = sorted(selected_slugs - known)
        if unknown:
            raise RuntimeError(f"unknown station slug(s): {', '.join(unknown)}")
        stations = [station for station in stations if station.slug in selected_slugs]
    if not stations:
        raise RuntimeError("no stations selected")
    return stations


def cycle_steps(cycle: int) -> tuple[int, ...]:
    return LONG_STEPS if cycle in LONG_CYCLES else SHORT_STEPS


def final_file_url(run: datetime, stream: str, file_type: str) -> str:
    final_step = cycle_steps(run.hour)[-1]
    stamp = run.strftime("%Y%m%d%H0000")
    return (
        f"{ECMWF_ROOT}/{run:%Y%m%d}/{run:%H}z/ifs/0p25/{stream}/"
        f"{stamp}-{final_step}h-{stream}-{file_type}.grib2"
    )


def final_index_url(run: datetime, stream: str, file_type: str) -> str:
    return final_file_url(run, stream, file_type).removesuffix(".grib2") + ".index"


def parse_http_timestamp(value: str | None, fallback: datetime) -> datetime:
    if not value:
        return fallback
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return fallback


def run_source_ready_at(client: Client, run: datetime, discovered_at: datetime) -> datetime | None:
    """Return the final source timestamp, ``None`` for 404, or raise transient errors.

    Treating rate limits or connection failures as an incomplete run is unsafe:
    it can make an older cycle look like the newest available one. The public
    client downloads through the JSON indexes, so those are the readiness
    sentinels we validate here.
    """

    sentinels = (
        ("enfo/ef", final_index_url(run, "enfo", "ef")),
        ("oper/fc", final_index_url(run, "oper", "fc")),
    )
    ready_times: list[datetime] = []
    for label, url in sentinels:
        try:
            response = client.session.head(
                url,
                timeout=15,
                allow_redirects=True,
                verify=client.verify,
            )
        except Exception as error:
            raise RuntimeError(f"ECMWF readiness check failed for {iso_z(run)}: {error}") from error
        if response.status_code == 404:
            print(
                f"READINESS: run={iso_z(run)} sentinel={label} status=404 "
                f"checked={iso_z(datetime.now(timezone.utc))}",
                flush=True,
            )
            return None
        if response.status_code != 200:
            retry_after = response.headers.get("Retry-After")
            suffix = f"; retry after {retry_after}s" if retry_after else ""
            raise RuntimeError(
                f"ECMWF readiness HTTP {response.status_code} for {iso_z(run)}{suffix}"
            )
        ready_times.append(
            parse_http_timestamp(response.headers.get("Last-Modified"), discovered_at)
        )
    ready_at = max(ready_times, default=discovered_at)
    print(
        f"READINESS: run={iso_z(run)} status=ready "
        f"source_ready={iso_z(ready_at)} checked={iso_z(datetime.now(timezone.utc))}",
        flush=True,
    )
    return ready_at


def candidate_runs(cycles: Iterable[int]) -> list[tuple[datetime, int]]:
    now = datetime.now(timezone.utc)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    values: list[tuple[datetime, int]] = []
    for day_back in range(3):
        day = start - timedelta(days=day_back)
        for cycle in cycles:
            run = day + timedelta(hours=cycle)
            # No complete IFS ENS run is expected before roughly +7 hours.
            if run <= now - timedelta(hours=6, minutes=30):
                values.append((run, cycle))
    return sorted(values, key=lambda item: item[0], reverse=True)


def choose_run(
    client: Client,
    requested_cycle: int | None,
    requested_date: str | None,
    minimum_run: datetime | None = None,
    minimum_ready_at: datetime | None = None,
) -> RunSelection:
    discovered_at = datetime.now(timezone.utc)
    if requested_cycle is not None and requested_date:
        run = datetime.strptime(requested_date, "%Y%m%d").replace(
            hour=requested_cycle, tzinfo=timezone.utc
        )
        ready_at = run_source_ready_at(client, run, discovered_at)
        if ready_at is None:
            raise RuntimeError(f"requested ECMWF run is not complete: {iso_z(run)}")
        return RunSelection(run, requested_cycle, ready_at, discovered_at)
    cycles = (
        (requested_cycle,)
        if requested_cycle is not None
        else DEFAULT_DIRECT_CYCLES
    )
    for run, cycle in candidate_runs(cycles):
        if minimum_run is not None and run <= minimum_run:
            if requested_cycle is None or minimum_run.hour == requested_cycle:
                floor_ready = minimum_ready_at
                verified = floor_ready is not None
                if floor_ready is None:
                    floor_ready = run_source_ready_at(client, minimum_run, discovered_at)
                    verified = floor_ready is not None
                return RunSelection(
                    minimum_run,
                    minimum_run.hour,
                    floor_ready or discovered_at,
                    discovered_at,
                    verified,
                )
            break
        ready_at = run_source_ready_at(client, run, discovered_at)
        if ready_at is not None:
            return RunSelection(run, cycle, ready_at, discovered_at)
    raise RuntimeError("no complete ECMWF IFS ENS cycle found")


def chunks(values: tuple[int, ...], size: int) -> Iterable[tuple[int, ...]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def directory_size(path: Path) -> int:
    total = 0
    for child in path.iterdir():
        if child.is_file():
            total += child.stat().st_size
    return total


def update_peak_temp(metrics: Metrics, temp_dir: Path, max_temp_bytes: int) -> None:
    current = directory_size(temp_dir)
    metrics.peak_temp_bytes = max(metrics.peak_temp_bytes, current)
    if current > max_temp_bytes:
        raise RuntimeError(
            f"temporary source footprint {current / 1024**3:.2f} GiB exceeds "
            f"limit {max_temp_bytes / 1024**3:.2f} GiB"
        )


def retrieve_batch(
    client: Client,
    run: datetime,
    cycle: int,
    batch_steps: tuple[int, ...],
    raw_params: tuple[str, ...],
    target: Path,
    perturbed: bool,
) -> tuple[int, float]:
    request_params: list[str] = []
    for param in raw_params:
        request_params.extend(GUST_REQUEST_NAMES if param == "10fg" else (param,))
    request: dict[str, object] = {
        "date": run.strftime("%Y%m%d"),
        "time": cycle,
        "step": list(batch_steps),
        "param": request_params,
        "target": str(target),
    }
    if perturbed:
        request.update(
            stream="enfo",
            type="pf",
            number=list(PERTURBED_MEMBERS),
        )
    else:
        request.update(stream="oper", type="fc")
    started = time.monotonic()
    last_error: Exception | None = None
    for attempt in range(3):
        target.unlink(missing_ok=True)
        try:
            client.retrieve(**request)
            if not target.exists() or target.stat().st_size <= 0:
                raise RuntimeError(f"ECMWF returned an empty file for steps {batch_steps}")
            return target.stat().st_size, time.monotonic() - started
        except Exception as error:
            last_error = error
            target.unlink(missing_ok=True)
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise RuntimeError(
        f"ECMWF download failed after 3 attempts for steps {batch_steps}: {last_error}"
    ) from last_error


def key_int(gid: int, name: str) -> int:
    return int(eccodes.codes_get(gid, name))


def establish_grid_points(gid: int, stations: list[Station]) -> tuple[GridPoint, ...]:
    nearest = eccodes.codes_grib_find_nearest_multiple(
        gid,
        False,
        [station.lat for station in stations],
        [station.lon for station in stations],
    )
    return tuple(
        GridPoint(
            index=int(item["index"]),
            lat=float(item["lat"]),
            lon=float(item["lon"]),
            distance_km=float(item["distance"]),
        )
        for item in nearest
    )


def decode_batch(
    path: Path,
    perturbed: bool,
    batch_steps: tuple[int, ...],
    raw_params: tuple[str, ...],
    stations: list[Station],
    step_to_index: dict[int, int],
    raw: dict[str, np.ndarray],
    existing_grid_points: tuple[GridPoint, ...] | None,
) -> tuple[tuple[GridPoint, ...], int]:
    found: set[tuple[str, int, int]] = set()
    geometry: tuple[object, ...] | None = None
    grid_points = existing_grid_points
    message_count = 0
    with path.open("rb") as stream:
        while True:
            gid = eccodes.codes_grib_new_from_file(stream)
            if gid is None:
                break
            try:
                message_count += 1
                source_short_name = str(eccodes.codes_get(gid, "shortName"))
                short_name = SHORT_NAME_ALIASES.get(source_short_name, source_short_name)
                step = key_int(gid, "endStep")
                member = key_int(gid, "perturbationNumber") if perturbed else 0
                if short_name not in raw_params or step not in batch_steps:
                    raise RuntimeError(
                        f"unexpected GRIB message {short_name=} {step=} {member=}"
                    )
                if perturbed and member not in PERTURBED_MEMBERS:
                    raise RuntimeError(f"unexpected perturbed member {member}")
                expected_data_type = "pf" if perturbed else "fc"
                if str(eccodes.codes_get(gid, "dataType")) != expected_data_type:
                    raise RuntimeError(
                        f"unexpected dataType for {short_name} step {step}: "
                        f"{eccodes.codes_get(gid, 'dataType')}"
                    )
                if perturbed and key_int(gid, "numberOfForecastsInEnsemble") != 51:
                    raise RuntimeError("ECMWF perturbed message does not describe 51 forecasts")
                if short_name == "tp":
                    units = str(eccodes.codes_get(gid, "units"))
                    start_step = key_int(gid, "startStep")
                    step_type = str(eccodes.codes_get(gid, "stepType"))
                    if units != "m" or start_step != 0 or step_type != "accum":
                        raise RuntimeError(
                            "unexpected total-precipitation semantics: "
                            f"units={units!r}, startStep={start_step}, stepType={step_type!r}"
                        )
                combination = (short_name, step, member)
                if combination in found:
                    raise RuntimeError(f"duplicate GRIB message {combination}")
                found.add(combination)

                current_geometry = (
                    str(eccodes.codes_get(gid, "gridType")),
                    key_int(gid, "Ni"),
                    key_int(gid, "Nj"),
                )
                if geometry is None:
                    geometry = current_geometry
                elif current_geometry != geometry:
                    raise RuntimeError(
                        f"mixed GRIB geometries: {geometry!r} and {current_geometry!r}"
                    )
                if current_geometry != ("regular_ll", 1440, 721):
                    raise RuntimeError(f"unexpected ECMWF grid {current_geometry!r}")

                if grid_points is None:
                    grid_points = establish_grid_points(gid, stations)
                values = np.asarray(
                    eccodes.codes_get_double_elements(
                        gid,
                        "values",
                        [point.index for point in grid_points],
                    ),
                    dtype=np.float64,
                )
                if values.shape != (len(stations),) or not np.isfinite(values).all():
                    raise RuntimeError(
                        f"invalid sampled values for {combination}: {values.shape}"
                    )
                raw[short_name][member, :, step_to_index[step]] = values
            finally:
                eccodes.codes_release(gid)

    expected_members = PERTURBED_MEMBERS if perturbed else (0,)
    expected = {
        (param, step, member)
        for param in raw_params
        for step in batch_steps
        for member in expected_members
    }
    missing = expected - found
    unexpected = found - expected
    if missing or unexpected:
        raise RuntimeError(
            f"incomplete GRIB batch: missing={len(missing)}, "
            f"unexpected={len(unexpected)}, sample={sorted(missing, key=str)[:5]}"
        )
    if grid_points is None:
        raise RuntimeError("no GRIB grid was decoded")
    return grid_points, message_count


def deaccumulate_tp(tp_metres: np.ndarray) -> np.ndarray:
    cumulative_mm = tp_metres * 1000.0
    initial_max = float(np.max(np.abs(cumulative_mm[:, :, 0])))
    if initial_max > 0.05:
        raise RuntimeError(
            f"ECMWF total precipitation at t0 is not zero ({initial_max:.3f} mm)"
        )
    intervals = np.empty_like(cumulative_mm)
    intervals[:, :, 0] = cumulative_mm[:, :, 0]
    intervals[:, :, 1:] = np.diff(cumulative_mm, axis=2)
    minimum = float(np.min(intervals))
    if minimum < -0.05:
        member, station, step = np.unravel_index(np.argmin(intervals), intervals.shape)
        raise RuntimeError(
            "ECMWF total precipitation reset unexpectedly: "
            f"{minimum:.3f} mm at member={member}, station={station}, step_index={step}"
        )
    intervals[(intervals < 0) & (intervals >= -0.05)] = 0.0
    if float(np.max(intervals)) > 500:
        raise RuntimeError("implausible precipitation interval above 500 mm")
    closure_error = float(np.max(np.abs(np.sum(intervals, axis=2) - cumulative_mm[:, :, -1])))
    if closure_error > 0.1:
        raise RuntimeError(
            f"deaccumulated precipitation does not close ({closure_error:.3f} mm)"
        )
    return intervals


def transform_fields(raw: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    output: dict[str, np.ndarray] = {}
    temperature = raw["2t"] - 273.15
    if float(np.min(temperature)) < -100 or float(np.max(temperature)) > 70:
        raise RuntimeError("implausible 2 m temperature values")
    output["temperature_2m"] = temperature
    output["precipitation"] = deaccumulate_tp(raw["tp"])

    if "10u" in raw and "10v" in raw:
        u = raw["10u"]
        v = raw["10v"]
        wind_speed = np.hypot(u, v) * 3.6
        if float(np.max(wind_speed)) > 400:
            raise RuntimeError("implausible 10 m wind speed")
        output["wind_speed_10m"] = wind_speed
        output["wind_direction_10m"] = (
            np.degrees(np.arctan2(-u, -v)) + 360.0
        ) % 360.0

    if "tcc" in raw:
        cloud = raw["tcc"]
        cloud_min = float(np.min(cloud))
        cloud_max = float(np.max(cloud))
        if cloud_min >= -0.1 and cloud_max <= 1.1:
            cloud = np.clip(cloud, 0.0, 1.0) * 100.0
        elif cloud_min >= -1.0 and cloud_max <= 101.0:
            cloud = np.clip(cloud, 0.0, 100.0)
        else:
            raise RuntimeError(
                f"implausible total cloud cover range {cloud_min:.4f}..{cloud_max:.4f}"
            )
        output["cloud_cover"] = cloud

    if "10fg" in raw:
        gust = raw["10fg"] * 3.6
        if float(np.min(gust)) < -0.1 or float(np.max(gust)) > 500:
            raise RuntimeError("implausible 10 m wind gust")
        output["wind_gusts_10m"] = np.clip(gust, 0.0, None)

    if "mucape" in raw:
        cape = raw["mucape"]
        if float(np.min(cape)) < -1 or float(np.max(cape)) > 20_000:
            raise RuntimeError("implausible most-unstable CAPE")
        output["cape"] = np.clip(cape, 0.0, None)

    return output


def rounded_matrix(values: np.ndarray, decimals: int) -> list[list[float]]:
    rounded = np.round(values, decimals=decimals)
    if not np.isfinite(rounded).all():
        raise RuntimeError("output matrix contains non-finite values")
    return rounded.tolist()


def update_digest(payload: dict) -> None:
    digest_data = {key: payload.get(key) for key in DIGEST_KEYS}
    payload["data_sha256"] = hashlib.sha256(
        json.dumps(digest_data, separators=(",", ":")).encode()
    ).hexdigest()


def build_station_run(
    station_index: int,
    station: Station,
    grid_point: GridPoint,
    run: datetime,
    cycle: int,
    steps: tuple[int, ...],
    fields: dict[str, np.ndarray],
    source_ready_at: datetime,
    discovered_at: datetime,
    fetched: datetime,
    metrics: Metrics,
) -> dict:
    times = [run + timedelta(hours=step) for step in steps]
    times_ms = [int(value.timestamp() * 1000) for value in times]
    members: dict[str, list[list[float]]] = {}
    for name, values in fields.items():
        decimals = 3 if name == "precipitation" else 1
        members[name] = rounded_matrix(values[:, station_index, :], decimals)
    temp_hres = list(members["temperature_2m"][0])
    precip_hres = list(members["precipitation"][0])
    final_interval = steps[-1] - steps[-2]
    source_end = run + timedelta(hours=steps[-1] + final_interval)
    run_iso = iso_z(run)
    payload = {
        "run": run_iso,
        "fetched": iso_z(fetched),
        "t0_ms": times_ms[0],
        "times_ms": times_ms,
        "n": len(times_ms),
        "step_h": None if len({right - left for left, right in zip(steps, steps[1:])}) > 1 else steps[1] - steps[0],
        "step_hours": sorted({right - left for left, right in zip(steps, steps[1:])}),
        # Since IFS Cycle 50r1 the control forecast and deterministic HRES are
        # the same forecast. Embed member 0 as the exact-cycle HRES overlay so
        # archived direct runs never need a second Open-Meteo request.
        "temp_hres": temp_hres,
        "precip_hres": precip_hres,
        "members": members,
        "source": {
            "model": "ecmwf_ifs025_ensemble",
            "provider": "ECMWF Open Data",
            "endpoint": "data.ecmwf.int",
            "access": "direct_grib2_range_requests",
            "run_initialisation": run_iso,
            "availability": iso_z(source_ready_at),
            "source_ready": iso_z(source_ready_at),
            "discovered": iso_z(discovered_at),
            "processed": iso_z(fetched),
            "data_end": iso_z(source_end),
            "grid_latitude": grid_point.lat,
            "grid_longitude": grid_point.lon,
            "requested_latitude": station.lat,
            "requested_longitude": station.lon,
            "grid_distance_km": round(grid_point.distance_km, 3),
            "resolution_degrees": 0.25,
            "cycle50r1_members": "member 0=oper/fc; members 1..50=enfo/pf",
            "temporary_grib_retained": False,
            "download_bytes_total": metrics.grib_bytes,
            "download_seconds_total": round(metrics.download_seconds, 3),
            "hres": {
                "status": "available",
                "model": "ecmwf_ifs",
                "product": "IFS control/HRES (ECMWF Open Data 0.25 degree)",
                "endpoint": "data.ecmwf.int direct GRIB2",
                "precipitation_alignment": "deaccumulated_native_intervals",
                "run_initialisation": run_iso,
                "same_as_control_member": True,
                "grid_latitude": grid_point.lat,
                "grid_longitude": grid_point.lon,
            },
        },
    }
    update_digest(payload)
    return payload


def load_archive(path: Path, station: Station) -> dict:
    if not path.exists():
        return {
            "schema": 3,
            "station": station.name,
            "slug": station.slug,
            "lat": station.lat,
            "lon": station.lon,
            "updated": None,
            "runs": [],
        }
    try:
        document = json.loads(path.read_text())
    except Exception as error:
        raise RuntimeError(f"existing plume archive is not valid JSON: {path}") from error
    if (
        not isinstance(document, dict)
        or document.get("schema") != 3
        or document.get("slug") != station.slug
        or not isinstance(document.get("runs"), list)
    ):
        raise RuntimeError(f"existing plume archive has an invalid schema: {path}")
    return document


def has_complete_prescheduled_run(
    out_dir: Path,
    repo_dir: Path,
    stations: list[Station],
    run: datetime,
) -> bool:
    """True only for an exact, complete 39-station native 9-km 00Z/06Z run."""

    if run.hour not in (0, 6):
        return False
    trend = load_trend_cache_module(repo_dir)
    configured_slugs = [str(item[1]) for item in trend.STATIONS]
    if [station.slug for station in stations] != configured_slugs:
        return False

    steps = (
        list(range(0, 91))
        + list(range(93, 145, 3))
        + (list(range(150, 361, 6)) if run.hour == 0 else [])
    )
    expected_times = [
        int((run + timedelta(hours=step)).timestamp() * 1000)
        for step in steps
    ]
    run_iso = iso_z(run)
    required_fields = set(PRESCHEDULED_FIELDS)
    for station in stations:
        document = load_archive(
            out_dir / f"pluim_trend_{station.slug}.json",
            station,
        )
        matches = [
            item
            for item in document.get("runs", [])
            if isinstance(item, dict)
            and item.get("run") == run_iso
            and trend.is_sha256(item.get("data_sha256"))
        ]
        if len(matches) != 1:
            return False
        archived_run = matches[0]
        source = (
            archived_run.get("source")
            if isinstance(archived_run.get("source"), dict)
            else {}
        )
        if source.get("access") != "ecmwf_prescheduled_point_api":
            return False
        if trend.run_time_axis(archived_run) != expected_times:
            return False
        if not required_fields.issubset(set(trend.complete_run_fields(archived_run))):
            return False
    return True


def skip_complete_prescheduled_run(
    out_dir: Path,
    repo_dir: Path,
    stations: list[Station],
    run: datetime,
    run_checkpoint: Path | None,
) -> bool:
    if not has_complete_prescheduled_run(out_dir, repo_dir, stations, run):
        return False
    if run_checkpoint is not None:
        run_checkpoint.unlink(missing_ok=True)
    print(
        f"SKIP: native 9-km pre-scheduled run {iso_z(run)} staat volledig "
        f"in alle {len(stations)} archieven; 0,25-graden download niet nodig",
        flush=True,
    )
    return True


def prepare_documents(
    out_dir: Path,
    stations: list[Station],
    grid_points: tuple[GridPoint, ...],
    run: datetime,
    cycle: int,
    steps: tuple[int, ...],
    fields: dict[str, np.ndarray],
    source_ready_at: datetime,
    discovered_at: datetime,
    fetched: datetime,
    metrics: Metrics,
    keep: int,
    force: bool,
) -> dict[Path, dict]:
    documents: dict[Path, dict] = {}
    for station_index, (station, grid_point) in enumerate(zip(stations, grid_points)):
        path = out_dir / f"pluim_trend_{station.slug}.json"
        document = load_archive(path, station)
        runs = [item for item in document.get("runs", []) if isinstance(item, dict) and item.get("data_sha256")]
        run_iso = iso_z(run)
        new_run = build_station_run(
            station_index,
            station,
            grid_point,
            run,
            cycle,
            steps,
            fields,
            source_ready_at,
            discovered_at,
            fetched,
            metrics,
        )
        runs = [item for item in runs if item.get("run") != run_iso]
        runs.append(new_run)
        runs.sort(key=lambda item: str(item.get("run", "")), reverse=True)
        document.update(
            schema=3,
            station=station.name,
            slug=station.slug,
            lat=station.lat,
            lon=station.lon,
            updated=iso_z(fetched),
            runs=runs[:keep],
        )
        documents[path] = document
    return documents


def write_documents_atomically(documents: dict[Path, dict], meta_path: Path, meta: dict) -> list[Path]:
    if not documents:
        raise RuntimeError("no documents to write")
    out_dir = next(iter(documents)).parent
    out_dir.mkdir(parents=True, exist_ok=True)
    staging_dir = Path(tempfile.mkdtemp(prefix=".pluim-direct-staging-", dir=out_dir))
    written: list[Path] = []
    try:
        staged: list[tuple[Path, Path]] = []
        for final_path, document in documents.items():
            stage_path = staging_dir / final_path.name
            with stage_path.open("w") as handle:
                json.dump(document, handle, separators=(",", ":"), allow_nan=False)
                handle.flush()
                os.fsync(handle.fileno())
            staged.append((stage_path, final_path))
        meta_stage = staging_dir / meta_path.name
        with meta_stage.open("w") as handle:
            json.dump(meta, handle, separators=(",", ":"), allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())

        for stage_path, final_path in staged:
            os.replace(stage_path, final_path)
            written.append(final_path)
        os.replace(meta_stage, meta_path)
        written.append(meta_path)
        return written
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)


def attach_capability_manifest(
    written: Iterable[Path],
    repo_dir: Path,
    out_dir: Path,
    meta_path: Path,
) -> list[Path]:
    """Rebuild and validate the archive manifest, returning publish order.

    The direct producer can replace a same-cycle early archive with a different
    set of complete fields. The capability manifest must therefore be derived
    from the newly written station documents before anything is offered to the
    publisher. Its path deliberately precedes the direct-run metadata but
    follows every station path: R2 publishes stations, archive manifest, then
    direct-run metadata.
    """

    ordered = [Path(path) for path in written]
    if meta_path not in ordered:
        raise RuntimeError("direct write batch is missing pluim_direct_meta.json")
    station_paths = [path for path in ordered if path != meta_path]
    if not station_paths:
        raise RuntimeError("direct write batch has no station archives")

    trend = load_trend_cache_module(repo_dir)
    manifest_name = getattr(trend, "CAPABILITY_MANIFEST_NAME", None)
    if not isinstance(manifest_name, str) or not manifest_name:
        raise RuntimeError("trend cache has no capability-manifest name")
    manifest_path = out_dir / manifest_name
    changed_path = trend.write_capability_manifest(out_dir)
    if changed_path is not None and Path(changed_path) != manifest_path:
        raise RuntimeError("trend cache wrote an unexpected capability manifest")

    try:
        manifest = json.loads(manifest_path.read_text())
        direct_meta = json.loads(meta_path.read_text())
    except (OSError, ValueError, TypeError) as error:
        raise RuntimeError("direct capability manifest is not readable JSON") from error

    expected_station_count = len(trend.STATIONS)
    semantic = {
        key: manifest.get(key)
        for key in ("schema", "complete", "station_count", "member_count", "runs")
    }
    revision = manifest.get("revision")
    if revision != trend.canonical_sha256(semantic):
        raise RuntimeError("direct capability manifest has an invalid revision")
    if (
        manifest.get("schema") != 1
        or manifest.get("complete") is not True
        or manifest.get("station_count") != expected_station_count
        or manifest.get("member_count") != 51
        or direct_meta.get("complete") is not True
        or direct_meta.get("station_count") != expected_station_count
    ):
        raise RuntimeError("direct capability manifest is not complete for all stations")

    run_iso = direct_meta.get("run")
    required_fields = set(direct_meta.get("fields") or ())
    matching_runs = [
        item
        for item in manifest.get("runs", [])
        if isinstance(item, dict) and item.get("run") == run_iso
    ]
    if len(matching_runs) != 1:
        raise RuntimeError("direct run is missing from the capability manifest")
    run_capability = matching_runs[0]
    if (
        run_capability.get("complete") is not True
        or run_capability.get("station_count") != expected_station_count
        or run_capability.get("member_count") != 51
        or not required_fields.issubset(set(run_capability.get("fields") or ()))
    ):
        raise RuntimeError("direct run has incomplete capability certification")

    return station_paths + [manifest_path, meta_path]


def enrich_existing_source_ready(
    meta_path: Path,
    meta: dict,
    stations: list[Station],
    run_iso: str,
    source_ready_at: datetime,
) -> list[Path]:
    """Backfill the real ECMWF ready time without downloading GRIB again."""

    ready_iso = iso_z(source_ready_at)
    documents: dict[Path, dict] = {}
    for station in stations:
        path = meta_path.parent / f"pluim_trend_{station.slug}.json"
        document = load_archive(path, station)
        matches = [item for item in document["runs"] if item.get("run") == run_iso]
        if len(matches) != 1:
            raise RuntimeError(f"cannot enrich source time in {path}: exact run missing")
        source = matches[0].get("source")
        if not isinstance(source, dict) or source.get("access") != "direct_grib2_range_requests":
            raise RuntimeError(f"cannot enrich source time in {path}: direct provenance missing")
        source["availability"] = ready_iso
        source["source_ready"] = ready_iso
        documents[path] = document

    enriched_meta = dict(meta)
    enriched_meta["last_run_source_ready_time"] = int(source_ready_at.timestamp())
    if "last_run_processing_completed_time" not in enriched_meta:
        enriched_meta["last_run_processing_completed_time"] = enriched_meta.get(
            "last_run_availability_time"
        )
    return write_documents_atomically(documents, meta_path, enriched_meta)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    install_signal_handlers()
    use_safe_multipart_chunk_size()
    stations = load_stations(args.repo_dir, set(args.slug))
    raw_params = FIELD_SETS[args.fields]
    meta_path = args.out_dir / "pluim_direct_meta.json"
    existing_meta = load_meta_document(meta_path)
    minimum_run, minimum_ready_at = newest_complete_floor(
        (meta_path, args.published_state),
        args.fields,
        len(stations),
    )

    # The unattended job owns only 12Z/18Z. Remove abandoned checkpoints from
    # the former 00Z/06Z route before any ECMWF client or readiness probe can
    # start. An explicit manual --cycle 0/6 keeps its exact checkpoint.
    if not args.no_write and args.cycle is None:
        removed = prune_prescheduled_checkpoints()
        if removed:
            print(
                f"CLEANUP: {len(removed)} oud(e) 00Z/06Z-checkpoint(s) verwijderd",
                flush=True,
            )

    if not args.no_write and not args.probe_only:
        candidate = None
        if args.cycle is None:
            default_candidates = candidate_runs(DEFAULT_DIRECT_CYCLES)
            newest_default = default_candidates[0][0] if default_candidates else None
            if (
                minimum_run is not None
                and minimum_ready_at is not None
                and (newest_default is None or newest_default <= minimum_run)
            ):
                print(
                    "SKIP: geen nieuwere automatische 12Z/18Z-run dan "
                    f"{iso_z(minimum_run)}; ECMWF-probe niet nodig",
                    flush=True,
                )
                return 0
        elif args.cycle in (0, 6) and args.date:
            candidate = datetime.strptime(args.date, "%Y%m%d").replace(
                hour=args.cycle, tzinfo=timezone.utc
            )
        elif args.cycle in (0, 6):
            candidates = candidate_runs((args.cycle,))
            candidate = candidates[0][0] if candidates else None
        else:
            candidate = None
        if (
            candidate is not None
            and (minimum_run is None or candidate > minimum_run)
        ):
            candidate_checkpoint = checkpoint_path(candidate, args.fields)
            prune_stale_runtime(candidate_checkpoint, args.out_dir)
            if skip_complete_prescheduled_run(
                args.out_dir,
                args.repo_dir,
                stations,
                candidate,
                candidate_checkpoint,
            ):
                return 0

    client = Client(source="ecmwf")
    configure_client_timeouts(client)
    selection = choose_run(
        client,
        args.cycle,
        args.date,
        minimum_run=minimum_run,
        minimum_ready_at=minimum_ready_at,
    )
    run, cycle = selection.run, selection.cycle
    assert_not_rollback(run, minimum_run, args.no_write)
    if args.probe_only:
        print(
            "PROBE:" + json.dumps(
                {
                    "run": iso_z(run),
                    "cycle": cycle,
                    "source_ready": iso_z(selection.source_ready_at),
                    "discovered": iso_z(selection.discovered_at),
                    "local_floor": iso_z(minimum_run) if minimum_run else None,
                },
                sort_keys=True,
            ),
            flush=True,
        )
        return 0
    steps = cycle_steps(cycle)
    if args.limit_steps is not None:
        steps = steps[: args.limit_steps]
    elif args.test_step:
        requested_steps = set(args.test_step)
        invalid_steps = requested_steps - set(steps)
        if invalid_steps:
            raise RuntimeError(f"invalid native test steps: {sorted(invalid_steps)}")
        steps = tuple(step for step in steps if step in requested_steps)
    run_iso = iso_z(run)
    expected_complete = (
        args.limit_steps is None
        and not args.test_step
        and len(stations) == len(load_stations(args.repo_dir, set()))
    )
    run_checkpoint = None if args.no_write else checkpoint_path(run, args.fields)
    if not args.no_write:
        prune_stale_runtime(run_checkpoint, args.out_dir)
        if skip_complete_prescheduled_run(
            args.out_dir,
            args.repo_dir,
            stations,
            run,
            run_checkpoint,
        ):
            return 0
    if not args.force and not args.no_write and meta_path.exists():
        expected_output_paths = [
            args.out_dir / f"pluim_trend_{station.slug}.json" for station in stations
        ]
        if (
            existing_meta.get("complete") is True
            and existing_meta.get("run") == run_iso
            and existing_meta.get("field_set") == args.fields
            and existing_meta.get("station_count") == len(stations)
            and set(existing_meta.get("fields") or ()) == set(OUTPUT_FIELDS[args.fields])
            and all(path.is_file() for path in expected_output_paths)
        ):
            if run_checkpoint is not None:
                run_checkpoint.unlink(missing_ok=True)
            if (
                existing_meta.get("last_run_source_ready_time") is None
                and selection.source_ready_verified
            ):
                written = attach_capability_manifest(
                    enrich_existing_source_ready(
                        meta_path,
                        existing_meta,
                        stations,
                        run_iso,
                        selection.source_ready_at,
                    ),
                    args.repo_dir,
                    args.out_dir,
                    meta_path,
                )
                print(
                    f"ENRICHED: direct run {run_iso} bron gereed op "
                    f"{iso_z(selection.source_ready_at)}",
                    flush=True,
                )
                print("WRITTEN:" + " ".join(str(path) for path in written), flush=True)
                return 0
            print(f"SKIP: direct run {run_iso} field_set={args.fields} is already complete", flush=True)
            written = attach_capability_manifest(
                (*expected_output_paths, meta_path),
                args.repo_dir,
                args.out_dir,
                meta_path,
            )
            print(
                "WRITTEN:" + " ".join(str(path) for path in written),
                flush=True,
            )
            return 0
    print(
        f"ECMWF direct run {run_iso}: {len(stations)} stations, "
        f"{len(steps)} steps, fields={','.join(raw_params)}, "
        f"source_ready={iso_z(selection.source_ready_at)}, "
        f"discovered={iso_z(selection.discovered_at)}",
        flush=True,
    )

    shape = (51, len(stations), len(steps))
    step_to_index = {step: index for index, step in enumerate(steps)}
    metrics = Metrics(started_monotonic=time.monotonic())
    max_temp_bytes = int(args.max_temp_gib * 1024**3)
    grid_points: tuple[GridPoint, ...] | None = None
    resumed = (
        load_checkpoint(run_checkpoint, run, steps, stations, raw_params, shape)
        if run_checkpoint is not None else None
    )
    if resumed is None:
        raw = {param: np.full(shape, np.nan, dtype=np.float64) for param in raw_params}
    else:
        raw, grid_points, stored_metrics = resumed
        metrics.grib_bytes = int(stored_metrics.get("grib_bytes", 0))
        metrics.download_seconds = float(stored_metrics.get("download_seconds", 0.0))
        metrics.decode_seconds = float(stored_metrics.get("decode_seconds", 0.0))
        metrics.batches = int(stored_metrics.get("batches", 0))
        metrics.peak_temp_bytes = int(stored_metrics.get("peak_temp_bytes", 0))
        completed = sum(
            all(np.isfinite(values[:, :, index]).all() for values in raw.values())
            for index in range(len(steps))
        )
        print(
            f"RESUME: compact checkpoint bevat {completed}/{len(steps)} stappen "
            f"({run_checkpoint.stat().st_size / 1024**2:.1f} MiB)",
            flush=True,
        )

    with tempfile.TemporaryDirectory(prefix="weerlab_ecmwf_pluim_", dir="/tmp") as temp_name:
        temp_dir = Path(temp_name)
        try:
            for batch_number, batch_steps in enumerate(chunks(steps, args.batch_steps), start=1):
                batch_indexes = [step_to_index[step] for step in batch_steps]
                if all(
                    np.isfinite(values[:, :, batch_indexes]).all()
                    for values in raw.values()
                ):
                    print(
                        f"  batch {batch_number}: steps {batch_steps[0]}..{batch_steps[-1]} "
                        "uit compact checkpoint",
                        flush=True,
                    )
                    continue
                batch_started = time.monotonic()
                pf_path = temp_dir / f"pf_{batch_number:03d}.grib2"
                fc_path = temp_dir / f"fc_{batch_number:03d}.grib2"
                batch_bytes = 0
                batch_download = 0.0
                try:
                    size, elapsed = retrieve_batch(
                        client,
                        run,
                        cycle,
                        batch_steps,
                        raw_params,
                        pf_path,
                        perturbed=True,
                    )
                    batch_bytes += size
                    batch_download += elapsed
                    update_peak_temp(metrics, temp_dir, max_temp_bytes)
                    size, elapsed = retrieve_batch(
                        client,
                        run,
                        cycle,
                        batch_steps,
                        raw_params,
                        fc_path,
                        perturbed=False,
                    )
                    batch_bytes += size
                    batch_download += elapsed
                    update_peak_temp(metrics, temp_dir, max_temp_bytes)

                    decode_started = time.monotonic()
                    grid_points, pf_messages = decode_batch(
                        pf_path,
                        True,
                        batch_steps,
                        raw_params,
                        stations,
                        step_to_index,
                        raw,
                        grid_points,
                    )
                    grid_points, fc_messages = decode_batch(
                        fc_path,
                        False,
                        batch_steps,
                        raw_params,
                        stations,
                        step_to_index,
                        raw,
                        grid_points,
                    )
                    decode_elapsed = time.monotonic() - decode_started
                    metrics.grib_bytes += batch_bytes
                    metrics.download_seconds += batch_download
                    metrics.decode_seconds += decode_elapsed
                    metrics.batches += 1
                    print(
                        f"  batch {batch_number}: steps {batch_steps[0]}..{batch_steps[-1]}, "
                        f"{batch_bytes / 1024**2:.1f} MiB, download {batch_download:.1f}s, "
                        f"decode {decode_elapsed:.1f}s, messages {pf_messages + fc_messages}, "
                        f"elapsed {time.monotonic() - metrics.started_monotonic:.1f}s",
                        flush=True,
                    )
                finally:
                    pf_path.unlink(missing_ok=True)
                    fc_path.unlink(missing_ok=True)
                    remaining = directory_size(temp_dir)
                    if remaining:
                        raise RuntimeError(
                            f"temporary source cleanup left {remaining} bytes after batch {batch_number}"
                        )
                if time.monotonic() - batch_started <= 0:
                    raise RuntimeError("invalid batch timing")
                if run_checkpoint is not None and grid_points is not None:
                    save_checkpoint(
                        run_checkpoint,
                        run,
                        steps,
                        stations,
                        raw_params,
                        raw,
                        grid_points,
                        metrics,
                    )

            if any(not np.isfinite(values).all() for values in raw.values()):
                raise RuntimeError("one or more member/station/step combinations are missing")
            fields = transform_fields(raw)
            if grid_points is None:
                raise RuntimeError("grid point mapping is missing")
            fetched = datetime.now(timezone.utc)
            total_elapsed = time.monotonic() - metrics.started_monotonic
            meta = {
                "schema": 1,
                "run": run_iso,
                "cycle": cycle,
                "complete": expected_complete,
                "field_set": args.fields,
                "fields": sorted(fields),
                "station_count": len(stations),
                "member_count": 51,
                "step_count": len(steps),
                "last_run_initialisation_time": int(run.timestamp()),
                "last_run_source_ready_time": int(selection.source_ready_at.timestamp()),
                "last_run_discovered_time": int(selection.discovered_at.timestamp()),
                "last_run_processing_started_time": int(selection.discovered_at.timestamp()),
                "last_run_availability_time": int(fetched.timestamp()),
                "last_run_processing_completed_time": int(fetched.timestamp()),
                "last_run_modification_time": int(fetched.timestamp()),
                "data_end_time": int((run + timedelta(hours=steps[-1] + (steps[-1] - steps[-2]))).timestamp()),
                "temporal_resolution_seconds": 10800,
                "update_interval_seconds": 21600,
                "source": "ECMWF Open Data direct",
                "source_url": "https://data.ecmwf.int/forecasts/",
                "temporary_grib_retained": False,
                "metrics": {
                    "grib_bytes": metrics.grib_bytes,
                    "download_seconds": round(metrics.download_seconds, 3),
                    "decode_seconds": round(metrics.decode_seconds, 3),
                    "total_seconds": round(total_elapsed, 3),
                    "peak_temp_bytes": metrics.peak_temp_bytes,
                    "batches": metrics.batches,
                },
            }
            print("VALIDATED " + json.dumps(meta, sort_keys=True), flush=True)
            if args.no_write:
                print("NO_WRITE: compact JSON was not written", flush=True)
                return 0

            current_floor, _ = newest_complete_floor(
                (meta_path, args.published_state),
                args.fields,
                len(stations),
            )
            assert_not_rollback(run, current_floor, args.no_write)
            documents = prepare_documents(
                args.out_dir,
                stations,
                grid_points,
                run,
                cycle,
                steps,
                fields,
                selection.source_ready_at,
                selection.discovered_at,
                fetched,
                metrics,
                args.keep,
                args.force,
            )
            written = attach_capability_manifest(
                write_documents_atomically(
                    documents,
                    meta_path,
                    meta,
                ),
                args.repo_dir,
                args.out_dir,
                meta_path,
            )
            if run_checkpoint is not None:
                run_checkpoint.unlink(missing_ok=True)
            print("WRITTEN:" + " ".join(str(path) for path in written), flush=True)
            return 0
        finally:
            # TemporaryDirectory removes the directory itself after this block;
            # this guard verifies that no batch files survived inside it.
            leftovers = list(temp_dir.iterdir()) if temp_dir.exists() else []
            if leftovers:
                for leftover in leftovers:
                    if leftover.is_file():
                        leftover.unlink(missing_ok=True)
                    elif leftover.is_dir():
                        shutil.rmtree(leftover, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
