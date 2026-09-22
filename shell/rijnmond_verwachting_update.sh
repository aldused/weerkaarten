#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Regioverwachting Rijnmond / Zuid-Holland Zuid — wrapper voor
# nl.edaldus.rijnmond-verwachting.plist (elke 30 minuten).
#
# scripts/rijnmond_verwachting.py inventariseert bij elke aanroep welke
# modellen en runs Weerlab heeft; zonder nieuwe runs (en binnen drie uur) slaat
# hij over. Is er een nieuwe rijnmond_verwachting.json, dan gaat die naar R2
# (data.weerlab.nl); demo_rijnmond_verwachting.html leest hem daar
# (localhost → lokaal bestand).
#
# Taalredactie: standaard uit (regelgebaseerde tekst). Aanzetten met
#   RIJNMOND_REDACTIE=claude in de plist (EnvironmentVariables); vereist een
#   ingelogde claude CLI ('claude /login' of 'claude setup-token').
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "/Users/aldus/KNMI_Project/weerlab"

STAMP="/Users/aldus/KNMI_Project/rijnmond_cache/laatste_upload"
REDACTIE="${RIJNMOND_REDACTIE:-uit}"
mkdir -p "$(dirname "$STAMP")"

echo "[$(date '+%F %T')] rijnmond_verwachting start (redactie: $REDACTIE)"
/usr/local/bin/python3 -u scripts/rijnmond_verwachting.py --redactie "$REDACTIE" "$@"

if [ ! -f "$STAMP" ] || [ rijnmond_verwachting.json -nt "$STAMP" ]; then
  R2_CACHE_CONTROL="public, max-age=60" shell/r2_publish.sh rijnmond_verwachting.json
  touch "$STAMP"
fi
echo "[$(date '+%F %T')] klaar"
