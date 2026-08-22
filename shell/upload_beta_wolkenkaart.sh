#!/bin/bash
# Upload beta wolkenkaart PNGs + meta JSON naar R2 (data.weerlab.nl/beta-wolkenkaart/)
# Gebruik: ./shell/upload_beta_wolkenkaart.sh [icond2|harmonie|topmeteo]
set -euo pipefail

PREFIX="${1:-icond2}"
REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
RCLONE="/opt/homebrew/bin/rclone"
REMOTE="r2:weerlab-data"
SUBDIR="beta-wolkenkaart"
CACHE_CONTROL="public, max-age=3600"

cd "$REPO_DIR"

if [ ! -x "$RCLONE" ]; then
  echo "FOUT: rclone niet gevonden op $RCLONE"
  exit 1
fi

META="beta_${PREFIX}_meta.json"
if [ ! -f "$META" ]; then
  echo "FOUT: $META niet gevonden"
  exit 1
fi

# Wolkenverdeling wisselt atomair tussen twee slots. De oude metadata blijft
# tijdens de upload naar het vorige slot wijzen; metadata gaat daarom als laatste.
ASSET_BASE=""
if [ "$PREFIX" = "topmeteo" ]; then
  ASSET_BASE="$(jq -r '.asset_base // empty' "$META")"
  case "$ASSET_BASE" in
    slots/0/|slots/1/) ;;
    *) echo "FOUT: ongeldige asset_base in $META: $ASSET_BASE"; exit 1 ;;
  esac
fi
ASSET_REMOTE="$REMOTE/$SUBDIR/$ASSET_BASE"

# Eerst alle run-assets.
count=0
for f in beta_${PREFIX}_uur*.png; do
  [ -f "$f" ] || continue
  "$RCLONE" copyto "$f" "$ASSET_REMOTE$f" \
    --header-upload "Cache-Control: $CACHE_CONTROL" \
    --no-traverse
  echo "R2: $f"
  count=$((count + 1))
done

detail_count=0
for f in beta_${PREFIX}_detail_uur*.bin.gz; do
  [ -f "$f" ] || continue
  "$RCLONE" copyto "$f" "$ASSET_REMOTE$f" \
    --header-upload "Cache-Control: $CACHE_CONTROL" \
    --no-traverse
  echo "R2: $f"
  detail_count=$((detail_count + 1))
done

# Metadata als laatste: vanaf dit moment is de nieuwe run zichtbaar.
"$RCLONE" copyto "$META" "$REMOTE/$SUBDIR/$META" \
  --header-upload "Cache-Control: public, max-age=60" \
  --no-traverse
echo "R2: $META (laatste)"

echo "Klaar: $count PNGs + $detail_count detailbestanden + 1 JSON geüpload naar $REMOTE/$SUBDIR/"
