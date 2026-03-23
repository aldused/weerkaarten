#!/bin/bash
set -e  # stop bij fout
SCRIPT_DIR="/Users/aldus/Desktop/KNMI_Project/weerkaarten 2"

cd "$SCRIPT_DIR"

echo "Kaarten genereren..."
/usr/local/bin/python3 "$SCRIPT_DIR/mosmix_kaart_fixed.py" || { echo "FOUT: mosmix_kaart_fixed.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/mosmix_kaart_zon.py"   || { echo "FOUT: mosmix_kaart_zon.py";   exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/mosmix_kaart_wind.py"  || { echo "FOUT: mosmix_kaart_wind.py";  exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/mosmix_kaart_regen.py" || { echo "FOUT: mosmix_kaart_regen.py"; exit 1; }

echo "Toplijst bijwerken..."
/usr/local/bin/python3 "$SCRIPT_DIR/maak_toplijst.py" || { echo "FOUT: maak_toplijst.py"; exit 1; }

echo "Index bijwerken..."
/usr/local/bin/python3 "$SCRIPT_DIR/maak_index.py" || { echo "FOUT: maak_index.py"; exit 1; }

echo "Uploaden naar GitHub..."
git add kaart_*.png kaart_zon_*.png kaart_wind_*.png kaart_regen_*.png index.json index.html toplijst.html toplijst.json

if git diff --cached --quiet; then
    echo "Niets gewijzigd, geen commit nodig."
else
    git commit -m "Weerkaarten update $(date '+%Y-%m-%d %H:%M')"
    git push origin main
fi

echo "Klaar!"
