#!/usr/bin/env python3
"""Haal de actuele ECMWF Extreme Forecast Index-kaarten op voor Weerlab.

Het script schrijft alleen ``ecmwf_efi_meta.json``. De kaartbeelden blijven de
originele, volledige-resolutie WebP's op charts.ecmwf.int; het JSON-bestand
bevat de laatste ECMWF-run, de 24-uurs tijdstappen en de directe beeld-URL's.
Upload daarna met ``shell/r2_publish_harmonie.sh ecmwf_efi_meta.json``.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


WORK_DIR = Path("/Users/aldus/KNMI_Project/weerlab")
PRODUCT_URL = (
    "https://charts.ecmwf.int/opencharts-api/v1/packages/opencharts/products/"
    "medium-multi-efi/"
)
USER_AGENT = "weerlab.nl-ecmwf-efi/1.0"


def fetch_json(url: str) -> dict:
    """Lees openbare ECMWF JSON met een kleine retry voor tijdelijke storingen."""
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urlopen(request, timeout=30) as response:  # noqa: S310 - vaste ECMWF URL
                return json.load(response)
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"ECMWF API niet bereikbaar: {last_error}")


def main() -> int:
    product = fetch_json(PRODUCT_URL)
    base_axis = next((axis for axis in product.get("axis", []) if axis.get("name") == "base_time"), None)
    bases = (base_axis or {}).get("values") or []
    if not bases:
        raise RuntimeError("ECMWF gaf geen EFI-runs terug")

    # De API rangschikt op meest recente beschikbare run. Een enkele actuele run
    # is voldoende voor de 24-uurs tijdlijn en voorkomt tientallen extra calls.
    base = bases[0]
    base_time = str(base["value"])
    frames: list[dict] = []
    for valid in base.get("linked_values") or []:
        valid_time = str(valid["value"])
        query = urlencode({
            "base_time": base_time,
            "valid_time": valid_time,
            "values": valid_time,
            "projection": "opencharts_europe",
        })
        data = fetch_json(f"{PRODUCT_URL}axis/valid_time/?{query}")
        result = (data.get("results") or {}).get(valid_time) or {}
        image_url = result.get("url")
        if not image_url:
            print(f"  overslaan: geen kaart voor {valid_time}")
            continue
        frames.append({
            "value": valid_time,
            "label": result.get("label") or valid.get("label") or valid_time,
            "url": image_url,
        })

    if not frames:
        raise RuntimeError("ECMWF gaf geen EFI-kaartbeelden terug")

    output = {
        "source": "ECMWF OpenCharts · medium-multi-efi",
        "source_url": "https://charts.ecmwf.int/products/medium-multi-efi",
        "updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "title": product.get("title", "Multi-parameter EFI during last 24 hours"),
        "base_time": base_time,
        "base_label": base.get("label", base_time),
        "projection": "opencharts_europe",
        "frames": frames,
    }
    destination = WORK_DIR / "ecmwf_efi_meta.json"
    destination.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"ECMWF EFI: {base_time}, {len(frames)} kaarten → {destination.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
