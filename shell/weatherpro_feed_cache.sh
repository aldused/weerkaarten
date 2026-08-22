#!/bin/bash
# Haalt de verse WeatherPro/MeteoGroup-feed per stad en publiceert
# weatherpro_uur.json naar R2 (data.weerlab.nl/weatherpro_uur.json).
# Zelfde bron als de WeatherPro-app + wetter24 (keyless, per lid).
set -euo pipefail

# launchd = kale PATH; homebrew expliciet
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
PY="/opt/homebrew/bin/python3"
[ -x "$PY" ] || PY="/usr/local/bin/python3"
[ -x "$PY" ] || PY="$(command -v python3)"

cd "$REPO_DIR"
echo "[$(date -u +%FT%TZ)] weatherpro_feed_cache start"

"$PY" shell/weatherpro_feed_cache.py --dir "$REPO_DIR"

if [ -f "$REPO_DIR/weatherpro_uur.json" ]; then
  # feed ~uurlijks vers → 10 min cache
  R2_CACHE_CONTROL="public, max-age=600" "$REPO_DIR/shell/r2_publish.sh" "$REPO_DIR/weatherpro_uur.json"
else
  echo "weatherpro_uur.json ontbreekt, niets te uploaden." >&2
  exit 1
fi

echo "[$(date -u +%FT%TZ)] weatherpro_feed_cache klaar"
