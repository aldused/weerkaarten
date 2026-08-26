#!/bin/bash
cd "/Users/aldus/KNMI_Project/weerlab"
git checkout main 2>/dev/null || true
# Runtime-data wordt via R2 gepubliceerd. Neem JSON- en PNG-feeds daarom niet
# meer blind mee in een handmatige Pages-publicatie.
git add -A -- ':!*.json' ':!*.png'
if git diff --cached --quiet; then
    echo "Niets te pushen."
else
    git commit -m "Handmatige push alles $(date '+%Y-%m-%d %H:%M')"
    git push origin main
    echo "=== Klaar! ==="
fi
