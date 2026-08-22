"""
haal_marifoon.py — Haal KNMI marifoonbericht op en sla op als JSON
Dataset: maritime-forecasts/versions/1.0 (Open Data API, twee-stap download)
(opvolger van marifoon/1.0, die per 19 mei 2026 is gestopt — laatste bestand 22 jun)

Leest het MARITIEM_DOMEIN_KUST-bestand (JSON): per kustdistrict tekstverwachtingen
(wind, windstoten, zicht, weer) voor 0-12/12-24 uur + dagvooruitzichten.
Output: marifoon.json in dezelfde structuur als voorheen (marifoon.html-compatibel).
"""
import os, sys, requests, json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from knmi_api import knmi_get

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

BASE_URL = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/maritime-forecasts/versions/1.0"
WARNINGS_URL = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/maritime-warnings/versions/1.0"

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

# Kustdistricten (nieuwe locatie-id's) met representatieve coördinaten
KUSTVAKKEN = {
    "VLISSINGEN_DISTRICT": {"naam": "Vlissingen",       "lat": 51.45, "lon": 3.60},
    "ZIERIKZEE":           {"naam": "Zierikzee",        "lat": 51.65, "lon": 3.90},
    "HOEK_VAN_HOLLAND":    {"naam": "Hoek van Holland", "lat": 52.00, "lon": 4.10},
    "IJMUIDEN":            {"naam": "IJmuiden",          "lat": 52.47, "lon": 4.50},
    "TEXEL":               {"naam": "Texel",             "lat": 53.00, "lon": 4.70},
    "HARLINGEN":           {"naam": "Harlingen",         "lat": 53.17, "lon": 5.40},
    "ROTTUM":              {"naam": "Rottum",            "lat": 53.55, "lon": 6.20},
    "DELFZIJL":            {"naam": "Delfzijl",          "lat": 53.35, "lon": 6.90},
    "IJSSELMEER":          {"naam": "IJsselmeer",        "lat": 52.70, "lon": 5.30},
    "MARKEN":              {"naam": "Marken",            "lat": 52.50, "lon": 5.20},
}

# period_name (nieuw) → termijnnummer (oud, marifoon.html verwacht '1'/'2' + '10'-'12')
PERIODE_MAP = {"0-12": "1", "12-24": "2", "+1": "10", "+2": "11", "+3": "12"}

# phenomenon → veldnaam in marifoon.json
PHENOMEEN_MAP = {
    "WIND":       "wind",
    "GUST":       "windstoten",
    "WEATHER":    "weer",
    "VISIBILITY": "zicht",
    "CLOUD":      "bewolking",
}

LEEG_TERMIJN = {
    "wind": "", "windstoten": "", "wind_waarschuwing": "",
    "weer": "", "zicht": "", "bewolking": "",
}


def haal_marifoon():
    print("Marifoonbericht ophalen (maritime-forecasts)...")

    # Stap 1: meest recente KUST-bestand zoeken
    r = knmi_get(f"{BASE_URL}/files",
                 params={"maxKeys": 30, "sorting": "desc"}, timeout=15)
    r.raise_for_status()
    bestanden = r.json().get("files", [])

    kust_bestand = next(
        (f["filename"] for f in bestanden if "MARITIEM_DOMEIN_KUST" in f["filename"]),
        None
    )
    if not kust_bestand:
        print("Geen MARITIEM_DOMEIN_KUST bestand gevonden")
        return None
    print(f"  Bestand: {kust_bestand}")

    # Stap 2: download URL ophalen
    r2 = knmi_get(f"{BASE_URL}/files/{kust_bestand}/url", timeout=15)
    r2.raise_for_status()
    download_url = r2.json()["temporaryDownloadUrl"]

    # Stap 3: JSON downloaden
    bron = requests.get(download_url, timeout=30).json()
    pub = bron.get("publication", {})
    components = pub.get("forecast", {}).get("components", [])

    bijgewerkt_iso = pub.get("last_updated_at", "")
    volgend_bericht_iso = pub.get("next_forecast_at", "")
    bijgewerkt = _format_tijd(bijgewerkt_iso)
    volgend_bericht = _format_tijd(volgend_bericht_iso)

    # Overzicht uit de verwachtingendataset. Actuele waarschuwingen staan sinds
    # de datamigratie in de aparte dataset maritime-warnings.
    overzicht = ""
    for c in components:
        if c.get("location") != "KUST_DISTRICTEN":
            continue
        data = c.get("data", {})
        if c.get("phenomenon") == "SYNOPSIS" and not overzicht:
            overzicht = (data.get("message_nl") or "").strip()

    waarschuwingen, waarschuwingen_bijgewerkt = _haal_waarschuwingen()
    waarschuwing = "; ".join(
        f"{naam}: {tekst}" for naam, tekst in waarschuwingen.items()
    )

    # Vakken opbouwen
    vakken = {}
    for info in KUSTVAKKEN.values():
        vakken[info["naam"]] = {
            "lat": info["lat"],
            "lon": info["lon"],
            "termijnen": {},
        }

    periodes = _maak_periodes(bron.get("meta", {}).get("time_slot", {}))

    for c in components:
        loc = c.get("location", "")
        pname = c.get("period_name", "")
        tid = PERIODE_MAP.get(pname)
        if loc not in KUSTVAKKEN or tid is None:
            continue

        naam = KUSTVAKKEN[loc]["naam"]
        termijnen = vakken[naam]["termijnen"]
        if tid not in termijnen:
            termijnen[tid] = {"termijn": tid, **LEEG_TERMIJN}
        t = termijnen[tid]

        data = c.get("data", {})
        fen = c.get("phenomenon", "")
        if "WARNING" in fen:
            t["wind_waarschuwing"] = (data.get("message_nl") or "").strip()
        elif fen in PHENOMEEN_MAP:
            tekst = (data.get("message_nl") or "").strip()
            if fen == "VISIBILITY":
                extra = (data.get("additional_message_nl") or "").strip()
                if extra and extra.lower() not in tekst.lower():
                    tekst = f"{tekst} ({extra})" if tekst else extra
            t[PHENOMEEN_MAP[fen]] = tekst
        elif fen == "AIR_TEMPERATURE":
            mn, mx = data.get("min"), data.get("max")
            if mn is not None and mx is not None:
                t["temperatuur"] = f"{mn} tot {mx}°C"
        elif fen == "WATER_TEMPERATURE":
            w = data.get("temperature")
            if w is not None:
                t["watertemperatuur"] = f"{w}°C"

    # Termijnen omzetten van dict naar gesorteerde lijst + periode-labels
    for naam in vakken:
        termijn_dict = vakken[naam]["termijnen"]
        vakken[naam]["termijnen"] = [
            termijn_dict[t] for t in sorted(termijn_dict.keys(), key=lambda x: int(x))
        ]
        for t in vakken[naam]["termijnen"]:
            t["periode"] = periodes.get(t["termijn"], f"Termijn {t['termijn']}")

    volledige_tekst = _maak_tekst(bijgewerkt, overzicht, waarschuwing, vakken)

    resultaat = {
        "bijgewerkt": bijgewerkt,
        "bijgewerkt_iso": bijgewerkt_iso,
        "meteoroloog": "",  # niet meer aanwezig in maritime-forecasts
        "volgend_bericht": volgend_bericht,
        "volgend_bericht_iso": volgend_bericht_iso,
        "overzicht": overzicht,
        "waarschuwing": waarschuwing,
        "waarschuwingen": waarschuwingen,
        "waarschuwingen_bijgewerkt": waarschuwingen_bijgewerkt,
        "periodes": periodes,
        "vakken": vakken,
        "volledige_tekst": volledige_tekst,
    }

    with open("marifoon.json", "w") as f:
        json.dump(resultaat, f, ensure_ascii=False, indent=1)
    print(f"Marifoon opgeslagen ({bijgewerkt}, bron: maritime-forecasts)")
    return resultaat


def _haal_waarschuwingen():
    """Lees actieve waarschuwingen voor de kustdistricten uit maritime-warnings.

    De waarschuwingendienst publiceert op onregelmatige momenten. Daarom wordt
    steeds het nieuwste JSON-bestand gelezen en worden alleen actieve, nog niet
    verlopen waarschuwingen voor de categorie ``coastal`` overgenomen. Een
    tijdelijke fout mag het gewone marifoonbericht niet blokkeren.
    """
    try:
        r = knmi_get(f"{WARNINGS_URL}/files",
                     params={"maxKeys": 5, "sorting": "desc"}, timeout=15)
        r.raise_for_status()
        bestanden = r.json().get("files", [])
        bestand = next(
            (f["filename"] for f in bestanden
             if f.get("filename", "").lower().endswith(".json")),
            None,
        )
        if not bestand:
            return {}, ""

        r2 = knmi_get(f"{WARNINGS_URL}/files/{bestand}/url", timeout=15)
        r2.raise_for_status()
        bron = requests.get(r2.json()["temporaryDownloadUrl"], timeout=30)
        bron.raise_for_status()
        data = bron.json()

        nu = datetime.now(timezone.utc)
        waarschuwingen = {}
        for gebied in data.get("areas", []):
            if gebied.get("area_category") != "coastal":
                continue
            naam = (gebied.get("name_nl") or "").strip()
            if naam not in {info["naam"] for info in KUSTVAKKEN.values()}:
                continue

            teksten = []
            for waarschuwing in gebied.get("warnings", []):
                if waarschuwing.get("status") != "active":
                    continue
                verloopt = waarschuwing.get("expires")
                if verloopt:
                    try:
                        if datetime.fromisoformat(verloopt.replace("Z", "+00:00")) <= nu:
                            continue
                    except ValueError:
                        pass
                tekst = (waarschuwing.get("description_nl") or "").strip()
                if tekst and tekst not in teksten:
                    teksten.append(tekst)
            if teksten:
                waarschuwingen[naam] = " / ".join(teksten)

        gegenereerd = _format_tijd(data.get("metadata", {}).get("generated", ""))
        return waarschuwingen, gegenereerd
    except Exception as exc:
        print(f"Waarschuwingen tijdelijk niet beschikbaar: {exc}")
        return {}, ""


def _maak_tekst(bijgewerkt, overzicht, waarschuwing, vakken):
    """Stel een leesbare volledige tekst samen uit de geparste onderdelen."""
    regels = [f"MARIFOONBERICHT — stand {bijgewerkt}", ""]
    if waarschuwing:
        regels += [f"WAARSCHUWING: {waarschuwing}", ""]
    if overzicht:
        regels += ["WEEROVERZICHT", overzicht, ""]
    regels.append("VERWACHTING PER KUSTDISTRICT")
    for naam, vak in vakken.items():
        regels += ["", naam.upper()]
        for t in vak["termijnen"]:
            if not any(t.get(veld) for veld in (
                "wind", "windstoten", "wind_waarschuwing", "weer", "zicht",
                "bewolking", "temperatuur", "watertemperatuur",
            )):
                continue
            regels.append(f"  {t['periode']}:")
            if t["wind"]:
                regels.append(f"    wind: {t['wind']}")
            if t["windstoten"]:
                regels.append(f"    windstoten: {t['windstoten']}")
            if t["wind_waarschuwing"]:
                regels.append(f"    waarschuwing: {t['wind_waarschuwing']}")
            if t["zicht"]:
                regels.append(f"    zicht: {t['zicht']}")
            if t["weer"]:
                regels.append(f"    weer: {t['weer']}")
            if t.get("bewolking"):
                regels.append(f"    bewolking: {t['bewolking']}")
            if t.get("temperatuur"):
                regels.append(f"    luchttemperatuur: {t['temperatuur']}")
            if t.get("watertemperatuur"):
                regels.append(f"    watertemperatuur: {t['watertemperatuur']}")
    return "\n".join(regels)


def _format_tijd(dt_str):
    """Format ISO-8601 ('2026-07-03T09:56:47+00:00') naar '03 jul 2026 11:56' (lokaal)."""
    if not dt_str:
        return ""
    try:
        dt = datetime.fromisoformat(dt_str.strip()).astimezone(LOCAL_TZ)
        return dt.strftime("%d %b %Y %H:%M").lower()
    except ValueError:
        return dt_str


def _maak_periodes(time_slot):
    """Leid de termijn-labels af van het publicatie-tijdslot.
    '0-12' = slotstart +0-12u, '12-24' = +12-24u; '+1'/'+2'/'+3' = vandaag/morgen/overmorgen.
    (De 'period'-velden per component bevatten het tijdslot zelf en zijn hier onbruikbaar.)
    """
    DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']
    try:
        start = datetime.fromisoformat(time_slot["start_datetime"]).astimezone(LOCAL_TZ)
    except (KeyError, ValueError):
        return {}
    periodes = {}
    for tid, uren in (("1", 0), ("2", 12)):
        van = start + timedelta(hours=uren)
        tot = start + timedelta(hours=uren + 12)
        periodes[tid] = f"{van.strftime('%H:%M')} - {tot.strftime('%H:%M')}"
    for tid, dagen in (("10", 0), ("11", 1), ("12", 2)):
        d = start + timedelta(days=dagen)
        periodes[tid] = f"{DAGEN[d.weekday()]} {d.day} {d.strftime('%b').lower()}"
    return periodes


if __name__ == "__main__":
    haal_marifoon()
