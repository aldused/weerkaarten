#!/bin/bash
# Runtime images belong in R2; data refreshes must not depend on a Git push.
set -euo pipefail
cd /Users/aldus/KNMI_Project/weerlab
/usr/local/bin/python3 scripts/run_with_timeout.py --seconds 900 /usr/local/bin/python3 scripts/maak_zeetemp_kaart.py
/usr/local/bin/python3 scripts/maak_index.py
bash shell/r2_publish.sh kaart_zeetemp_*.png index.json
echo "Zeetemp gepubliceerd — $(date '+%Y-%m-%d %H:%M')"
