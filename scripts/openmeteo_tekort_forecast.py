#!/usr/bin/env python3
"""
openmeteo_tekort_forecast.py — 15-daagse neerslag-forecast voor AWS-stations.

Output: tekort_forecast.json
  Per AWS-station: { "lat":…, "lon":…, "naam":…, "daily": [{date, precip_mm, et0_mm}, …] }

Verdamping-forecast: ECMWF's ET0 (FAO Penman-Monteith) als proxy voor Makkink EV24.
Makkink ≈ 0,75 × ET0 onder Ned. omstandigheden (seizoensafhankelijk).
Voor tekort-extensie gebruiken we klimatologisch EV24-gemiddelde uit onze eigen data.
"""

import os
import json
import urllib.request
import urllib.parse
import re
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EV24_CACHE = os.path.join(SCRIPT_DIR, "ev24_cache")
OUT_JSON   = os.path.join(SCRIPT_DIR, "tekort_forecast.json")

AWS_LIST = [235, 240, 249, 251, 260, 278, 280, 283, 310, 319, 350, 377]


def parse_station_coords(aws: int):
    """Lees LAT/LON/NAME uit CSV-header."""
    path = os.path.join(EV24_CACHE, f"ev24_{aws}.csv")
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("# " + str(aws).rjust(9)) or re.match(rf"^#\s+{aws}\s", line):
                # "# 260         5.180       52.100      1.90        De Bilt"
                parts = line.lstrip("#").strip().split()
                if len(parts) >= 5:
                    lon = float(parts[1])
                    lat = float(parts[2])
                    naam = " ".join(parts[4:])
                    return lat, lon, naam
    return None


def fetch_forecast(lat: float, lon: float):
    """Deterministische ECMWF IFS-025 forecast."""
    params = urllib.parse.urlencode({
        "latitude":  lat,
        "longitude": lon,
        "daily":     "precipitation_sum,et0_fao_evapotranspiration",
        "forecast_days": 16,
        "timezone":  "Europe/Amsterdam",
        "models":    "ecmwf_ifs025",
    })
    url = f"https://api.open-meteo.com/v1/forecast?{params}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"    FOUT det: {e}")
        return None


def fetch_ensemble(lat: float, lon: float):
    """ECMWF-ensemble (50 perturbed + control) via ensemble-api."""
    params = urllib.parse.urlencode({
        "latitude":  lat,
        "longitude": lon,
        "daily":     "precipitation_sum,et0_fao_evapotranspiration",
        "forecast_days": 16,
        "timezone":  "Europe/Amsterdam",
        "models":    "ecmwf_ifs025",
    })
    url = f"https://ensemble-api.open-meteo.com/v1/ensemble?{params}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"    FOUT ens: {e}")
        return None


def parse_ensemble(data: dict):
    """Returnt lijst van dagen, met per dag lijsten precip[51] en et0[51]."""
    if not data or "daily" not in data:
        return None
    d = data["daily"]
    p_cols = sorted([k for k in d if k.startswith("precipitation_sum")])
    e_cols = sorted([k for k in d if k.startswith("et0_fao_evapotranspiration")])
    dates = d.get("time", [])
    out = []
    for i, date in enumerate(dates):
        precip = [d[k][i] for k in p_cols if d[k][i] is not None]
        et0    = [d[k][i] for k in e_cols if d[k][i] is not None]
        out.append({"date": date, "precip": precip, "et0": et0})
    return out


def main():
    print("=" * 60)
    print("openmeteo_tekort_forecast.py — 15-daagse forecast")
    print("=" * 60)
    out = {
        "gegenereerd": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "stations": {},
    }
    for aws in AWS_LIST:
        coords = parse_station_coords(aws)
        if not coords:
            print(f"  {aws}: geen coords gevonden, overslaan")
            continue
        lat, lon, naam = coords
        print(f"  {aws} {naam} ({lat}, {lon}) …")

        det = fetch_forecast(lat, lon)
        ens = fetch_ensemble(lat, lon)
        if not det or "daily" not in det:
            print(f"    geen deterministische forecast, overslaan")
            continue
        d = det["daily"]
        daily = []
        for i, datum in enumerate(d["time"]):
            daily.append({
                "date":   datum,
                "precip": d["precipitation_sum"][i],
                "et0":    d["et0_fao_evapotranspiration"][i],
            })
        ensemble_daily = parse_ensemble(ens) if ens else None
        out["stations"][str(aws)] = {
            "lat": lat, "lon": lon, "naam": naam,
            "daily":    daily,
            "ensemble": ensemble_daily,
        }

    with open(OUT_JSON, "w") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n✓ {OUT_JSON}  ({os.path.getsize(OUT_JSON)/1024:.1f} kB)")
    print(f"  Stations: {len(out['stations'])}/{len(AWS_LIST)}")
    if out["stations"]:
        first = next(iter(out["stations"].values()))
        dates = [d["date"] for d in first["daily"]]
        print(f"  Dagen:    {dates[0]} … {dates[-1]} ({len(dates)} dagen)")


if __name__ == "__main__":
    main()
