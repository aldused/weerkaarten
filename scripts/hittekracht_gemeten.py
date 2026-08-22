#!/usr/bin/env python3
"""Officiële gemeten hittekracht (KNMI Dataplatform) per station.

Bron: KDP-dataset ``wet_bulb_globe_temperature`` v3.0 — 10-minuten-CSV's met
per station WBGT én heat_force (hittekracht), exact zoals de KNMI-app ze
toont voor gemeten waarden (TR-26-04).

Haalt alle bestanden van de lopende lokale dag op, bepaalt per station de
actuele waarde en het dagmaximum, en schrijft weerlab/hittekracht_gemeten.json.
Per bestand wordt het parseresultaat gecachet zodat een periodieke run alleen
nieuwe bestanden downloadt.
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import knmi_api  # noqa: E402

WEERLAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UIT_JSON = os.path.join(WEERLAB, "hittekracht_gemeten.json")
CACHE_JSON = os.path.join(WEERLAB, "logs", "hittekracht_gemeten_cache.json")

BASE = ("https://api.dataplatform.knmi.nl/open-data/v1/datasets/"
        "wet_bulb_globe_temperature/versions/3.0/files")

STATION_NAMEN = {
    "06215": "Voorschoten", "06235": "De Kooy", "06240": "Schiphol",
    "06249": "Berkhout", "06251": "Terschelling", "06260": "De Bilt",
    "06267": "Stavoren", "06269": "Lelystad", "06270": "Leeuwarden",
    "06273": "Marknesse", "06275": "Deelen", "06279": "Hoogeveen",
    "06280": "Eelde", "06283": "Hupsel", "06286": "Nieuw Beerta",
    "06290": "Twenthe", "06310": "Vlissingen", "06319": "Westdorpe",
    "06323": "Wilhelminadorp", "06330": "Hoek v. Holland",
    "06340": "Woensdrecht", "06344": "Rotterdam", "06348": "Cabauw",
    "06350": "Gilze-Rijen", "06356": "Herwijnen", "06370": "Eindhoven",
    "06375": "Volkel", "06377": "Ell", "06380": "Maastricht",
    "06391": "Arcen",
}


def _amsterdam_offset(dt_utc):
    """Uur-offset Amsterdam (1 of 2) voor een UTC-datetime, zonder pytz."""
    y = dt_utc.year

    def laatste_zondag(maand):
        d = datetime(y, maand + 1, 1, tzinfo=timezone.utc) - timedelta(days=1)
        return d - timedelta(days=(d.weekday() + 1) % 7)

    zomer_start = laatste_zondag(3).replace(hour=1)
    zomer_eind = laatste_zondag(10).replace(hour=1)
    return 2 if zomer_start <= dt_utc < zomer_eind else 1


def lokale_dag_bereik():
    """(dag_key, start_utc, eind_utc) voor de lopende Amsterdamse dag."""
    nu = datetime.now(timezone.utc)
    off = _amsterdam_offset(nu)
    lokaal = nu + timedelta(hours=off)
    dag_key = lokaal.strftime("%Y-%m-%d")
    start_lokaal = lokaal.replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = start_lokaal - timedelta(hours=off)
    return dag_key, start_utc, start_utc + timedelta(days=1)


def lijst_bestanden(start_utc, eind_utc):
    """Alle wbgt_*.csv-bestandsnamen binnen [start_utc, eind_utc)."""
    namen = []
    # Bestandsnamen zijn wbgt_JJJJMMDDUUMM.csv (UTC) en sorteren lexicografisch.
    # startAfterFilename verdraagt geen orderBy/nextPageToken; pagineren door
    # steeds na de laatst ontvangen naam verder te lezen.
    start_na = "wbgt_" + start_utc.strftime("%Y%m%d%H%M")
    eind_naam = "wbgt_" + eind_utc.strftime("%Y%m%d%H%M")
    while True:
        r = knmi_api.knmi_get(BASE, params={"maxKeys": 500,
                                            "startAfterFilename": start_na})
        if r.status_code != 200:
            raise RuntimeError(f"KDP-lijst faalde: HTTP {r.status_code}")
        d = r.json()
        files = d.get("files", [])
        for f in files:
            fn = f.get("filename", "")
            if fn >= eind_naam:
                return namen
            namen.append(fn)
        if d.get("isTruncated") is not True or not files:
            return namen
        start_na = files[-1]["filename"]


def parse_csv(tekst):
    """CSV → (tijd_iso, {station: {lat, lon, wbgt, hk}})."""
    tijd = None
    stations = {}
    for regel in tekst.splitlines():
        regel = regel.strip()
        if not regel:
            continue
        if regel.startswith("#"):
            if "time=" in regel:
                tijd = regel.split("time=", 1)[1].strip()
            continue
        if regel.startswith("station,"):
            continue
        delen = regel.split(",")
        if len(delen) < 5:
            continue
        sid, lat, lon, wbgt, hk = delen[:5]
        try:
            stations[sid] = {
                "lat": round(float(lat), 4), "lon": round(float(lon), 4),
                "wbgt": round(float(wbgt), 2), "hk": int(hk),
            }
        except ValueError:
            continue
    return tijd, stations


def download_bestand(fn):
    r = knmi_api.knmi_get(f"{BASE}/{fn}/url")
    if r.status_code != 200:
        raise RuntimeError(f"url voor {fn} faalde: HTTP {r.status_code}")
    tmp_url = r.json()["temporaryDownloadUrl"]
    with urllib.request.urlopen(tmp_url, timeout=30) as resp:
        return resp.read().decode("utf-8")


def laad_cache():
    try:
        with open(CACHE_JSON) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def schrijf_json(pad, data):
    tmp = pad + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, pad)


def main():
    dag_key, start_utc, eind_utc = lokale_dag_bereik()
    bestanden = lijst_bestanden(start_utc, eind_utc)
    if not bestanden:
        print(f"Geen KDP-bestanden voor {dag_key}", file=sys.stderr)
        sys.exit(1)

    cache = laad_cache()
    nieuw = 0
    for fn in bestanden:
        if fn in cache:
            continue
        try:
            tijd, stations = parse_csv(download_bestand(fn))
        except Exception as e:  # noqa: BLE001 — één gat mag de dag niet breken
            print(f"  {fn} overgeslagen: {e}", file=sys.stderr)
            continue
        if stations:
            cache[fn] = {"tijd": tijd, "stations": stations}
            nieuw += 1

    # Cache trimmen tot de lopende dag (+ gisteren voor de nachtovergang)
    grens = "wbgt_" + (start_utc - timedelta(days=1)).strftime("%Y%m%d%H%M")
    cache = {fn: v for fn, v in cache.items() if fn >= grens}
    os.makedirs(os.path.dirname(CACHE_JSON), exist_ok=True)
    schrijf_json(CACHE_JSON, cache)

    dag_bestanden = [fn for fn in bestanden if fn in cache]
    if not dag_bestanden:
        print("Geen bruikbare data", file=sys.stderr)
        sys.exit(1)

    laatste_fn = max(dag_bestanden)
    laatste = cache[laatste_fn]

    stations = {}
    for fn in dag_bestanden:
        inhoud = cache[fn]
        for sid, w in inhoud["stations"].items():
            st = stations.setdefault(sid, {
                "naam": STATION_NAMEN.get(sid, sid),
                "lat": w["lat"], "lon": w["lon"],
                "wbgt_max": w["wbgt"], "hk_max": w["hk"],
                "tijd_max": inhoud["tijd"],
            })
            if w["wbgt"] > st["wbgt_max"]:
                st.update(wbgt_max=w["wbgt"], hk_max=w["hk"],
                          tijd_max=inhoud["tijd"])
    for sid, w in laatste["stations"].items():
        if sid in stations:
            stations[sid].update(wbgt_nu=w["wbgt"], hk_nu=w["hk"])

    uit = {
        "gegenereerd": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dag": dag_key,
        "laatste_tijd": laatste["tijd"],
        "n_bestanden": len(dag_bestanden),
        "bron": "KNMI Dataplatform wet_bulb_globe_temperature 3.0",
        "stations": stations,
    }
    schrijf_json(UIT_JSON, uit)
    print(f"{dag_key}: {len(stations)} stations, {len(dag_bestanden)} bestanden "
          f"({nieuw} nieuw), laatste {laatste['tijd']}")


if __name__ == "__main__":
    main()
