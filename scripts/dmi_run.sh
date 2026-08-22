#!/bin/bash
set -euo pipefail

ROOT="/Users/aldus/KNMI_Project/weerlab"
LOG="$ROOT/dmi_out.log"
LOCKDIR="/tmp/weerlab-dmi.lock"

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  echo "$(date): DMI al bezig, skip." >> "$LOG"
  exit 0
fi

cleanup() { rmdir "$LOCKDIR" 2>/dev/null || true; }
trap cleanup EXIT

echo "$(date): === DMI update ===" >> "$LOG"
/usr/local/bin/python3 "$ROOT/scripts/dmi_update.py" \
  --days 3 --max-steps 61 --grid-step 0.08 >> "$LOG" 2>&1
echo "$(date): === DMI klaar ===" >> "$LOG"
