"""KNMI Public Weather Warnings snapshots; never expose test data as live alerts.

Source contract: https://dataplatform.knmi.nl/dataset/docs/knmi-public-weather-warnings-1-0
The checked-in schema is KNMI's schema 0.7. Unknown schemas fail closed.
"""
from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from uuid import UUID

API = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/KNMI-public-weather-warnings/versions/1.0"
# Public, shared anonymous token published by KNMI; expires 1 August 2027.
# A personal token can be supplied via KNMI_API_KEY, never sent to the browser.
ANONYMOUS_KEY = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjUzYTg1ZDBhMmQ5YzRkYzJiYWNlNzQ4NTQ2Zjk4ODExIiwiaCI6Im11cm11cjEyOCJ9"
SCHEMA = json.loads((Path(__file__).parent / "schemas/knmi-public-warnings-0.7.json").read_text())
PHENOMENA = {"road-ice": "Gladheid", "snow": "Sneeuw", "high-temperature": "Hitte",
             "low-temperature": "Kou", "fog": "Mist", "thunderstorm": "Onweersbuien",
             "waterspouts": "Waterhozen", "wind": "Windstoten", "rain": "Zware regen"}
COLORS = {"yellow": "geel", "orange": "oranje", "red": "rood"}
SEVERITIES = {"Moderate": "geel", "Severe": "oranje", "Extreme": "rood"}


class NonOperationalSnapshot(ValueError):
    """Publication is explicitly test/exercise data, not today's weather."""


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Missing ISO timestamp")
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if date.tzinfo is None:
        raise ValueError("Timestamp without timezone")
    return date.astimezone(timezone.utc)


def validate(value, rule=None, path="snapshot"):
    """Validate the JSON Schema constructs used in KNMI's published schema.

    No dependencies are needed by the existing launchd Python environment.
    Defaults are not applied: source values remain intact.
    """
    rule = SCHEMA if rule is None else rule
    if "$ref" in rule:
        return validate(value, SCHEMA["$defs"][rule["$ref"].split("/")[-1]], path)
    if "anyOf" in rule:
        for option in rule["anyOf"]:
            try:
                validate(value, option, path)
                return
            except (ValueError, TypeError):
                pass
        raise ValueError(path + ": no schema alternative matches")
    types = {"object": isinstance(value, dict), "array": isinstance(value, list),
             "string": isinstance(value, str), "null": value is None,
             "number": type(value) in (int, float) and math.isfinite(value),
             "integer": type(value) is int}
    if "type" in rule and not types.get(rule["type"], False):
        raise ValueError(path + ": incorrect type")
    if "enum" in rule and value not in rule["enum"]:
        raise ValueError(path + ": unknown value")
    if isinstance(value, dict):
        if any(key not in value for key in rule.get("required", [])):
            raise ValueError(path + ": required field missing")
        for key, child in rule.get("properties", {}).items():
            if key in value:
                validate(value[key], child, path + "." + key)
    if isinstance(value, (list, str)):
        for low, high in [("minItems", "maxItems")] if isinstance(value, list) else [("minLength", "maxLength")]:
            if len(value) < rule.get(low, 0) or len(value) > rule.get(high, math.inf):
                raise ValueError(path + ": incorrect length")
    if isinstance(value, list):
        for i, item in enumerate(value):
            child = rule.get("prefixItems", [])[i] if i < len(rule.get("prefixItems", [])) else rule.get("items", {})
            validate(item, child, path + f"[{i}]")
    if rule.get("format") == "date-time":
        timestamp(value)
    if rule.get("format") == "uuid":
        UUID(value)


def geometry(area):
    # KNMI's schema allows omission of type through its model defaults.
    coordinates = area["coordinates"]
    if not coordinates:
        raise ValueError("Empty warning polygon")
    kind = area.get("type")
    if kind is None:
        kind = "Polygon" if isinstance(coordinates[0][0][0], (int, float)) else "MultiPolygon"
    if kind not in ("Polygon", "MultiPolygon"):
        raise ValueError("Unsupported warning geometry")
    polygons = [coordinates] if kind == "Polygon" else coordinates
    for polygon in polygons:
        if not polygon:
            raise ValueError("Empty polygon")
        for ring in polygon:
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("Unclosed warning polygon")
            for point in ring:
                if len(point) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) for v in point):
                    raise ValueError("Invalid coordinates")
                if not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90):
                    raise ValueError("Coordinates out of range")
    return {"type": kind, "coordinates": coordinates}


def normalize(snapshot, now=None, filename=None):
    now = now or datetime.now(timezone.utc)
    if now < datetime(2026, 11, 2, tzinfo=timezone.utc):
        # The test dataset also publishes empty heartbeat snapshots without a
        # Test set. They must not replace the real province warnings either.
        raise NonOperationalSnapshot("KNMI dataset is not live before 2 November 2026")
    validate(snapshot)
    meta = snapshot["metadata"]
    if meta.get("schema_version") != "0.7":
        raise ValueError("Unsupported KNMI schema version")
    if meta.get("publication_type") == "test":
        raise NonOperationalSnapshot("KNMI polygon dataset contains test data")
    if meta.get("publication_type") not in ("manual", "heartbeat"):
        raise ValueError("Missing operational publication type")
    if meta.get("domain", "public") != "public":
        raise ValueError("Wrong warning domain")
    issued = timestamp(meta["generated_at"])
    if (now - issued).total_seconds() > 36 * 3600 or (issued - now).total_seconds() > 300:
        raise ValueError("KNMI snapshot not current")
    sets = snapshot["warnings"]
    if snapshot["num_warning_sets"] != len(sets) or snapshot["num_warnings"] != sum(len(s["parts"]) for s in sets):
        raise ValueError("KNMI snapshot counters do not match")
    if sets and not any(s.get("operational_status") == "Actual" for s in sets):
        raise NonOperationalSnapshot("No Actual warning sets in snapshot")
    result = {"schema": 2, "mode": "polygons", "generated": now.isoformat(timespec="seconds"),
              "issued": meta["generated_at"], "source": API, "source_file": filename,
              "publication_type": meta["publication_type"], "snapshot_uuid": meta["snapshot_uuid"],
              "schema_version": meta["schema_version"], "operational_status": "Actual",
              "provinces": {}, "warnings": [], "outlook": [], "errors": {}}
    identities = set()
    for warning in sets:
        if warning.get("operational_status") != "Actual" or warning.get("status", "active") != "active":
            continue
        if warning.get("domain", "public") != "public":
            continue
        text = warning["texts"]["nl"]
        for part in warning["parts"]:
            if part.get("status", "active") != "active":
                continue
            onset, expires = part["onset"], part["expires"]
            if timestamp(onset) >= timestamp(expires):
                raise ValueError("Invalid warning validity")
            if timestamp(expires) <= now:
                continue
            if part["part_uuid"] in identities:
                raise ValueError("Duplicate warning part identity")
            identities.add(part["part_uuid"])
            code = SEVERITIES[part["severity"]]
            if part.get("color") and COLORS[part["color"]] != code:
                raise ValueError("Conflicting KNMI severity and color")
            area_description = (part.get("area_description") or part.get("area description") or {}).get("nl") or "KNMI-waarschuwingsgebied"
            guidance = (part.get("guidance") or {}).get("nl") or {}
            normalized = {"id": part["part_uuid"], "warning_set_id": warning["warning_set_uuid"],
                          "version_id": part["version_id"], "version_dt": part["version_dt"],
                          "code": code, "phenomenon": warning["phenomenon"],
                          "fenomeen": PHENOMENA[warning["phenomenon"]], "headline": text["headline"],
                          "detail": text["description"], "detailed_description": text.get("detailed_description", ""),
                          "warning_type": warning["warning_type"], "operational_status": "Actual",
                          "onset": onset, "expires": expires, "geldigheid": onset + " / " + expires,
                          "gebieden": [area_description], "geometry": geometry(part["area"]),
                          "probability": part["probability_percentage_range"],
                          "impact": guidance.get("impact") or "", "instruction": guidance.get("instruction") or ""}
            target = "warnings" if warning["warning_type"] == "warning" else "outlook"
            result[target].append(normalized)
    rank = {"geel": 1, "oranje": 2, "rood": 3}
    for target in ("warnings", "outlook"):
        result[target].sort(key=lambda w: (-rank[w["code"]], w["fenomeen"], w["onset"], w["id"]))
    return result


def read_json(url, token=None):
    headers = {"User-Agent": "Weerlab-KNMI-waarschuwingen/2.0 (+https://weerlab.nl)"}
    if token:
        headers["Authorization"] = token
    with urlopen(Request(url, headers=headers), timeout=25) as response:
        return json.load(response)


def api_json(url):
    token = os.environ.get("KNMI_API_KEY")
    if token:
        return read_json(url, token)
    # Reuse the established server-side KNMI credentials and retry policy.
    try:
        from knmi_api import knmi_get
    except ImportError:
        return read_json(url, ANONYMOUS_KEY)
    response = knmi_get(url, timeout=25)
    response.raise_for_status()
    return response.json()


def fetch_snapshot():
    listing = api_json(API + "/files?" + urlencode({"maxKeys": 10, "sorting": "desc"}))
    names = sorted((f["filename"] for f in listing.get("files", []) if f["filename"].endswith(".json")), reverse=True)
    if not names:
        raise ValueError("No KNMI JSON snapshot available")
    filename = names[0]
    link = api_json(API + "/files/" + quote(filename, safe="") + "/url")
    return read_json(link["temporaryDownloadUrl"]), filename


def load_operational():
    if datetime.now(timezone.utc) < datetime(2026, 11, 2, tzinfo=timezone.utc):
        raise NonOperationalSnapshot("KNMI dataset is in its test phase until 2 November")
    snapshot, filename = fetch_snapshot()
    return normalize(snapshot, filename=filename)
