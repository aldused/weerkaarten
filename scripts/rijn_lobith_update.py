#!/usr/bin/env python3
"""
rijn_lobith_update.py — actuele + recente Rijnafvoer bij Lobith (Bovenrijn, Tolkamer)
uit de nieuwe RWS WaterWebservices (DDAPI 2.0).

Schrijft rijn_lobith.json voor demo_rijn_lobith.html:
  - nu:      laatste geldige 10-min meting (afvoer m3/s)
  - reeks:   dagwaarden (etmaalgemiddelde) laatste ~60 dagen
  - drempels + historie: gecureerde referenties (zie ONDER)

Bron: https://ddapi20-waterwebservices.rijkswaterstaat.nl
Grootheid Q (Debiet), Compartiment OW, locatie lobith.bovenrijn.tolkamer.
De klassieke waterwebservices.rijkswaterstaat.nl is per eind april 2026 gestopt.
"""
import os, json, datetime
from collections import defaultdict
import urllib.request

BASE = "https://ddapi20-waterwebservices.rijkswaterstaat.nl"
OBS  = BASE + "/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen"
LOC_CODE = "lobith.bovenrijn.tolkamer"
DAGEN = 60
SENTINEL = 100000          # RWS mist-waarde (999999999) eruit filteren

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(SCRIPT_DIR, "rijn_lobith.json")

# Gecureerde referentiedrempels + historische laagterecords (m3/s).
# Bron: Rijkswaterstaat Waterinfo / waterberichtgeving.rws.nl.
DREMPELS = {"gemiddeld": 2200, "ola": 1020, "alarm": 800, "record": 620}
HISTORIE = [
    {"jaar": 1947, "q": 620, "note": "record - laagste ooit"},
    {"jaar": 2018, "q": 732, "note": "okt - laagste sinds 1901 (toen)"},
    {"jaar": 2022, "q": 650, "note": "aug - naderde record"},
]


def _post(url: str, body: dict, timeout: int = 120) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json",
                                          "Accept": "application/json",
                                          "User-Agent": "weerlab/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status == 204:
            return {}
        return json.loads(resp.read().decode("utf-8"))


def haal_afvoer() -> list:
    """Retourneer [(datetime_utc_naief_lokaal_iso, waarde)] geldige 10-min metingen."""
    now = datetime.datetime.now(datetime.timezone.utc)
    begin = (now - datetime.timedelta(days=DAGEN)).strftime("%Y-%m-%dT%H:%M:%S.000+00:00")
    eind = now.strftime("%Y-%m-%dT%H:%M:%S.000+00:00")
    body = {
        "Locatie": {"Code": LOC_CODE, "X": None, "Y": None},
        "AquoPlusWaarnemingMetadata": {"AquoMetadata": {
            "Compartiment": {"Code": "OW"}, "Grootheid": {"Code": "Q"}}},
        "Periode": {"Begindatumtijd": begin, "Einddatumtijd": eind},
    }
    j = _post(OBS, body)
    out = []
    for reeks in (j.get("WaarnemingenLijst") or []):
        for m in reeks.get("MetingenLijst", []):
            tijd = m.get("Tijdstip")
            w = (m.get("Meetwaarde") or {}).get("Waarde_Numeriek")
            if tijd is None or w is None:
                continue
            if abs(w) >= SENTINEL:
                continue
            out.append((tijd, float(w)))
    # dedupe op tijdstip, sorteer
    uniek = {t: w for t, w in out}
    return sorted(uniek.items())


def haal_waterstand() -> tuple | None:
    """Laatste geldige waterhoogte (WATHTE, cm +NAP) bij Lobith → (tijdstip, cm)."""
    now = datetime.datetime.now(datetime.timezone.utc)
    begin = (now - datetime.timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S.000+00:00")
    eind = now.strftime("%Y-%m-%dT%H:%M:%S.000+00:00")
    body = {
        "Locatie": {"Code": LOC_CODE, "X": None, "Y": None},
        "AquoPlusWaarnemingMetadata": {"AquoMetadata": {
            "Compartiment": {"Code": "OW"}, "Grootheid": {"Code": "WATHTE"}}},
        "Periode": {"Begindatumtijd": begin, "Einddatumtijd": eind},
    }
    try:
        j = _post(OBS, body)
    except Exception:
        return None
    laatste = None
    for reeks in (j.get("WaarnemingenLijst") or []):
        for m in reeks.get("MetingenLijst", []):
            w = (m.get("Meetwaarde") or {}).get("Waarde_Numeriek")
            t = m.get("Tijdstip")
            if t is None or w is None or abs(w) >= SENTINEL:
                continue
            if laatste is None or t > laatste[0]:
                laatste = (t, float(w))
    return laatste


def dagwaarden(metingen: list) -> list:
    """Etmaalgemiddelde per kalenderdag (lokale datum uit ISO-tijdstip)."""
    per_dag = defaultdict(list)
    for tijd, w in metingen:
        datum = tijd[:10]  # YYYY-MM-DD (lokale tijd in RWS-respons)
        per_dag[datum].append(w)
    rijen = [{"d": d, "q": round(sum(v) / len(v))} for d, v in sorted(per_dag.items())]
    return rijen


def main():
    metingen = haal_afvoer()
    if not metingen:
        raise SystemExit("Geen afvoerdata ontvangen van RWS (204/leeg).")

    reeks = dagwaarden(metingen)
    laatste_tijd, laatste_w = metingen[-1]

    ws = haal_waterstand()  # (tijd, cm +NAP) of None
    nu = {"tijd": laatste_tijd, "afvoer": round(laatste_w)}
    if ws:
        nu["waterstand_cm"] = round(ws[1])
        nu["waterstand_tijd"] = ws[0]

    out = {
        "gegenereerd": datetime.datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M%z"),
        "locatie": "Lobith (Bovenrijn, Tolkamer)",
        "grootheid": "Afvoer (debiet)",
        "eenheid": "m3/s",
        "bron": "Rijkswaterstaat WaterWebservices (DDAPI 2.0)",
        "nu": nu,
        "reeks": reeks,
        "drempels": DREMPELS,
        "historie": HISTORIE,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"Geschreven: {OUT}")
    print(f"  nu: {out['nu']['afvoer']} m3/s @ {laatste_tijd}")
    print(f"  reeks: {len(reeks)} dagen  ({reeks[0]['d']} .. {reeks[-1]['d']})")
    print(f"  laatste 5 dagen: {[r['q'] for r in reeks[-5:]]}")


if __name__ == "__main__":
    main()
