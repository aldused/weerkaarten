#!/usr/bin/env python3
"""App-identieke hittekrachtverwachting per KNMI-station.

Bron: de publieke backend van de KNMI-app, `api.app.knmi.cloud/weather/detail`
(zonder auth). Dit is exact wat de app-tegel toont. De app adresseert een punt
via een gridcelcode: prefix "A" + index, met index = kolom*35 + rij_vanaf_noord
over het grid SW(50.7,3.2)–NE(53.6,7.4), 30 kolommen × 35 rijen (uit
`static.app.knmi.cloud/config/appconfig.json`, settings.grid).

Per station wordt voor vandaag en morgen de dag-hittekracht bepaald als de
hoogste uurlijkse `heatIndex` van dat etmaal — de definitie die de app-tegel
"max hittekracht" gebruikt. Schrijft weerlab/hittekracht_app.json.
"""

import gzip
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

WEERLAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UIT_JSON = os.path.join(WEERLAB, "hittekracht_app.json")

API = "https://api.app.knmi.cloud/weather/detail"

# Grid uit appconfig settings.grid (prefix A).
GRID_SW = (50.7, 3.2)
GRID_NE = (53.6, 7.4)
GRID_NLON = 30
GRID_NLAT = 35
_DLON = (GRID_NE[1] - GRID_SW[1]) / GRID_NLON
_DLAT = (GRID_NE[0] - GRID_SW[0]) / GRID_NLAT

# region= raakt alleen het alerts-blok, niet heatIndex; vaste waarde volstaat.
REGION = 15

# KNMI-hoofdstations (naam, lat, lon). Coördinaten uit het KDP-meetnet.
STATIONS = [
    ("Den Helder", 52.9269, 4.7811), ("Schiphol", 52.3172, 4.7897),
    ("De Bilt", 52.0989, 5.1797), ("Leeuwarden", 53.2231, 5.7517),
    ("Eelde", 53.1236, 6.5847), ("Twenthe", 52.2731, 6.8908),
    ("Vlissingen", 51.4414, 3.5958), ("Rotterdam", 51.9606, 4.4469),
    ("Eindhoven", 51.4631, 5.3856), ("Maastricht", 50.9053, 5.7619),
    ("Voorschoten", 52.1397, 4.4364), ("Cabauw", 51.9692, 4.9258),
    ("Gilze-Rijen", 51.5650, 4.9353), ("Volkel", 51.6586, 5.7067),
    ("Deelen", 52.0547, 5.8722), ("Hoogeveen", 52.7489, 6.5731),
    ("Hoek van Holland", 51.9911, 4.1217), ("Lelystad", 52.4483, 5.5081),
    ("Terschelling", 53.3911, 5.3458), ("Stavoren", 52.8983, 5.3831),
    ("Westdorpe", 51.2247, 3.8611), ("Wilhelminadorp", 51.5258, 3.8836),
    ("Herwijnen", 51.8578, 5.1453), ("Ell", 51.1969, 5.7644),
    ("Arcen", 51.4972, 6.1961), ("Marknesse", 52.7028, 5.8875),
    ("Heino", 52.4356, 6.2597), ("Hupsel", 52.0678, 6.6567),
    ("Nieuw Beerta", 53.1936, 7.1519), ("Berkhout", 52.6394, 4.9786),
    ("Woensdrecht", 51.4489, 4.3419), ("Wijk aan Zee", 52.5061, 4.6031),
]


def cel_code(lat, lon):
    col = min(GRID_NLON - 1, max(0, int((lon - GRID_SW[1]) / _DLON)))
    row_n = min(GRID_NLAT - 1, max(0, int((GRID_NE[0] - lat) / _DLAT)))
    return col * GRID_NLAT + row_n


def haal_detail(code, datum_iso):
    url = f"{API}?location=A{code}&region={REGION}&date={datum_iso}T00:00:00Z"
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "Accept-Language": "nl-NL,nl;q=0.9",
        "Accept-Encoding": "gzip",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    return json.loads(raw)


def dag_heatindex(payload, dag_key):
    """Dag-hittekracht = exact het kop-veld ``heatIndex`` van de detail-respons
    voor de opgevraagde datum. Dit is de waarde die de app-tegel toont; het is
    NIET simpelweg de max van de getoonde uurlijkse heatIndex (die kan afwijken —
    bijv. Eelde kop 3 terwijl geen enkel getoond uur boven 2 komt). Alleen als de
    kop ontbreekt vallen we terug op de hoogste uurwaarde binnen de lokale dag."""
    kop = payload.get("heatIndex")
    if isinstance(kop, (int, float)):
        return int(kop)
    beste = None
    for uur in payload.get("hourly", {}).get("forecast", []):
        t = uur.get("dateTime", "")
        try:
            dt = datetime.fromisoformat(t.replace("Z", "+00:00"))
        except ValueError:
            continue
        lokaal = dt + timedelta(hours=_ams_offset(dt))
        if lokaal.strftime("%Y-%m-%d") != dag_key:
            continue
        hk = uur.get("heatIndex")
        if isinstance(hk, (int, float)) and (beste is None or hk > beste):
            beste = int(hk)
    return beste


def _ams_offset(dt_utc):
    y = dt_utc.year

    def laatste_zondag(maand):
        d = datetime(y, maand + 1, 1, tzinfo=timezone.utc) - timedelta(days=1)
        return d - timedelta(days=(d.weekday() + 1) % 7)

    start = laatste_zondag(3).replace(hour=1)
    eind = laatste_zondag(10).replace(hour=1)
    return 2 if start <= dt_utc < eind else 1


def lokale_dag(offset=0):
    nu = datetime.now(timezone.utc)
    lokaal = nu + timedelta(hours=_ams_offset(nu)) + timedelta(days=offset)
    return lokaal.strftime("%Y-%m-%d")


def schrijf_json(pad, data):
    tmp = pad + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, pad)


def main():
    vandaag = lokale_dag(0)
    morgen = lokale_dag(1)
    overmorgen = lokale_dag(2)
    # +0/+1 = HARMONIE (uurlijks); +2 komt uit ECMWF-ensemble (indicatief), maar
    # de app-backend levert er wel een dag-heatIndex voor.
    dagen = {vandaag: "vandaag", morgen: "morgen", overmorgen: "overmorgen"}

    stations = {}
    for naam, lat, lon in STATIONS:
        code = cel_code(lat, lon)
        rec = {"naam": naam, "lat": round(lat, 4), "lon": round(lon, 4),
               "cel": f"A{code}", "hk": {}}
        ok = False
        for dag_key in dagen:
            try:
                payload = haal_detail(code, dag_key)
            except Exception as e:  # noqa: BLE001 — één station mag niet alles breken
                print(f"  {naam} {dag_key}: {e}", file=sys.stderr)
                continue
            hk = dag_heatindex(payload, dag_key)
            if hk is not None:
                rec["hk"][dag_key] = hk
                ok = True
            time.sleep(0.15)  # rustig aan tegen de API
        if ok:
            stations[naam] = rec

    if not stations:
        print("Geen app-hittekracht opgehaald", file=sys.stderr)
        sys.exit(1)

    uit = {
        "gegenereerd": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "vandaag": vandaag,
        "morgen": morgen,
        "overmorgen": overmorgen,
        "bron": "KNMI-app backend (api.app.knmi.cloud/weather/detail)",
        "definitie": "dag-hittekracht = kop-veld heatIndex uit weather/detail (app-tegelwaarde)",
        "stations": stations,
    }
    schrijf_json(UIT_JSON, uit)
    n = len(stations)
    v = sum(1 for s in stations.values() if vandaag in s["hk"])
    print(f"{n} stations; vandaag={vandaag} ({v} met waarde), morgen={morgen}, "
          f"overmorgen={overmorgen}")


if __name__ == "__main__":
    main()
