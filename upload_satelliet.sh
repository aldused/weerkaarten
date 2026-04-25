#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"
git checkout main 2>/dev/null || true

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_satelliet.py"

git add sat_visible.png sat_infrared.png

if git diff --cached --quiet; then
  echo "Geen nieuwe satellietbeelden."
else
  git commit -m "Satellietbeelden update $(date '+%H:%M')"
  git push
fi
