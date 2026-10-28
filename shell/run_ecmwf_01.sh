#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
exec /usr/local/bin/python3 -u /Users/aldus/KNMI_Project/weerlab/shell/build_ecmwf_01.py --state '/Volumes/WEERLAB/Modeldata/ECMWF/europa-01' --workers 2 --publish
