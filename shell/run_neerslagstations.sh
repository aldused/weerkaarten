#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# KNMI-neerslagstations — wrapper voor nl.edaldus.neerslagstations.plist
# Haalt de voorlopige 24-uurssommen (KNMI Data Platform, ~18:37 UT per dag)
# en de gevalideerde MONV-reeks op → neerslagstations.json, en publiceert
# naar R2 (data.weerlab.nl). R2-only: beta_neerslagstations.html leest
# https://data.weerlab.nl/neerslagstations.json (localhost → lokaal bestand).
#
# Tijden (lokaal): 07:00 en 19:00 (vaste verversmomenten) plus 19:50, 20:50
# en 22:30 om het KNMI-dagbestand direct na publicatie mee te nemen
# (18:37 UT = 19:37 wintertijd / 20:37 zomertijd).
# ═══════════════════════════════════════════════════════════════════════════
set -eo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
ulimit -n 4096 2>/dev/null || true
cd "/Users/aldus/KNMI_Project/weerlab"

echo "════════════════════════════════════════════════════"
echo "  Neerslagstations run — $(date '+%Y-%m-%d %H:%M')"
echo "════════════════════════════════════════════════════"

/usr/local/bin/python3 -u scripts/neerslagstations_update.py

echo "Publiceren naar R2 (data.weerlab.nl/neerslagstations.json)…"
R2_CACHE_CONTROL="public, max-age=120" shell/r2_publish.sh neerslagstations.json

# 07:00-run: archief van vorig jaar bijwerken zolang het nog niet volledig
# gevalideerd is (MONV loopt ~1 maand achter). Mislukken stopt de dagrun niet.
if [ "$(date +%H)" = "07" ]; then
  /usr/local/bin/python3 -u scripts/neerslagstations_archief.py --bij --publiceer \
    || echo "Let op: archief vorig jaar niet bijgewerkt (volgende 07:00-run opnieuw)"
fi

echo "Klaar — $(date '+%Y-%m-%d %H:%M')"
