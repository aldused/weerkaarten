#!/usr/bin/env python3
"""
jaarwisseling_ophalen.py
Haalt de temperatuur op het exacte jaarwisselingsmoment op voor alle
KNMI-stations: 00:00 lokale tijd (CET) op 1 januari.

Bron: KNMI-uurgegevens (uurgeg_<stn>_<decennium>.zip). De temperatuur T
staat in 0.1 °C. 00:00 CET op 1 jan = 23:00 UTC op 31 dec, dus we nemen
de meting van 31 december met HH=23 (uurgegevens zijn in UTC).

Stations komen uit feestdagen_ophalen.STATIONS (zelfde set als de
feestdagen-pagina). Stations met enkel CSV-dagdata (geen uurgegevens)
worden overgeslagen.

Schrijft jaarwisseling_data.js naast dit script:
    const JAARWISSELING_DATA = {...};

Gebruik:
    python3 jaarwisseling_ophalen.py            # alle stations
    python3 jaarwisseling_ophalen.py --hoofd    # alleen hoofdstations
"""

import io
import os
import sys
import json
import zipfile
import requests
from datetime import datetime

from feestdagen_ophalen import STATIONS

# Decennium-bestanden; nieuwe decennia hoeven enkel hier bijgezet te worden.
DECENNIA = [
    "1951-1960", "1961-1970", "1971-1980", "1981-1990",
    "1991-2000", "2001-2010", "2011-2020", "2021-2030",
]
BASE = ("https://cdn.knmi.nl/knmi/map/page/klimatologie/gegevens/"
        "uurgegevens/uurgeg_{stn}_{dec}.zip")


def extract_decade(stn, dec):
    """Geeft {nieuwjaar(int): temp_C(float)} voor één station/decennium-zip.
    Geeft None terug als het bestand niet bestaat (station kende dat
    decennium nog niet)."""
    url = BASE.format(stn=stn, dec=dec)
    out = {}
    try:
        r = requests.get(url, timeout=120)
        if r.status_code == 404:
            return None
        r.raise_for_status()
    except requests.HTTPError:
        return None
    except Exception as e:
        print(f"    ✗ {dec}: {e}")
        return out
    try:
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            tekst = z.read(z.namelist()[0]).decode("latin-1")
    except zipfile.BadZipFile:
        return None
    for regel in tekst.splitlines():
        regel = regel.strip()
        if not regel or regel.startswith("#"):
            continue
        velden = [v.strip() for v in regel.split(",")]
        if len(velden) < 8:
            continue
        yyyymmdd, hh, T = velden[1], velden[2], velden[7]
        # 31 december, 23:00 UTC = 00:00 CET van het nieuwe jaar
        if yyyymmdd.endswith("1231") and hh == "23" and T != "":
            try:
                nieuwjaar = int(yyyymmdd[:4]) + 1
                out[nieuwjaar] = int(T) / 10.0
            except ValueError:
                continue
    return out


def haal_station(stn):
    """Alle jaarwisselingstemperaturen voor één station {jaar: temp}."""
    data = {}
    for dec in DECENNIA:
        deel = extract_decade(stn, dec)
        if deel:
            data.update(deel)
    return data


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))

    if "--hoofd" in sys.argv:
        nrs = [nr for nr, info in STATIONS.items() if info.get("hoofd")]
    else:
        nrs = list(STATIONS.keys())

    out_stations = {}
    out_data = {}
    print(f"→ Jaarwisseling 00:00 — {len(nrs)} stations")

    for nr in nrs:
        info = STATIONS.get(nr, {})
        naam = info.get("naam", str(nr))
        if info.get("csv"):
            print(f"  – {nr} {naam}: geen uurgegevens (CSV-dagdata), overslaan")
            continue
        print(f"→ {nr} {naam} …", flush=True)
        data = haal_station(nr)
        if not data:
            print(f"    (geen uurdata)")
            continue
        out_stations[str(nr)] = {"naam": naam, "hoofd": info.get("hoofd", False)}
        out_data[str(nr)] = {str(j): data[j] for j in sorted(data)}
        jaren = sorted(data)
        warm = max(data, key=data.get)
        koud = min(data, key=data.get)
        print(f"    ✓ {len(jaren)} jaarwisselingen ({jaren[0]}–{jaren[-1]}) · "
              f"max {data[warm]:+.1f}° koud {data[koud]:+.1f}°")

    payload = {
        "gegenereerd": datetime.now().isoformat(timespec="seconds"),
        "toelichting": "Temperatuur (°C) om 00:00 CET op 1 jan = 23:00 UTC 31 dec; "
                       "sleutel = nieuwjaar",
        "stations": out_stations,
        "data": out_data,
    }
    json_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    js_pad = os.path.join(script_dir, "jaarwisseling_data.js")
    with open(js_pad, "w", encoding="utf-8") as f:
        f.write(f"const JAARWISSELING_DATA = {json_str};")
    with open(os.path.join(script_dir, "jaarwisseling_data.json"), "w",
              encoding="utf-8") as f:
        f.write(json_str)

    kb = os.path.getsize(js_pad) // 1024
    print(f"\n✓ {len(out_stations)} stations met uurdata → {js_pad} ({kb} KB)")


if __name__ == "__main__":
    main()
