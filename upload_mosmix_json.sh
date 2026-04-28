#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_json.py"

"$SCRIPT_DIR/shell/r2_publish.sh" \
  mosmix_nl.json mosmix_be.json mosmix_fr.json mosmix_ibe.json mosmix_de.json mosmix_gb.json mosmix_gr.json \
  mosmix_uurlijks_nl.json mosmix_uurlijks_be.json mosmix_uurlijks_fr.json \
  mosmix_uurlijks_ibe.json mosmix_uurlijks_de.json mosmix_uurlijks_gb.json mosmix_uurlijks_gr.json
