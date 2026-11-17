"""Cacheer recente gevalideerde KNMI-uurcodes via EDR (KNMI_EDR_KEY vereist)."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timedelta, timezone
import gzip
from pathlib import Path
import os
import urllib.parse
import urllib.request

BASE = "https://api.dataplatform.knmi.nl/edr/v1/collections/hourly-in-situ-meteorological-observations-validated"
UTC = timezone.utc

def request(path, token, **params):
    import json
    suffix = "?" + urllib.parse.urlencode(params) if params else ""
    req = urllib.request.Request(BASE + path + suffix, headers={
        "Authorization": token, "Accept": "application/json", "Accept-Encoding": "gzip"
    })
    with urllib.request.urlopen(req, timeout=70) as response:
        raw = response.read()
        return json.loads(gzip.decompress(raw) if response.headers.get("Content-Encoding") == "gzip" else raw)

def fetch(task):
    cache, token, names, year, month = task
    target = cache / f"{year}{month:02}.txt.gz"
    if target.is_file():
        return
    start = datetime(year, month, 1, tzinfo=UTC)
    stop = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=UTC)
    # Query exact uurvakken: eerste eindigt om 01 UTC, laatste om 00 UTC op
    # de eerste dag van de volgende maand. Schrijf die laatste als HH=24.
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    bounds = (start + timedelta(hours=1)).strftime(fmt) + "/" + stop.strftime(fmt)
    result = request("/area", token, coords="POLYGON((2 50,8 50,8 56,2 56,2 50))",
                     datetime=bounds, **{"parameter-name": "WW,IX,W3,W6"})
    tmp = target.with_suffix(".part")
    with gzip.open(tmp, "wt", encoding="utf-8", newline="") as f:
        for key, (id, name, lon, lat) in names.items():
            f.write(f"# {id} {lon} {lat} 0 {name}\n")
        f.write("# STN,YYYYMMDD,HH,WW,IX,S,Y\n")
        writer = csv.writer(f)
        n = 0
        for coverage in result["coverages"]:
            id, *_ = names[coverage["eumetnet:locationId"]]
            times = coverage["domain"]["axes"]["t"]["values"]
            ranges = coverage["ranges"]
            cols = [ranges.get(name, {"values": [None] * len(times)})["values"] for name in ("WW","IX","W3","W6")]
            for iso, *values in zip(times, *cols, strict=True):
                end = datetime.fromisoformat(iso)
                if not start < end <= stop or all(v is None for v in values):
                    continue
                day = end - timedelta(microseconds=1)
                writer.writerow([id, day.strftime("%Y%m%d"), end.hour or 24,
                                 *(int(v) if v is not None else None for v in values)])
                n += 1
        if not n:
            raise ValueError(f"KNMI EDR gaf geen bruikbare uurwaarden voor {year}-{month:02}")
    tmp.replace(target)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("cache", type=Path)
    p.add_argument("eerste_eindjaar", type=int)
    p.add_argument("laatste_eindjaar", type=int)
    p.add_argument("--hele-seizoen", action="store_true", help="Haal juli tot en met juni op.")
    args = p.parse_args()
    months = (7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6) if args.hele_seizoen else (10, 11, 12, 1, 2, 3)
    token = os.environ["KNMI_EDR_KEY"]
    features = request("/locations", token)["features"]
    names = {}
    for item in features:
        lon, lat = item["geometry"]["coordinates"]
        if not (2 <= lon <= 8 and 50 <= lat <= 56):
            continue
        key, props = item["id"], item["properties"]
        id = str(props.get("wmoId") or key.split("-")[-1]).removeprefix("06")
        names[key] = (id, props["name"], lon, lat)
    args.cache.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        tasks = [(args.cache, token, names, y - (m >= 7), m)
                 for y in reversed(range(args.eerste_eindjaar, args.laatste_eindjaar+1))
                 for m in months]
        for _ in pool.map(fetch, tasks):
            pass
    print(f"{len(tasks)} KNMI EDR-maanden beschikbaar")

if __name__ == "__main__":
    main()
