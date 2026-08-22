#!/bin/bash
# Cache ECMWF IFS025 ensemble dagstatistieken voor Jan Visser pluimen.
# Schrijft weerlab/jvens.json en uploadt naar R2 (data.weerlab.nl/jvens.json).
set -euo pipefail

REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
OUT="$REPO_DIR/jvens.json"
PY="/usr/local/bin/python3"
[ -x "$PY" ] || PY="/opt/homebrew/bin/python3"
[ -x "$PY" ] || PY="$(command -v python3)"

cd "$REPO_DIR"

echo "[$(date -u +%FT%TZ)] jan_visser_ens_cache start"
"$PY" shell/jan_visser_ens_cache.py --out "$OUT"

# Upload naar R2 — cache 10 min, ECMWF 00Z is dagelijks
R2_CACHE_CONTROL="public, max-age=600" "$REPO_DIR/shell/r2_publish.sh" "$OUT"

echo "[$(date -u +%FT%TZ)] jan_visser_ens_cache klaar"
