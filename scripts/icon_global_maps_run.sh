#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
exec /usr/local/bin/python3 -u /Users/aldus/KNMI_Project/weerlab/scripts/icon_global_native.py --mode maps --publish --prune --workers 4
