#!/bin/bash
set -e
SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_metar.py" || { echo "FOUT: haal_metar.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_luchtvaart_bulletin.py" || echo "WAARSCHUWING: haal_luchtvaart_bulletin.py mislukt"

"$SCRIPT_DIR/shell/r2_publish.sh" \
    metar_data.json luchtvaart_bulletin.json
