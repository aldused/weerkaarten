"""Download openbare KNMI-uurwaarden per kalendermaand; hergebruik de cache."""
import argparse
import calendar
import concurrent.futures
import gzip
from pathlib import Path
import time
import urllib.parse
import urllib.request

API = "https://www.daggegevens.knmi.nl/klimatologie/uurgegevens"

def fetch(task):
    cache, year, month = task
    month_start = f"{year}{month:02d}01"
    month_end = f"{year}{month:02d}{calendar.monthrange(year, month)[1]:02d}"
    target = cache / f"{year}{month:02d}.txt.gz"
    if target.is_file():
        return
    query = urllib.parse.urlencode(dict(stns="ALL", vars="WW:IX:S", start=month_start+"01", end=month_end+"24"))
    for attempt in range(3):
        try:
            req = urllib.request.Request(f"{API}?{query}", headers={
                "Accept-Encoding": "gzip", "User-Agent": "Weerlab/winterarchief"
            })
            with urllib.request.urlopen(req, timeout=35) as response:
                raw = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
            if b"# STN,YYYYMMDD,HH," not in raw:
                raise ValueError("KNMI gaf geen tabel terug")
            tmp = target.with_suffix(".part")
            tmp.write_bytes(gzip.compress(raw, compresslevel=5))
            tmp.replace(target)
            return
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("cache", type=Path)
    p.add_argument("eerste_eindjaar", type=int)
    p.add_argument("laatste_eindjaar", type=int)
    period = p.add_mutually_exclusive_group()
    period.add_argument("--hele-seizoen", action="store_true", help="Haal juli tot en met juni op.")
    period.add_argument("--winterjaar", action="store_true", help="Haal augustus tot en met juli op.")
    args = p.parse_args()
    start = 8 if args.winterjaar else 7
    months = (*range(start, 13), *range(1, start)) if args.winterjaar or args.hele_seizoen else (10, 11, 12, 1, 2, 3)
    args.cache.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        # Meest recente winter eerst, daarna terug in de tijd.
        jobs = [(args.cache, y - (m >= start), m)
                for y in reversed(range(args.eerste_eindjaar, args.laatste_eindjaar + 1))
                for m in months]
        for _ in pool.map(fetch, jobs):
            pass
    print(f"{len(jobs)} KNMI-maandbestanden beschikbaar")

if __name__ == "__main__":
    main()
