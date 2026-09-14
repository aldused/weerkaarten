#!/bin/bash
set -euo pipefail
REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$REPO_DIR"
/usr/local/bin/python3 scripts/haal_marifoon.py
bash shell/r2_publish.sh marifoon.json
