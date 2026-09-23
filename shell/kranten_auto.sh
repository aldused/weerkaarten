#!/bin/bash
# Automatische krantconcepten (launchd nl.edaldus.kranten, 08-12 elk uur).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd /Users/aldus/KNMI_Project/weerlab || exit 1
exec /usr/local/bin/python3 scripts/kranten_auto.py >> /Users/aldus/KNMI_Project/logs/kranten_auto.log 2>&1
