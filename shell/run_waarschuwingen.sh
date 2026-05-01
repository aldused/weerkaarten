#!/bin/bash
# Wordt aangeroepen door nl.edaldus.waarschuwingen.plist (elke 15 min).
# Scrapet KNMI waarschuwingen → weerlab/waarschuwingen.json en publiceert.
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

# Gebruik dezelfde python die ook andere weerlab-scripts pakt
PYTHON="$(command -v python3)"
[ -x "/usr/local/bin/python3" ] && PYTHON="/usr/local/bin/python3"

"$PYTHON" "$SCRIPT_DIR/scripts/scrape_waarschuwingen.py"

# Publiceer naar GitHub Pages via bestaand git_publish-script
"$SCRIPT_DIR/shell/git_publish.sh" "waarschuwingen: 15-min update" waarschuwingen.json
