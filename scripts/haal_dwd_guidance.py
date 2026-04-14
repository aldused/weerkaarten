#!/usr/bin/env python3
"""
haal_dwd_guidance.py
Scrapt DWD Synoptische Übersicht (Kurzfrist + Mittelfrist),
vertaalt naar Nederlands via lokaal Helsinki NLP model, slaat op als dwd_guidance.json.
"""

import os, json, re, requests
from datetime import datetime

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

URLS = {
    "kurzfrist": "https://www.dwd.de/DE/fachnutzer/hobbymet/wetter_deutschland/_functions/PlainTeaser_synUebersichten/nas_bericht_syn_ueb_kurzfrist_frueh.html",
    "mittelfrist": "https://www.dwd.de/DE/fachnutzer/hobbymet/wetter_deutschland/_functions/PlainTeaser_synUebersichten/nas_bericht_syn_ueb_mittelfrist.html",
}

OUTPUT = "dwd_guidance.json"

_model = None
_tokenizer = None

def _get_model():
    global _model, _tokenizer
    if _model is None:
        from transformers import MarianMTModel, MarianTokenizer
        name = "Helsinki-NLP/opus-mt-de-nl"
        _tokenizer = MarianTokenizer.from_pretrained(name)
        _model = MarianMTModel.from_pretrained(name)
    return _model, _tokenizer


def _vertaal_zin(tekst):
    """Vertaal één stuk tekst (max ~400 tekens)."""
    model, tokenizer = _get_model()
    tokens = tokenizer([tekst], return_tensors="pt", padding=True, truncation=True, max_length=512)
    vertaald = model.generate(**tokens)
    return tokenizer.decode(vertaald[0], skip_special_tokens=True)


def vertaal_lokaal(tekst):
    """Vertaal Duitse tekst naar Nederlands via lokaal Helsinki NLP model."""
    if not tekst or not tekst.strip():
        return tekst

    # Splits op lege regels (alinea's) om opmaak te bewaren
    alineas = re.split(r'(\n\s*\n)', tekst)
    resultaat = []

    for deel in alineas:
        # Lege scheidingsregels ongewijzigd laten
        if not deel.strip():
            resultaat.append(deel)
            continue

        # Regels die niet vertaald moeten worden (codes, datums, afkortingen)
        if re.match(r'^\s*(SXEU|DWAV|S\w{3}\d{2}|\d{6}/\d{4})', deel.strip()):
            resultaat.append(deel)
            continue

        # Splits in stukken van max ~400 tekens op regelgrenzen
        regels = deel.split('\n')
        vertaalde_regels = []
        buffer = ""

        for regel in regels:
            if len(buffer) + len(regel) < 400:
                buffer += (" " if buffer else "") + regel.strip()
            else:
                if buffer:
                    try:
                        vertaalde_regels.append(_vertaal_zin(buffer))
                    except Exception:
                        vertaalde_regels.append(buffer)
                buffer = regel.strip()

        if buffer:
            try:
                vertaalde_regels.append(_vertaal_zin(buffer))
            except Exception:
                vertaalde_regels.append(buffer)

        resultaat.append('\n'.join(vertaalde_regels))

    return ''.join(resultaat)


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

            print(f"  Vertalen via lokaal model...")
            vertaald = vertaal_lokaal(origineel)
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
