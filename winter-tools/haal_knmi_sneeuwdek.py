"""Haal alle kalenderdagen op uit het openbare KNMI-neerslagstationsarchief."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import gzip
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API = "https://www.daggegevens.knmi.nl/klimatologie/monv/reeksen"
HEADER = b"# STN,YYYYMMDD,"

def fetch(task):
    cache, start, end, refresh = task
    key = f"{start:%Y%m%d}-{end:%Y%m%d}"
    target = cache / f"{key}.txt.gz"
    if target.exists() and not refresh:
        return key
    query = urlencode({"stns": "ALL", "start": start.strftime("%Y%m%d"), "end": end.strftime("%Y%m%d")})
    req = Request(f"{API}?{query}", headers={"Accept-Encoding": "gzip", "User-Agent": "Weerlab sneeuwdekarchief"})
    for attempt in range(3):
        try:
            with urlopen(req, timeout=40) as response:
                body = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
            if HEADER not in body:
                raise ValueError(f"Geen KNMI-tabel voor {key}")
            staging = target.with_suffix(".part")
            staging.write_bytes(gzip.compress(body, compresslevel=5))
            staging.replace(target)
            return key
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(2**attempt)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("cache", type=Path)
    p.add_argument("eerste_jaar", type=int)
    p.add_argument("t_m", type=date.fromisoformat)
    p.add_argument("--ververs-laatste", action="store_true")
    args = p.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    tasks = []
    for year in range(args.t_m.year, args.eerste_jaar-1, -1):
        for month in (7, 1):
            first = date(year, month, 1)
            last = min(args.t_m, date(year, 6, 30) if month == 1 else date(year, 12, 31))
            if first <= last:
                tasks.append((args.cache, first, last, args.ververs_laatste and year == args.t_m.year))
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i, key in enumerate(pool.map(fetch, tasks), 1):
            if i % 20 == 0 or i == len(tasks):
                print(f"{i}/{len(tasks)} periodes beschikbaar ({key})", flush=True)

if __name__ == "__main__":
    main()
