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
    # ══════════════════════════════════════════════════════════════════════════
    # ENGELSE OOSTKUST (Noordzee)
    # ══════════════════════════════════════════════════════════════════════════
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
    ("Warp",               51.525,  1.032, "UK"),  # CEFAS boei

    # ══════════════════════════════════════════════════════════════════════════
    # UK OFFSHORE PLATFORMS & VELDEN
    # ══════════════════════════════════════════════════════════════════════════
    ("Dogger Bank",        54.75,   2.00,  "UK"),
    ("Dogger Bank Oost",   54.80,   3.50,  "UK"),
    ("Forties Field",      57.717,  1.017, "UK"),
    ("Rough",              53.80,   1.10,  "UK"),
    ("Cleeton",            53.70,   0.80,  "UK"),
    ("Sole Pit",           53.50,   1.50,  "UK"),
    ("Leman Bank",         53.10,   2.20,  "UK"),
    ("Indefatigable",      53.45,   2.50,  "UK"),
    ("Brent",              60.900,  1.800, "UK"),
    ("Piper",              58.280,  0.120, "UK"),
    ("Claymore",           58.450, -0.250, "UK"),
    ("Beryl",              59.546,  1.537, "UK"),
    ("Bruce",              59.744,  1.634, "UK"),
    ("Buzzard",            57.832, -0.966, "UK"),
    ("Elgin/Franklin",     57.167,  2.000, "UK"),
    ("Shearwater",         57.032,  1.944, "UK"),
    ("Britannia",          58.075,  0.994, "UK"),
    ("Alba",               58.036,  1.108, "UK"),
    ("Captain",            58.306, -1.711, "UK"),
    ("Goldeneye",          58.000, -0.383, "UK"),
    ("Scott",              58.278,  0.213, "UK"),
    ("Andrew",             58.083,  1.250, "UK"),
    ("Montrose Field",     57.451,  1.388, "UK"),
    ("Fulmar",             56.483,  2.133, "UK"),
    ("Gannet Alpha",       57.220,  0.880, "UK"),

    # ══════════════════════════════════════════════════════════════════════════
    # UK OFFSHORE WINDPARKEN
    # ══════════════════════════════════════════════════════════════════════════
    ("Hornsea 1",          53.900,  1.790, "UK"),
    ("Hornsea 2",          53.920,  1.560, "UK"),
    ("Hornsea 3",          53.920,  1.330, "UK"),
    ("East Anglia ONE",    52.230,  2.480, "UK"),
    ("Beatrice",           58.130, -3.070, "UK"),
    ("Moray East",         58.167, -2.699, "UK"),
    ("Dudgeon",            53.249,  1.390, "UK"),
    ("Sheringham Shoal",   53.117,  1.133, "UK"),
    ("Race Bank",          53.275,  0.833, "UK"),
    ("Triton Knoll",       53.400,  0.900, "UK"),

    # ══════════════════════════════════════════════════════════════════════════
    # SCHOTSE NOORDZEEKUST
    # ══════════════════════════════════════════════════════════════════════════
    ("Aberdeen",           57.14,  -2.08,  "UK"),
    ("Firth of Forth",     56.15,  -2.50,  "UK"),
    ("Moray Firth",        57.70,  -3.30,  "UK"),
    ("Peterhead",          57.50,  -1.77,  "UK"),
    ("Montrose",           56.70,  -2.43,  "UK"),

    # ══════════════════════════════════════════════════════════════════════════
    # NOORSE PLATFORMS & KUST
    # ══════════════════════════════════════════════════════════════════════════
    ("Stavanger",          58.97,   5.73,  "NO"),
    ("Kristiansand",       58.15,   8.00,  "NO"),
    ("Egersund",           58.45,   5.99,  "NO"),
    ("Lista",              58.10,   6.57,  "NO"),
    ("Haugesund",          59.41,   5.27,  "NO"),
    ("Ekofisk",            56.549,  3.210, "NO"),
    ("Sleipner",           58.360,  1.910, "NO"),
    ("Troll",              60.646,  3.726, "NO"),
    ("Oseberg",            60.492,  2.827, "NO"),
    ("Gullfaks",           61.215,  2.280, "NO"),
    ("Statfjord",          61.256,  1.854, "NO"),
    ("Valhall",            56.278,  3.395, "NO"),
    ("Snorre",             61.525,  2.212, "NO"),
    ("Ula",                57.111,  2.847, "NO"),
    ("Gyda",               56.911,  3.108, "NO"),
    ("Frigg",              59.880,  2.067, "NO"),

    # ══════════════════════════════════════════════════════════════════════════
    # DEENSE WESTKUST, PLATFORMS & WINDPARKEN
    # ══════════════════════════════════════════════════════════════════════════
    ("Esbjerg",            55.47,   8.13,  "DK"),
    ("Thyboron",           56.70,   8.08,  "DK"),
    ("Hanstholm",          57.12,   8.60,  "DK"),
    ("Hirtshals",          57.59,   9.96,  "DK"),
    ("Hvide Sande",        56.00,   8.12,  "DK"),
    ("Horns Rev",          55.53,   7.85,  "DK"),
    ("Nymindegab",         55.82,   8.17,  "DK"),
    ("Dan",                55.473,  5.103, "DK"),
    ("Tyra",               55.717,  4.793, "DK"),
    ("Gorm",               55.567,  4.783, "DK"),
    ("Siri",               56.483,  4.911, "DK"),
    ("Halfdan",            55.230,  5.006, "DK"),
    ("South Arne",         56.078,  4.229, "DK"),

    # ══════════════════════════════════════════════════════════════════════════
    # DUITSE NOORDZEEKUST, PLATFORMS & WINDPARKEN
    # ══════════════════════════════════════════════════════════════════════════
    ("Helgoland",          54.18,   7.89,  "DE"),
    ("Sylt",               54.90,   8.30,  "DE"),
    ("Borkum",             53.59,   6.66,  "DE"),
    ("Norderney",          53.72,   7.15,  "DE"),
    ("Bremerhaven",        53.55,   8.57,  "DE"),
    ("Cuxhaven",           53.87,   8.71,  "DE"),
    ("St. Peter-Ording",   54.32,   8.60,  "DE"),
    ("FINO-1",             54.01,   6.59,  "DE"),
    ("DanTysk",            55.140,  7.200, "DE"),
    ("Sandbank",           55.183,  6.850, "DE"),
    ("Gemini",             54.037,  5.965, "DE"),

    # ══════════════════════════════════════════════════════════════════════════
    # BELGISCHE KUST
    # ══════════════════════════════════════════════════════════════════════════
    ("Oostende",           51.23,   2.92,  "BE"),
    ("Westhinder",         51.38,   2.44,  "BE"),
    ("Zeebrugge",          51.35,   3.18,  "BE"),

    # ══════════════════════════════════════════════════════════════════════════
    # SCHEEPVAARTGEBIEDEN (centrum-coördinaten)
    # ══════════════════════════════════════════════════════════════════════════
    ("Viking",             59.75,   2.00,  "INT"),
    ("North Utsire",       60.25,   4.00,  "INT"),
    ("South Utsire",       58.50,   4.50,  "INT"),
    ("Forties Area",       57.25,   1.50,  "INT"),
    ("Cromarty",           57.75,  -1.58,  "INT"),
    ("Tyne Area",          55.25,  -0.75,  "INT"),
    ("Dogger Area",        55.50,   2.00,  "INT"),
    ("Fisher",             57.00,   6.00,  "INT"),
    ("German Bight",       54.75,   6.00,  "INT"),
    ("Humber Area",        53.75,   1.00,  "INT"),
    ("Thames Area",        51.75,   1.75,  "INT"),
    ("Fair Isle",          59.75,  -1.50,  "INT"),

    # ══════════════════════════════════════════════════════════════════════════
    # CENTRALE & NOORDELIJKE NOORDZEE (extra punten voor dekking)
    # ══════════════════════════════════════════════════════════════════════════
    ("Dogger Bank Centrum",54.50,   3.00,  "INT"),
    ("Zuidelijke Noordzee",53.00,   3.00,  "INT"),
    ("Oyster Grounds",     54.20,   4.00,  "INT"),
    ("Silver Pit",         54.00,   2.00,  "INT"),
    ("Devil's Hole",       56.50,   1.00,  "INT"),
    ("Fladen Ground",      58.20,   0.50,  "INT"),
    ("Long Forties",       57.50,   1.50,  "INT"),
    ("Midden-Noordzee West",  55.00,  2.00, "INT"),
    ("Midden-Noordzee Oost",  55.00,  5.00, "INT"),
    ("Jyllandbank",           55.50,  5.50, "INT"),
    ("Duitse Bocht Oost",     54.50,  6.00, "INT"),
    ("Duitse Bocht West",     54.50,  5.00, "INT"),
    ("Skagerrak West",        57.50,  7.00, "INT"),
    ("Noordzee Midden-Noord", 56.50,  4.00, "INT"),
    ("Noordzee Midden-Zuid",  54.00,  4.50, "INT"),
    ("Witch Ground",       58.00,   1.50,  "INT"),
    ("Buchan Deep",        57.75,  -0.50,  "INT"),
    ("Outer Moray Firth",  58.50,  -2.00,  "INT"),
    ("Centrale Noordzee Noord", 56.00, 3.00, "INT"),
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
