#!/usr/bin/env python3
"""Maak de actuele feed voor europa-maxima.html.

De MOSMIX-L-stations worden rechtstreeks bij DWD opgehaald. Khust gebruikt de
WeatherPro-puntverwachting, zoals de oorspronkelijke kaart. De uitvoer wordt
atomair geschreven zodat de webpagina nooit een half JSON-bestand kan lezen.
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import time as clock
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "europa_maxima.json"
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
UA = {"User-Agent": "weerlab.nl europa-maxima (ed@aldus.nl)"}
DWD_BASE = (
    "https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/"
    "single_stations/{code}/kml/MOSMIX_L_LATEST_{code}.kmz"
)

# weergavenaam, kaart-lat, kaart-lon, MOSMIX-id, bronstation
CITIES = [
    ("Reykjavik", 64.1466, -21.9426, "04030", "REYKJAVIK"),
    ("Narvik", 68.4385, 17.4273, "01194", "NARVIK"),
    ("Trondheim", 63.4305, 10.3951, "01271", "TRONDHEIM"),
    ("Oslo", 59.9139, 10.7522, "01492", "OSLO-BLINDERN"),
    ("Murmansk", 68.9585, 33.0827, "22113", "MURMANSK"),
    ("Rovaniemi", 66.5039, 25.7294, "02847", "ROVANIEMI"),
    ("Arkhangelsk", 64.5393, 40.5187, "22550", "ARCHANGELSK"),
    ("Moskou", 55.7558, 37.6173, "27612", "MOSKAU"),
    ("Vilnius", 54.6872, 25.2797, "26730", "VILNIUS"),
    ("Boekarest", 44.4268, 26.1025, "15420", "BUKAREST"),
    ("Helsinki", 60.1699, 24.9384, "02975", "HELSINKI"),
    ("Stockholm", 59.3293, 18.0686, "02464", "STOCKHOLM"),
    ("Edinburgh", 55.9533, -3.1883, "03160", "EDINBURGH"),
    ("Dublin", 53.3498, -6.2603, "03969", "DUBLIN"),
    ("Londen", 51.5074, -0.1278, "03772", "LONDON"),
    ("Amsterdam", 52.3676, 4.9041, "06240", "AMSTERDAM"),
    ("Parijs", 48.8566, 2.3522, "07149", "PARIS"),
    ("Bordeaux", 44.8378, -0.5792, "07510", "BORDEAUX"),
    ("Marseille", 43.2965, 5.3698, "07650", "MARSEILLE"),
    ("Bern", 46.948, 7.4474, "06630", "BERN"),
    ("Wenen", 48.2082, 16.3738, "11034", "WIEN/CITY"),
    ("Kopenhagen", 55.6761, 12.5683, "06180", "KOPENHAGEN"),
    ("Berlijn", 52.52, 13.405, "10389", "BERLIN-ALEX."),
    ("München", 48.1351, 11.582, "10865", "MUENCHEN STADT"),
    ("Warschau", 52.2297, 21.0122, "12375", "WARSCHAU"),
    ("Kyiv", 50.4501, 30.5234, "33345", "KIEW"),
    ("Chișinău", 47.0105, 28.8638, "33815", "KISHINEV/KICHINAU"),
    ("Sarajevo", 43.8563, 18.4131, "14654", "SARAJEVO-BEJELAVE"),
    ("Thessaloniki", 40.6401, 22.9444, "16622", "THESSALONIKI"),
    ("Istanbul", 41.0082, 28.9784, "17060", "ISTANBUL"),
    ("Ankara", 39.9334, 32.8597, "17128", "ANKARA"),
    ("Antalya", 36.8969, 30.7133, "17300", "ANTALYA"),
    ("Nicosia", 35.1856, 33.3823, "17610", "NICOSIA"),
    ("Athene", 37.9838, 23.7275, "16716", "ATHEN"),
    ("Heraklion", 35.3387, 25.1442, "16754", "HERAKLION"),
    ("Venetië", 45.4408, 12.3155, "16105", "VENEDIG"),
    ("Rome", 41.9028, 12.4964, "16239", "ROMA-CIAMPINO"),
    ("Catania", 37.5079, 15.083, "16460", "CATANIA"),
    ("Cagliari", 39.2238, 9.1217, "16560", "CAGLIARI"),
    ("Ibiza", 38.9067, 1.4206, "08373", "IBIZA"),
    ("Barcelona", 41.3874, 2.1686, "08181", "BARCELONA"),
    ("Madrid", 40.4168, -3.7038, "08221", "MADRID/BARAJAS"),
    ("La Coruña", 43.3623, -8.4115, "08001", "LA CORUNA"),
    ("Lissabon", 38.7223, -9.1393, "08536", "LISSABON"),
    ("Córdoba", 37.8882, -4.7794, "08410", "CORDOBA"),
    ("Tenerife", 28.2916, -16.6291, "60015", "TENERIFE NORTE"),
    ("Ponta Delgada", 37.7412, -25.6756, "08513", "PONTA DELGADA"),
]


def http_get(url: str, *, headers: dict[str, str] | None = None,
             params: dict[str, str] | None = None, timeout: int = 35,
             attempts: int = 3) -> bytes:
    if params:
        url = f"{url}?{urlencode(params)}"
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            request = Request(url, headers={**UA, **(headers or {})})
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except Exception as exc:
            last_error = exc
            if attempt < attempts:
                clock.sleep(attempt * 2)
    assert last_error is not None
    raise last_error


def strip_namespaces(xml: str) -> str:
    xml = re.sub(r"<(/?)\w+:", r"<\1", xml)
    xml = re.sub(r"\b\w+:(\w+=)", r"\1", xml)
    return re.sub(r'\s+xmlns(?::\w+)?="[^"]*"', "", xml)


def parse_values(root: ET.Element, name: str) -> list[float | None]:
    for forecast in root.findall(".//Forecast"):
        if forecast.get("elementName") != name:
            continue
        value = forecast.find("value")
        result: list[float | None] = []
        for raw in (value.text if value is not None and value.text else "").split():
            try:
                result.append(float(raw))
            except ValueError:
                result.append(None)
        return result
    return []


def parse_dwd_city(city: tuple[str, float, float, str, str]) -> tuple[dict[str, Any], datetime]:
    name, lat, lon, code, station = city
    content = http_get(DWD_BASE.format(code=code))
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        kml_name = next(n for n in archive.namelist() if n.lower().endswith(".kml"))
        root = ET.fromstring(strip_namespaces(archive.read(kml_name).decode("utf-8")))

    issue_text = root.findtext(".//IssueTime", "").strip()[:19]
    issue = datetime.strptime(issue_text, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    times = [
        datetime.strptime((node.text or "").strip()[:19], "%Y-%m-%dT%H:%M:%S")
        .replace(tzinfo=timezone.utc)
        .astimezone(LOCAL_TZ)
        for node in root.findall(".//ForecastTimeSteps/TimeStep")
    ]
    tx = parse_values(root, "TX")
    by_date: dict[str, list[float]] = {}
    for valid, kelvin in zip(times, tx):
        if kelvin is None or kelvin <= 200 or valid.hour < 12:
            continue
        by_date.setdefault(valid.date().isoformat(), []).append(kelvin - 273.15)

    return ({
        "name": name,
        "lat": lat,
        "lon": lon,
        "source": "MOSMIX",
        "station": station,
        "stationId": code,
        "values": {key: round(max(values), 1) for key, values in by_date.items()},
    }, issue)


def fetch_weatherpro_khust(today: datetime) -> tuple[dict[str, Any], datetime]:
    token = http_get("https://api.weatherpro.com/v1/token/weather", timeout=20).decode().strip()
    start = datetime.combine(today.date(), time.min, tzinfo=LOCAL_TZ).astimezone(timezone.utc)
    end = start + timedelta(days=3)
    params = {
        "fields": "maxAirTemperatureInCelsius,minAirTemperatureInCelsius,issuedAt",
        "locatedAt": "23.2972,48.175",
        "validPeriod": "PT12H",
        "validFrom": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "validUntil": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    content = http_get(
        "https://point-forecast-weatherpro.meteogroup.com/search",
        params=params,
        headers={"Authorization": f"Bearer {token}"},
        timeout=25,
    )
    forecasts = json.loads(content).get("forecasts", [])
    values: dict[str, float] = {}
    issued: list[datetime] = []
    for forecast in forecasts:
        valid_from = datetime.fromisoformat(forecast["validFrom"].replace("Z", "+00:00"))
        local = valid_from.astimezone(LOCAL_TZ)
        # De dagperiode start bij deze bron rond 06 UTC. Negeer het nachtvenster.
        if not 5 <= valid_from.hour <= 8:
            continue
        value = forecast.get("maxAirTemperatureInCelsius")
        if value is not None:
            values[local.date().isoformat()] = round(float(value), 1)
        if forecast.get("issuedAt"):
            issued.append(datetime.fromisoformat(forecast["issuedAt"].replace("Z", "+00:00")))
    if not values:
        raise RuntimeError("WeatherPro leverde geen dagmaxima voor Khust")
    return ({
        "name": "Khust",
        "lat": 48.175,
        "lon": 23.2972,
        "source": "WeatherPro",
        "station": "puntverwachting Khust",
        "stationId": "",
        "values": values,
    }, max(issued) if issued else datetime.now(timezone.utc))


def main() -> int:
    now = datetime.now(timezone.utc)
    local_now = now.astimezone(LOCAL_TZ)
    wanted = [(local_now.date() + timedelta(days=offset)).isoformat() for offset in (0, 1)]
    cities: list[dict[str, Any]] = []
    runs: list[datetime] = []
    errors: list[str] = []

    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(parse_dwd_city, city): city[0] for city in CITIES}
        for future in as_completed(futures):
            name = futures[future]
            try:
                city, issue = future.result()
                if all(date in city["values"] for date in wanted):
                    cities.append(city)
                    runs.append(issue)
                else:
                    errors.append(f"{name}: vandaag/morgen niet compleet")
            except Exception as exc:
                errors.append(f"{name}: {exc}")

    try:
        khust, issue = fetch_weatherpro_khust(local_now)
        if all(date in khust["values"] for date in wanted):
            cities.append(khust)
            runs.append(issue)
        else:
            errors.append("Khust: vandaag/morgen niet compleet")
    except Exception as exc:
        errors.append(f"Khust: {exc}")

    expected = len(CITIES) + 1
    if len(cities) < expected:
        print("Feed niet gepubliceerd; onvolledige brondata:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        print(f"Compleet: {len(cities)}/{expected}", file=sys.stderr)
        return 1

    oldest_run = min(runs)
    age_hours = (now - oldest_run.astimezone(timezone.utc)).total_seconds() / 3600
    if age_hours > 30:
        print(f"Feed niet gepubliceerd; oudste modelrun is {age_hours:.1f} uur oud.", file=sys.stderr)
        return 1

    order = {
        name: index if index < 26 else index + 1
        for index, (name, *_rest) in enumerate(CITIES)
    }
    order["Khust"] = 26
    cities.sort(key=lambda item: order[item["name"]])
    payload = {
        "generated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "modelRun": max(runs).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dates": {"today": wanted[0], "tomorrow": wanted[1]},
        "count": len(cities),
        "cities": cities,
    }
    tmp = OUT.with_suffix(OUT.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, OUT)
    print(f"OK {len(cities)} plaatsen -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
