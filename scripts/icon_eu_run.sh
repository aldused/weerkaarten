#!/bin/bash
set -euo pipefail

ROOT="/Users/aldus/KNMI_Project/weerlab"
LOG="$ROOT/icon_eu_out.log"
LOCKDIR="/tmp/weerlab-icon-eu.lock"

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  echo "$(date): ICON-EU al bezig, skip." >> "$LOG"
  exit 0
fi

cleanup() { rmdir "$LOCKDIR" 2>/dev/null || true; }
trap cleanup EXIT

echo "$(date): === ICON-EU update ===" >> "$LOG"
/usr/local/bin/python3 "$ROOT/scripts/icon_eu_update.py" \
  --days 5 --max-steps 120 --grid-step 0.15 >> "$LOG" 2>&1
echo "$(date): === ICON-EU klaar ===" >> "$LOG"
