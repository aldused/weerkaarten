#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"
source ~/.zshrc 2>/dev/null
/usr/local/bin/python3 scripts/haal_guidance.py || exit 1
/usr/local/bin/python3 scripts/haal_dwd_guidance.py || exit 1
"$SCRIPT_DIR/shell/git_publish.sh" \
  "Guidance update $(date '+%H:%M')" \
  guidance.json dwd_guidance.json
