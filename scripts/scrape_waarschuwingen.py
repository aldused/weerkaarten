#!/usr/bin/env python3
"""
Scrape KNMI waarschuwingen per provincie + Waddeneilanden, schrijf JSON
naar weerlab/waarschuwingen.json. Wordt elke 15 min uitgevoerd via launchd.

Bron: https://www.knmi.nl/nederland-nu/weer/waarschuwingen/<slug>
Structuur:
  <div class="warning-overview ... warning-overview--{yellow|orange|red}">
    <h3>{fenomeen}</h3>
    <div class="warning-overview__xs-title">{geldigheid}</div>
    <div class="warning-overview__description">{detail}</div>
  </div>
Geen warning-overview-blokken op de pagina ⇒ code groen.
"""
from __future__ import annotations
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from bs4 import BeautifulSoup

ROOT     = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "waarschuwingen.json"
BASE     = "https://www.knmi.nl/nederland-nu/weer/waarschuwingen"
UA       = "Mozilla/5.0 (compatible; weerlab-waarschuwingen/1.0; +https://weerlab.nl)"
TIMEOUT  = 20

# Naam zoals in nl_provincies_wadden.geojson  →  KNMI URL-slug
PROVINCES: dict[str, str] = {
    "Groningen":      "groningen",
    "Fryslân":        "friesland",
    "Drenthe":        "drenthe",
    "Overijssel":     "overijssel",
    "Flevoland":      "flevoland",
    "Gelderland":     "gelderland",
    "Utrecht":        "utrecht",
    "Noord-Holland":  "noord-holland",
    "Zuid-Holland":   "zuid-holland",
    "Zeeland":        "zeeland",
    "Noord-Brabant":  "noord-brabant",
    "Limburg":        "limburg",
    "Waddeneilanden": "waddeneilanden",
}

CLASS_TO_CODE = {
    "warning-overview--yellow": "geel",
    "warning-overview--orange": "oranje",
    "warning-overview--red":    "rood",
}
CODE_RANK = {"groen": 0, "geel": 1, "oranje": 2, "rood": 3}


def _fetch(url: str) -> str:
    req = Request(url, headers={"User-Agent": UA, "Accept-Language": "nl,en;q=0.5"})
    with urlopen(req, timeout=TIMEOUT) as r:
        return r.read().decode("utf-8", errors="replace")


def _clean(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def _parse_warning_block(div) -> dict | None:
    classes = div.get("class") or []
    code = next((CLASS_TO_CODE[c] for c in classes if c in CLASS_TO_CODE), None)
    if not code:
        return None
    h3 = div.find("h3")
    fenomeen = _clean(h3.get_text(" ", strip=True)) if h3 else ""
    title_div = div.find(class_="warning-overview__xs-title")
    geldigheid = ""
    if title_div:
        # Eerste tekstregel is meestal "Za. 17:00 - Za. 22:00"
        geldigheid = _clean(title_div.get_text(" ", strip=True))
        geldigheid = re.sub(r"\s*Meer informatie\s*$", "", geldigheid).strip()
    desc_div = div.find(class_="warning-overview__description")
    detail = ""
    if desc_div:
        # Eerste alinea zonder de "Wat kan ik verwachten"-link
        for a in desc_div.find_all("a"):
            a.extract()
        detail = _clean(desc_div.get_text(" ", strip=True))
    return {
        "code": code,
        "fenomeen": fenomeen,
        "detail": detail,
        "geldigheid": geldigheid,
    }


def parse_province(html: str) -> tuple[str, list[dict]]:
    soup = BeautifulSoup(html, "html.parser")
    blocks = soup.select("div.warning-overview.warning-overview--indent")
    warnings: list[dict] = []
    for div in blocks:
        w = _parse_warning_block(div)
        if w:
            warnings.append(w)
    if not warnings:
        return "groen", []
    highest = max(warnings, key=lambda w: CODE_RANK[w["code"]])["code"]
    return highest, warnings


def scrape_all() -> dict:
    result = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source":    BASE,
        "provinces": {},
        "warnings":  [],   # geconsolideerd, met gebieden gegroepeerd per fenomeen+code
        "errors":    {},
    }
    # consolidatie-key: (code, fenomeen, geldigheid) → set(provincies)
    bucket: dict[tuple, dict] = {}

    for prov, slug in PROVINCES.items():
        url = f"{BASE}/{slug}"
        try:
            html = _fetch(url)
        except (URLError, HTTPError, TimeoutError) as e:
            result["errors"][prov] = f"{type(e).__name__}: {e}"
            result["provinces"][prov] = {"code": "groen", "warnings": []}
            continue
        try:
            code, warns = parse_province(html)
        except Exception as e:  # noqa: BLE001
            result["errors"][prov] = f"parse: {e}"
            result["provinces"][prov] = {"code": "groen", "warnings": []}
            continue

        result["provinces"][prov] = {"code": code, "warnings": warns}

        for w in warns:
            key = (w["code"], w["fenomeen"], w["geldigheid"])
            if key not in bucket:
                bucket[key] = {
                    "code":       w["code"],
                    "fenomeen":   w["fenomeen"],
                    "detail":     w["detail"],
                    "geldigheid": w["geldigheid"],
                    "gebieden":   [],
                }
            if prov not in bucket[key]["gebieden"]:
                bucket[key]["gebieden"].append(prov)

    # Sorteer: rood eerst, dan oranje, dan geel
    result["warnings"] = sorted(
        bucket.values(),
        key=lambda w: (-CODE_RANK[w["code"]], w["fenomeen"]),
    )
    return result


def main() -> int:
    data = scrape_all()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(OUT_PATH)
    n_with = sum(1 for p in data["provinces"].values() if p["code"] != "groen")
    print(f"[waarschuwingen] {len(data['provinces'])} gebieden, {n_with} met waarschuwing, "
          f"{len(data['warnings'])} unieke fenomenen, "
          f"{len(data['errors'])} errors → {OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
