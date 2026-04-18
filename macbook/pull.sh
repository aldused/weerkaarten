#!/bin/bash
# Haalt laatste weerkaarten vanuit GitHub (passieve kopie op MacBook).
# Draait via launchd elk uur.

set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$REPO/macbook/pull.log"

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
  cd "$REPO"
  git fetch --prune origin
  git reset --hard origin/main
  echo "HEAD: $(git log -1 --format='%h %s')"
} >> "$LOG" 2>&1

# Log roteren (>5 MB)
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG")" -gt 5242880 ]; then
  mv "$LOG" "$LOG.old"
fi
