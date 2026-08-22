#!/usr/bin/env python3
"""Maak compacte dagbestanden voor het interactieve klimaatarchief.

De historische basis komt uit de lokale KNMI-daggegevens. De dagelijks
vernieuwde maanddata-bestanden worden daar overheen gelegd, zodat ook dagen die
via EDR zijn aangevuld meteen in het archief terechtkomen. Naast temperatuur,
zon en neerslag worden wind en het percentage mogelijke zonneschijn meegenomen.
Station 999 is het daggemiddelde van de vijf hoofdstations.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
STATIONS = {
    235: "Den Helder",
    240: "Schiphol",
    260: "De Bilt",
    270: "Leeuwarden",
    275: "Deelen",
    280: "Eelde",
    283: "Hupsel",
    286: "Nieuw Beerta",
    290: "Twenthe",
    310: "Vlissingen",
    330: "Hoek van Holland",
    344: "Rotterdam Airport",
    350: "Gilze-Rijen",
    370: "Eindhoven",
    380: "Maastricht",
    391: "Arcen",
}
MAIN_STATIONS = (260, 235, 310, 280, 380)
COLUMNS = ("date", "tx", "tn", "tg", "rr", "sq", "ddvec", "fhvec", "fg", "sp")
SOURCE_FIELDS = ("TX", "TN", "TG", "RH", "SQ", "DDVEC", "FHVEC", "FG", "SP")
JSON_FIELDS = ("tx", "tn", "tg", "rr", "sq", "ddvec", "fhvec", "fg", "sp")


def number(value: str, field: str) -> float | int | None:
    value = value.strip()
    if not value:
        return None
    raw = int(value)
    if raw == -1 and field in {"RH", "SQ", "SP"}:
        raw = 0
    if field in {"DDVEC", "SP"}:
        return raw
    scaled = raw / 10
    return int(scaled) if scaled.is_integer() else round(scaled, 1)


def read_station(station: int) -> list[list[object]]:
    path = ROOT / f"knmi_dagdata_{station}.csv"
    header: list[str] | None = None
    rows_by_date: dict[str, list[object]] = {}
    with path.open(encoding="latin-1") as handle:
        for line in handle:
            if line.startswith("# STN,"):
                header = [part.strip() for part in line[2:].split(",")]
                continue
            if header is None or line.startswith("#") or not line.strip():
                continue
            parts = [part.strip() for part in line.split(",")]
            if len(parts) < len(header):
                continue
            item = dict(zip(header, parts))
            date = item.get("YYYYMMDD", "")
            if len(date) != 8 or not date.isdigit():
                continue
            iso = f"{date[:4]}-{date[4:6]}-{date[6:]}"
            values = [number(item.get(field, ""), field) for field in SOURCE_FIELDS]
            rows_by_date[iso] = [iso, *values]

    # De maanddata-run vult de ZIP-reeks dagelijks aan via EDR. Alle aanwezige
    # waarden overschrijven daarom de CSV-basis; ontbrekende extra windvelden
    # blijven tijdelijk uit de historische basis beschikbaar.
    month_path = ROOT / f"maanddata_{station}.json"
    if month_path.exists():
        payload = json.loads(month_path.read_text(encoding="utf-8"))
        for date, day in payload.get("data", {}).items():
            row = rows_by_date.setdefault(date, [date, *([None] * len(JSON_FIELDS))])
            for index, field in enumerate(JSON_FIELDS, start=1):
                value = day.get(field)
                if value is not None:
                    row[index] = value

    # De kleine patch uit haal_maanddata.py bevat de meest recente EDR-dagen
    # inclusief wind en zonpercentage en wint daarom van beide historische
    # bronnen.
    patch_path = ROOT / f"klimaatarchief_actueel_{station}.json"
    if patch_path.exists():
        payload = json.loads(patch_path.read_text(encoding="utf-8"))
        for date, day in payload.get("data", {}).items():
            row = rows_by_date.setdefault(date, [date, *([None] * len(JSON_FIELDS))])
            for index, field in enumerate(JSON_FIELDS, start=1):
                value = day.get(field)
                if value is not None:
                    row[index] = value
    return [rows_by_date[date] for date in sorted(rows_by_date)]


def average(values: list[float | int]) -> float | int | None:
    if not values:
        return None
    result = round(sum(values) / len(values), 1)
    return int(result) if result.is_integer() else result


def build_main_station_group(all_rows: dict[int, list[list[object]]]) -> list[list[object]]:
    by_date: dict[str, list[list[object]]] = defaultdict(list)
    for station in MAIN_STATIONS:
        for row in all_rows[station]:
            by_date[str(row[0])].append(row)

    grouped: list[list[object]] = []
    for date in sorted(by_date):
        station_rows = by_date[date]
        values: list[object] = [date]
        for index in range(1, len(COLUMNS)):
            if COLUMNS[index] == "ddvec":
                vectors = [
                    (float(row[6]), float(row[7]))
                    for row in station_rows
                    if isinstance(row[6], (int, float)) and isinstance(row[7], (int, float)) and row[7] > 0
                ]
                if not vectors:
                    values.append(None)
                else:
                    east = sum(speed * math.sin(math.radians(direction)) for direction, speed in vectors)
                    north = sum(speed * math.cos(math.radians(direction)) for direction, speed in vectors)
                    values.append(round(math.degrees(math.atan2(east, north)) % 360))
                continue
            present = [row[index] for row in station_rows if isinstance(row[index], (int, float))]
            values.append(average(present))
        grouped.append(values)
    return grouped


def write(station: int, name: str, rows: list[list[object]]) -> None:
    payload = {
        "station": station,
        "naam": name,
        "columns": COLUMNS,
        "data": rows,
        "laatste_dag": rows[-1][0] if rows else None,
        "uitleg": {
            "wind": "FG is etmaalgemiddelde windsnelheid; DDVEC/FHVEC bepalen de vectorrichting.",
            "ads": "ADS gebruikt TG boven de 10-daagse normaal, RH maximaal 0,2 mm en SP minimaal 50%.",
        },
    }
    target = ROOT / f"klimaatarchief_data_{station}.json"
    target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{target.name}: {len(rows):,} dagen")


def main() -> None:
    all_rows = {station: read_station(station) for station in STATIONS}
    for station, name in STATIONS.items():
        write(station, name, all_rows[station])
    write(999, "Hoofdstations", build_main_station_group(all_rows))


if __name__ == "__main__":
    main()
