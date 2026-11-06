#!/bin/bash
# Wereldweer-nieuwsstroom — wrapper voor nl.edaldus.wereldweer-stroom.plist (elke 5 minuten).
# Ophalen per bron op eigen interval (5–180 min); modelrondes (triage Haiku + redactie Sonnet) elke 15 min
# overdag, elk uur 's nachts (instelbaar in data/wereldweer/beheer.json). Vooruitblik: alleen bij een nieuwe ECMWF-run.
# Log: ../logs/wereldweer_stroom.log
set -o pipefail
# launchd heeft een kale PATH: python3 (eccodes/cartopy) in /usr/local/bin, claude/node/rclone in homebrew
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
ulimit -n 4096 2>/dev/null || true
cd "/Users/aldus/KNMI_Project/weerlab" || exit 1
python3 scripts/wereldweer_vooruitblik.py >> ../logs/wereldweer_stroom.log 2>&1 || echo "$(date '+%F %T') vooruitblik faalde" >> ../logs/wereldweer_stroom.log
exec python3 scripts/wereldweer_stroom.py "$@"
