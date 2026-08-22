#!/bin/bash
# HARMONIE-only poller.
# Controleert vaker op een nieuwe KNMI-run zonder de complete modelkaarten-runner te starten.
set -euo pipefail

ROOT="/Users/aldus/KNMI_Project/weerlab"
LOG="$ROOT/modelkaarten.log"
LOCKDIR="/tmp/weerlab-harmonie-poll.lock"

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  echo "$(date): Harmonie poll al bezig, skip." >> "$LOG"
  exit 0
fi

cleanup() {
  rmdir "$LOCKDIR" 2>/dev/null || true
}
trap cleanup EXIT

echo "$(date): === Harmonie poll ===" >> "$LOG"
bash "$ROOT/scripts/harmonie_update.sh" >> "$LOG" 2>&1
echo "$(date): HARMONIE 46 testfeed pollen..." >> "$LOG"
bash "$ROOT/scripts/harmonie46_update.sh" >> "$LOG" 2>&1
echo "$(date): === Harmonie poll klaar ===" >> "$LOG"

tail -5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
