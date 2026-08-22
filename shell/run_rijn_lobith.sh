#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Rijn/Lobith afvoer — 3-uurlijkse update, wrapper voor nl.edaldus.rijn-lobith.plist
# Haalt actuele + 60-daagse afvoer (grootheid Q) bij Lobith (Bovenrijn, Tolkamer)
# uit de RWS WaterWebservices (DDAPI 2.0) → rijn_lobith.json, en publiceert naar
# R2 (data.weerlab.nl). R2-only (geen git-churn bij 3-uurlijkse updates);
# demo_rijn_lobith.html leest data.weerlab.nl/rijn_lobith.json (localhost→lokaal).
# ═══════════════════════════════════════════════════════════════════════════
set -e
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "/Users/aldus/KNMI_Project/weerlab"

LOG_TS="$(date '+%Y-%m-%d %H:%M')"
echo "════════════════════════════════════════════════════"
echo "  Rijn/Lobith afvoer run — ${LOG_TS}"
echo "════════════════════════════════════════════════════"

/usr/local/bin/python3 -u scripts/rijn_lobith_update.py

echo ""
echo "Publiceren naar R2 (data.weerlab.nl/rijn_lobith.json)…"
shell/r2_publish.sh rijn_lobith.json

echo "Klaar — $(date '+%Y-%m-%d %H:%M')"
