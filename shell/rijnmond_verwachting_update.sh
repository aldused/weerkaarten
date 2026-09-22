#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Regioverwachting Rijnmond / Zuid-Holland Zuid — wrapper voor
# nl.edaldus.rijnmond-verwachting.plist (8 uitgiften per dag: 01, 04, 07, 10,
# 13, 16, 19 en 22 uur, met een inhaalpoging om :20).
#
# scripts/rijnmond_verwachting.py inventariseert bij elke aanroep welke
# modellen en runs Weerlab heeft en geeft per moment één verwachting uit; de
# inhaalpoging slaat over als dat al lukte. De nieuwe rijnmond_verwachting.json
# gaat daarna naar R2
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
/usr/local/bin/python3 -u scripts/rijnmond_verwachting.py --slot --redactie "$REDACTIE" "$@"

if [ ! -f "$STAMP" ] || [ rijnmond_verwachting.json -nt "$STAMP" ]; then
  R2_CACHE_CONTROL="public, max-age=60" shell/r2_publish.sh rijnmond_verwachting.json
  touch "$STAMP"
fi
echo "[$(date '+%F %T')] klaar"
