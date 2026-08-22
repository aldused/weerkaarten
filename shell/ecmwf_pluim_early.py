#!/usr/bin/env python3
"""Bouw een vroege IFS-ENS-pluim uit ECMWF pre-scheduled delivery.

Open-Meteo ontvangt de native Europese O1280-ensemblebestanden via ECMWF
pre-scheduled delivery.  Die bron is voor de 00Z-ochtendrun doorgaans ruim voor
de publieke 0,25-graden Open Data gereed.  Dit module archiveert uitsluitend
een exact gepinde, volledig gevalideerde run.  De latere directe Open-Data-run
mag hetzelfde run-id atomair vervangen.

De bron levert 00Z (15 dagen) en 06Z (6 dagen), 51 leden en de echte native
tijden: uurlijks t/m +90, 3-uurlijks t/m +144 en voor 00Z 6-uurlijks t/m +360.
CAPE zit niet in deze voorlevering en wordt bewust niet gefabriceerd.
"""
from __future__ import annotations

import copy
import json
import math
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pluim_trend_cache as trend


EARLY_MODEL = "ecmwf_ifs_europe_ensemble"
EARLY_CYCLES = (0, 6)
EARLY_LATEST_META_URL = (
    "https://ensemble-api.open-meteo.com/data_run/"
    f"{EARLY_MODEL}/latest.json"
)
EARLY_API_URL = "https://ensemble-api.open-meteo.com/v1/ensemble"

# Alleen velden die vandaag aantoonbaar voor alle 51 leden uit de ECPDS-run
# beschikbaar zijn. CAPE ontbreekt in de bron en blijft dus eerlijk optioneel.
EARLY_FIELDS = (
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
ACCUMULATED_FIELDS = {"precipitation", "snowfall"}
EXPECTED_UNITS = {
    "temperature_2m": "°C",
    "precipitation": "mm",
    "wind_speed_10m": "km/h",
    "wind_direction_10m": "°",
    "cloud_cover": "%",
    "wind_gusts_10m": "km/h",
    "dew_point_2m": "°C",
    "relative_humidity_2m": "%",
    "snowfall": "cm",
}

# De API-velden hierboven worden uit deze native ECMWF-velden opgebouwd.  Dit
# is ook een snelle meta-poort voordat een grotere puntrespons wordt opgehaald.
REQUIRED_NATIVE_VARIABLES = {
    "temperature_2m",
    "precipitation",
    "wind_u_component_10m",
    "wind_v_component_10m",
    "cloud_cover",
    "wind_gusts_10m",
    "dew_point_2m",
}


def early_run_meta_url(cycle: datetime) -> str:
    return (
        "https://ensemble-api.open-meteo.com/data_run/"
        f"{EARLY_MODEL}/{cycle:%Y/%m/%d/%H%M}Z/meta.json"
    )


def validate_early_meta(document: object) -> tuple[datetime, datetime, list[datetime]]:
    if not isinstance(document, dict):
        raise RuntimeError("vroege ECMWF-meta is geen JSON-object")
    cycle = trend.parse_utc(document.get("reference_time", ""))
    created = trend.parse_utc(document.get("created_at", ""))
    if cycle.minute != 0 or cycle.second != 0 or cycle.hour not in EARLY_CYCLES:
        raise RuntimeError(f"niet-ondersteunde vroege ECMWF-cyclus {trend.iso_z(cycle)}")
    if created < cycle or created > datetime.now(timezone.utc):
        raise RuntimeError("ongeldige created_at in vroege ECMWF-meta")

    raw_valid_times = document.get("valid_times")
    if not isinstance(raw_valid_times, list) or len(raw_valid_times) < 2:
        raise RuntimeError("vroege ECMWF-meta mist native geldigheidstijden")
    valid_times = [trend.parse_utc(value) for value in raw_valid_times]
    if valid_times[0] != cycle:
        raise RuntimeError("vroege ECMWF-tijdas start niet op de initialisatie")
    if any(right <= left for left, right in zip(valid_times, valid_times[1:])):
        raise RuntimeError("vroege ECMWF-tijdas is niet strikt oplopend")
    expected_hours = (
        list(range(0, 91))
        + list(range(93, 145, 3))
        + (list(range(150, 361, 6)) if cycle.hour == 0 else [])
    )
    expected_times = [cycle + timedelta(hours=hour) for hour in expected_hours]
    if valid_times != expected_times:
        horizon = int((valid_times[-1] - cycle).total_seconds() // 3600)
        expected_horizon = expected_hours[-1]
        raise RuntimeError(
            "vroege ECMWF-run is nog niet compleet of mist native stappen "
            f"({len(valid_times)} tijden, +{horizon}; verwacht "
            f"{len(expected_times)} tijden, +{expected_horizon})"
        )

    native_variables = document.get("variables")
    if not isinstance(native_variables, list):
        raise RuntimeError("vroege ECMWF-meta mist variabelenlijst")
    missing = REQUIRED_NATIVE_VARIABLES.difference(native_variables)
    if missing:
        raise RuntimeError(
            "vroege ECMWF-run mist native velden: " + ", ".join(sorted(missing))
        )
    return cycle, created, valid_times


def same_early_meta(left: dict, right: dict) -> bool:
    keys = ("reference_time", "created_at", "valid_times", "variables")
    return all(left.get(key) == right.get(key) for key in keys)


def early_api_url(
    stations: list[tuple[str, str, float, float]],
    cycle: datetime,
) -> str:
    params = {
        "latitude": ",".join(str(lat) for _name, _slug, lat, _lon in stations),
        "longitude": ",".join(str(lon) for _name, _slug, _lat, lon in stations),
        "hourly": ",".join(EARLY_FIELDS),
        "models": EARLY_MODEL,
        "run": cycle.strftime("%Y-%m-%dT%H:%M"),
        # Een 00Z-run eindigt inclusief +360. Zestien kalenderdagen zorgen dat
        # de exclusieve API-daggrens dit laatste tijdstip niet afsnijdt.
        "forecast_days": "16",
        "timezone": "GMT",
        "timeformat": "iso8601",
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm",
        "cell_selection": "nearest",
        # Geen Open-Meteo hoogteterugrekening: gebruik het native roosterpunt,
        # net als de latere directe GRIB2-pluim.
        "elevation": ",".join("nan" for _station in stations),
    }
    return f"{EARLY_API_URL}?{urllib.parse.urlencode(params)}"


def _series_at_native_times(
    values: object,
    source_times: list[datetime],
    native_times: list[datetime],
    accumulated: bool,
) -> list[float | int]:
    if not isinstance(values, list) or len(values) != len(source_times):
        raise RuntimeError("vroege ECMWF-reeks heeft een ongeldige lengte")
    source_index = {value: index for index, value in enumerate(source_times)}
    if len(source_index) != len(source_times):
        raise RuntimeError("vroege ECMWF-respons bevat dubbele tijdstappen")
    missing = [value for value in native_times if value not in source_index]
    if missing:
        raise RuntimeError(f"vroege ECMWF-respons mist {len(missing)} native tijdstappen")

    indices = [source_index[value] for value in native_times]
    if not accumulated:
        out = [values[index] for index in indices]
    else:
        # Open-Meteo verdeelt een native 3/6-uursaccumulatie over uurvakken.
        # Herstel bij het terugzetten op de native as daarom de intervalsom.
        out = [0.0]
        for left, right in zip(indices, indices[1:]):
            interval = values[left + 1:right + 1]
            if len(interval) != right - left:
                raise RuntimeError("onvolledig vroeg ECMWF-accumulatie-interval")
            if any(value is None or not trend.is_finite_number(value) for value in interval):
                raise RuntimeError("vroeg ECMWF-accumulatie-interval bevat ontbrekende waarden")
            out.append(sum(float(value) for value in interval))

    if out and out[0] is None:
        # Gust is een maximum over het voorafgaande interval en heeft op t0
        # geen interval. De archiefcontracten vereisen wel een eindige 51xN-as.
        out[0] = 0.0
    if any(not trend.is_finite_number(value) for value in out):
        raise RuntimeError("vroege ECMWF-reeks bevat ontbrekende of niet-eindige waarden")
    return out


def native_hourly(response: object, native_times: list[datetime]) -> dict:
    if not isinstance(response, dict) or not isinstance(response.get("hourly"), dict):
        raise RuntimeError("vroege ECMWF-puntrespons is ongeldig")
    raw_hourly = response["hourly"]
    units = response.get("hourly_units")
    if not isinstance(units, dict):
        raise RuntimeError("vroege ECMWF-puntrespons mist eenheden")
    wrong_units = [
        f"{base}={units.get(base)!r}"
        for base, expected in EXPECTED_UNITS.items()
        if units.get(base) != expected
    ]
    if wrong_units:
        raise RuntimeError(
            "vroege ECMWF-puntrespons heeft onverwachte eenheden: "
            + ", ".join(wrong_units)
        )
    raw_times = raw_hourly.get("time")
    if not isinstance(raw_times, list) or len(raw_times) < len(native_times):
        raise RuntimeError("vroege ECMWF-puntrespons mist een uurlijkse tijdas")
    source_times = [
        datetime.fromtimestamp(value, tz=timezone.utc)
        if isinstance(value, (int, float)) and not isinstance(value, bool)
        else trend.parse_utc(value)
        for value in raw_times
    ]
    if any(right - left != timedelta(hours=1) for left, right in zip(source_times, source_times[1:])):
        raise RuntimeError("vroege ECMWF-API-tijdas is niet aaneengesloten uurlijks")

    hourly: dict[str, list] = {"time": [trend.iso_z(value) for value in native_times]}
    for base in EARLY_FIELDS:
        keys = trend.member_keys(raw_hourly, base)
        if len(keys) != trend.MEMBER_COUNT:
            raise RuntimeError(f"{base}: verwacht 51 vroege ECMWF-leden, kreeg {len(keys)}")
        for key in keys:
            hourly[key] = _series_at_native_times(
                raw_hourly.get(key),
                source_times,
                native_times,
                accumulated=base in ACCUMULATED_FIELDS,
            )
    return hourly


def _load_archive(path: Path, slug: str) -> dict:
    if not path.exists():
        return {}
    try:
        document = json.loads(path.read_text())
    except (OSError, ValueError, TypeError) as exc:
        raise RuntimeError(f"bestaand archief {slug} is onleesbaar") from exc
    if (
        not isinstance(document, dict)
        or document.get("schema") != 3
        or document.get("slug") != slug
        or not isinstance(document.get("runs"), list)
    ):
        raise RuntimeError(f"bestaand archief {slug} heeft een ongeldig schema")
    return document


def _is_direct_run(run: dict) -> bool:
    source = run.get("source") if isinstance(run.get("source"), dict) else {}
    return (
        source.get("access") == "direct_grib2_range_requests"
        or source.get("endpoint") == "data.ecmwf.int"
        or source.get("provider") == "ECMWF Open Data"
    )


def _build_early_run(
    hourly: dict,
    cycle: datetime,
    created: datetime,
    native_times: list[datetime],
    grid_meta: dict,
) -> dict:
    run_iso = trend.iso_z(cycle)
    source_meta = {
        "last_run_availability_time": int(created.timestamp()),
        "data_end_time": int(native_times[-1].timestamp()),
    }
    run = trend.build_run(
        hourly,
        run_iso,
        source_meta,
        grid_meta,
        hres_error="control uit dezelfde ECPDS-run",
    )
    members = run["members"]
    run["temp_hres"] = copy.deepcopy(members["temperature_2m"][0])
    run["precip_hres"] = copy.deepcopy(members["precipitation"][0])
    run["source"] = {
        "provider": "ECMWF",
        "delivery": "Open-Meteo pre-scheduled ECPDS",
        "model": EARLY_MODEL,
        "product": "IFS ENS Europe native O1280 9 km",
        "access": "ecmwf_prescheduled_point_api",
        "endpoint": "ensemble-api.open-meteo.com",
        "run_initialisation": run_iso,
        "availability": trend.iso_z(created),
        "first_observed": trend.iso_z(datetime.now(timezone.utc)),
        "data_end": trend.iso_z(native_times[-1]),
        "native_time_count": len(native_times),
        "grid_latitude": grid_meta.get("latitude"),
        "grid_longitude": grid_meta.get("longitude"),
        "grid_elevation": grid_meta.get("elevation"),
        "hres": {
            "status": "available",
            "model": "ecmwf_ifs",
            "product": "IFS control/HRES uit dezelfde ECPDS-run",
            "precipitation_alignment": "deaccumulated_native_intervals",
            "run_initialisation": run_iso,
            "identity": "oper-fc control, Cycle 50r1",
        },
    }
    trend.update_digest(run)
    return run


def try_early_run(
    out_dir: Path,
    keep: int = trend.KEEP_RUNS,
    stations: list[tuple[str, str, float, float]] | None = None,
    fetch=trend.fetch_with_retry,
) -> list[str]:
    """Return changed station paths, or [] when no newer early run is ready."""
    stations = trend.STATIONS if stations is None else stations
    cache_buster = int(datetime.now(timezone.utc).timestamp() * 1000)
    latest = fetch(f"{EARLY_LATEST_META_URL}?cache_buster={cache_buster}")
    cycle, created, native_times = validate_early_meta(latest)
    run_iso = trend.iso_z(cycle)

    documents: dict[str, dict] = {}
    newest_seen: datetime | None = None
    same_run_count = 0
    for name, slug, lat, lon in stations:
        path = out_dir / f"pluim_trend_{slug}.json"
        document = _load_archive(path, slug)
        documents[slug] = document
        valid_runs = [
            run for run in document.get("runs", [])
            if isinstance(run, dict) and trend.is_sha256(run.get("data_sha256"))
        ]
        for run in valid_runs:
            try:
                run_time = trend.parse_utc(run.get("run", ""))
            except (TypeError, ValueError):
                continue
            newest_seen = run_time if newest_seen is None else max(newest_seen, run_time)
        same = next((run for run in valid_runs if run.get("run") == run_iso), None)
        if same is not None:
            if _is_direct_run(same):
                print(f"Vroege run {run_iso} niet toegepast: directe run bestaat al")
                return []
            fields = set(trend.complete_run_fields(same))
            if set(EARLY_FIELDS).issubset(fields):
                same_run_count += 1

    if newest_seen is not None and newest_seen > cycle:
        print(
            f"Vroege run {run_iso} is ouder dan lokaal archief {trend.iso_z(newest_seen)} — skip"
        )
        return []
    if same_run_count == len(stations):
        print(f"Vroege run {run_iso} staat al volledig in alle {len(stations)} archieven")
        return []

    run_specific_url = (
        f"{early_run_meta_url(cycle)}?cache_buster={cache_buster}"
    )
    pinned_before = fetch(run_specific_url)
    pinned_cycle, pinned_created, pinned_times = validate_early_meta(pinned_before)
    if pinned_cycle != cycle or pinned_created != created or pinned_times != native_times:
        raise RuntimeError("latest en run-specifieke vroege ECMWF-meta verschillen")

    raw = fetch(early_api_url(stations, cycle))
    responses = raw if isinstance(raw, list) else [raw]
    if len(responses) != len(stations):
        raise RuntimeError(
            f"vroege ECMWF-batch bevat {len(responses)} locaties, verwacht {len(stations)}"
        )

    candidates: list[tuple[Path, dict, str, dict]] = []
    for (name, slug, lat, lon), response in zip(stations, responses):
        if not isinstance(response, dict):
            raise RuntimeError(f"{name}: ongeldige vroege ECMWF-respons")
        hourly = native_hourly(response, native_times)
        run = _build_early_run(hourly, cycle, created, native_times, response)
        document = documents[slug]
        runs = [
            item for item in document.get("runs", [])
            if isinstance(item, dict)
            and trend.is_sha256(item.get("data_sha256"))
            and item.get("run") != run_iso
        ]
        runs.insert(0, run)
        runs.sort(key=lambda item: trend.parse_utc(item["run"]), reverse=True)
        out = {
            "schema": 3,
            "station": name,
            "slug": slug,
            "lat": lat,
            "lon": lon,
            "updated": trend.iso_z(datetime.now(timezone.utc)),
            "runs": runs[:keep],
        }
        candidates.append((out_dir / f"pluim_trend_{slug}.json", out, name, run))

    pinned_after = fetch(run_specific_url)
    if not isinstance(pinned_after, dict) or not same_early_meta(pinned_before, pinned_after):
        raise RuntimeError("vroege ECMWF-runmetadata veranderde tijdens de batch")

    written: list[str] = []
    for path, out, name, run in candidates:
        tmp_path = path.with_suffix(path.suffix + ".early.tmp")
        tmp_path.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
        tmp_path.replace(path)
        written.append(str(path))
        print(
            f"  EARLY OK {name}: 51 leden, {run['n']} native stappen, "
            f"9 km, {len(run['members'])} velden"
        )
    return written
