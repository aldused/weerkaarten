#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

echo "=== Ed Aldus WM — upload $(date) ==="

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_waarschuwingen.py"       || { echo "FOUT: haal_waarschuwingen.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_guidance.py"             || echo "WAARSCHUWING: haal_guidance.py mislukt"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_luchtvaart_bulletin.py"  || echo "WAARSCHUWING: haal_luchtvaart_bulletin.py mislukt"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_maanddata.py"            || echo "WAARSCHUWING: haal_maanddata.py mislukt"
# MOS/MIX-kaarten zijn dynamisch: alleen JSON verversen, geen PNG-generatie meer.
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_json.py"               || { echo "FOUT: mosmix_json.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_beta_debilt.py"          || { echo "FOUT: maak_beta_debilt.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_beta_verificatie.py"     || { echo "FOUT: maak_beta_verificatie.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_grafiek.py"              || { echo "FOUT: maak_grafiek.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_grafiek_be.py"           || { echo "FOUT: maak_grafiek_be.py"; exit 1; }
# Toplijst wordt exclusief door nl.edaldus.toplijst gegenereerd en gepubliceerd.
# Toplijst heeft een eigen launchd-taak; satelliet blijft PNG.
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_index.py"                || { echo "FOUT: maak_index.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/maak_p13_html.py"                     || { echo "FOUT: maak_p13_html.py"; exit 1; }

"$SCRIPT_DIR/shell/git_publish.sh" \
    "Kaarten update $(date '+%Y-%m-%d %H:%M')" \
    waarschuwingen.json guidance.json dwd_guidance.json luchtvaart_bulletin.json \
    maanddata_*.json beta_debilt.json beta_verificatie.json grafiek_trend.json grafiek_trend_be.json \
    index.json p13_records.html p13_records.js \
    mosmix_nl.json mosmix_be.json mosmix_fr.json mosmix_ibe.json mosmix_de.json mosmix_gb.json \
    mosmix_uurlijks_nl.json mosmix_uurlijks_be.json mosmix_uurlijks_fr.json \
    mosmix_uurlijks_ibe.json mosmix_uurlijks_de.json mosmix_uurlijks_gb.json
