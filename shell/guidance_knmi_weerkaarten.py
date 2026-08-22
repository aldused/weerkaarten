#!/usr/bin/env python3
"""
guidance_knmi_weerkaarten.py <cache_dir>

Haalt de officiele KNMI-weerkaarten op (grondkaarten met isobaren en fronten,
HARMONIE-analyse + ECMWF-prognose) van de KNMI-site en legt ze klaar voor de
guidance-prompt. Dit is de gezaghebbende Nederlandse frontenbron voor de korte
termijn (analyse t/m +36 uur), naast de Bracknell-faxkaarten (breder Europa,
tot +120 uur).

Bron: https://www.knmi.nl/nederland-nu/weer/waarschuwingen-en-verwachtingen/weerkaarten
De kaart-URL's roteren per dag (bestandsnaam = dag+uur), dus we scrapen de
pagina voor de actuele set i.p.v. namen te raden.

Bestandsnaamconventie op de CDN:
  AL<dd><hh>_large.gif  = analyse,     geldig dag <dd> om <hh> UTC (HARMONIE)
  PL<dd><hh>_large.gif  = prognose,    geldig dag <dd> om <hh> UTC (ECMWF)

Schrijft:
  <cache>/guidance_knmi_<code>.gif   per kaart (bijv. guidance_knmi_AL0700.gif)
  <cache>/knmi_charts.json           {analysis_utc, charts:[...]}
  <cache>/knmi_weerkaart_sectie.txt  kaartlijst voor de prompt

Niet-fataal bedoeld: bij een fout ruimt het script de half-af bestanden op en
eindigt met exitcode 1, zodat guidance_update.sh gewoon zonder KNMI-kaarten
doorgaat (net als bij de clusterkaarten).
"""
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

PAGINA = ("https://www.knmi.nl/nederland-nu/weer/waarschuwingen-en-verwachtingen/"
          "weerkaarten")
CDN = ("https://cdn.knmi.nl/knmi/map/page/weer/waarschuwingen_verwachtingen/"
       "weerkaarten/")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"

DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"]
MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli",
           "augustus", "september", "oktober", "november", "december"]


def _haal(url, referer=None):
    headers = {"User-Agent": UA}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    return urllib.request.urlopen(req, timeout=60)


def _valid_datum(dd, hh, vandaag):
    """Kies de datum met dag-van-de-maand <dd> die het dichtst bij vandaag ligt.

    De kaarten lopen van de analyse (vandaag of morgen 00 UTC) tot ~+36 uur,
    dus de geldige datum ligt altijd binnen een paar dagen rond vandaag. Zoek
    de dichtstbijzijnde match zodat het ook klopt rond een maandwisseling.
    """
    for delta in sorted(range(-2, 4), key=abs):
        kandidaat = vandaag + timedelta(days=delta)
        if kandidaat.day == dd:
            return datetime(kandidaat.year, kandidaat.month, kandidaat.day, hh,
                            tzinfo=timezone.utc)
    return None


def main():
    cache = sys.argv[1]

    # Oude KNMI-kaarten weg zodat een stille run geen verouderde set achterlaat.
    for f in os.listdir(cache):
        if f.startswith("guidance_knmi_") and f.endswith(".gif"):
            os.remove(os.path.join(cache, f))
    for naam in ("knmi_charts.json", "knmi_weerkaart_sectie.txt"):
        p = os.path.join(cache, naam)
        if os.path.isfile(p):
            os.remove(p)

    with _haal(PAGINA) as r:
        html = r.read().decode("utf-8", "replace")
    codes = sorted(set(re.findall(r"\b((?:AL|PL)\d{4})_large\.gif", html)))
    if not codes:
        sys.exit("FOUT: geen KNMI-weerkaarten (AL/PL) op de pagina gevonden")

    vandaag = datetime.now(timezone.utc).date()
    charts = []
    for code in codes:
        soort = "analyse" if code.startswith("AL") else "verwachting"
        dd, hh = int(code[2:4]), int(code[4:6])
        valid = _valid_datum(dd, hh, vandaag)
        if valid is None:
            print(f"WAARSCHUWING: kan geldigheidsdatum van {code} niet bepalen — overgeslagen")
            continue

        bestand = f"guidance_knmi_{code}.gif"
        pad = os.path.join(cache, bestand)
        try:
            with _haal(CDN + f"{code}_large.gif", referer=PAGINA) as r:
                blob = r.read()
        except Exception as e:
            print(f"WAARSCHUWING: {code} niet opgehaald ({e})")
            continue
        if len(blob) < 10000 or not blob.startswith(b"GIF"):
            print(f"WAARSCHUWING: {code} geen geldige GIF ({len(blob)} bytes) — overgeslagen")
            continue
        with open(pad, "wb") as fh:
            fh.write(blob)

        d = valid.date()
        label = (f"{soort} — {DAGEN[d.weekday()]} {d.day} {MAANDEN[d.month - 1]} "
                 f"{hh:02d} UTC")
        charts.append({
            "file": bestand,
            "code": code,
            "soort": soort,
            "valid_utc": valid.isoformat(),
            "valid_label": label,
        })

    if len(charts) < 2:
        # Zonder minstens analyse + een prognose voegt het weinig toe; ruim op.
        for c in charts:
            try:
                os.remove(os.path.join(cache, c["file"]))
            except FileNotFoundError:
                pass
        sys.exit(f"FOUT: slechts {len(charts)} bruikbare KNMI-weerkaart(en)")

    charts.sort(key=lambda c: c["valid_utc"])
    analyse = next((c for c in charts if c["soort"] == "analyse"), None)

    meta = {
        "analysis_utc": analyse["valid_utc"] if analyse else None,
        "charts": charts,
    }
    json.dump(meta, open(os.path.join(cache, "knmi_charts.json"), "w"),
              ensure_ascii=False, indent=1)

    regels = []
    for c in charts:
        regels.append(f"- {os.path.join(cache, c['file'])} — {c['valid_label']}")
    open(os.path.join(cache, "knmi_weerkaart_sectie.txt"), "w").write(
        "\n".join(regels) + "\n")

    analyse_txt = f", analyse {analyse['valid_label'][10:]}" if analyse else ""
    print(f"KNMI-weerkaarten: {len(charts)} kaarten{analyse_txt}")


if __name__ == "__main__":
    main()
