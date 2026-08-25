#!/usr/bin/env python3
"""Haal het nieuwste KNMI CellWarn-product op en publiceer het voor Weerlab.

De browserkaart kan de KNMI Open Data API niet rechtstreeks gebruiken zonder
de API-sleutel prijs te geven. Dit script draait daarom server-side, kiest het
nieuwste individuele-cellenbestand en schrijft dat atomisch als GeoJSON.

Gebruik:
    python3 cell_tracking_update.py [--out PAD] [--no-publish]

De API-sleutel komt uit KNMI_API_KEY of, als die variabele ontbreekt, uit
KNMI_Project/pascal/.env. Met --no-publish is het script lokaal te testen.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen


HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PROJECT = REPO.parent
DEFAULT_OUT = REPO / "cell_tracking_latest.geojson"
R2_PUBLISH = HERE / "r2_publish.sh"

BASE = "https://api.dataplatform.knmi.nl/open-data/v1"
DATASET = "cell-tracking"
VERSION = "2.0"
FILE_PREFIX = "adaguc_polygons_hail_"


def load_api_key() -> str:
    key = os.environ.get("KNMI_API_KEY", "").strip()
    if key:
        return key

    env_path = PROJECT / "pascal" / ".env"
    if env_path.exists():
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            if raw.strip().startswith("KNMI_API_KEY="):
                return raw.split("=", 1)[1].strip().strip("\"'")
    raise RuntimeError("KNMI_API_KEY ontbreekt (ook niet gevonden in pascal/.env)")


def get_json(url: str, api_key: str | None = None, tries: int = 3) -> dict:
    headers = {"User-Agent": "weerlab-cellwarn/1.0"}
    if api_key:
        headers["Authorization"] = api_key
    last_error: Exception | None = None
    for attempt in range(tries):
        try:
            with urlopen(Request(url, headers=headers), timeout=60) as response:
                return json.load(response)
        except Exception as exc:
            last_error = exc
            if attempt + 1 < tries:
                time.sleep(2 * (attempt + 1))
    assert last_error is not None
    raise last_error


def latest_filename(api_key: str) -> str:
    url = (
        f"{BASE}/datasets/{DATASET}/versions/{VERSION}/files"
        "?maxKeys=100&orderBy=created&sorting=desc"
    )
    listing = get_json(url, api_key)
    names = [
        str(item.get("filename", ""))
        for item in listing.get("files", [])
        if str(item.get("filename", "")).startswith(FILE_PREFIX)
        and str(item.get("filename", "")).endswith(".geojson")
        and "combined" not in str(item.get("filename", ""))
    ]
    if not names:
        raise RuntimeError("geen individueel CellWarn-GeoJSON in de KNMI-bestandslijst")
    return max(names)


def download_product(filename: str, api_key: str) -> dict:
    safe_name = quote(filename, safe="")
    url_info = get_json(
        f"{BASE}/datasets/{DATASET}/versions/{VERSION}/files/{safe_name}/url",
        api_key,
    )
    download_url = url_info.get("temporaryDownloadUrl")
    if not download_url:
        raise RuntimeError("KNMI gaf geen tijdelijke download-URL terug")
    return get_json(str(download_url))


def validate_and_annotate(data: dict, filename: str) -> dict:
    if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
        raise RuntimeError("CellWarn-bestand is geen geldige GeoJSON FeatureCollection")
    for index, feature in enumerate(data["features"]):
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise RuntimeError(f"ongeldig GeoJSON-feature op positie {index}")
        geometry = feature.get("geometry") or {}
        if geometry.get("type") not in ("Polygon", "MultiPolygon"):
            raise RuntimeError(f"onverwacht geometrie-type op positie {index}")

    data["weerlab"] = {
        "source": "KNMI CellWarn / cell-tracking 2.0",
        "source_filename": filename,
        "fetched_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "feature_count": len(data["features"]),
    }
    return data


def atomic_write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
    ) as handle:
        handle.write(payload)
        temp_path = Path(handle.name)
    temp_path.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="KNMI CellWarn → Weerlab GeoJSON")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--no-publish", action="store_true")
    args = parser.parse_args()

    api_key = load_api_key()
    filename = latest_filename(api_key)
    data = validate_and_annotate(download_product(filename, api_key), filename)
    atomic_write(args.out, data)
    timestamp = (data.get("dimensions") or {}).get("time", {}).get("value", "onbekend")
    print(f"CellWarn bijgewerkt: {filename} · {len(data['features'])} features · {timestamp}")

    if not args.no_publish:
        if not R2_PUBLISH.exists():
            raise RuntimeError(f"publicatiescript ontbreekt: {R2_PUBLISH}")
        subprocess.run([str(R2_PUBLISH), str(args.out)], check=True, cwd=REPO)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
