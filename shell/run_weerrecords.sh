#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Weerrecords daily run — wrapper voor nl.edaldus.weerrecords.plist
# Genereert records_*.json en uploadt naar R2 (data.weerlab.nl).
# Wordt 3× per ochtend gedraaid (05/06/07) om late KNMI-publicatie op te vangen.
# ═══════════════════════════════════════════════════════════════════════════
set -e
cd "/Users/aldus/KNMI_Project/weerlab"

LOG_TS="$(date '+%Y-%m-%d %H:%M')"
echo "════════════════════════════════════════════════════"
echo "  Weerrecords run — ${LOG_TS}"
echo "════════════════════════════════════════════════════"

/usr/local/bin/python3 -u scripts/knmi_records.py

echo ""
echo "Publiceren naar R2…"
shell/r2_publish.sh records_*.json

echo ""
echo "Publiceren naar git/Pages (extremenzoeker leest records_*.json relatief)…"
# records_*.json wordt door extremen.html via relatieve URL geladen → Pages/git.
# R2-upload hierboven is voor data.weerlab.nl-consumers; de site zelf heeft git nodig.
shell/git_publish.sh "data: weerrecords daily run $(date '+%Y-%m-%d %H:%M')" records_*.json

echo "Klaar — $(date '+%Y-%m-%d %H:%M')"
