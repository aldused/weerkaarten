#!/usr/bin/env python3
"""
Haal golfhoogtedata op van Rijkswaterstaat (DDL API) en schrijf naar golven.json.
Bron: waterwebservices.rijkswaterstaat.nl
Draait elke 10 minuten via cron.
"""

import requests
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from math import sin, cos, tan, sqrt, atan, atan2, degrees, radians, sinh, cosh

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
UITVOER = os.path.join(SCRIPT_DIR, "golven.json")

DDL_URL = "https://waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES_DBO/OphalenWaarnemingen"
CAT_URL = "https://waterwebservices.rijkswaterstaat.nl/METADATASERVICES_DBO/OphalenCatalogus/"
HEADERS = {"Content-Type": "application/json"}

# ── UTM zone 31N (EPSG:25831) → WGS84 conversie ────────────────────────────
def utm31n_naar_wgs84(x, y):
    k0 = 0.9996
    a = 6378137.0
    f = 1 / 298.257223563
    e = sqrt(2 * f - f * f)
    n = f / (2 - f)
    A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64)

    a1 = 1/2*n - 2/3*n*n + 5/16*n**3 + 41/180*n**4
    a2 = 13/48*n*n - 3/5*n**3 + 557/1440*n**4
    a3 = 61/240*n**3 - 103/140*n**4
    a4 = 49561/161280*n**4

    b1 = 1/2*n - 2/3*n*n + 37/96*n**3 - 1/360*n**4
    b2 = 1/48*n*n + 1/15*n**3 - 437/1440*n**4
    b3 = 17/480*n**3 - 37/840*n**4
    b4 = 4397/161280*n**4

    x0, y0 = 500000, 0
    lon0 = radians(3)

    xi = (y - y0) / (k0 * A)
    eta = (x - x0) / (k0 * A)

    xi_p = xi - (b1*sin(2*xi)*cosh(2*eta) + b2*sin(4*xi)*cosh(4*eta)
                 + b3*sin(6*xi)*cosh(6*eta) + b4*sin(8*xi)*cosh(8*eta))
    eta_p = eta - (b1*cos(2*xi)*sinh(2*eta) + b2*cos(4*xi)*sinh(4*eta)
                   + b3*cos(6*xi)*sinh(6*eta) + b4*cos(8*xi)*sinh(8*eta))

    chi = atan2(sin(xi_p), sqrt(sinh(eta_p)**2 + cos(xi_p)**2))
    lat = chi + (a1*sin(2*chi) + a2*sin(4*chi) + a3*sin(6*chi) + a4*sin(8*chi))
    lon = lon0 + atan2(sinh(eta_p), cos(xi_p))

    return round(degrees(lat), 5), round(degrees(lon), 5)


def haal_catalogus():
    """Haal alle locaties op die Hm0 (significante golfhoogte) meten."""
    r = requests.post(CAT_URL, json={"CatalogusFilter": {"Grootheden": True}},
                      headers=HEADERS, timeout=30)
    r.raise_for_status()
    cat = r.json()

    # Vind Hm0 metadata ID
    hm0_ids = set()
    for m in cat.get("AquoMetadataLijst", []):
        if m.get("Grootheid", {}).get("Code") == "Hm0":
            hm0_ids.add(m["AquoMetadata_MessageID"])

    # Map locatie IDs
    loc_map = {}
    for l in cat.get("LocatieLijst", []):
        lid = l.get("Locatie_MessageID")
        if lid:
            loc_map[lid] = l

    # Vind locaties met Hm0
    hm0_loc_ids = set()
    for entry in cat.get("AquoMetadataLocatieLijst", []):
        if entry.get("AquoMetaData_MessageID") in hm0_ids:
            hm0_loc_ids.add(entry.get("Locatie_MessageID"))

    locaties = []
    gezien = set()  # Voorkom dubbele codes
    for lid in hm0_loc_ids:
        loc = loc_map.get(lid, {})
        code = loc.get("Code", "")
        naam = loc.get("Naam", "")
        x = loc.get("X", 0)
        y = loc.get("Y", 0)
        coord = loc.get("Coordinatenstelsel", "")

        if not code or coord != "25831" or not x or not y:
            continue

        # Unieke sleutel op code + afgeronde coordinaten (sommige stations hebben meerdere entries)
        sleutel = f"{code}_{round(x, 0)}_{round(y, 0)}"
        if sleutel in gezien:
            continue
        gezien.add(sleutel)

        lat, lon = utm31n_naar_wgs84(x, y)

        locaties.append({
            "code": code,
            "naam": naam,
            "x": x,
            "y": y,
            "lat": lat,
            "lon": lon,
        })

    return locaties


def haal_waarnemingen(locatie, uren_terug=24):
    """Haal de laatste waarnemingen op voor één locatie."""
    nu = datetime.now(timezone.utc)
    begin = nu - timedelta(hours=uren_terug)

    body = {
        "AquoPlusWaarnemingMetadata": {
            "AquoMetadata": {
                "Grootheid": {"Code": "Hm0"}
            }
        },
        "Locatie": {
            "X": locatie["x"],
            "Y": locatie["y"],
            "Code": locatie["code"],
            "Coordinatenstelsel": "25831"
        },
        "Periode": {
            "Begindatumtijd": begin.strftime("%Y-%m-%dT%H:%M:%S.000+00:00"),
            "Einddatumtijd": nu.strftime("%Y-%m-%dT%H:%M:%S.000+00:00")
        }
    }

    try:
        r = requests.post(DDL_URL, json=body, headers=HEADERS, timeout=15)
        r.raise_for_status()
        data = r.json()

        if not data.get("Succesvol"):
            return None

        waarn = data.get("WaarnemingenLijst", [])
        if not waarn:
            return None

        metingen = waarn[0].get("MetingenLijst", [])
        if not metingen:
            return None

        # Neem de laatste meting
        laatste = metingen[-1]
        waarde_cm = laatste.get("Meetwaarde", {}).get("Waarde_Numeriek")
        tijdstip = laatste.get("Tijdstip", "")

        if waarde_cm is None or waarde_cm > 99000:
            return None

        # Waarde is in cm, converteer naar meters
        waarde_m = round(waarde_cm / 100.0, 2)

        # Verzamel de laatste 144 metingen voor grafiek (24 uur bij 10-min interval)
        historie = []
        for m in metingen[-144:]:
            w = m.get("Meetwaarde", {}).get("Waarde_Numeriek")
            t = m.get("Tijdstip", "")
            if w is not None and w < 99000:
                historie.append({"t": t, "h": round(w / 100.0, 2)})

        return {
            "hm0": waarde_m,
            "tijdstip": tijdstip,
            "historie": historie,
        }

    except Exception as e:
        print(f"  Fout bij {locatie['code']}: {e}", file=sys.stderr)
        return None


# ── Open-Meteo Marine API voor internationale Noordzee-punten ────────────────

INTERNATIONALE_PUNTEN = [
    # ── Engelse oostkust (Noordzee) ──────────────────────────────────────────
    ("Dowsing",            53.531,  1.053, "UK"),
    ("West Gabbard",       51.955,  2.110, "UK"),
    ("Lowestoft",          52.47,   1.76,  "UK"),
    ("Scarborough",        54.28,  -0.39,  "UK"),
    ("Whitby",             54.49,  -0.61,  "UK"),
    ("Flamborough Head",   54.12,  -0.08,  "UK"),
    ("Cromer",             52.93,   1.30,  "UK"),
    ("Great Yarmouth",     52.60,   1.73,  "UK"),
    ("Felixstowe",         51.96,   1.35,  "UK"),
    ("Margate",            51.39,   1.39,  "UK"),
    ("Dover",              51.11,   1.32,  "UK"),
    ("Humber",             53.65,  -0.18,  "UK"),
    ("The Wash",           52.95,   0.40,  "UK"),
    ("Bridlington",        54.08,  -0.18,  "UK"),
    ("Hartlepool",         54.69,  -1.15,  "UK"),
    ("Sunderland",         54.92,  -1.35,  "UK"),
    ("Berwick-upon-Tweed", 55.77,  -1.98,  "UK"),

    # ── Engelse/Schotse offshore Noordzee ────────────────────────────────────
    ("Dogger Bank",        54.75,   2.00,  "UK"),
    ("Dogger Bank Oost",   54.80,   3.50,  "UK"),
    ("Forties",            57.75,   0.90,  "UK"),
    ("Ekofisk Approach",   56.30,   3.10,  "UK"),
    ("Rough",              53.80,   1.10,  "UK"),
    ("Cleeton",            53.70,   0.80,  "UK"),
    ("Sole Pit",           53.50,   1.50,  "UK"),
    ("Leman",              53.10,   2.20,  "UK"),
    ("Indefatigable",      53.45,   2.50,  "UK"),

    # ── Schotse Noordzeekust ─────────────────────────────────────────────────
    ("Aberdeen",           57.14,  -2.08,  "UK"),
    ("Firth of Forth",     56.15,  -2.50,  "UK"),
    ("Moray Firth",        57.70,  -3.30,  "UK"),
    ("Peterhead",          57.50,  -1.77,  "UK"),
    ("Montrose",           56.70,  -2.43,  "UK"),

    # ── Noorse zuidwestkust ──────────────────────────────────────────────────
    ("Stavanger",          58.97,   5.73,  "NO"),
    ("Kristiansand",       58.15,   8.00,  "NO"),
    ("Egersund",           58.45,   5.99,  "NO"),
    ("Lista",              58.10,   6.57,  "NO"),
    ("Haugesund",          59.41,   5.27,  "NO"),

    # ── Deense westkust en offshore ──────────────────────────────────────────
    ("Esbjerg",            55.47,   8.13,  "DK"),
    ("Thyboron",           56.70,   8.08,  "DK"),
    ("Hanstholm",          57.12,   8.60,  "DK"),
    ("Hirtshals",          57.59,   9.96,  "DK"),
    ("Hvide Sande",        56.00,   8.12,  "DK"),
    ("Horns Rev",          55.53,   7.85,  "DK"),
    ("Nymindegab",         55.82,   8.17,  "DK"),

    # ── Duitse Noordzeekust ──────────────────────────────────────────────────
    ("Helgoland",          54.18,   7.89,  "DE"),
    ("Sylt",               54.90,   8.30,  "DE"),
    ("Borkum",             53.59,   6.66,  "DE"),
    ("Norderney",          53.72,   7.15,  "DE"),
    ("Bremerhaven",        53.55,   8.57,  "DE"),
    ("Cuxhaven",           53.87,   8.71,  "DE"),
    ("St. Peter-Ording",   54.32,   8.60,  "DE"),
    ("FINO-1",             54.01,   6.59,  "DE"),  # Offshore meetplatform

    # ── Belgische kust ───────────────────────────────────────────────────────
    ("Oostende",           51.23,   2.92,  "BE"),
    ("Westhinder",         51.38,   2.44,  "BE"),
    ("Zeebrugge",          51.35,   3.18,  "BE"),

    # ── Centrale & Noordelijke Noordzee ──────────────────────────────────────
    ("Centrale Noordzee",  56.00,   3.00,  "INT"),
    ("Fisher",             57.00,   4.50,  "INT"),
    ("Viking",             58.50,   2.00,  "INT"),
    ("Dogger Bank Centrum",54.50,   3.00,  "INT"),
    ("Zuidelijke Noordzee",53.00,   3.00,  "INT"),
    ("Oyster Grounds",     54.20,   4.00,  "INT"),
    ("Silver Pit",         54.00,   2.00,  "INT"),
    ("Devil's Hole",       56.50,   1.00,  "INT"),
    ("Fladen Ground",      58.20,   0.50,  "INT"),
    ("Long Forties",       57.50,   1.50,  "INT"),

    # ── Tussen Engeland en Denemarken (extra dekking) ────────────────────────
    ("Midden-Noordzee West",  55.00,  2.00, "INT"),
    ("Midden-Noordzee Oost",  55.00,  5.00, "INT"),
    ("Jyllandbank",           55.50,  5.50, "INT"),
    ("Duitse Bocht Oost",     54.50,  6.00, "INT"),
    ("Duitse Bocht West",     54.50,  5.00, "INT"),
    ("Skagerrak West",        57.50,  7.00, "INT"),
    ("Noordzee Midden-Noord", 56.50,  4.00, "INT"),
    ("Noordzee Midden-Zuid",  54.00,  4.50, "INT"),
]


def haal_open_meteo_golven(punten):
    """Haal golfhoogtedata op via Open-Meteo Marine API."""
    resultaten = []

    for naam, lat, lon, land in punten:
        try:
            url = (
                f"https://marine-api.open-meteo.com/v1/marine"
                f"?latitude={lat}&longitude={lon}"
                f"&hourly=wave_height,wave_period,wave_direction"
                f"&past_hours=24&forecast_hours=0"
                f"&timezone=Europe%2FAmsterdam"
            )
            r = requests.get(url, timeout=15)
            r.raise_for_status()
            data = r.json()

            hourly = data.get("hourly", {})
            times = hourly.get("time", [])
            heights = hourly.get("wave_height", [])
            periods = hourly.get("wave_period", [])
            directions = hourly.get("wave_direction", [])

            if not heights:
                continue

            # Filter None values en neem laatste geldige meting
            geldige = [(t, h) for t, h in zip(times, heights) if h is not None]
            if not geldige:
                continue

            laatste_t, laatste_h = geldige[-1]

            # Historie opbouwen
            historie = []
            for t, h in geldige:
                if h is not None:
                    historie.append({"t": t, "h": round(h, 2)})

            # Laatste periode en richting
            periode = None
            richting = None
            for p in reversed(periods):
                if p is not None:
                    periode = round(p, 1)
                    break
            for d in reversed(directions):
                if d is not None:
                    richting = round(d)
                    break

            code = naam.upper().replace(" ", "")[:12] + f"_{land}"
            resultaten.append({
                "code": code,
                "naam": naam,
                "lat": lat,
                "lon": lon,
                "hm0": round(laatste_h, 2),
                "tijdstip": laatste_t,
                "historie": historie,
                "periode": periode,
                "richting": richting,
                "bron": "open-meteo",
                "land": land,
            })
            print(f"  [OM] {naam:25s} ({land})  Hm0={laatste_h:.2f}m")

        except Exception as e:
            print(f"  [OM] Fout bij {naam}: {e}", file=sys.stderr)

    return resultaten


def main():
    # ── Stap 1: Rijkswaterstaat data (Nederland) ────────────────────────────
    print("=== Rijkswaterstaat DDL API ===")
    print("Catalogus ophalen...")
    locaties = haal_catalogus()
    print(f"{len(locaties)} unieke Hm0-locaties gevonden")

    resultaten = []
    ok = 0

    for i, loc in enumerate(locaties):
        data = haal_waarnemingen(loc)
        if data:
            resultaten.append({
                "code": loc["code"],
                "naam": loc["naam"],
                "lat": loc["lat"],
                "lon": loc["lon"],
                "hm0": data["hm0"],
                "tijdstip": data["tijdstip"],
                "historie": data["historie"],
                "bron": "rws",
                "land": "NL",
            })
            ok += 1
            print(f"  [{ok}] {loc['code']:20s} {loc['naam']:35s} Hm0={data['hm0']:.2f}m")

        if (i + 1) % 50 == 0:
            print(f"  ... {i+1}/{len(locaties)} verwerkt, {ok} met data")

    print(f"\nRWS: {ok} stations met data")

    # ── Stap 2: Open-Meteo data (internationaal) ────────────────────────────
    print("\n=== Open-Meteo Marine API ===")
    intl = haal_open_meteo_golven(INTERNATIONALE_PUNTEN)
    resultaten.extend(intl)
    print(f"Open-Meteo: {len(intl)} punten met data")

    # ── Opslaan ──────────────────────────────────────────────────────────────
    nu = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    uitvoer = {
        "bijgewerkt": nu,
        "bron": "Rijkswaterstaat DDL API + Open-Meteo Marine API",
        "aantal": len(resultaten),
        "stations": resultaten,
    }

    with open(UITVOER, "w") as f:
        json.dump(uitvoer, f, indent=1)

    print(f"\nTotaal: {len(resultaten)} stations opgeslagen in {UITVOER}")


if __name__ == "__main__":
    main()
