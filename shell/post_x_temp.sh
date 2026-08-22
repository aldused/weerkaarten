#!/bin/bash
SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

echo "=== X temperatuur-post $(date) ==="
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/post_x_dagtemperatuur.py" "$@"
