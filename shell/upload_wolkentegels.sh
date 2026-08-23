#!/bin/bash
# Upload de realistische wolkentegels naar R2 (harmonie-data.weerlab.nl/wolkentegels/).
# Gebruik: ./shell/upload_wolkentegels.sh [model ...]   (leeg = alle modellen)
set -euo pipefail

REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
TEGEL_DIR="$REPO_DIR/wolkentegels"
RCLONE="/opt/homebrew/bin/rclone"
REMOTE="r2:weerlab-harmonie"
SUBDIR="wolkentegels"

cd "$REPO_DIR"

if [ ! -x "$RCLONE" ]; then
  echo "FOUT: rclone niet gevonden op $RCLONE"
  exit 1
fi

MODELLEN=("$@")
if [ ${#MODELLEN[@]} -eq 0 ]; then
  MODELLEN=(harmonie harmonie46 icond2 icond2ruc arome_om ukmo_om dmi_om)
fi

for prefix in "${MODELLEN[@]}"; do
  META="$TEGEL_DIR/${prefix}_tegel_meta.json"
  if [ ! -f "$META" ]; then
    echo "overslaan: $META ontbreekt"
    continue
  fi

  # Eerst de tegels, daarna pas de meta: zolang de meta oud is, wijst de
  # viewer nog naar de vorige (nog aanwezige) bestandsnamen.
  "$RCLONE" copy "$TEGEL_DIR" "$REMOTE/$SUBDIR/" \
    --include "${prefix}_uur*.webp" \
    --header-upload "Cache-Control: public, max-age=3600" \
    --transfers 8 --checkers 8 --no-traverse

  "$RCLONE" copyto "$META" "$REMOTE/$SUBDIR/${prefix}_tegel_meta.json" \
    --header-upload "Cache-Control: public, max-age=60" \
    --no-traverse

  echo "R2: $prefix ($(ls "$TEGEL_DIR/${prefix}_uur"*.webp 2>/dev/null | wc -l | tr -d ' ') tegels + meta)"
done

echo "Klaar: wolkentegels naar $REMOTE/$SUBDIR/"
