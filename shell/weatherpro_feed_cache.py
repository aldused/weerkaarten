#!/usr/bin/env python3
"""
Haalt de WeatherPro/MeteoGroup point-forecast feed (verse run, exact dezelfde
cijfers als de app en wetter24) per locatie-id (lid) en schrijft
weatherpro_uur.json voor de weerbewaking-pagina's.

Feed (keyless):
  WeatherServiceFeed.php?lid=<lid>&mode=premium&format=xml
  SearchFeed.php?search=<naam>  (lid-resolutie, eenmalig)

Per plaats:
  data: uurreeks  (tt/td/ff/ffg/dd/n/rr/pop/ppp/sun/ww; ff/ffg km/u, sun min/u)
  days: dagwaarden RECHTSTREEKS uit de feed-<day> (tx/tn/sun(h)/rr/pop/ff/ffg/dd/ww)
        — dit zijn de exacte app-dagcijfers, geen eigen aggregatie.

KNMI-stationnummers -> slug in "stations" zodat de documentpagina's
(5-dagen/Ridderkerk/event/uurlijks) direct kunnen koppelen.
"""
import json, sys, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Amsterdam")
except Exception:
    import sys as _sys
    print("WAARSCHUWING: zoneinfo ontbreekt — vaste +2u (fout in wintertijd)!", file=_sys.stderr)
    TZ = timezone(timedelta(hours=2))

BASE = "https://weatherpro.consumer.meteogroup.com/weatherpro"
DAYS = 9   # dagen uur-data bewaren (feed levert ~15)

# (slug, weergavenaam, lid, lat, lon) — lid via SearchFeed.php (8jul'26)
CITIES = [
    ("rotterdam",      "Rotterdam",        1811359, 51.920, 4.500),
    ("dordrecht",      "Dordrecht",        1810866, 51.800, 4.670),
    ("soestdijk",      "Soestdijk",        1812345, 52.180, 5.280),
    ("ridderkerk",     "Ridderkerk",       1811111, 51.870, 4.600),
    ("rhoon",          "Rhoon",            1811114, 51.870, 4.430),
    ("valkenburg_zh",  "Valkenburg (ZH)",  1812362, 52.180, 4.430),
    ("denhelder",      "Den Helder",       1814346, 52.958, 4.759),
    ("schiphol",       "Schiphol",         1812756, 52.300, 4.750),
    ("debilt",         "De Bilt",          1812106, 52.120, 5.180),
    ("lelystad",       "Lelystad",         1813247, 52.520, 5.480),
    ("leeuwarden",     "Leeuwarden",       1815113, 53.200, 5.780),
    ("deelen",         "Deelen",           1811917, 52.070, 5.880),
    ("eelde",          "Eelde",            1814847, 53.130, 6.570),
    ("enschede",       "Enschede",         1812432, 52.220, 6.900),
    ("vlissingen",     "Vlissingen",        189337, 51.450, 3.580),
    ("hoekvanholland", "Hoek van Holland", 1811678, 51.980, 4.130),
    ("gilzerijen",     "Gilze-Rijen",       189844, 51.550, 4.950),
    ("eindhoven",      "Eindhoven",         189296, 51.450, 5.470),
    ("volkel",         "Volkel",           1810320, 51.650, 5.650),
    ("maastricht",     "Maastricht",        188216, 50.850, 5.680),
    ("hoogeveen",      "Hoogeveen",        1813744, 52.730, 6.480),
    ("terschelling",   "Terschelling",     1815712, 53.400, 5.333),
    ("vlieland",       "Vlieland",         1815279, 53.250, 4.920),
]

# KNMI-stationnummer -> slug (voor de 5/6-daagse + event-pagina's)
KNMI_STATIONS = {
    210: "valkenburg_zh", 235: "denhelder", 240: "schiphol", 260: "debilt",
    269: "lelystad", 270: "leeuwarden", 275: "deelen", 280: "eelde",
    290: "enschede", 310: "vlissingen", 330: "hoekvanholland", 344: "rotterdam",
    350: "gilzerijen", 370: "eindhoven", 375: "volkel", 380: "maastricht",
}

def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "weerlab-feed/1.1"})
    return urllib.request.urlopen(req, timeout=30).read()

def _f(a, k):
    v = a.get(k)
    try: return float(v)
    except (TypeError, ValueError): return None

def _r(v):
    """Half-up afronden zoals JS Math.round / de app (Python round() is half-to-even)."""
    import math
    return int(math.floor(v + 0.5)) if v is not None else None

KT = 1.852  # feed-wind (ff/ffg) staat in KNOPEN -> km/u (geverifieerd tegen
            # point-forecast windSpeedInKnots/KilometerPerHour, zelfde run/uur)

def fetch_city(lid):
    xml = _get(f"{BASE}/WeatherServiceFeed.php?lid={lid}&mode=premium&format=xml")
    fc = ET.fromstring(xml).find("forecast")
    if fc is None:
        raise RuntimeError("geen <forecast> in feed")

    now = datetime.now(TZ)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=DAYS)

    data = []
    for h in fc.find("hours").findall("hour"):
        # Feed-dtg = EINDE van het uurvak (app toont vak 17-18 met de waarde die
        # op 18:00 gestempeld staat) -> wij labelen met de vak-START (dtg - 1 uur).
        dt = datetime.fromisoformat(h.attrib["dtg"]).astimezone(TZ) - timedelta(hours=1)
        if not (start <= dt <= end):
            continue
        a = h.attrib
        ff_kt = _f(a, "ff"); ffg_kt = _f(a, "ffg")
        data.append({
            "t": dt.strftime("%Y-%m-%dT%H:%M"),          # lokale tijd (Europe/Amsterdam)
            "iso": dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),  # exacte UTC
            "tt": _f(a, "tt"), "td": _f(a, "td"),
            "ff": _r((ff_kt or 0) * KT), "ffg": _r(((ffg_kt if ffg_kt is not None else ff_kt) or 0) * KT),
            "dd": _r(_f(a, "dd") or 0), "n": _f(a, "n"),
            "rr": round(_f(a, "rrr") or 0, 2), "pop": _r(_f(a, "prrr") or 0),
            "ppp": _f(a, "ppp"), "sun": _r(_f(a, "sun") or 0),
            "ww": int(_f(a, "ww") or 0),
        })

    # Dag-elementen: exacte app-dagcijfers (tx/tn/sun-uren/neerslag/kans/wind).
    days = {}
    for d in fc.find("days").findall("day"):
        dt = datetime.fromisoformat(d.attrib["dtg"]).astimezone(TZ)
        key = dt.strftime("%Y-%m-%d")
        a = d.attrib
        tx, tn = _f(a, "tx"), _f(a, "tn")
        if tx is None or tn is None:
            continue
        days[key] = {
            "txv": tx, "tnv": tn, "tx": _r(tx), "tn": _r(tn),
            "sun": _f(a, "sun"),                       # zonuren (decimaal)
            "rr": round(_f(a, "rrr") or 0, 1),         # dag-neerslag mm
            "pop": _r(_f(a, "prrr") or 0),             # dag-neerslagkans %
            "ff": _r((_f(a, "ff") or 0) * KT),         # dag-wind: kt -> km/u
            "ffg": _r((_f(a, "ffg") or 0) * KT),       # dag-stoot: kt -> km/u
            "dd": _r(_f(a, "dd") or 0),                # dag-windrichting
            "ww": int(_f(a, "ww") or 0),
        }

    return data, days

def main():
    repo = sys.argv[sys.argv.index("--dir") + 1] if "--dir" in sys.argv else "."
    out = {"_meta": {"fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                     "stations": KNMI_STATIONS, "bron": "WeatherServiceFeed (MeteoGroup)"}}
    fetched = out["_meta"]["fetched"]
    fouten = 0
    for slug, name, lid, lat, lon in CITIES:
        try:
            data, days = fetch_city(lid)
            if not data:
                print(f"  {name}: geen uur-data in venster", file=sys.stderr); fouten += 1; continue
            out[slug] = {"name": name, "lid": lid, "lat": lat, "lon": lon,
                         "fetched": fetched, "data": data, "days": days}
            print(f"  {name}: {len(data)} uur, {len(days)} dagen")
        except Exception as e:
            print(f"  {name}: FOUT {e}", file=sys.stderr); fouten += 1
    if len(out) <= 1:
        print("Geen enkele stad opgehaald.", file=sys.stderr); sys.exit(1)
    path = f"{repo}/weatherpro_uur.json"
    import os
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    os.replace(tmp, path)   # atomair: upload ziet nooit een half bestand
    n = len(out) - 1
    print(f"geschreven: {path} ({n} plaatsen, {fouten} fouten)")

if __name__ == "__main__":
    main()
