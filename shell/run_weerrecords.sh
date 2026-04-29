#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Weerrecords daily run — wrapper voor nl.edaldus.weerrecords.plist
# Genereert records_*.json en pusht direct naar GitHub Pages.
# Wordt 3× per ochtend gedraaid (05/06/07) om late KNMI-publicatie op te vangen;
# git_publish.sh skipt automatisch als er niets veranderd is.
# ═══════════════════════════════════════════════════════════════════════════
set -e
cd "/Users/aldus/KNMI_Project/weerlab"

LOG_TS="$(date '+%Y-%m-%d %H:%M')"
echo "════════════════════════════════════════════════════"
echo "  Weerrecords run — ${LOG_TS}"
echo "════════════════════════════════════════════════════"

/usr/local/bin/python3 -u scripts/knmi_records.py

echo ""
echo "Publiceren naar git…"
shell/git_publish.sh "Weerrecords auto-update ${LOG_TS}" records_*.json

echo "Klaar — $(date '+%Y-%m-%d %H:%M')"
