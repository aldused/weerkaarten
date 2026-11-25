#!/bin/bash
# Publiceer de daganalyse onafhankelijk van de uitrol van de website.
set -euo pipefail
cd "$(dirname "$0")/.."

/usr/local/bin/python3 -u scripts/update_zeetemp_noaa.py
bash shell/r2_publish.sh zeetemp_noaa.json
