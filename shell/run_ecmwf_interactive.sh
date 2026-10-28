#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
exec /usr/local/bin/python3 -u /Users/aldus/KNMI_Project/weerlab/shell/export_ecmwf_interactive.py --state /Volumes/WEERLAB/Modeldata/ECMWF/interactief --workers 2 --publish
