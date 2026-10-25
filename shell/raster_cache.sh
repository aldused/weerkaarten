#!/bin/bash
# Haalt de ruwe WeatherPro-feed per plaats + de KNMI-waarschuwingen (Meteoalarm) en publiceert
# weatherpro_raster.json en knmi_warnings.json naar R2 (data.weerlab.nl) voor weerbewaking_raster.html.
set -euo pipefail

# launchd = kale PATH; homebrew expliciet
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
PY="/opt/homebrew/bin/python3"
[ -x "$PY" ] || PY="/usr/local/bin/python3"
[ -x "$PY" ] || PY="$(command -v python3)"

cd "$REPO_DIR"
echo "[$(date -u +%FT%TZ)] raster_cache start"
"$PY" shell/raster_cache.py --dir "$REPO_DIR"

for f in weatherpro_raster.json knmi_warnings.json; do
  if [ -f "$REPO_DIR/$f" ]; then
    # feed ~uurlijks vers → 5 min cache
    R2_CACHE_CONTROL="public, max-age=300" "$REPO_DIR/shell/r2_publish.sh" "$REPO_DIR/$f"
  else
    echo "$f ontbreekt, niets te uploaden." >&2
  fi
done
echo "[$(date -u +%FT%TZ)] raster_cache klaar"
