#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Dagelijkse dagdata-sync
# Regenereert dagdata_*.json uit de CSV's (bijgewerkt door knmi_records.py
# dat om 05:00 draait) en vult daarna aan met EDR-data t/m gisteren.
# Geplanned om 05:30 via nl.edaldus.dagdata.plist.
# ═══════════════════════════════════════════════════════════════════════════

set -e
cd "/Users/aldus/KNMI_Project/weerkaarten 2"

echo "════════════════════════════════════════════════════"
echo "  Dagdata daily sync — $(date '+%Y-%m-%d %H:%M')"
echo "════════════════════════════════════════════════════"

echo "Stap 1/2: CSV → JSON (maak_dagdata_json.py)"
/usr/local/bin/python3 -u scripts/maak_dagdata_json.py

echo ""
echo "Stap 2/2: EDR-aanvulling t/m gisteren (extend_dagdata.py)"
/usr/local/bin/python3 -u scripts/extend_dagdata.py

echo ""
echo "Klaar — $(date '+%Y-%m-%d %H:%M')"
