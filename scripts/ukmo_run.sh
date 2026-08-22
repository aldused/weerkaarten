#!/bin/bash
set -euo pipefail

ROOT="/Users/aldus/KNMI_Project/weerlab"
LOG="$ROOT/ukmo_out.log"
LOCKDIR="/tmp/weerlab-ukmo.lock"

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  echo "$(date): UKMO al bezig, skip." >> "$LOG"
  exit 0
fi

cleanup() { rmdir "$LOCKDIR" 2>/dev/null || true; }
trap cleanup EXIT

echo "$(date): === UKMO update ===" >> "$LOG"
/usr/local/bin/python3 "$ROOT/scripts/ukmo_update.py" \
  --days 5 --max-steps 120 --grid-step 0.15 >> "$LOG" 2>&1
echo "$(date): === UKMO klaar ===" >> "$LOG"
