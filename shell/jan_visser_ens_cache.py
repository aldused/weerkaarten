#!/usr/bin/env python3
"""Cache ECMWF IFS025 ensemble-mean dagstatistieken voor Jan Visser pluimen.

Haalt per station een 16-daagse ensemble run op via open-meteo, berekent:
- 6h TMax/TMin ENS-mean (eindtijden op 00/06/12/18 UTC)
- 12h precipitation ENS-mean (00-12 / 12-24 UTC)

Bewaart laatste 10 runs per station in één JSON: weerlab/jvens.json
Structuur:
  { "stations": {<name>: {<runISO>: {temp:[{t,mx,mn}], precip:[{t,v}]}}},
    "updated": "<ISO>",
    "schema": 1 }

De pagina kan dit op load fetchen en mergen met localStorage zodat ENS-prev
ook beschikbaar is voor eerste-bezoeken (los van browser-cache).
"""
from __future__ import annotations
import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

STATIONS = [
    ("De Bilt",            52.10, 5.18),
    ("Groningen (Eelde)",  53.13, 6.58),
    ("Twente",             52.27, 6.89),
    ("Maastricht (Beek)",  50.91, 5.77),
    ("Schiphol",           52.31, 4.77),
    ("Den Helder",         52.92, 4.78),
    ("Vlissingen",         51.44, 3.60),
]

KEEP_RUNS = 10
ENS_URL = (
    "https://ensemble-api.open-meteo.com/v1/ensemble"
    "?latitude={lat}&longitude={lon}"
    "&hourly=temperature_2m,precipitation"
    "&models=ecmwf_ifs025"
    "&start_date={start}&end_date={end}&timezone=UTC"
)


def fetch_with_retry(url: str, tries: int = 4) -> dict:
    last_err: Exception | None = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "weerlab-jvens/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last_err = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"Open-Meteo fetch faalde na {tries} pogingen: {last_err}")


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def bin_end_6h(t: datetime) -> datetime:
    h = t.hour
    if h == 0:
        return t.replace(minute=0, second=0, microsecond=0)
    end_hr = math.ceil(h / 6) * 6
    if end_hr == 24:
        return t.replace(hour=0, minute=0, second=0, microsecond=0) \
                .replace(day=t.day) + (datetime(t.year, t.month, t.day, 0, tzinfo=timezone.utc)
                                       - datetime(t.year, t.month, t.day, 0, tzinfo=timezone.utc))
    return t.replace(hour=end_hr, minute=0, second=0, microsecond=0)


def bin_end_6h_fixed(t: datetime) -> datetime:
    """6h bin-eindtijd: 0/6/12/18 UTC. h==0 -> dat tijdstip, anders volgende multiple."""
    if t.hour == 0:
        return t.replace(minute=0, second=0, microsecond=0)
    end_hr = math.ceil(t.hour / 6) * 6
    if end_hr == 24:
        from datetime import timedelta
        return (t.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1))
    return t.replace(hour=end_hr, minute=0, second=0, microsecond=0)


def compute_6h_ens_minmax(hourly: dict) -> list[dict]:
    times = [parse_iso(s) for s in hourly["time"]]
    member_keys = [k for k in hourly.keys()
                   if k == "temperature_2m" or k.startswith("temperature_2m_member")]
    bins: dict[datetime, list[int]] = {}
    for i, t in enumerate(times):
        be = bin_end_6h_fixed(t)
        bins.setdefault(be, []).append(i)

    out: list[dict] = []
    for be in sorted(bins.keys()):
        idxs = bins[be]
        if len(idxs) < 4:
            continue
        sum_mx = sum_mn = 0.0
        n_valid = 0
        for mk in member_keys:
            arr = hourly[mk]
            mx, mn = -math.inf, math.inf
            for i in idxs:
                v = arr[i]
                if v is None or not math.isfinite(v):
                    continue
                if v > mx:
                    mx = v
                if v < mn:
                    mn = v
            if math.isfinite(mx) and math.isfinite(mn):
                sum_mx += mx
                sum_mn += mn
                n_valid += 1
        if n_valid == 0:
            continue
        out.append({
            "t": be.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "mx": round(sum_mx / n_valid, 2),
            "mn": round(sum_mn / n_valid, 2),
        })
    return out


def compute_12h_ens_precip(hourly: dict) -> list[dict]:
    times = [parse_iso(s) for s in hourly["time"]]
    member_keys = [k for k in hourly.keys()
                   if k == "precipitation" or k.startswith("precipitation_member")]
    if not member_keys:
        return []
    bins: dict[datetime, list[int]] = {}
    for i, t in enumerate(times):
        half = 0 if t.hour < 12 else 12
        bs = t.replace(hour=half, minute=0, second=0, microsecond=0)
        bins.setdefault(bs, []).append(i)

    out: list[dict] = []
    for bs in sorted(bins.keys()):
        idxs = bins[bs]
        if len(idxs) < 10:
            continue
        sum_mean = 0.0
        valid_mem = 0
        for mk in member_keys:
            arr = hourly[mk]
            s, any_ok = 0.0, False
            for i in idxs:
                v = arr[i]
                if v is None or not math.isfinite(v):
                    continue
                s += v
                any_ok = True
            if any_ok:
                sum_mean += s
                valid_mem += 1
        if valid_mem > 0:
            out.append({
                "t": bs.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                "v": round(sum_mean / valid_mem, 2),
            })
    return out


def today_utc_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def add_days_utc(date_str: str, n: int) -> str:
    from datetime import timedelta
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return (d + timedelta(days=n)).strftime("%Y-%m-%d")


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", default="/Users/aldus/KNMI_Project/weerlab/jvens.json")
    p.add_argument("--keep", type=int, default=KEEP_RUNS)
    args = p.parse_args(argv)

    out_path = Path(args.out)
    existing = {}
    if out_path.exists():
        try:
            existing = json.loads(out_path.read_text())
        except Exception:
            existing = {}
    stations_db = existing.get("stations", {})

    start = today_utc_str()
    end = add_days_utc(start, 15)
    run_iso = f"{start}T00:00:00.000Z"

    total_added = 0
    for name, lat, lon in STATIONS:
        url = ENS_URL.format(lat=lat, lon=lon, start=start, end=end)
        try:
            data = fetch_with_retry(url)
        except Exception as e:
            print(f"FOUT station {name}: {e}", file=sys.stderr)
            continue
        hourly = data.get("hourly", {})
        if not hourly.get("time"):
            print(f"Geen data voor {name}", file=sys.stderr)
            continue

        temp = compute_6h_ens_minmax(hourly)
        precip = compute_12h_ens_precip(hourly)
        if not temp:
            print(f"Geen temp-bins voor {name}", file=sys.stderr)
            continue

        st = stations_db.setdefault(name, {})
        st[run_iso] = {"temp": temp, "precip": precip}
        # keep only last N runs
        runs = sorted(st.keys())
        while len(runs) > args.keep:
            del st[runs.pop(0)]
        total_added += 1
        print(f"OK {name}: {len(temp)} 6h-bins, {len(precip)} 12h-bins")

    out_doc = {
        "schema": 1,
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "current_run": run_iso,
        "stations": stations_db,
    }
    out_path.write_text(json.dumps(out_doc, separators=(",", ":")))
    print(f"Geschreven: {out_path} ({out_path.stat().st_size} bytes), {total_added}/{len(STATIONS)} stations bijgewerkt")
    return 0 if total_added > 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
