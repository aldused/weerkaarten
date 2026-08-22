#!/bin/bash
set -euo pipefail

ROOT="/Users/aldus/KNMI_Project/weerlab"
LOG="$ROOT/arome_fr_out.log"
LOCKDIR="/tmp/weerlab-arome-fr.lock"

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  echo "$(date): AROME FR al bezig, skip." >> "$LOG"
  exit 0
fi

cleanup() { rmdir "$LOCKDIR" 2>/dev/null || true; }
trap cleanup EXIT

echo "$(date): === AROME France update ===" >> "$LOG"
/usr/local/bin/python3 "$ROOT/scripts/arome_fr_update.py" \
  --days 3 --grid-step 0.1 >> "$LOG" 2>&1
echo "$(date): === AROME France klaar ===" >> "$LOG"
