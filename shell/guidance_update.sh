#!/bin/bash
# Guidance: 4x daags een leesbare modelbeschouwing voor de weerbewaking.
# Kaarten -> headless claude (concept + verificatie) -> ecmwf_guidance.json -> R2.
#
# Bronnen:
#  - KNMI-weerkaarten (grondkaarten met fronten, HARMONIE-analyse + ECMWF-prognose):
#    cdn.knmi.nl .../weerkaarten/ — de gezaghebbende Nederlandse frontenbron voor de
#    korte termijn (analyse t/m +36 uur). Zie guidance_knmi_weerkaarten.py.
#  - Bracknell/UKMO faxkaarten (fronten, breder Europa t/m +120u): wetterzentrale BRAEU_<lead>.png
#  - ECMWF HRES overzichtskaarten:        weerlab/wxbeta/<cycle>z/ (lokaal, build_wxbeta)
#  - ENS-clusters z500 + ENS-blok De Bilt + KNMI/DWD-guidance als referentie.
#
# Cadans: 4 vaste momenten (04:30/10:15/16:00/22:15 lokaal, elk + retry). ECMWF
# HRES ververst maar 2x bruikbaar (00/12); de nacht- en middagrun zijn dus
# "tussenupdates" die de verse HARMONIE/KNMI-weerkaarten, de nieuwste fronten en
# de actuele KNMI/DWD-guidance meenemen met de laatste ECMWF-run als backbone.
#
# Bij elke fout: exit zonder upload, zodat de vorige, op echte modelruns
# gebaseerde guidance blijft staan. Er is nadrukkelijk geen generieke noodtekst.
# Gebruik: guidance_update.sh [--dry-run|--force]
#   --dry-run : alles t/m promptbouw, geen claude/upload
#   --force   : sla de slot-skip over (voor handmatig hergenereren)
# Elk van de 4 momenten heeft een retry ~30 min later; de slot-skip zorgt dat
# de retry alleen doorloopt als de hoofdrun van dat dagdeel nog niet slaagde.
set -euo pipefail

# launchd geeft een kale PATH zonder homebrew; claude CLI heeft node nodig
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PROJECT="/Users/aldus/KNMI_Project"
WEERLAB="$PROJECT/weerlab"
SHELL_DIR="$WEERLAB/shell"
CACHE="$PROJECT/guidance_cache"
CLAUDE_BIN="/opt/homebrew/bin/claude"
CLAUDE_MODEL="opus"
CODEX_BIN="/Applications/ChatGPT.app/Contents/Resources/codex"
BRACK_LEADS=(0 24 48 72 96 120)
DRY_RUN=0
FORCE=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
[ "${1:-}" = "--force" ] && FORCE=1

mkdir -p "$CACHE"
cd "$CACHE"
echo "[$(date '+%F %T')] guidance_update start"

# Slot-skip (voor de 30-min retry): elk dagdeel (nacht/ochtend/middag/avond)
# levert precies één update. Draaide de hoofdrun van dit dagdeel al met succes,
# dan slaat de retry over; faalde die, dan loopt de retry gewoon door. Zo
# vernieuwen ook de tussenruns (waarin ECMWF niet verandert) netjes 4x/dag.
if [ "$DRY_RUN" != "1" ] && [ "$FORCE" != "1" ]; then
  if python3 - "$CACHE" <<'PYEOF'
import json, os, sys
from datetime import datetime
cache = sys.argv[1]

def slot_id(now):
    h = now.hour
    naam = ("nacht" if 3 <= h <= 7 else "ochtend" if 8 <= h <= 12
            else "middag" if 13 <= h <= 17 else "avond")
    return f"{now.date().isoformat()}/{naam}"

try:
    cur = json.load(open(os.path.join(cache, "ecmwf_guidance.json")))
    # exit 0 = dit dagdeel al gedaan (skip), exit 1 = nog niet (doorgaan)
    sys.exit(0 if cur.get("slot_id") == slot_id(datetime.now()) else 1)
except Exception:
    sys.exit(1)
PYEOF
  then
    echo "Dit dagdeel is al bijgewerkt — niets te doen, stop."
    exit 0
  fi
fi

# ------------------------------------------- 0. KNMI-guidance verversen
# Referentiebron voor de prompt én houdt guidance.json op R2 actueel.
# NB: upload_kaarten.sh is NIET verweesd (draait 6x/dag via nl.edaldus.weerkaarten
# -> weerkaarten_run.sh) en ververst guidance.json ook; hier extra zodat de
# prompt altijd een verse referentie heeft.
if /usr/local/bin/python3 "$WEERLAB/scripts/haal_guidance.py"; then
  "$SHELL_DIR/r2_publish.sh" "$WEERLAB/guidance.json" || echo "WAARSCHUWING: upload KNMI-guidance mislukt"
else
  echo "WAARSCHUWING: haal_guidance.py mislukt — oude KNMI-tekst als referentie"
fi
# DWD-guidance (Kurzfrist/Mittelfrist, incl. lokale vertaling — duurt ~2 min)
if /usr/local/bin/python3 "$WEERLAB/scripts/haal_dwd_guidance.py"; then
  "$SHELL_DIR/r2_publish.sh" "$WEERLAB/dwd_guidance.json" || echo "WAARSCHUWING: upload DWD-guidance mislukt"
else
  echo "WAARSCHUWING: haal_dwd_guidance.py mislukt — oude DWD-tekst als referentie"
fi

# ---------------------------------------------------------------- 1. Bracknell
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
brack_ok=0
for lead in "${BRACK_LEADS[@]}"; do
  url="https://wetterzentrale.de/maps/BRAEU_${lead}.png"
  tmp="brack_${lead}.tmp"
  # Wetterzentrale kan tussen www en het kale domein omleiden. Volg zulke
  # HTTPS-redirects, zodat de HTML-redirectpagina niet als mislukte PNG eindigt.
  if curl -sSfL --proto-redir '=https' --max-redirs 3 -o "$tmp" \
       -H "Referer: https://wetterzentrale.de/nl/fax.php" -H "User-Agent: $UA" "$url" \
     && [ "$(stat -f%z "$tmp")" -gt 20000 ] \
     && file "$tmp" | grep -q "PNG image"; then
    mv "$tmp" "guidance_brack_${lead}.png"
    brack_ok=$((brack_ok + 1))
  else
    rm -f "$tmp"
    echo "WAARSCHUWING: Bracknell T+${lead} niet opgehaald"
  fi
done
if [ "$brack_ok" -lt 4 ]; then
  echo "FOUT: slechts $brack_ok Bracknell-kaarten, minimaal 4 nodig" >&2
  exit 1
fi
echo "Bracknell: $brack_ok kaarten"

# ------------------------------------- 1a. KNMI-weerkaarten (HARMONIE-analyse)
# Gezaghebbende Nederlandse grondkaarten met fronten (analyse t/m +36u). Verse
# HARMONIE-analyse per run -> houdt de korte termijn ook in de tussenruns actueel.
# Non-fataal: zonder KNMI-kaarten draait de guidance gewoon op Bracknell + ECMWF.
if ! python3 "$SHELL_DIR/guidance_knmi_weerkaarten.py" "$CACHE"; then
  echo "WAARSCHUWING: KNMI-weerkaarten niet beschikbaar — verder zonder"
  rm -f "$CACHE"/guidance_knmi_*.gif "$CACHE/knmi_charts.json" "$CACHE/knmi_weerkaart_sectie.txt"
fi

# ----------------------------------------- 1b. ENS-clusterkaarten (dag 3-10)
# Eigen cluster-z500-product van R2 (launchd 10:45/22:45); voedt de
# vooruitzichten-alinea. Non-fataal: zonder clusters gewoon door.
python3 - "$CACHE" <<'PYEOF'
import json, sys, urllib.request
from datetime import datetime, timedelta

cache = sys.argv[1]
BASE = "https://data.weerlab.nl/"
LABELS = {"int1": "dag 3-4 (72-96h)", "int2": "dag 5-7 (120-168h)", "int3": "dag 8-10 (192-240h)"}

def haal(pad):
    # R2/Cloudflare blokkeert de standaard Python-urllib User-Agent (403)
    req = urllib.request.Request(BASE + pad, headers={"User-Agent": "Mozilla/5.0 (weerlab-guidance)"})
    return urllib.request.urlopen(req, timeout=60)

try:
    with haal("cluster_z500_meta.json") as r:
        meta = json.load(r)
    if datetime.now() - datetime.fromisoformat(meta["bijgewerkt"]) > timedelta(hours=24):
        raise ValueError(f"clusterdata verouderd ({meta['bijgewerkt']})")
    regels = [f"ENS-clusterrun: {meta['run']}"]
    for key, bestand in meta["bestanden"].items():
        with haal(bestand) as r:
            open(f"{cache}/guidance_cluster_{key}.png", "wb").write(r.read())
        telling = {}
        for lid in meta["leden"].get(key, []):
            telling[lid] = telling.get(lid, 0) + 1
        verdeling = ", ".join(f"cluster {c}: {n} leden" for c, n in sorted(telling.items()))
        regels.append(f"- guidance_cluster_{key}.png — {LABELS.get(key, key)} — ledenverdeling: {verdeling}")
    open(f"{cache}/cluster_sectie.txt", "w").write("\n".join(regels) + "\n")
    print(f"Clusters: {len(meta['bestanden'])} kaarten (run {meta['run']})")
except Exception as e:
    import os
    for key in LABELS:
        try: os.remove(f"{cache}/guidance_cluster_{key}.png")
        except FileNotFoundError: pass
    try: os.remove(f"{cache}/cluster_sectie.txt")
    except FileNotFoundError: pass
    print(f"WAARSCHUWING: clusterkaarten niet beschikbaar ({e})")
PYEOF

# ------------------------------------------------- 2. ECMWF-frames + manifest
# Kiest nieuwste wxbeta-run en zoekt per dag (vandaag..+4) het 12 UTC-frame.
python3 - "$WEERLAB" "$CACHE" <<'PYEOF'
import json, os, shutil, sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

weerlab, cache = sys.argv[1], sys.argv[2]
for f in os.listdir(cache):
    if f.startswith("guidance_ecmwf_d") and f.endswith(".png"):
        os.remove(os.path.join(cache, f))
meta = json.load(open(os.path.join(weerlab, "wxbeta_meta.json")))
runs = [run for cycle, run in meta["data"]["ecmwf"]["runs"].items()
        if cycle in ("00", "12")]
if not runs:
    sys.exit("FOUT: geen ECMWF HRES-runs (00/12 UTC) in wxbeta-meta")

best = max(runs, key=lambda r: r["run_utc"])
run_dt = datetime.fromisoformat(best["run_utc"])
cycle = best["cycle"]

# wxbeta bewaart 00 en 12 UTC naast elkaar. De max() hierboven kiest dus
# altijd de nieuwste werkelijk beschikbare HRES-run. Een stilgevallen
# kaartpijplijn mag echter niet ongemerkt met een oude run publiceren.
run_age = (datetime.now(timezone.utc) - run_dt).total_seconds() / 3600
if run_age > 20:
    sys.exit(
        f"FOUT: nieuwste ECMWF-run in wxbeta is {run_age:.1f} uur oud "
        "— oude guidance blijft staan"
    )

DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"]
MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli",
           "augustus", "september", "oktober", "november", "december"]

# De dagindeling is Nederlands. Zo verdwijnt de verstreken dag direct na
# lokale middernacht, ook wanneer het in UTC nog de vorige kalenderdag is.
today = datetime.now(ZoneInfo("Europe/Amsterdam")).date()
days, ecmwf_charts, ecmwf_extra = [], [], []
for i in [0, 1, 2, 3, 4, 5, 6, 8, 9]:
    d = today + timedelta(days=i)
    valid = datetime(d.year, d.month, d.day, 12, tzinfo=timezone.utc)
    lead = int((valid - run_dt).total_seconds() // 3600)
    label = f"{DAGEN[d.weekday()]} {d.day} {MAANDEN[d.month - 1]}"
    if i < 6:
        days.append({"date": d.isoformat(), "label": label})
    if lead < 6 or lead > best["maxlead"] or lead % 6:
        continue
    src = os.path.join(weerlab, "wxbeta", f"{cycle}z", f"wxbeta_overview_{lead // 6:02d}.png")
    if not os.path.isfile(src):
        continue
    dst = f"guidance_ecmwf_d{i}.png"
    shutil.copyfile(src, os.path.join(cache, dst))
    kaart = {"day": i, "lead": lead, "file": dst, "valid_label": f"{label} 12 UTC"}
    (ecmwf_charts if i < 6 else ecmwf_extra).append(kaart)

if len(ecmwf_charts) != 6:
    sys.exit(f"FOUT: {len(ecmwf_charts)} van 6 ECMWF-dagframes gevonden voor run {best['run_utc']}")

manifest = {
    "ecmwf_run_utc": best["run_utc"],
    "ecmwf_run_label": best["run_label"],
    "days": days,
    "ecmwf_charts": ecmwf_charts,
    "ecmwf_extra": ecmwf_extra,
}
json.dump(manifest, open(os.path.join(cache, "manifest.json"), "w"), ensure_ascii=False, indent=1)
print(f"ECMWF: {len(ecmwf_charts)} frames uit run {best['run_label']}")
PYEOF

# ------------------- 2b. Drukcentra en Nederlands dagweer machinaal berekenen
# Kernposities plus negen Nederlandse modelpunten uit het ECMWF-veld zelf.
# Beide AI-passes gebruiken dit als waarheid voor positie, temperatuur,
# neerslag, bewolking, wind en CAPE.
if ! python3 "$SHELL_DIR/guidance_pressure_facts.py" "$CACHE"; then
  echo "FOUT: ECMWF-feitenblok mislukt — oude guidance blijft staan" >&2
  rm -f "$CACHE/drukcentra_feiten.txt"
  exit 1
fi
if ! grep -q '^# ECMWF-DAGFEITEN NEDERLAND' "$CACHE/drukcentra_feiten.txt"; then
  echo "FOUT: Nederlandse ECMWF-dagfeiten ontbreken — oude guidance blijft staan" >&2
  exit 1
fi
# ------------------------------------------------------- 3. Prompt samenstellen
python3 - "$SHELL_DIR" "$CACHE" "$WEERLAB" <<'PYEOF'
import json, os, re, sys
from datetime import datetime, timedelta
shell_dir, cache, weerlab = sys.argv[1], sys.argv[2], sys.argv[3]
man = json.load(open(os.path.join(cache, "manifest.json")))
prompt = open(os.path.join(shell_dir, "guidance_prompt.md")).read()

# KNMI-weerkaarten (indien opgehaald) eenmaal inlezen; ook voor de context-regel.
kc = None
knmi_pad = os.path.join(cache, "knmi_charts.json")
if os.path.isfile(knmi_pad):
    try:
        kc = json.load(open(knmi_pad))
    except Exception:
        kc = None

# --- Context van deze run: hoofdupdate (verse ECMWF) of tussenupdate? ---
dagdelen = ("nacht", "ochtend", "middag", "avond")
_h = datetime.now().hour
dagdeel = dagdelen[0 if 3 <= _h <= 7 else 1 if 8 <= _h <= 12 else 2 if 13 <= _h <= 17 else 3]
try:
    vorige_run = json.load(open(os.path.join(cache, "ecmwf_guidance.json"))).get("ecmwf_run_utc")
except Exception:
    vorige_run = None
verse_ecmwf = man["ecmwf_run_utc"] != vorige_run

ctx = ["# CONTEXT VAN DEZE RUN", ""]
if verse_ecmwf:
    ctx.append(f"Dit is een HOOFDUPDATE op een verse ECMWF HRES-run ({man['ecmwf_run_label']}). "
               "Bouw het beeld volledig opnieuw op vanaf de kaarten.")
else:
    ctx.append(f"Dit is een TUSSENUPDATE (dagdeel: {dagdeel}). De ECMWF HRES-run is dezelfde als in "
               f"de vorige guidance ({man['ecmwf_run_label']}); wél vers zijn de KNMI-weerkaarten "
               "(HARMONIE-analyse), de Bracknell-fronten en de KNMI/DWD-guidance. Leg het accent op "
               "de korte termijn: verwerk de nieuwste analyse en frontligging in de dagen van vandaag "
               "en morgen. De meerdaagse lijn hoeft niet te wijzigen tenzij de verse kaarten daar "
               "aanleiding toe geven.")
if kc and kc.get("analysis_utc"):
    ctx.append(f"Nieuwste KNMI/HARMONIE-analyse: {kc['analysis_utc'][:16].replace('T', ' ')} UTC.")

lines = ["", *ctx, "", "# KAARTEN"]

# KNMI-weerkaarten eerst: gezaghebbend voor de Nederlandse fronten op korte termijn.
if kc and kc.get("charts"):
    lines += ["", "## KNMI-weerkaarten (grondkaarten met fronten; HARMONIE-analyse + ECMWF-prognose)",
              "Gezaghebbende Nederlandse frontenanalyse voor de korte termijn (analyse t/m +36 uur). "
              "Bij verschil met Bracknell is deze voor Nederland leidend voor frontligging en -timing."]
    for c in kc["charts"]:
        lines.append(f"- {os.path.join(cache, c['file'])} — {c['valid_label']}")

lines += ["", "## Bracknell-faxkaarten (UKMO, fronten; breder Europa, tot +120u)"]
for f in sorted(os.listdir(cache)):
    m = re.match(r"guidance_brack_(\d+)\.png$", f)
    if m:
        lead = int(m.group(1))
        soort = "analyse" if lead == 0 else f"verwachting T+{lead}u"
        lines.append(f"- {os.path.join(cache, f)} — {soort} (geldigheid staat op de kaart zelf, linksboven)")

lines += ["", f"## ECMWF HRES overzichtskaarten (run {man['ecmwf_run_label']})"]
for c in man["ecmwf_charts"]:
    lines.append(f"- {os.path.join(cache, c['file'])} — geldig {c['valid_label']}")

if man.get("ecmwf_extra"):
    lines += ["", "## ECMWF HRES doorkijk (voor de vooruitzichten-alinea)"]
    for c in man["ecmwf_extra"]:
        lines.append(f"- {os.path.join(cache, c['file'])} — geldig {c['valid_label']}")

cluster_pad = os.path.join(cache, "cluster_sectie.txt")
if os.path.isfile(cluster_pad):
    lines += ["", "## ENS-clusterkaarten z500 (51 leden, voor de vooruitzichten-alinea)",
              "Elke kaart toont de clusters van het ensemble voor dat tijdvak; de",
              "ledenverdeling zegt hoeveel steun elk scenario heeft."]
    for regel in open(cluster_pad).read().strip().split("\n"):
        if regel.startswith("- guidance_cluster_"):
            naam, rest = regel[2:].split(" — ", 1)
            lines.append(f"- {os.path.join(cache, naam)} — {rest}")
        else:
            lines.append(regel)

lines += ["", "## Dagen voor het days-array (exact deze datums en labels gebruiken)"]
for d in man["days"]:
    lines.append(f"- {d['date']} — {d['label']}")

# drukcentra-feitenblok (indien berekend) hoort bij de kaartsectie
feiten_pad = os.path.join(cache, "drukcentra_feiten.txt")
if os.path.isfile(feiten_pad):
    lines += ["", open(feiten_pad).read().rstrip()]

# kaarten+dagen+feiten apart bewaren: de verificatie-pass gebruikt dezelfde sectie
open(os.path.join(cache, "kaarten_sectie.txt"), "w").write("\n".join(lines) + "\n")

# KNMI-guidance (kort + meerdaags) als referentietekst, alleen als vers genoeg
try:
    kg = json.load(open(os.path.join(weerlab, "guidance.json")))
    opgehaald = datetime.fromisoformat(kg["bijgewerkt"])
    if datetime.now() - opgehaald < timedelta(hours=36):
        lines += ["", "# KNMI-GUIDANCE (referentie, zie werkwijze stap 3)",
                  f"Opgehaald: {kg['bijgewerkt'][:16]}"]
        for key, kop in (("kort", "Guidance modelbeoordeling (tot +48 uur)"),
                         ("lang", "Guidance meerdaagse")):
            g = kg.get(key) or {}
            tekst = (g.get("tekst") or "").strip()
            if tekst:
                lines += ["", f"## {kop}", g.get("geldig") or "", tekst[:5000]]
    else:
        print(f"KNMI-guidance ouder dan 36 uur ({kg['bijgewerkt'][:16]}) — niet meegenomen")
except Exception as e:
    print(f"KNMI-guidance niet beschikbaar als referentie: {e}")

# DWD-guidance (synoptische beoordeling DWD-meteoroloog, Duitstalig origineel)
try:
    dg = json.load(open(os.path.join(weerlab, "dwd_guidance.json")))
    opgehaald = datetime.fromisoformat(dg["bijgewerkt"])
    if datetime.now() - opgehaald < timedelta(hours=36):
        lines += ["", "# DWD-GUIDANCE (referentie, zie werkwijze stap 3; Duitstalig, focus Duitsland)",
                  f"Opgehaald: {dg['bijgewerkt'][:16]}"]
        for key, kop in (("kurzfrist", "Synoptische Übersicht Kurzfrist"),
                         ("mittelfrist", "Synoptische Übersicht Mittelfrist")):
            g = dg.get(key) or {}
            tekst = (g.get("original") or "").strip()
            if tekst:
                lines += ["", f"## {kop}", f"Uitgifte: {g.get('issuedAt') or '?'}", tekst[:5000]]
    else:
        print(f"DWD-guidance ouder dan 36 uur ({dg['bijgewerkt'][:16]}) — niet meegenomen")
except Exception as e:
    print(f"DWD-guidance niet beschikbaar als referentie: {e}")

open(os.path.join(cache, "prompt_full.txt"), "w").write(prompt + "\n".join(lines) + "\n")
print("Prompt samengesteld")
PYEOF

# ------------------------------------------------------------ 4. Claude headless
if [ "$DRY_RUN" = "1" ]; then
  echo "DRY-RUN: prompt staat in $CACHE/prompt_full.txt — stop vóór claude/upload"
  exit 0
fi
echo "claude -p concept (model: $CLAUDE_MODEL) ..."
run_text_model() {
  local prompt_file="$1" output_file="$2" fase="$3"
  if "$CLAUDE_BIN" -p "$(cat "$prompt_file")" \
      --model "$CLAUDE_MODEL" \
      --allowedTools "Read" \
      --max-turns 40 \
      --output-format text > "$output_file"; then
    if ! grep -qiE 'credit balance is too low|hit your limit|usage limit' "$output_file"; then
      return 0
    fi
  fi

  echo "WAARSCHUWING: Claude niet beschikbaar voor $fase — probeer Codex read-only" >&2
  if [ -x "$CODEX_BIN" ] && "$CODEX_BIN" exec \
      --ignore-user-config --ignore-rules --ephemeral \
      --sandbox read-only --skip-git-repo-check \
      -c 'model_reasoning_effort="high"' \
      -C "$CACHE" - < "$prompt_file" > "$output_file"; then
    return 0
  fi
  return 1
}

if ! run_text_model "$CACHE/prompt_full.txt" "$CACHE/raw_out.txt" "concept"; then
  echo "FOUT: conceptgeneratie mislukt — oude guidance blijft staan" >&2
  exit 1
fi

# ------------------------------------------- 4b. Verificatie-pass (2e claude)
# Aparte controleur legt het concept zin voor zin naast de kaarten en
# corrigeert feitelijke fouten (kernposities, trekrichtingen, bewolking...).
python3 - "$SHELL_DIR" "$CACHE" <<'PYEOF'
import json, os, re, sys
shell_dir, cache = sys.argv[1], sys.argv[2]
raw = open(os.path.join(cache, "raw_out.txt")).read()
if "Not logged in" in raw:
    sys.exit("FOUT: claude CLI niet ingelogd — draai eenmalig 'claude /login' in een terminal")
if "hit your limit" in raw or "usage limit" in raw.lower() or "credit balance is too low" in raw.lower():
    sys.exit(f"FOUT: opus-gebruikslimiet bereikt ({raw.strip()[:80]}) — oude guidance blijft staan")
m = re.search(r'\{\s*"intro"', raw)
start = m.start() if m else raw.find("{")
end = raw.rfind("}")
if start < 0 or end <= start:
    sys.exit("FOUT: geen JSON in concept-uitvoer")
concept = json.loads(raw[start:end + 1])
for key in ("intro", "days", "aandachtspunten"):
    if not concept.get(key):
        sys.exit(f"FOUT: veld '{key}' ontbreekt in concept")

verify = open(os.path.join(shell_dir, "guidance_verify_prompt.md")).read()
kaarten = open(os.path.join(cache, "kaarten_sectie.txt")).read()
prompt = (verify + "\n" + kaarten + "\n# CONCEPT\n\n"
          + json.dumps(concept, ensure_ascii=False, indent=1) + "\n")
open(os.path.join(cache, "verify_prompt_full.txt"), "w").write(prompt)
print("Concept ok — verificatie-prompt samengesteld")
PYEOF

echo "claude -p verificatie (model: $CLAUDE_MODEL) ..."
if ! run_text_model "$CACHE/verify_prompt_full.txt" "$CACHE/raw_verified.txt" "verificatie"; then
  echo "FOUT: verificatiegeneratie mislukt — oude guidance blijft staan" >&2
  exit 1
fi

# ----------------------------------------------- 5. Valideren + JSON assembleren
python3 - "$CACHE" <<'PYEOF'
import json, os, sys
from datetime import datetime, timezone

cache = sys.argv[1]
raw = open(os.path.join(cache, "raw_verified.txt")).read()
if "Not logged in" in raw:
    sys.exit("FOUT: claude CLI niet ingelogd — draai eenmalig 'claude /login' in een terminal")
if "hit your limit" in raw or "usage limit" in raw.lower() or "credit balance is too low" in raw.lower():
    sys.exit(f"FOUT: opus-gebruikslimiet bereikt ({raw.strip()[:80]}) — oude guidance blijft staan")
# anker op '"intro"' zodat eventuele denktekst met accolades ervoor niet meetelt
import re as _re
m = _re.search(r'\{\s*"intro"', raw)
start = m.start() if m else raw.find("{")
end = raw.rfind("}")
if start < 0 or end <= start:
    sys.exit("FOUT: geen JSON in verificatie-uitvoer")
gd = json.loads(raw[start:end + 1])
correcties = gd.pop("correcties", None)
if correcties:
    print(f"Verificatie-pass: {len(correcties)} correctie(s):")
    for c in correcties:
        print(f"  - {c}")
else:
    print("Verificatie-pass: geen correcties")

for key in ("intro", "days", "vooruitzichten", "aandachtspunten"):
    if not gd.get(key):
        sys.exit(f"FOUT: veld '{key}' ontbreekt of is leeg")
if len(gd["days"]) != 6 or any(not d.get("synoptiek") or not d.get("weertype") for d in gd["days"]):
    sys.exit("FOUT: days-array onvolledig (synoptiek/weertype per dag vereist)")

man = json.load(open(os.path.join(cache, "manifest.json")))
for i, (md, d) in enumerate(zip(man["days"], gd["days"])):
    if d.get("date") != md["date"]:
        sys.exit(f"FOUT: datum van dag {i + 1} klopt niet")

# Harde eindredactie: te lange of automatisch klinkende tekst wordt niet gepubliceerd.
def woorden(s):
    return len(str(s).split())

def zinnen(s):
    import re
    return len([p for p in re.split(r"(?<=[.!?])\s+", str(s).strip()) if p])

limieten = [
    ("intro", gd["intro"], 100),
    ("vooruitzichten", gd["vooruitzichten"], 180),
    ("aandachtspunten", gd["aandachtspunten"], 120),
]
for i, d in enumerate(gd["days"], 1):
    limieten += [(f"synoptiek dag {i}", d["synoptiek"], 110),
                 (f"weertype dag {i}", d["weertype"], 75)]
for naam, tekst, maximum in limieten:
    if woorden(tekst) > maximum:
        sys.exit(f"FOUT: {naam} is te lang ({woorden(tekst)} woorden; maximaal {maximum})")
if not 1 <= zinnen(gd["intro"]) <= 3:
    sys.exit("FOUT: intro moet uit maximaal drie zinnen bestaan")
for i, d in enumerate(gd["days"], 1):
    if zinnen(d["synoptiek"]) != 2:
        sys.exit(f"FOUT: synoptiek dag {i} moet uit exact twee zinnen bestaan")
    if not 1 <= zinnen(d["weertype"]) <= 2:
        sys.exit(f"FOUT: weertype dag {i} moet uit maximaal twee zinnen bestaan")
alle_tekst = " ".join([gd["intro"], gd["vooruitzichten"], gd["aandachtspunten"]]
                       + [d[k] for d in gd["days"] for k in ("synoptiek", "weertype")]).lower()
verboden = ("alle bronnen", "alle modellen", "eensluidend", "staat vast",
            "trogje", "zonverlies", "voorspelling")
gevonden = [term for term in verboden if term in alle_tekst]
if gevonden:
    sys.exit("FOUT: ongewenste formulering(en): " + ", ".join(gevonden))

brack = []
for f in sorted(os.listdir(cache)):
    if f.startswith("guidance_brack_") and f.endswith(".png"):
        lead = int(f.split("_")[2].split(".")[0])
        # De Wetterzentrale-bestandsstap is niet altijd de kalendergeldigheid:
        # kaarten met verschillende UKMO-runs staan tegelijk online. Zonder
        # machineleesbare geldigheidsdatum dus niet aan een dag koppelen.
        brack.append({"lead": lead, "file": f})
brack.sort(key=lambda b: b["lead"])

# KNMI-weerkaarten (indien opgehaald) meenemen in de uitvoer
knmi_charts = []
try:
    knmi_charts = json.load(open(os.path.join(cache, "knmi_charts.json"))).get("charts", [])
except Exception:
    knmi_charts = []

# slot_id: welk dagdeel deze update hoort (moet gelijk zijn aan de slot-skip)
def _slot(now):
    h = now.hour
    naam = ("nacht" if 3 <= h <= 7 else "ochtend" if 8 <= h <= 12
            else "middag" if 13 <= h <= 17 else "avond")
    return f"{now.date().isoformat()}/{naam}"

out = {
    "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "slot_id": _slot(datetime.now()),
    "ecmwf_run_utc": man["ecmwf_run_utc"],
    "ecmwf_run_label": man["ecmwf_run_label"],
    "intro": gd["intro"],
    "days": [dict(md, synoptiek=cd["synoptiek"], weertype=cd["weertype"])
             for md, cd in zip(man["days"], gd["days"])],
    "vooruitzichten": gd["vooruitzichten"],
    "aandachtspunten": gd["aandachtspunten"],
    "knmi_charts": knmi_charts,
    "brack_charts": brack,
    "ecmwf_charts": man["ecmwf_charts"] + man.get("ecmwf_extra", []),
    "cluster_charts": sorted(f for f in os.listdir(cache)
                             if f.startswith("guidance_cluster_") and f.endswith(".png")),
}
# let op: 'guidance.json' is al bezet door de KNMI-modelbeoordeling (haal_guidance.py)
tmp = os.path.join(cache, "ecmwf_guidance.json.tmp")
json.dump(out, open(tmp, "w"), ensure_ascii=False, indent=1)
os.replace(tmp, os.path.join(cache, "ecmwf_guidance.json"))
print("ecmwf_guidance.json geschreven")
PYEOF

# ------------------------------------------------------------------- 6. Upload
uploads=("$CACHE/ecmwf_guidance.json")
for f in "$CACHE"/guidance_knmi_*.gif "$CACHE"/guidance_brack_*.png "$CACHE"/guidance_ecmwf_d*.png "$CACHE"/guidance_cluster_*.png; do
  [ -f "$f" ] && uploads+=("$f")
done
"$SHELL_DIR/r2_publish.sh" "${uploads[@]}"

echo "[$(date '+%F %T')] guidance_update klaar"
