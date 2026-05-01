#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Maanddata refresh — voedt maandoverzicht.html via maanddata_*.json op R2.
# Wordt 3× gedraaid (09/12/15) om gisteren's EDR-data zo vroeg mogelijk live
# te krijgen. EDR heeft ~10u lag na 00:00 UTC, dus 12:00 lokaal is de
# eerste betrouwbare slot; 09:00 is een vroege poging, 15:00 fallback.
# ═══════════════════════════════════════════════════════════════════════════
set -e
cd "/Users/aldus/KNMI_Project/weerlab"

LOG_TS="$(date '+%Y-%m-%d %H:%M')"
echo "════════════════════════════════════════════════════"
echo "  Maanddata refresh — ${LOG_TS}"
echo "════════════════════════════════════════════════════"

/usr/local/bin/python3 -u scripts/haal_maanddata.py

echo ""
echo "Uploaden naar R2…"
shell/r2_publish.sh maanddata_*.json

echo ""
echo "Publiceren naar GitHub Pages (= weerlab.nl/maanddata_*.json bron)…"
shell/git_publish.sh "maanddata: voorlopige EDR/10-min data t/m gisteren" maanddata_*.json

echo "Klaar — $(date '+%Y-%m-%d %H:%M')"
