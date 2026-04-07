#!/usr/bin/env python3
"""
haal_dwd_guidance.py
Scrapt DWD Synoptische Übersicht (Kurzfrist + Mittelfrist),
vertaalt naar Nederlands via Claude Haiku, slaat op als dwd_guidance.json.
"""

import os, json, re, requests
from datetime import datetime
import anthropic

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

URLS = {
    "kurzfrist": "https://www.dwd.de/DE/fachnutzer/hobbymet/wetter_deutschland/_functions/PlainTeaser_synUebersichten/nas_bericht_syn_ueb_kurzfrist_frueh.html",
    "mittelfrist": "https://www.dwd.de/DE/fachnutzer/hobbymet/wetter_deutschland/_functions/PlainTeaser_synUebersichten/nas_bericht_syn_ueb_mittelfrist.html",
}

OUTPUT = "dwd_guidance.json"


def vertaal_claude(tekst):
    """Vertaal Duitse tekst naar Nederlands via Claude Haiku."""
    if not tekst or not tekst.strip():
        return tekst

    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=8000,
        messages=[{
            "role": "user",
            "content": f"""Vertaal de volgende Duitse meteorologische tekst naar het Nederlands.
Behoud exact dezelfde opmaak, regelafbrekingen en structuur.
Vertaal alleen de tekst, voeg niets toe en laat niets weg.
Meteorologische afkortingen (Bft, UTC, hPa, GWL, etc.) en plaatsnamen niet vertalen.
SXEU/DWAV codes en datumregels niet vertalen.

Tekst:
{tekst}"""
        }]
    )
    return message.content[0].text


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

            print(f"  Vertalen via Claude...")
            vertaald = vertaal_claude(origineel)
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
