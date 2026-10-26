#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Neerslagaccumulatie (KNMI-radar) — wrapper voor nl.edaldus.accumulatie.plist
# Elke 5 minuten: nieuwe RTCOR-bestanden (+ herkansing ontbrekende), RTCOR
# dag-tars (vullen gaten, ~10 UTC), RFCOR (finaal, ~2 weken later; vervangt
# realtime automatisch), blokken/presets/index, kaartarchief.
# Wekelijks: validatie tegen regenmeters (accumulatie/valideer.py).
#
# Ook de aparte laag "radar bijgesteld met regenmeters" (accumulatie/bijgesteld.py,
# eigen archief ~/Library/Application Support/weerlab/accumulatie_bijgesteld,
# R2-prefix accumulatie-bijgesteld/).
# Uploaden naar R2 (data.weerlab.nl/accumulatie/) alleen met ACCU_R2=1 —
# zolang de module bèta is staat dat uit; de wachtrij blijft bewaard en gaat
# bij de eerste run met ACCU_R2=1 in één keer mee.
# Data: ~/Library/Application Support/weerlab/accumulatie
# ═══════════════════════════════════════════════════════════════════════════
set -o pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
ulimit -n 4096 2>/dev/null || true
cd "/Users/aldus/KNMI_Project/weerlab"
LOG=logs/accumulatie.log
if [ -f "$LOG" ] && [ "$(stat -f %z "$LOG")" -gt 5000000 ]; then mv "$LOG" "$LOG.1"; fi
exec >> "$LOG" 2>&1

echo "── accumulatie $(date '+%Y-%m-%d %H:%M:%S') ──"
R2=""
[ "${ACCU_R2:-0}" = "1" ] && R2="--r2"
/usr/local/bin/python3 -u -m accumulatie.verwerk alles $R2 || echo "FOUT: verwerk faalde ($?)"

VAL="$HOME/Library/Application Support/weerlab/accumulatie/pub/validatie/validatie.json"
if [ ! -f "$VAL" ] || [ -n "$(find "$VAL" -mtime +7 2>/dev/null)" ]; then
  echo "Validatie bijwerken…"
  /usr/local/bin/python3 -u -m accumulatie.valideer || echo "FOUT: validatie faalde ($?)"
  echo "Leave-one-out bijstelling bijwerken…"
  /usr/local/bin/python3 -u -m accumulatie.bijstel_validatie --opnieuw || echo "FOUT: leave-one-out faalde ($?)"
fi
