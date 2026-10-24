#!/bin/bash
# Recente KNMI-stormuren en dagarchief automatisch verversen.
set -euo pipefail
ROOT="/Users/aldus/KNMI_Project"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LOCK="$ROOT/.stormdagen-live.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  age=$(( $(date +%s) - $(stat -f %m "$LOCK") ))
  if [ "$age" -gt 1800 ]; then rmdir "$LOCK"; mkdir "$LOCK" || exit 0; else exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
echo "$(date '+%F %T') stormdagen-check"
/usr/local/bin/python3 "$ROOT/weerlab/scripts/stormarchief/update_stormdagen.py" --out "$ROOT/stormdagen_cache" --publish
