#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/Desktop/KNMI_Project/weerkaarten"
cd "$SCRIPT_DIR"

echo "=== Toplijst update $(date) ==="

/usr/local/bin/python3 "$SCRIPT_DIR/maak_toplijst.py" || { echo "FOUT: maak_toplijst.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/maak_index.py"    || { echo "FOUT: maak_index.py";    exit 1; }

git add toplijst.json toplijst.html index.json

if git diff --cached --quiet; then
    echo "Niets gewijzigd."
else
    git commit -m "Toplijst update $(date '+%Y-%m-%d %H:%M')"
    git push
    echo "=== Upload klaar ==="
fi
