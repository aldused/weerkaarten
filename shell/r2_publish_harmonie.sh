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
GZIP_UPLOAD="${R2_GZIP:-0}"

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
  content_type="application/octet-stream"
  if [[ "$name" == *.json ]]; then content_type="application/json"; fi
  if [[ "$name" == *.png ]]; then content_type="image/png"; fi
  if [ "$GZIP_UPLOAD" = "1" ] && [[ "$name" != *.png ]]; then
    gzip_file="$(mktemp /tmp/weerlab-r2-gzip.XXXXXX)"
    gzip -c "$file" > "$gzip_file"
    if ! "$RCLONE" copyto "$gzip_file" "$REMOTE/$name" \
      --header-upload "Cache-Control: $CACHE_CONTROL" \
      --header-upload "Content-Type: $content_type" \
      --header-upload "Content-Encoding: gzip" \
      --no-traverse; then
      rm -f "$gzip_file"
      exit 1
    fi
    rm -f "$gzip_file"
  else
    "$RCLONE" copyto "$file" "$REMOTE/$name" \
      --header-upload "Cache-Control: $CACHE_CONTROL" \
      --header-upload "Content-Type: $content_type" \
      --no-traverse
  fi
  echo "R2 harmonie upload: $name"
  uploaded=$((uploaded + 1))
done

if [ "$uploaded" -eq 0 ]; then
  echo "Geen bestanden naar R2 geupload."
  exit 1
fi
