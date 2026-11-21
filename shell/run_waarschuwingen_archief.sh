#!/bin/bash
# Eigen taak: een langzame historische import vertraagt de live bron niet.
set -euo pipefail
REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
PYTHON="/usr/local/bin/python3"
[ -x "$PYTHON" ] || PYTHON="$(command -v python3)"
cd "$REPO_DIR"
set +e
"$PYTHON" scripts/knmi_warning_archive.py --legacy-limit 150
status=$?
set -e
if [ "$status" -eq 3 ]; then exit 0; fi
if [ "$status" -ne 0 ]; then exit "$status"; fi
"$REPO_DIR/shell/r2_publish.sh" waarschuwingen-archief.json
