#!/bin/bash
set -euo pipefail
cd /Users/aldus/KNMI_Project/weerlab
export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin
export OMP_NUM_THREADS=4
/usr/local/bin/python3 scripts/run_with_timeout.py --seconds 1800 /usr/local/bin/python3 -u scripts/knmi_neerslag_records.py
shell/r2_publish.sh neerslag_records.json neerslag_droog.json
