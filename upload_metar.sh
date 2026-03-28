#!/bin/bash
set -e
SCRIPT_DIR="/Users/aldus/Desktop/KNMI_Project/weerkaarten 2"
cd "$SCRIPT_DIR"
git checkout main 2>/dev/null || true

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_metar.py" || { echo "FOUT: haal_metar.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_luchtvaart_bulletin.py" || echo "WAARSCHUWING: haal_luchtvaart_bulletin.py mislukt"

git add metar_data.json luchtvaart_bulletin.json 2>/dev/null || true

if git diff --cached --quiet; then
    echo "Geen wijzigingen in METAR data."
else
    git commit -m "METAR update $(date '+%Y-%m-%d %H:%M')"
    git push
fi
