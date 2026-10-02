"""KDP dagreeksen: UTC-eindlabels naar meetdagen, waarden in fysieke eenheden."""
import math
from knmi_station_ids import station_wigos
from datetime import datetime, timedelta

BASE = "https://api.dataplatform.knmi.nl/edr/v1/collections/"
VALIDATED = "daily-in-situ-meteorological-observations-validated"
PROVISIONAL = "daily-in-situ-meteorological-observations"


def daily_label(day):
    return f"{day + timedelta(days=1):%Y-%m-%d}T00:00:00Z"


def parse_daily(payload, station, start, end, parameters=("RH", "EV24")):
    """Return {meetdag: {parameter: float | None}}; nooit null als nul lezen."""
    if payload.get("type") != "CoverageCollection" or not isinstance(payload.get("coverages"), list):
        raise ValueError("Ongeldig KNMI CoverageJSON-antwoord")
    if any(link.get("rel") == "next" for link in payload.get("links", [])):
        raise ValueError("KNMI-antwoord is gepagineerd; verklein het datumvenster")
    expected = station_wigos(station)
    rows = {}
    for coverage in payload["coverages"]:
        if coverage.get("eumetnet:locationId") != expected:
            raise ValueError("KNMI-antwoord bevat een ander station")
        times = coverage["domain"]["axes"]["t"]["values"]
        ranges = coverage["ranges"]
        for param in parameters:
            if param not in ranges or len(ranges[param]["values"]) != len(times):
                raise ValueError(f"Onvolledige KNMI-reeks: {param}")
            if ranges[param].get("axisNames") != ["t", "y", "x"] or ranges[param].get("shape") != [len(times), 1, 1]:
                raise ValueError(f"Onverwachte KNMI-dimensies: {param}")
        for i, label in enumerate(times):
            stamp = datetime.fromisoformat(label.replace("Z", "+00:00"))
            if stamp.utcoffset() != timedelta(0) or any((stamp.hour, stamp.minute, stamp.second)):
                raise ValueError("KNMI daglabel is geen UTC-middernacht")
            day = stamp.date() - timedelta(days=1)
            if not start <= day <= end:
                continue
            row = {}
            for param in parameters:
                value = ranges[param]["values"][i]
                if value is not None and (isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value)):
                    raise ValueError(f"Ongeldige waarde voor {param}")
                row[param] = value
            rows[day] = row
    return rows


def fetch_daily(station, start, end, validated=True, get=None):
    if get is None:
        from knmi_api import knmi_get
        get = knmi_get
    if start > end:
        return {}
    collection = VALIDATED if validated else PROVISIONAL
    response = get(
        f"{BASE}{collection}/locations/{station_wigos(station)}",
        params={"datetime": f"{daily_label(start)}/{daily_label(end)}", "parameter-name": "RH,EV24"},
        timeout=120,
    )
    response.raise_for_status()
    return parse_daily(response.json(), station, start, end)
