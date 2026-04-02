#!/bin/bash
cd "/Users/aldus/Desktop/KNMI_Project/weerkaarten 2"
git checkout main 2>/dev/null || true
git add -A
if git diff --cached --quiet; then
    echo "Niets te pushen."
else
    git commit -m "Handmatige push alles $(date '+%Y-%m-%d %H:%M')"
    git push origin main
    echo "=== Klaar! ==="
fi
