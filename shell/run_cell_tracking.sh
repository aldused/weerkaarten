#!/bin/bash
set -euo pipefail

REPO="/Users/aldus/KNMI_Project/weerlab"
PYTHON="/usr/local/bin/python3"
LOG_DIR="/Users/aldus/KNMI_Project/logs"
OUT="$REPO/cell_tracking_latest.geojson"

mkdir -p "$LOG_DIR"
cd "$REPO"

"$PYTHON" shell/cell_tracking_update.py --out "$OUT" \
  >> "$LOG_DIR/cell_tracking.log" 2>&1

# Houd het log compact; CellWarn draait elke vijf minuten.
tail -n 1000 "$LOG_DIR/cell_tracking.log" > "$LOG_DIR/cell_tracking.log.tmp"
mv "$LOG_DIR/cell_tracking.log.tmp" "$LOG_DIR/cell_tracking.log"
