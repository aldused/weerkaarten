#!/usr/local/bin/python3
# haal_luchtvaart_bulletin.py
import os, json, re, requests
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

URL     = "https://www.knmi.nl/nederland-nu/luchtvaart/weerbulletin-kleine-luchtvaart"
HEADERS = {"User-Agent": "EdAldusWM/1.0 bulletin-fetcher"}
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

print("Luchtvaart bulletin ophalen...")
try:
    r = requests.get(URL, headers=HEADERS, timeout=20)
    r.raise_for_status()
    html = r.text

    # Bulletin staat tussen ZCZC en NNNN in een <pre> of als platte tekst
    match = re.search(r'(ZCZC.*?NNNN)', html, re.DOTALL)
    if not match:
        # Probeer via code block
        match = re.search(r'<code[^>]*>(ZCZC.*?NNNN)</code>', html, re.DOTALL)

    if match:
        tekst = match.group(1)
        # HTML entities opruimen
        tekst = tekst.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
        tekst = re.sub(r'<[^>]+>', '', tekst).strip()

        # Tijdstempel van de pagina
        tijd_match = re.search(r'(\d{2}/\d{2}/\d{4}\s+\d{2}[.,:]\d{2})\s*uur', html)
        tijd_str = tijd_match.group(1).replace('.', ':') if tijd_match else ''

        data = {
            "tekst":  tekst,
            "tijd":   tijd_str,
            "update": datetime.now(LOCAL_TZ).strftime("%d-%m-%Y %H:%M"),
        }
        with open("luchtvaart_bulletin.json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Bulletin opgeslagen ({len(tekst)} tekens, {tijd_str})")
    else:
        print("Geen bulletin gevonden in HTML")

except Exception as e:
    print(f"Fout: {e}")
