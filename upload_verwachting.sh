#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_knmi_verwachting.py"

"$SCRIPT_DIR/shell/r2_publish.sh" knmi_verwachting.json
