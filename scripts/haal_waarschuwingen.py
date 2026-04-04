"""
haal_waarschuwingen.py — Haal KNMI waarschuwingen op en sla op als JSON
Wordt aangeroepen vanuit upload_kaarten.sh
"""
import os, requests, json, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

KNMI_KEY = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjdhYWZkZDdiMjAwZDQxOTM5Y2I1ZTRkZWU0OTE2OWMyIiwiaCI6Im11cm11cjEyOCJ9"
BASE_URL = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/waarschuwingen_nederland_48h/versions/1.0"
HEADERS  = {"Authorization": KNMI_KEY}

PROVINCIES = {
    "GR": "Groningen", "FR": "Friesland", "DR": "Drenthe",
    "OV": "Overijssel", "FL": "Flevoland", "GL": "Gelderland",
    "NH": "Noord-Holland", "UT": "Utrecht", "ZH": "Zuid-Holland",
    "ZE": "Zeeland", "NB": "Noord-Brabant", "LB": "Limburg",
    "WAE": "Waddeneilanden", "WAD": "Waddenzee", "IJG": "IJsselmeergebied",
}

KLEUR_VOLGORDE = {"GREEN": 0, "YELLOW": 1, "ORANGE": 2, "RED": 3}
KLEUR_NL = {"GREEN": "groen", "YELLOW": "geel", "ORANGE": "oranje", "RED": "rood"}

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

def haal_waarschuwingen():
    # Meest recente XML bestand
    r = requests.get(f"{BASE_URL}/files", headers=HEADERS,
                     params={"maxKeys": 5, "sorting": "desc"}, timeout=15)
    r.raise_for_status()
    bestanden = r.json().get("files", [])
    xml_bestand = next((f["filename"] for f in bestanden if f["filename"].endswith(".xml")), None)
    if not xml_bestand:
        print("Geen XML bestand gevonden"); return None

    # Download URL
    r2 = requests.get(f"{BASE_URL}/files/{xml_bestand}/url", headers=HEADERS, timeout=15)
    r2.raise_for_status()
    xml_tekst = requests.get(r2.json()["temporaryDownloadUrl"], timeout=30).text

    root = ET.fromstring(xml_tekst)

    # Haal per provincie de hoogste kleurcode op (eerste timeslice)
    provincie_codes = {}
    for loc in root.iter("location"):
        loc_id = loc.findtext("location_id")
        color  = loc.findtext(".//color_id")
        if loc_id and color and loc_id in PROVINCIES:
            if loc_id not in provincie_codes:
                provincie_codes[loc_id] = color
            else:
                # Bewaar de hoogste code
                if KLEUR_VOLGORDE.get(color, 0) > KLEUR_VOLGORDE.get(provincie_codes[loc_id], 0):
                    provincie_codes[loc_id] = color

    # Hoogste code voor heel Nederland
    max_kleur = max(provincie_codes.values(),
                    key=lambda c: KLEUR_VOLGORDE.get(c, 0),
                    default="GREEN")

    # Haal tekst op
    txt_bestand = next((f["filename"] for f in bestanden if f["filename"].endswith(".txt")), None)
    tekst = ""
    if txt_bestand:
        r3 = requests.get(f"{BASE_URL}/files/{txt_bestand}/url", headers=HEADERS, timeout=15)
        r3.raise_for_status()
        tekst = requests.get(r3.json()["temporaryDownloadUrl"], timeout=15).text.strip()

    # Fenomeen uit XML halen
    FENOMEEN_NL = {
        "SNOW": "sneeuw", "ICE": "gladheid", "FOG": "mist",
        "RAIN": "regen", "THUNDER": "onweer", "WIND": "zware windstoten",
        "HEAT": "hitte", "COLD": "kou", "WATERSPOUT": "waterhoos",
    }
    fenomenen = set()
    for ph in root.iter("phenomenon_id"):
        fn = (ph.text or "").strip().upper()
        if fn in FENOMEEN_NL:
            fenomenen.add(FENOMEEN_NL[fn])
    fenomeen_str = ", ".join(sorted(fenomenen)) if fenomenen else ""

    # Fallback: fenomeen uit waarschuwingstekst halen als XML het niet geeft
    if not fenomeen_str and tekst:
        tekst_lower = tekst.lower()
        TEKST_FENOMEEN = [
            ("zware windstoten", "zware windstoten"), ("windstoten", "zware windstoten"),
            ("onweer", "onweer"), ("hagel", "hagel"),
            ("sneeuw", "sneeuw"), ("ijzel", "ijzel"), ("gladheid", "gladheid"),
            ("mist", "dichte mist"), ("hitte", "hitte"), ("kou", "kou"),
            ("regen", "zware regen"), ("neerslag", "zware neerslag"),
        ]
        gevonden = set()
        for zoek, label in TEKST_FENOMEEN:
            if zoek in tekst_lower:
                gevonden.add(label)
        fenomeen_str = ", ".join(sorted(gevonden)) if gevonden else ""

    nu = datetime.now(timezone.utc).astimezone(LOCAL_TZ).strftime("%d %b %Y %H:%M")

    resultaat = {
        "bijgewerkt": nu,
        "max_kleur": max_kleur,
        "max_kleur_nl": KLEUR_NL.get(max_kleur, "groen"),
        "fenomeen": fenomeen_str,
        "provincies": {pid: provincie_codes.get(pid, "GREEN") for pid in PROVINCIES},
        "tekst": tekst,
        "knmi_url": "https://www.knmi.nl/nederland-nu/weer/waarschuwingen"
    }

    with open("waarschuwingen.json", "w") as f:
        json.dump(resultaat, f, ensure_ascii=False)
    print(f"Waarschuwingen opgeslagen: {max_kleur} ({nu})")
    return resultaat

if __name__ == "__main__":
    haal_waarschuwingen()
