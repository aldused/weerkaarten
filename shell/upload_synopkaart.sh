#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_synop_kaart.py"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_actueel.py"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_waarschuwingen.py"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_toplijst.py"

"$SCRIPT_DIR/shell/git_publish.sh" \
  "Synop + waarschuwingen + toplijst update" \
  kaart_synop*.png actueel.json waarschuwingen.json toplijst.json toplijst.html
