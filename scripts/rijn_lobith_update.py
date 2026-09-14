#!/usr/bin/env python3
"""
rijn_lobith_update.py — actuele + recente Rijnafvoer bij Lobith (Bovenrijn, Tolkamer)
uit de nieuwe RWS WaterWebservices (DDAPI 2.0).

Schrijft rijn_lobith.json voor demo_rijn_lobith.html:
  - nu:      laatste geldige 10-min meting (afvoer m3/s)
  - reeks:   dagwaarden (etmaalgemiddelde) laatste ~60 dagen
  - drempels: OLA reference; no fixed alarm or unsupported historical records

Bron: https://ddapi20-waterwebservices.rijkswaterstaat.nl
Grootheid Q (Debiet), Compartiment OW, locatie lobith.bovenrijn.tolkamer.
De klassieke waterwebservices.rijkswaterstaat.nl is per eind april 2026 gestopt.
"""
import os, json, datetime, math, tempfile
from zoneinfo import ZoneInfo
from collections import defaultdict
import urllib.request

BASE = "https://ddapi20-waterwebservices.rijkswaterstaat.nl"
OBS  = BASE + "/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen"
LOC_CODE = "lobith.bovenrijn.tolkamer"
DAGEN = 60
SENTINEL = 100000          # RWS mist-waarde (999999999) eruit filteren

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(SCRIPT_DIR, "rijn_lobith.json")

# OLA is a navigation reference, not a stand-alone alarm threshold.
# https://open.rijkswaterstaat.nl/%40253564/olr-2022-bepaling-overeengekomen-lage/
DREMPELS = {"ola": 1020}
NL = ZoneInfo("Europe/Amsterdam")


def meettijd(value):
    try:
        result = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result.astimezone(datetime.timezone.utc) if result.tzinfo else None
    except (AttributeError, TypeError, ValueError):
        return None


def geldige_waarde(value, afvoer=False):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and abs(value) < SENTINEL and (not afvoer or value >= 0)


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
            if meettijd(tijd) is None or not geldige_waarde(w, afvoer=True):
                continue
            if abs(w) >= SENTINEL:
                continue
            out.append((meettijd(tijd).isoformat(), float(w)))
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
            if meettijd(t) is None or not geldige_waarde(w):
                continue
            t = meettijd(t).isoformat()
            if laatste is None or t > laatste[0]:
                laatste = (t, float(w))
    return laatste


def dagwaarden(metingen: list) -> list:
    """Mean of available observations per Dutch day, with explicit coverage."""
    per_dag = defaultdict(dict)
    for tijd, w in metingen:
        instant = meettijd(tijd)
        if instant is None or not geldige_waarde(w, afvoer=True):
            continue
        datum = instant.astimezone(NL).date()
        per_dag[datum][instant] = w
    rows = []
    for datum, readings in sorted(per_dag.items()):
        start = datetime.datetime.combine(datum, datetime.time(), NL).astimezone(datetime.timezone.utc)
        end = datetime.datetime.combine(datum + datetime.timedelta(days=1), datetime.time(), NL).astimezone(datetime.timezone.utc)
        expected = int((end - start).total_seconds() / 600)
        slots = {int((t - start).total_seconds() // 600) for t in readings}
        rows.append({"d": datum.isoformat(), "q": round(sum(readings.values()) / len(readings)),
                     "aantal": len(readings), "verwacht": expected,
                     "volledig": len(slots) == expected})
    return rows


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
    }
    # Readers must never observe a partly written JSON document.
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=SCRIPT_DIR, suffix=".json.tmp", delete=False) as f:
        json.dump(out, f, ensure_ascii=False, indent=2, allow_nan=False)
        temp_path = f.name
    os.replace(temp_path, OUT)

    print(f"Geschreven: {OUT}")
    print(f"  nu: {out['nu']['afvoer']} m3/s @ {laatste_tijd}")
    print(f"  reeks: {len(reeks)} dagen  ({reeks[0]['d']} .. {reeks[-1]['d']})")
    print(f"  laatste 5 dagen: {[r['q'] for r in reeks[-5:]]}")


if __name__ == "__main__":
    main()
