#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Dagelijkse dagdata-sync
# Regenereert dagdata_*.json uit de CSV's (bijgewerkt door knmi_records.py
# dat om 05:00 draait) en vult daarna aan met EDR-data t/m gisteren.
# Gepland in de ochtend en avond via nl.edaldus.dagdata.plist. De ochtendrun
# is een vroege poging; de avondrun is de zekere herberekening/publicatie.
# ═══════════════════════════════════════════════════════════════════════════

set -e
cd "/Users/aldus/KNMI_Project/weerlab"

echo "════════════════════════════════════════════════════"
echo "  Dagdata daily sync — $(date '+%Y-%m-%d %H:%M')"
echo "════════════════════════════════════════════════════"

echo "Stap 1/4: CSV → JSON (maak_dagdata_json.py)"
/usr/local/bin/python3 -u scripts/maak_dagdata_json.py

echo ""
echo "Stap 2/4: EDR-aanvulling t/m gisteren (extend_dagdata.py)"
/usr/local/bin/python3 -u scripts/extend_dagdata.py

echo ""
echo "Stap 3/4: Hittegolven bijwerken en publiceren"
/usr/local/bin/python3 -u scripts/maak_hittegolven.py
shell/r2_publish.sh hittegolven.json

echo ""
echo "Stap 4/4: dagdata naar R2 publiceren"
# De afnemers laden buiten localhost rechtstreeks vanaf data.weerlab.nl.
# Dit ververst de data zonder Git-commit of Pages-deploy.
shell/r2_publish.sh dagdata_*.json

echo ""
echo "Klaar — $(date '+%Y-%m-%d %H:%M')"
