#!/usr/local/bin/python3
# haal_luchtvaart_bulletin.py
import os, json, re, requests
from datetime import datetime
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

URL      = "https://www.knmi.nl/nederland-nu/luchtvaart/weerbulletin-kleine-luchtvaart"
HEADERS  = {"User-Agent": "EdAldusWM/1.0 bulletin-fetcher"}
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

print("Luchtvaart bulletin ophalen...")
try:
    r = requests.get(URL, headers=HEADERS, timeout=20)
    r.raise_for_status()
    html = r.text

    tekst = None

    # Strategie 1: extraheer <pre>...</pre> of <code>...</code> blok,
    # strip dan alle HTML-tags (KNMI gebruikt soms <span> voor highlighting)
    for tag in ('pre', 'code'):
        blok_match = re.search(rf'<{tag}[^>]*>(.*?)</{tag}>', html, re.DOTALL | re.IGNORECASE)
        if blok_match:
            blok = blok_match.group(1)
            blok = re.sub(r'<[^>]+>', '', blok)          # strip HTML tags
            blok = blok.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').strip()
            if 'ZCZC' in blok and 'NNNN' in blok:
                m = re.search(r'(ZCZC.*?NNNN)', blok, re.DOTALL)
                if m:
                    tekst = m.group(1).strip()
                    print(f"  Gevonden via <{tag}> blok")
                    break

    # Strategie 2: direct in ruwe HTML (fallback voor platte tekst pagina's)
    if not tekst:
        html_clean = re.sub(r'<[^>]+>', '', html)
        m = re.search(r'(ZCZC.*?NNNN)', html_clean, re.DOTALL)
        if m:
            tekst = m.group(1).strip()
            print("  Gevonden via ruwe HTML (fallback)")

    if tekst:
        # Tijdstempel onderaan de pagina: "28/03/2026 12.30 uur LT"
        tijd_match = re.search(r'(\d{2}/\d{2}/\d{4}\s+\d{2}[.,]\d{2})\s*uur', html)
        if tijd_match:
            tijd_str = tijd_match.group(1).replace('.', ':')  # "28/03/2026 12:30"
        else:
            tijd_str = ''

        data = {
            "tekst":  tekst,
            "tijd":   tijd_str,
            "update": datetime.now(LOCAL_TZ).strftime("%d-%m-%Y %H:%M"),
        }
        with open("luchtvaart_bulletin.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Bulletin opgeslagen ({len(tekst)} tekens, {tijd_str})")
    else:
        print("WAARSCHUWING: Geen bulletin gevonden in HTML — JSON niet bijgewerkt")

except Exception as e:
    print(f"Fout: {e}")
