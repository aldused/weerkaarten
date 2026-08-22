#!/bin/bash
set -euo pipefail

REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
PYTHON="/usr/local/bin/python3"
RCLONE="/opt/homebrew/bin/rclone"
REMOTE="r2:weerlab-harmonie"
OUTPUT="/tmp/weerlab-point-source-publish"

cd "$REPO_DIR"

if [ ! -x "$RCLONE" ]; then
  echo "FOUT: rclone niet gevonden op $RCLONE"
  exit 1
fi

build_and_upload() {
  local model="$1"
  local meta="$2"
  "$PYTHON" scripts/build_point_source.py --model "$model" --meta "$meta" --output "$OUTPUT"
  for file in "$OUTPUT/$model"/*; do
    local name
    name="$(basename "$file")"
    local content_type="application/octet-stream"
    if [[ "$name" == *.json ]]; then content_type="application/json"; fi
    "$RCLONE" copyto "$file" "$REMOTE/point-source/$model/$name" \
      --header-upload "Content-Type: $content_type" \
      --header-upload "Cache-Control: public, max-age=60" \
      --no-traverse
    echo "R2 point-source upload: $model/$name"
  done
}

if [ "$#" -eq 0 ]; then
  build_and_upload harmonie harmonie_canvas_meta.json
  build_and_upload icond2 icond2_canvas_meta.json
  echo "Point-sources HARMONIE en ICON-D2 gepubliceerd."
else
  if [ $(( $# % 2 )) -ne 0 ]; then
    echo "Gebruik: r2_publish_point_source.sh [model meta.json]..."
    exit 2
  fi
  while [ "$#" -gt 0 ]; do
    build_and_upload "$1" "$2"
    echo "Point-source $1 gepubliceerd."
    shift 2
  done
fi
