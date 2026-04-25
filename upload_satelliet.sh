#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_satelliet.py"

"$SCRIPT_DIR/shell/r2_publish.sh" \
  sat_visible.png sat_infrared.png
