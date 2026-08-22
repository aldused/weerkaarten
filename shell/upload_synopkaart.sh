#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_synop_kaart.py"
if ! /usr/local/bin/python3 "$SCRIPT_DIR/scripts/hittekracht_gemeten.py"; then
  echo "WAARSCHUWING: WBGT/hittekracht kon niet worden ververst; actueel accepteert alleen bronwaarden jonger dan 45 minuten." >&2
fi
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_actueel.py"
# Toplijst heeft bewust één eigenaar: nl.edaldus.toplijst. Niet hier opnieuw
# genereren/uploaden; dubbele writers putten de EDR-quota uit en kunnen racen.

shopt -s nullglob
"$SCRIPT_DIR/shell/r2_publish.sh" \
  actueel.json waarschuwingen.json kaart_synop*.png
