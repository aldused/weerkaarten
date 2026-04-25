#!/bin/bash
set -euo pipefail

SRC="$HOME/KNMI_Project/weerlab"
BACKUP_ROOT="$HOME/KNMI_Project/backups"
STAMP="$(date '+%Y-%m-%d-%H%M')"
DST="$BACKUP_ROOT/weerlab-$STAMP"

if [ ! -d "$SRC" ]; then
  echo "Bronmap niet gevonden: $SRC"
  exit 1
fi

mkdir -p "$BACKUP_ROOT"

echo "=== Weerlab backup gestart: $(date) ==="
echo "Bron:  $SRC"
echo "Doel:  $DST"

rsync -a \
  --exclude ".DS_Store" \
  --exclude "__pycache__/" \
  --exclude "*.pyc" \
  --exclude "launchd_out.log" \
  --exclude "launchd_err.log" \
  --exclude "modelkaarten_out.log" \
  --exclude "modelkaarten_err.log" \
  "$SRC/" "$DST/"

echo "Backup klaar: $DST"

# Bewaar alleen de laatste 5 backups.
find "$BACKUP_ROOT" -maxdepth 1 -type d -name "weerlab-*" -print0 \
  | xargs -0 ls -dt 2>/dev/null \
  | tail -n +6 \
  | while IFS= read -r old_backup; do
      echo "Verwijder oude backup: $old_backup"
      rm -rf "$old_backup"
    done

echo "=== Weerlab backup gereed: $(date) ==="
