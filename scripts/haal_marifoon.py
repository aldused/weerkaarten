"""
haal_marifoon.py — Haal KNMI marifoonbericht op en sla op als JSON
Dataset: marifoon/versions/1.0 (Open Data API, twee-stap download)
Bevat per kustdistrict: tekstverwachtingen (wind, zicht, weer) + uurlijkse tijdreeksen
"""
import os, requests, json, re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

KNMI_KEY = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjdhYWZkZDdiMjAwZDQxOTM5Y2I1ZTRkZWU0OTE2OWMyIiwiaCI6Im11cm11cjEyOCJ9"
BASE_URL = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/marifoon/versions/1.0"
HEADERS  = {"Authorization": KNMI_KEY}

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

# Kustvakken met representatieve coördinaten
KUSTVAKKEN = {
    "Vlissingen-district":       {"naam": "Vlissingen",       "lat": 51.45, "lon": 3.60},
    "Zierikzee-district":        {"naam": "Zierikzee",        "lat": 51.65, "lon": 3.90},
    "Hoek van Holland-district": {"naam": "Hoek van Holland", "lat": 52.00, "lon": 4.10},
    "IJmuiden-district":         {"naam": "IJmuiden",          "lat": 52.47, "lon": 4.50},
    "Texel-district":            {"naam": "Texel",             "lat": 53.00, "lon": 4.70},
    "Harlingen-district":        {"naam": "Harlingen",         "lat": 53.17, "lon": 5.40},
    "Rottum-district":           {"naam": "Rottum",            "lat": 53.55, "lon": 6.20},
    "Delfzijl-district":         {"naam": "Delfzijl",          "lat": 53.35, "lon": 6.90},
    "IJsselmeer-district":       {"naam": "IJsselmeer",        "lat": 52.70, "lon": 5.30},
    "Marken-district":           {"naam": "Marken",            "lat": 52.50, "lon": 5.20},
}

# Verwachtingsonderdelen die we willen extraheren (NL versie, zonder (E) suffix)
ONDERDELEN = {
    "Wind (str, bft)":              "wind",
    "Wind-stoten (kts)":            "windstoten",
    "Waarschuwing-wind (str, bft)": "wind_waarschuwing",
    "Weer":                         "weer",
    "Zicht (cat)":                  "zicht",
}

# Tijdreeks parameters
TIJDREEKS_PARAMS = ["ddd", "ff", "hs", "tt", "ts"]


def haal_marifoon():
    print("Marifoonbericht ophalen...")

    # Stap 1: meest recente bestanden ophalen
    r = requests.get(f"{BASE_URL}/files", headers=HEADERS,
                     params={"maxKeys": 10, "sorting": "desc"}, timeout=15)
    r.raise_for_status()
    bestanden = r.json().get("files", [])

    # Zoek het meest recente XML-bestand
    xml_bestand = next(
        (f["filename"] for f in bestanden if f["filename"].startswith("Marifoon_XML_")),
        None
    )
    if not xml_bestand:
        print("Geen Marifoon XML bestand gevonden")
        return None
    print(f"  Bestand: {xml_bestand}")

    # Stap 2: download URL ophalen
    r2 = requests.get(f"{BASE_URL}/files/{xml_bestand}/url", headers=HEADERS, timeout=15)
    r2.raise_for_status()
    download_url = r2.json()["temporaryDownloadUrl"]

    # Stap 3: XML downloaden
    xml_tekst = requests.get(download_url, timeout=30).text
    root = ET.fromstring(xml_tekst)

    # Metadata
    meteoroloog = root.findtext(".//Meteoroloog", "")
    created = root.findtext(".//Created", "")
    volgend = root.findtext(".//VolgendeBericht", "")

    # Format tijden naar lokaal
    bijgewerkt = _format_tijd(created)
    volgend_bericht = _format_tijd(volgend)

    # Weeroverzicht (audio tekst van Kustdistricten-gebied, termijn 0)
    overzicht = ""
    waarschuwing = ""
    for vo in root.iter("VerwachtingOnderdeel"):
        loc = vo.findtext("Locatie", "")
        onderdeel = vo.findtext("Onderdeel", "")
        termijn = vo.findtext("Termijn", "")
        tekst = vo.findtext("Tekst", "").strip()

        if loc == "Kustdistricten-gebied":
            if onderdeel == "Weeroverzicht (audio)" and termijn == "0":
                overzicht = tekst
            elif onderdeel == "Waarschuwing-wind (str, bft)" and termijn == "0":
                waarschuwing = tekst

    # Verwachtingen per kustdistrict per termijn
    vakken = {}
    for vak_id, info in KUSTVAKKEN.items():
        vakken[info["naam"]] = {
            "lat": info["lat"],
            "lon": info["lon"],
            "termijnen": {},
        }

    for vo in root.iter("VerwachtingOnderdeel"):
        loc = vo.findtext("Locatie", "")
        onderdeel = vo.findtext("Onderdeel", "")
        termijn = vo.findtext("Termijn", "")
        tekst = vo.findtext("Tekst", "").strip()

        if loc not in KUSTVAKKEN:
            continue
        if onderdeel not in ONDERDELEN:
            continue
        # Skip Engelse versies
        if onderdeel.endswith("(E)"):
            continue

        naam = KUSTVAKKEN[loc]["naam"]
        veld = ONDERDELEN[onderdeel]
        t = termijn

        if t not in vakken[naam]["termijnen"]:
            vakken[naam]["termijnen"][t] = {
                "termijn": t,
                "wind": "", "windstoten": "", "wind_waarschuwing": "",
                "weer": "", "zicht": ""
            }
        vakken[naam]["termijnen"][t][veld] = tekst

    # Termijnen omzetten van dict naar lijst, gesorteerd
    for naam in vakken:
        termijn_dict = vakken[naam]["termijnen"]
        vakken[naam]["termijnen"] = [
            termijn_dict[t] for t in sorted(termijn_dict.keys(), key=lambda x: int(x))
        ]

    # Termijnperiodes ophalen uit top-level <Termijn> elementen
    periodes = {}
    for t_elem in root.findall("Termijn"):
        nummer = t_elem.findtext("Nummer", "")
        van = t_elem.findtext("GeldigVan", "")
        tot = t_elem.findtext("GeldigTot", "")
        if nummer and van and tot:
            periodes[nummer] = _format_periode(van, tot)

    # Periode labels toevoegen aan termijnen
    for naam in vakken:
        for t in vakken[naam]["termijnen"]:
            tid = t["termijn"]
            t["periode"] = periodes.get(tid, f"Termijn {tid}")

    # Tijdreeksen parsen
    _parse_tijdreeksen(root, vakken)

    # Haal ook de NL ASCII tekst op voor de volledige tekst
    nl_bestand = next(
        (f["filename"] for f in bestanden if "NL_ASCII" in f["filename"]),
        None
    )
    volledige_tekst = ""
    if nl_bestand:
        r3 = requests.get(f"{BASE_URL}/files/{nl_bestand}/url", headers=HEADERS, timeout=15)
        r3.raise_for_status()
        volledige_tekst = requests.get(r3.json()["temporaryDownloadUrl"], timeout=15).text.strip()

    resultaat = {
        "bijgewerkt": bijgewerkt,
        "meteoroloog": meteoroloog,
        "volgend_bericht": volgend_bericht,
        "overzicht": overzicht,
        "waarschuwing": waarschuwing,
        "periodes": periodes,
        "vakken": vakken,
        "volledige_tekst": volledige_tekst,
    }

    with open("marifoon.json", "w") as f:
        json.dump(resultaat, f, ensure_ascii=False, indent=1)
    print(f"Marifoon opgeslagen ({bijgewerkt}, meteoroloog: {meteoroloog})")
    return resultaat


def _parse_tijdreeksen(root, vakken):
    """Parse uurlijkse tijdreeksen uit <Tijdreeksen>.
    Structuur: één <Tijdreeksen> blok met flat <Modelwaarde> elementen,
    elk met Locatie, Parameter, Tijd, MeteoroloogWaarde, ComputerWaarde.
    """
    tijdreeks_elem = root.find("Tijdreeksen")
    if tijdreeks_elem is None:
        return

    # Verzamel data per locatie per parameter per tijd
    raw = {}  # {locatie: {parameter: {tijd: waarde}}}
    for mv in tijdreeks_elem.iter("Modelwaarde"):
        loc = mv.findtext("Locatie", "")
        param = mv.findtext("Parameter", "")
        tijd = mv.findtext("Tijd", "")
        if not loc or not param or not tijd:
            continue
        if loc not in KUSTVAKKEN:
            continue
        if param not in TIJDREEKS_PARAMS:
            continue

        # MeteoroloogWaarde heeft voorrang
        val_str = mv.findtext("MeteoroloogWaarde", "")
        if not val_str:
            val_str = mv.findtext("ComputerWaarde", "")
        try:
            val = round(float(val_str), 1)
        except (ValueError, TypeError):
            val = None

        naam = KUSTVAKKEN[loc]["naam"]
        if naam not in raw:
            raw[naam] = {}
        if param not in raw[naam]:
            raw[naam][param] = {}
        raw[naam][param][tijd] = val

    # Omzetten naar geordende arrays per kustdistrict
    for naam, params in raw.items():
        # Verzamel alle unieke tijden voor dit vak
        alle_tijden = set()
        for p_data in params.values():
            alle_tijden.update(p_data.keys())
        tijden = sorted(alle_tijden)

        # Format tijden naar lokaal
        tijden_lokaal = [_format_tijd_kort(t) for t in tijden]

        reeks = {"tijden": tijden_lokaal}
        for param in TIJDREEKS_PARAMS:
            if param in params:
                reeks[param] = [params[param].get(t) for t in tijden]

        if naam in vakken:
            vakken[naam]["tijdreeks"] = reeks


def _format_tijd(dt_str):
    """Format '2026-04-04 09:50:43' naar '04 apr 2026 11:50' (lokale tijd)."""
    if not dt_str:
        return ""
    try:
        dt = datetime.strptime(dt_str.strip(), "%Y-%m-%d %H:%M:%S")
        dt = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        return dt.strftime("%d %b %Y %H:%M").lower()
    except ValueError:
        return dt_str


def _format_tijd_kort(dt_str):
    """Format '2026-04-04 14:00:00' naar '14:00' (lokale tijd)."""
    if not dt_str:
        return ""
    try:
        dt = datetime.strptime(dt_str.strip(), "%Y-%m-%d %H:%M:%S")
        dt = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        return dt.strftime("%H:%M")
    except ValueError:
        return dt_str


def _format_periode(van, tot):
    """Format verwachtingsperiode naar leesbare string."""
    try:
        dt_van = datetime.strptime(van.strip(), "%Y-%m-%d %H:%M:%S")
        dt_tot = datetime.strptime(tot.strip(), "%Y-%m-%d %H:%M:%S")
        dt_van = dt_van.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        dt_tot = dt_tot.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        return f"{dt_van.strftime('%H:%M')} - {dt_tot.strftime('%H:%M')}"
    except ValueError:
        return f"{van} - {tot}"


if __name__ == "__main__":
    haal_marifoon()
