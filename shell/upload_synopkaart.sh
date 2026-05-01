#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_synop_kaart.py"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_actueel.py"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_waarschuwingen.py"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_toplijst.py"

shopt -s nullglob
"$SCRIPT_DIR/shell/r2_publish.sh" \
  actueel.json waarschuwingen.json toplijst.json kaart_synop*.png

# JSON's worden relatief van weerlab.nl (= Pages) gefetcht — dus ook naar git.
# kaart_synop*.png blijven R2-only (groot, niet getrackt in git).
"$SCRIPT_DIR/shell/git_publish.sh" "data: synop-cyclus update" \
  actueel.json waarschuwingen.json toplijst.json
