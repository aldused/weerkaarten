#!/bin/bash
set -euo pipefail
cd /Users/aldus/KNMI_Project/weerlab
export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin
export OMP_NUM_THREADS=4
/usr/local/bin/python3 scripts/run_with_timeout.py --seconds 900 /usr/local/bin/python3 -u scripts/haal_dwd_guidance.py
shell/r2_publish.sh dwd_guidance.json
