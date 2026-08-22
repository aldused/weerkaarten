#!/usr/bin/env python3
"""
haal_guidance.py
Scrapt KNMI guidance modelbeoordeling (kort) en meerdaagse (lang).
Output: guidance.json
"""

import os, json, re, requests
from datetime import datetime

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

URLS = {
    "kort": "https://www.knmi.nl/nederland-nu/weer/waarschuwingen-en-verwachtingen/extra/guidance-modelbeoordeling",
    "lang": "https://www.knmi.nl/nederland-nu/weer/waarschuwingen-en-verwachtingen/extra/guidance-meerdaagse"
}
OUTPUT = "guidance.json"

def scrape_guidance(url):
    """Haal guidance tekst op van KNMI pagina."""
    try:
        r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
        html = r.text

        # Verwijder HTML tags maar bewaar structuur
        # Zoek de hoofdinhoud na de breadcrumb
        # De tekst zit na <h1> tag
        h1_match = re.search(r'<h1[^>]*>(.*?)</h1>', html, re.DOTALL)
        titel = ""
        if h1_match:
            titel = re.sub(r'<[^>]+>', '', h1_match.group(1)).strip()

        # Zoek geldigheid/uitgifte regel
        geldig = ""
        geldig_match = re.search(r'(Modellen algemeen.*?(?:locale tijd|lokale tijd))', html)
        if geldig_match:
            geldig = re.sub(r'<[^>]+>', '', geldig_match.group(1)).strip()

        # Haal paragrafen op na h1
        # Zoek content div
        content = ""
        # Verwijder scripts en styles
        html_clean = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL)
        html_clean = re.sub(r'<style[^>]*>.*?</style>', '', html_clean, flags=re.DOTALL)
        html_clean = re.sub(r'<nav[^>]*>.*?</nav>', '', html_clean, flags=re.DOTALL)
        html_clean = re.sub(r'<header[^>]*>.*?</header>', '', html_clean, flags=re.DOTALL)
        html_clean = re.sub(r'<footer[^>]*>.*?</footer>', '', html_clean, flags=re.DOTALL)

        # Zoek hoofdinhoud sectie
        main_match = re.search(r'<main[^>]*>(.*?)</main>', html_clean, re.DOTALL)
        if main_match:
            main_html = main_match.group(1)
        else:
            main_html = html_clean

        # Verwijder navigatie-elementen
        main_html = re.sub(r'<(nav|aside|header|footer)[^>]*>.*?</\1>', '', main_html, flags=re.DOTALL)

        # Zet headers om naar speciale markers
        main_html = re.sub(r'<h[1-6][^>]*>(.*?)</h[1-6]>', r'\n\n### \1\n', main_html, flags=re.DOTALL)

        # Zet paragrafen om
        main_html = re.sub(r'<p[^>]*>(.*?)</p>', r'\1\n\n', main_html, flags=re.DOTALL)
        main_html = re.sub(r'<br\s*/?>', '\n', main_html)
        main_html = re.sub(r'<strong[^>]*>(.*?)</strong>', r'**\1**', main_html, flags=re.DOTALL)

        # Verwijder resterende tags
        main_html = re.sub(r'<[^>]+>', ' ', main_html)

        # Opruimen
        main_html = re.sub(r'&amp;', '&', main_html)
        main_html = re.sub(r'&lt;', '<', main_html)
        main_html = re.sub(r'&gt;', '>', main_html)
        main_html = re.sub(r'&nbsp;', ' ', main_html)
        main_html = re.sub(r'&#\d+;', '', main_html)
        main_html = re.sub(r'&[a-z]+;', '', main_html)
        main_html = re.sub(r'\n{3,}', '\n\n', main_html)
        regels2 = [r.strip() for r in main_html.split('\n')]
        main_html = '\n'.join(r for r in regels2)
        main_html = re.sub(r'\n{3,}', '\n\n', main_html)
        main_html = re.sub(r'[ \t]+', ' ', main_html)

        # Zoek de relevante tekst - begin bij de geldigheidsregel of eerste sectie
        regels = main_html.strip().split('\n')
        start_idx = 0
        for i, regel in enumerate(regels):
            if 'Modellen' in regel or 'Beoordeling' in regel or 'Guidance' in regel or 'geldig' in regel.lower():
                start_idx = i
                break

        # Neem tekst tot en met de paraaf/uitgifte
        eind_idx = len(regels)
        for i, regel in enumerate(regels[start_idx:], start_idx):
            if 'Pagina delen' in regel or 'Verwachtingen in meer' in regel:
                eind_idx = i
                break

        content = '\n'.join(regels[start_idx:eind_idx]).strip()

        # Zoek paraaf en uitgifte
        paraaf_match = re.search(r'(Paraaf meteoroloog:.*?(?:uur LT|Paraaf:.*?\n))', content)
        paraaf = ""
        if paraaf_match:
            paraaf = paraaf_match.group(1).strip()

        return {
            "titel": titel,
            "geldig": geldig,
            "tekst": content[:8000],  # max 8000 tekens
            "paraaf": paraaf,
            "url": url,
            "opgehaald": datetime.now().isoformat()
        }

    except Exception as e:
        return {
            "titel": "Fout bij ophalen",
            "tekst": str(e),
            "url": url,
            "opgehaald": datetime.now().isoformat()
        }


def main():
    print(f"=== KNMI Guidance === {datetime.now():%Y-%m-%d %H:%M}")
    output = {}
    for naam, url in URLS.items():
        print(f"  Ophalen: {naam}...")
        output[naam] = scrape_guidance(url)
        print(f"  Klaar: {len(output[naam]['tekst'])} tekens")

    output["bijgewerkt"] = datetime.now().isoformat()
    with open(OUTPUT, "w") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"Opgeslagen: {OUTPUT}")


if __name__ == "__main__":
    main()
