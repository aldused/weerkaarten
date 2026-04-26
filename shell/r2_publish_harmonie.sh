#!/bin/bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Gebruik: r2_publish_harmonie.sh <bestand...>"
  exit 2
fi

REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
RCLONE="/opt/homebrew/bin/rclone"
REMOTE="r2:weerlab-harmonie"
CACHE_CONTROL="${R2_CACHE_CONTROL:-public, max-age=30}"

cd "$REPO_DIR"

if [ ! -x "$RCLONE" ]; then
  echo "FOUT: rclone niet gevonden op $RCLONE"
  exit 1
fi

uploaded=0
for file in "$@"; do
  if [ ! -f "$file" ]; then
    echo "Sla over, niet gevonden: $file"
    continue
  fi

  name="$(basename "$file")"
  "$RCLONE" copyto "$file" "$REMOTE/$name" \
    --header-upload "Cache-Control: $CACHE_CONTROL" \
    --no-traverse
  echo "R2 harmonie upload: $name"
  uploaded=$((uploaded + 1))
done

if [ "$uploaded" -eq 0 ]; then
  echo "Geen bestanden naar R2 geupload."
  exit 1
fi
