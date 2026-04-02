#!/bin/bash
cd "/Users/aldus/KNMI_Project/weerkaarten 2"
/usr/local/bin/python3 scripts/haal_guidance.py || exit 1
git add guidance.json
git diff --cached --quiet || git commit -m "Guidance update $(date '+%H:%M')" && git push
