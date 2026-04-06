#!/usr/bin/env python3
"""
haal_dwd_guidance.py
Scrapt DWD Synoptische Übersicht (Kurzfrist + Mittelfrist),
vertaalt naar Nederlands via DeepL, slaat op als dwd_guidance.json.
"""

import os, json, re, requests
from datetime import datetime

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

DEEPL_KEY = "74b23afc-bfb0-463e-b689-9e7d2ad67f84:fx"
DEEPL_URL = "https://api-free.deepl.com/v2/translate"

URLS = {
    "kurzfrist": "https://www.dwd.de/DE/fachnutzer/hobbymet/wetter_deutschland/_functions/PlainTeaser_synUebersichten/nas_bericht_syn_ueb_kurzfrist_frueh.html",
    "mittelfrist": "https://www.dwd.de/DE/fachnutzer/hobbymet/wetter_deutschland/_functions/PlainTeaser_synUebersichten/nas_bericht_syn_ueb_mittelfrist.html",
}

OUTPUT = "dwd_guidance.json"

# DeepL free tier: max 500.000 tekens/maand, max ~50 verzoeken/sec
# Splits tekst in blokken van max 4000 tekens voor betrouwbare vertaling
MAX_CHUNK = 4000


def vertaal_deepl(tekst):
    """Vertaal Duitse tekst naar Nederlands via DeepL API (header auth)."""
    if not tekst or not tekst.strip():
        return tekst

    # Splits op dubbele newlines (alinea's) om context te bewaren
    alineas = tekst.split("\n\n")
    blokken = []
    huidig = ""
    for a in alineas:
        if len(huidig) + len(a) + 2 > MAX_CHUNK and huidig:
            blokken.append(huidig)
            huidig = a
        else:
            huidig = huidig + "\n\n" + a if huidig else a
    if huidig:
        blokken.append(huidig)

    vertaald = []
    for blok in blokken:
        try:
            r = requests.post(DEEPL_URL, headers={
                "Authorization": f"DeepL-Auth-Key {DEEPL_KEY}",
                "Content-Type": "application/json",
            }, json={
                "text": [blok],
                "source_lang": "DE",
                "target_lang": "NL",
            }, timeout=30)
            r.raise_for_status()
            vertaald.append(r.json()["translations"][0]["text"])
        except Exception as e:
            print(f"  DeepL fout: {e}")
            vertaald.append(blok)  # fallback: origineel behouden

    return "\n\n".join(vertaald)


def scrape_dwd(url):
    """Haal guidance tekst op van DWD pagina (pre-tag)."""
    r = requests.get(url, timeout=30, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
    })
    r.encoding = "utf-8"
    html = r.text

    # DWD zet de guidance in een <pre> tag
    pre_match = re.search(r'<pre[^>]*>(.*?)</pre>', html, re.DOTALL)
    if not pre_match:
        raise ValueError("Geen <pre> tag gevonden op DWD pagina")

    tekst = pre_match.group(1).strip()

    # HTML entities opruimen
    tekst = re.sub(r'&amp;', '&', tekst)
    tekst = re.sub(r'&lt;', '<', tekst)
    tekst = re.sub(r'&gt;', '>', tekst)
    tekst = re.sub(r'&nbsp;', ' ', tekst)
    tekst = re.sub(r'&uuml;', 'ü', tekst)
    tekst = re.sub(r'&ouml;', 'ö', tekst)
    tekst = re.sub(r'&auml;', 'ä', tekst)
    tekst = re.sub(r'&Uuml;', 'Ü', tekst)
    tekst = re.sub(r'&Ouml;', 'Ö', tekst)
    tekst = re.sub(r'&Auml;', 'Ä', tekst)
    tekst = re.sub(r'&szlig;', 'ß', tekst)
    tekst = re.sub(r'&#\d+;', '', tekst)
    tekst = re.sub(r'<[^>]+>', '', tekst)  # resterende tags

    # Zoek uitgiftedatum
    uitgave = ""
    uitgave_match = re.search(r'ausgegeben am\s+(.*?)(?:\n|$)', tekst, re.IGNORECASE)
    if uitgave_match:
        uitgave = uitgave_match.group(1).strip()

    return tekst[:10000], uitgave


def main():
    print(f"=== DWD Guidance === {datetime.now():%Y-%m-%d %H:%M}")
    output = {}

    for naam, url in URLS.items():
        print(f"  Ophalen: {naam}...")
        try:
            origineel, uitgave = scrape_dwd(url)
            print(f"  Origineel: {len(origineel)} tekens")

            print(f"  Vertalen via DeepL...")
            vertaald = vertaal_deepl(origineel)
            print(f"  Vertaald: {len(vertaald)} tekens")

            output[naam] = {
                "original": origineel,
                "translated": vertaald,
                "issuedAt": uitgave,
                "fetchedAt": datetime.now().isoformat(),
            }
        except Exception as e:
            print(f"  FOUT: {e}")
            output[naam] = {
                "original": "",
                "translated": "",
                "error": str(e),
                "fetchedAt": datetime.now().isoformat(),
            }

    output["bijgewerkt"] = datetime.now().isoformat()
    with open(OUTPUT, "w") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"Opgeslagen: {OUTPUT}")


if __name__ == "__main__":
    main()
