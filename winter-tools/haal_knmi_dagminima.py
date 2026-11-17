"""Haal KNMI-dagminima van alle beschikbare stations op per juli–juniseizoen."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API = "https://www.daggegevens.knmi.nl/klimatologie/daggegevens"


def fetch(cache, end, with_mean=False):
    target = cache / f"{end}.txt.gz"
    if target.is_file():
        with gzip.open(target, "rb") as cached:
            columns = next((line for line in cached if line.startswith(b"# STN,YYYYMMDD,")), b"")
        if columns and (not with_mean or b"TG" in columns):
            return
    query = urlencode({
        "stns": "ALL", "vars": "TN:TG" if with_mean else "TN", "start": f"{end-1}0701", "end": f"{end}0630"
    })
    req = Request(f"{API}?{query}", headers={
        "Accept-Encoding": "gzip", "User-Agent": "Weerlab seizoenskalender"
    })
    for attempt in range(3):
        try:
            with urlopen(req, timeout=35) as response:
                data = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
            if b"# STN,YYYYMMDD," not in data:
                raise ValueError(f"Geen KNMI-tabel voor eindjaar {end}")
            staging = target.with_suffix(".part")
            staging.write_bytes(gzip.compress(data, compresslevel=5))
            staging.replace(target)
            return
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("eerste_eindjaar", type=int)
    parser.add_argument("laatste_eindjaar", type=int)
    parser.add_argument("--met-etmaalgemiddelde", action="store_true", help="Haal TG naast TN op.")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    years = list(range(args.eerste_eindjaar, args.laatste_eindjaar + 1))
    with ThreadPoolExecutor(max_workers=4) as pool:
        for _ in pool.map(lambda year: fetch(args.cache, year, args.met_etmaalgemiddelde), years):
            pass
    print(f"{len(years)} KNMI-seizoenen met dagminima beschikbaar")


if __name__ == "__main__":
    main()
