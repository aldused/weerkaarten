#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_luchtvaart_bulletin.py"

"$SCRIPT_DIR/shell/git_publish.sh" \
  "Luchtvaart bulletin update $(date '+%H:%M')" \
  luchtvaart_bulletin.json
