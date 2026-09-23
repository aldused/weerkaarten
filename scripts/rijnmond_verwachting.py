#!/usr/bin/env python3
"""Automatische regioverwachting Rijnmond / Zuid-Holland Zuid.

    python3 scripts/rijnmond_verwachting.py --slot        # vaste uitgifte (8x per dag)
    python3 scripts/rijnmond_verwachting.py               # alleen bij nieuwe modelruns
    python3 scripts/rijnmond_verwachting.py --force       # altijd opnieuw
    python3 scripts/rijnmond_verwachting.py --redactie claude   # plus taalredactie

Keten: rijnmond_bronnen (welke modellen en runs staan er nu op Weerlab?) →
rijnmond_analyse (vergelijking + consensus) → rijnmond_tekst (weerbericht) →
optioneel rijnmond_redactie (taalmodel herschrijft, een validator bewaakt
getallen en richtingen; bij twijfel blijft de regelgebaseerde tekst staan) →
rijnmond_verwachting.json in de weerlab-map (R2-publicatie via de shell-wrapper).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rijnmond_analyse as A  # noqa: E402
import rijnmond_bronnen as B  # noqa: E402
import rijnmond_tekst as T  # noqa: E402

UIT = B.WEERLAB / "rijnmond_verwachting.json"
# Acht vaste uitgiften per dag (lokale tijd). De tijden liggen net ná de momenten
# waarop Weerlab zijn modelvelden ververst: de nieuwe ECMWF-run staat rond 09:40
# en 21:40 binnen, HARMONIE ieder uur rond :35 en ICON-D2 driemaal per dag.
SLOTS = (1, 4, 7, 10, 13, 16, 19, 22)
HISTORIE = B.CACHE / "historie.json"
MAANDEN = B.MAANDEN


def _json_default(o):
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, np.ndarray):
        return None
    if isinstance(o, (np.floating, np.integer, np.bool_)):
        return o.item()
    return str(o)


def vingerafdruk(feiten: dict) -> str:
    runs = sorted(f"{r['id']}:{r['run_utc']}:{r['status']}" for r in feiten["modelruns"])
    runs += feiten.get("ens_info", {}).get("runs", [])[:1] + [str(feiten.get("mosmix_run"))]
    return hashlib.sha1("|".join(runs).encode()).hexdigest()[:16]


def slot_start(nu: datetime) -> datetime:
    """Begin van het uitgiftemoment waar `nu` in valt."""
    vandaag = nu.replace(minute=0, second=0, microsecond=0)
    for uur in reversed(SLOTS):
        if nu.hour >= uur:
            return vandaag.replace(hour=uur)
    return (vandaag - timedelta(days=1)).replace(hour=SLOTS[-1])


def uitgifte_label(nu: datetime) -> str:
    return f"{B.DAGEN[nu.weekday()]} {nu.day} {MAANDEN[nu.month - 1]}, {nu:%H.%M} uur"


def samenvatting_voor_historie(feiten: dict) -> dict:
    uit = {}
    for p in feiten["perioden"]:
        sleutel = f"{p['datum']}/{p['soort']}"
        uit[sleutel] = {"temp": p["temperatuur"]["waarde"], "kans": p["neerslag"]["kans"],
                        "bft": p["wind"].get("bft"), "label": f"{p['titel']} ({p['dag_label']})"}
    for d in feiten["daarna"]:
        uit[f"{d['datum']}/dag"] = {"temp": d["tmax"], "kans": d["kans_neerslag"], "bft": (d.get("wind") or {}).get("bft"),
                                    "label": d["dag_label"]}
    return uit


def wijzigingen(feiten: dict, nu: datetime) -> tuple[list[dict], str | None]:
    """Wat is er veranderd t.o.v. de uitgifte van minstens zes uur geleden?"""
    try:
        hist = json.loads(HISTORIE.read_text(encoding="utf-8"))
    except Exception:
        return [], None
    oud = [h for h in hist if datetime.fromisoformat(h["uitgegeven"]) <= nu - timedelta(hours=6)]
    if not oud:
        return [], None
    ref = oud[-1]
    nieuw = samenvatting_voor_historie(feiten)
    uit = []
    for sleutel, n in nieuw.items():
        o = ref["waarden"].get(sleutel)
        if not o:
            continue
        if n["temp"] is not None and o["temp"] is not None and abs(n["temp"] - o["temp"]) >= 1.5:
            soort = "Maximumtemperatuur" if sleutel.endswith("/dag") else "Minimumtemperatuur"
            uit.append({"wat": f"{soort} {n['label']}", "was": f"{T.afr(o['temp'])} °C", "nu": f"{T.afr(n['temp'])} °C"})
        if n["kans"] is not None and o["kans"] is not None and abs(n["kans"] - o["kans"]) >= 20:
            uit.append({"wat": f"Neerslagkans {n['label']}", "was": f"{o['kans']}%", "nu": f"{n['kans']}%"})
    return uit, ref["uitgegeven"]


def bewaar_historie(feiten: dict, nu: datetime) -> None:
    try:
        hist = json.loads(HISTORIE.read_text(encoding="utf-8"))
    except Exception:
        hist = []
    hist = [h for h in hist if datetime.fromisoformat(h["uitgegeven"]) > nu - timedelta(days=4)]
    hist.append({"uitgegeven": nu.isoformat(timespec="minutes"), "waarden": samenvatting_voor_historie(feiten)})
    HISTORIE.parent.mkdir(parents=True, exist_ok=True)
    tmp = HISTORIE.with_suffix(".tmp")
    tmp.write_text(json.dumps(hist, ensure_ascii=False), encoding="utf-8")
    tmp.replace(HISTORIE)


def materiele_wijziging(vorige: dict, feiten: dict) -> bool:
    """Is de nieuwe consensus inhoudelijk anders dan de vorige uitgifte?"""
    oud = {p["key"]: p for p in vorige.get("perioden", [])}
    for p in feiten["perioden"]:
        o = oud.get(p["key"])
        if not o:
            return True
        if abs((p["temperatuur"]["waarde"] or 0) - (o["temperatuur"]["waarde"] or 0)) >= 1.5:
            return True
        if abs(p["neerslag"]["kans"] - o["neerslag"]["kans"]) >= 20:
            return True
        if (p.get("mist") or {}).get("klasse") != (o.get("mist") or {}).get("klasse"):
            return True
        if abs((p["wind"].get("bft") or 0) - (o["wind"].get("bft") or 0)) >= 2:
            return True
    return False


def vooruitzicht_tabel(feiten: dict) -> list[dict]:
    rijen = []
    for d in feiten["daarna"]:
        w = d.get("wind") or {}
        rijen.append({
            "datum": d["datum"], "dag": d["dag_label"],
            "tmax": T.afr(d["tmax"]), "tmax_bereik": [T.afr(x) for x in (d.get("tmax_bereik") or [None, None])],
            "tmin": T.afr(d["tmin"]) if d.get("tmin") is not None else None,
            "neerslagkans": d.get("kans_neerslag"), "kans_ens": d.get("kans_ens"), "kans_modellen": d.get("kans_modellen"),
            "wind": f"{T.AFK.get(w.get('richting') or '', '')} {w.get('bft')}" if w.get("bft") is not None else "–",
            "zon_uren": T.afr((d.get("lucht") or {}).get("zon_uren")) if (d.get("lucht") or {}).get("zon_uren") is not None else None,
            "n_modellen": d["n_modellen"], "ens_spreiding": d.get("tmax_ens"),
            "mist": {k: (d.get("mist_ochtend") or {}).get(k) for k in ("klasse", "kans")} if d.get("mist_ochtend") else None,
            "per_model": d.get("per_model"),
        })
    return rijen


def slanke_feiten(feiten: dict) -> dict:
    """Feiten zonder puntarrays, voor de pagina en de redactie."""
    return json.loads(json.dumps(feiten, default=_json_default, ensure_ascii=False))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--slot", action="store_true",
                    help="vaste uitgifte: sla over als dit moment al een uitgifte heeft")
    ap.add_argument("--redactie", choices=["uit", "claude"], default="uit")
    ap.add_argument("--uit", default=str(UIT))
    args = ap.parse_args()

    nu = B.nu_lokaal()
    feiten = A.analyseer(nu)
    gebruikt = [r for r in feiten["modelruns"] if r["status"] == "gebruikt"]
    if len(gebruikt) < 3:
        print(f"FOUT: slechts {len(gebruikt)} bruikbare modellen — geen nieuwe verwachting", file=sys.stderr)
        return 1
    vinger = vingerafdruk(feiten)
    uitpad = Path(args.uit)
    if args.slot and uitpad.exists():
        # Slot-wacht: de hoofdrun geeft uit, de inhaalpoging 20 minuten later
        # doet dat alleen als de hoofdrun niet slaagde.
        try:
            vorige = json.loads(uitpad.read_text(encoding="utf-8"))
            if datetime.fromisoformat(vorige["uitgegeven"]) >= slot_start(nu):
                print(f"Uitgifte van {slot_start(nu):%H:%M} staat er al ({vorige['uitgegeven']}) — overgeslagen")
                return 0
        except Exception:
            pass
    if not args.force and not args.slot and uitpad.exists():
        try:
            vorige = json.loads(uitpad.read_text(encoding="utf-8"))
            leeftijd = nu - datetime.fromisoformat(vorige["uitgegeven"])
            # Zelfde runs en nog geen drie uur oud: niets te doen. Na drie uur wel
            # opnieuw, omdat dagdelen verschuiven ("vandaag" wordt "vanavond").
            if vorige.get("vingerafdruk") == vinger and leeftijd < timedelta(hours=3):
                print(f"Geen nieuwe modelruns sinds {vorige['uitgegeven']} — overgeslagen")
                return 0
            # Met taalredactie (kost een taalmodelaanroep) alleen opnieuw bij een
            # inhoudelijke wijziging of als de vorige uitgifte drie uur oud is.
            if args.redactie != "uit" and leeftijd < timedelta(hours=3) and not materiele_wijziging(vorige, feiten):
                print("Nieuwe runs, maar geen inhoudelijke wijziging binnen drie uur — overgeslagen")
                return 0
        except Exception:
            pass

    tekst = T.schrijf_alles(feiten)
    slank = slanke_feiten(feiten)
    tekstbron = {"soort": "regelgebaseerd",
                 "toelichting": "Automatisch opgesteld uit de modelconsensus; elke zin is terug te voeren op berekende waarden."}
    if args.redactie == "claude":
        try:
            import rijnmond_redactie as R
            resultaat = R.redigeer(tekst, slank)
            if resultaat.get("secties"):
                tekst["secties_regelgebaseerd"] = tekst["secties"]
                tekst["secties"] = resultaat["secties"]
                tekstbron = {"soort": "redactie", "model": resultaat.get("model"),
                             "toelichting": "Taalredactie door een taalmodel op basis van dezelfde feiten; "
                                            "getallen, richtingen en kansen zijn automatisch gecontroleerd.",
                             "afgekeurd": resultaat.get("afgekeurd", [])}
            else:
                tekstbron["redactie_mislukt"] = resultaat.get("fout", "onbekend")
        except Exception as exc:  # redactie is nooit blokkerend
            tekstbron["redactie_mislukt"] = str(exc)[:200]

    wijz, ref = wijzigingen(feiten, nu)
    uit = {
        "schema": 1,
        "product": "Weer Rijnmond",
        "gebied": feiten["gebied"],
        "uitgegeven": nu.isoformat(timespec="minutes"),
        "uitgegeven_utc": B.lokaal_naar_utc(nu).strftime("%Y-%m-%dT%H:%MZ"),
        "uitgegeven_label": uitgifte_label(nu),
        "vingerafdruk": vinger,
        "tekstbron": tekstbron,
        "overzicht": tekst["overzicht"],
        "secties": tekst["secties"],
        "secties_regelgebaseerd": tekst.get("secties_regelgebaseerd"),
        "modelvergelijking": tekst["modelvergelijking"],
        "vooruitzicht": vooruitzicht_tabel(slank),
        "modelruns": slank["modelruns"],
        "wijzigingen": {"ten_opzichte_van": ref, "lijst": wijz},
        "bronnen": {
            "ens": slank.get("ens_info"), "mosmix_run": slank.get("mosmix_run"),
            "waarnemingen": slank.get("waarnemingen"),
            "guidance": ({"gegenereerd_utc": slank["guidance"]["gegenereerd_utc"], "run": slank["guidance"]["run"]}
                         if slank.get("guidance") else None),
        },
        "waarnemingstoets": slank.get("waarnemingstoets"),
        "ens_trend": slank.get("ens_trend"),
        "punten": [{k: p[k] for k in ("id", "naam", "lat", "lon", "regio", "zone")} for p in B.PUNTEN],
        "tijdvakken": slank.get("tijdvakken"),
        "perioden": [{k: v for k, v in p.items() if k != "modellen"} for p in slank["perioden"]],
    }
    uitpad.parent.mkdir(parents=True, exist_ok=True)
    tmp = uitpad.with_suffix(".tmp")
    tmp.write_text(json.dumps(uit, ensure_ascii=False, default=_json_default, separators=(",", ":")), encoding="utf-8")
    tmp.replace(uitpad)
    bewaar_historie(feiten, nu)
    print(f"Verwachting geschreven: {uitpad} ({uitpad.stat().st_size / 1024:.0f} kB), "
          f"{len(gebruikt)} modellen, tekst: {tekstbron['soort']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
