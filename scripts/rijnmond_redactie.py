#!/usr/bin/env python3
"""Optionele taalredactie van het regelgebaseerde Rijnmond-bericht.

Een taalmodel (headless `claude -p`, zoals de ECMWF-guidance; Codex als
reserve) herschrijft alleen de formulering. Daarna controleert een harde
validator per dagdeel of de inhoud gelijk bleef:

* ieder getal moet al in het regelgebaseerde dagdeel staan;
* geen modelnamen, geen "voorspelling";
* geen windrichtingen die er niet stonden;
* geen verschijnselen (onweer, hagel, mist, front, hoge/lage druk) die er niet
  stonden, en droge dagdelen blijven droog;
* de lengte blijft binnen redelijke grenzen.

Faalt een dagdeel, dan blijft daar de regelgebaseerde tekst staan. De
redactie blokkeert de publicatie nooit.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

SHELL = Path(__file__).resolve().parent.parent / "shell"
PROMPT = SHELL / "rijnmond_redactie_prompt.md"
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "/opt/homebrew/bin/claude")
CODEX_BIN = "/Applications/ChatGPT.app/Contents/Resources/codex"
MODEL = os.environ.get("RIJNMOND_REDACTIE_MODEL", "opus")

MODELNAMEN = re.compile(r"\b(ECMWF|HARMONIE|ICON|GFS|UKMO|AROME|MOSMIX|ENS|IFS|DMI|Open-Meteo)\b", re.I)
RICHTINGEN = ["noordoost", "noordwest", "zuidoost", "zuidwest", "noord", "oost", "zuid", "west"]
VERSCHIJNSELEN = {
    "onweer": r"onwe(e)?r", "hagel": r"hagel", "mist": r"\bmist|nevel", "front": r"front",
    "hogedruk": r"hogedruk|hoge druk", "lagedruk": r"lagedruk|lage druk", "storing": r"storing",
    "motregen": r"motregen", "sluier": r"sluier", "zon": r"\bzon", "regen": r"regen|bui|neerslag",
}


def getallen(tekst: str) -> set[str]:
    return {g.replace(",", ".") for g in re.findall(r"\d+(?:[.,]\d+)?", tekst)}


def richtingen(tekst: str) -> set[str]:
    t = tekst.lower()
    gevonden = set()
    for r in RICHTINGEN:          # samengestelde eerst, daarna wegstrepen
        if r in t:
            gevonden.add(r)
            t = t.replace(r, " ")
    return gevonden


def verschijnselen(tekst: str) -> set[str]:
    t = tekst.lower()
    return {k for k, p in VERSCHIJNSELEN.items() if re.search(p, t)}


def valideer(origineel: list[str], nieuw: list[str]) -> list[str]:
    """Lege lijst = goedgekeurd; anders de redenen van afkeuring."""
    o, n = " ".join(origineel), " ".join(nieuw)
    fouten = []
    if not n.strip():
        return ["lege tekst"]
    extra = getallen(n) - getallen(o)
    if extra:
        fouten.append(f"nieuwe getallen: {sorted(extra)}")
    weg = {g for g in getallen(o) if g not in getallen(n)}
    # Temperaturen en windkracht mogen niet verdwijnen.
    kern = set(re.findall(r"(\d+) graden", o)) | set(re.findall(r"kracht (\d+)", o)) | set(re.findall(r"tot (\d+)\b", o))
    if weg & kern:
        fouten.append(f"weggevallen kerngetallen: {sorted(weg & kern)}")
    if MODELNAMEN.search(n):
        fouten.append("modelnaam in de tekst")
    if re.search(r"voorspel", n, re.I):
        fouten.append("'voorspelling' gebruikt")
    extra_r = richtingen(n) - richtingen(o)
    if extra_r:
        fouten.append(f"nieuwe windrichting: {sorted(extra_r)}")
    extra_v = verschijnselen(n) - verschijnselen(o)
    if extra_v:
        fouten.append(f"nieuw verschijnsel: {sorted(extra_v)}")
    if "droog" in o.lower() and "droog" not in n.lower() and "regen" not in verschijnselen(o):
        fouten.append("droog dagdeel niet meer droog genoemd")
    if not 0.6 <= len(n) / max(1, len(o)) <= 1.4:
        fouten.append(f"lengte {len(n)} t.o.v. {len(o)} tekens")
    return fouten


def _roep_model(prompt: str, timeout: int = 420) -> tuple[str | None, str]:
    cmd = [CLAUDE_BIN, "-p", prompt, "--model", MODEL, "--output-format", "text", "--max-turns", "2"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        uit = (r.stdout or "") + (r.stderr or "")
        if r.returncode == 0 and not re.search(r"hit your limit|usage limit|credit balance|Not logged in|authenticate", uit, re.I):
            return r.stdout, f"claude {MODEL}"
        fout = uit.strip()[:160] or f"exitcode {r.returncode}"
    except subprocess.TimeoutExpired:
        fout = "claude: tijdslimiet"
    except FileNotFoundError:
        fout = "claude CLI niet gevonden"
    if os.path.exists(CODEX_BIN):
        try:
            r = subprocess.run([CODEX_BIN, "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral",
                                "--sandbox", "read-only", "--skip-git-repo-check", "-"],
                               input=prompt, capture_output=True, text=True, timeout=timeout)
            if r.returncode == 0 and "{" in r.stdout:
                return r.stdout, "codex"
            fout += f"; codex: {(r.stderr or r.stdout).strip()[:120]}"
        except Exception as exc:  # pragma: no cover
            fout += f"; codex: {exc}"
    return None, fout


def redigeer(tekst: dict, feiten: dict) -> dict:
    secties = tekst["secties"]
    invoer = {"secties": [{"key": s["key"], "titel": s["titel"], "alineas": s["alineas"]} for s in secties]}
    prompt = PROMPT.read_text(encoding="utf-8") + "\n" + json.dumps(invoer, ensure_ascii=False, indent=1) + "\n"
    ruw, bron = _roep_model(prompt)
    if ruw is None:
        return {"fout": bron}
    m = re.search(r"\{\s*\"secties\"", ruw)
    start = m.start() if m else ruw.find("{")
    try:
        antwoord = json.loads(ruw[start:ruw.rfind("}") + 1])
    except Exception:
        return {"fout": "geen geldige JSON van het taalmodel"}
    nieuw = {s.get("key"): s for s in antwoord.get("secties", []) if isinstance(s, dict)}
    uit, afgekeurd = [], []
    for s in secties:
        kandidaat = nieuw.get(s["key"])
        alineas = [str(a).strip() for a in (kandidaat or {}).get("alineas", []) if str(a).strip()]
        fouten = valideer(s["alineas"], alineas) if kandidaat else ["ontbreekt in antwoord"]
        if fouten:
            afgekeurd.append({"key": s["key"], "redenen": fouten})
            uit.append(s)
        else:
            uit.append({**s, "alineas": alineas})
    if len(afgekeurd) == len(secties):
        return {"fout": "alle dagdelen afgekeurd", "afgekeurd": afgekeurd}
    return {"secties": uit, "model": bron, "afgekeurd": afgekeurd}
