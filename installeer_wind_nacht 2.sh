#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/Desktop/KNMI_Project/weerkaarten 2"
SCRIPTS="$SCRIPT_DIR/scripts"
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Wind nacht fix installeren en uploaden ==="

# 1. Kopieer het gerepareerde script
cp "$THIS_DIR/mosmix_kaart_wind_nacht.py" "$SCRIPTS/mosmix_kaart_wind_nacht.py"
echo "✓ mosmix_kaart_wind_nacht.py gekopieerd naar scripts/"

# 2. Ga naar projectmap
cd "$SCRIPT_DIR"
git checkout main 2>/dev/null || true

# 3. Verwijder oude nachtkaarten met oude naamformaat (dagnaam_datum)
OLD=$(ls kaart_wind_nacht_*_*[0-9][a-z][a-z][a-z][0-9][0-9][0-9][0-9].png 2>/dev/null || true)
if [ -n "$OLD" ]; then
    echo "Verwijder kaarten met oud naamformaat:"
    echo "$OLD" | xargs rm -v
fi

# 4. Genereer nieuwe kaarten (nieuwe naamformaat: YYYYMMDD_dagnaam)
echo "Kaarten genereren..."
/usr/local/bin/python3 "$SCRIPTS/mosmix_kaart_wind_nacht.py" || { echo "FOUT: kaart genereren mislukt"; exit 1; }

# 5. Commit en push
git add -A
if git diff --cached --quiet; then
    echo "Niets gewijzigd."
else
    git commit -m "Wind nacht kaarten fix: naamformaat YYYYMMDD $(date '+%Y-%m-%d %H:%M')"
    git push
    echo "=== Upload klaar ==="
fi
