#!/bin/bash
# Archiveer ECMWF IFS-ENS runs voor alle plaatsen uit de landelijke MOSMIX-feed
# pagina en upload de per-station JSON's naar R2 (data.weerlab.nl/pluim_trend_<slug>.json).
# Iedere minuut pollen. De Python-validator schrijft uitsluitend een nieuwe,
# volledige en door bronmetadata bevestigde 00Z/06Z/12Z/18Z-run. Een gewijzigd
# capability-manifest wordt altijd pas na alle stationarchieven gepubliceerd.
set -euo pipefail

REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
PY="/usr/local/bin/python3"
WRITER_LOCK_DIR="/tmp/nl.edaldus.pluim-archive-writer.lock"
PUBLISHED_REVISION_STAMP="/tmp/nl.edaldus.pluim-archive-published-revision"
publish_stamp_tmp=""
[ -x "$PY" ] || PY="/opt/homebrew/bin/python3"
[ -x "$PY" ] || PY="$(command -v python3)"

if ! mkdir "$WRITER_LOCK_DIR" 2>/dev/null; then
  existing_pid=$(sed -n '1p' "$WRITER_LOCK_DIR/pid" 2>/dev/null || true)
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "[$(date -u +%FT%TZ)] pluimarchief-schrijver draait al — skip"
    exit 0
  fi
  rm -f "$WRITER_LOCK_DIR/pid"
  rmdir "$WRITER_LOCK_DIR" 2>/dev/null || exit 0
  mkdir "$WRITER_LOCK_DIR"
fi
printf '%s\n' "$$" > "$WRITER_LOCK_DIR/pid"
cleanup_writer_lock() {
  if [ -n "$publish_stamp_tmp" ]; then
    rm -f "$publish_stamp_tmp"
  fi
  rm -f "$WRITER_LOCK_DIR/pid"
  rmdir "$WRITER_LOCK_DIR" 2>/dev/null || true
}
trap cleanup_writer_lock EXIT INT TERM

cd "$REPO_DIR"

echo "[$(date -u +%FT%TZ)] pluim_trend_cache start"
result=$("$PY" shell/pluim_trend_cache.py --dir "$REPO_DIR")
printf '%s\n' "$result"

written_line=$(printf '%s\n' "$result" | sed -n 's/^WRITTEN://p' | tail -n 1)
if [ -z "$written_line" ]; then
  echo "Geen nieuwe geverifieerde 00Z/06Z/12Z/18Z-run; upload overgeslagen."
  exit 0
fi
read -r -a to_upload <<< "$written_line"

manifest_path="$REPO_DIR/pluim_archive_meta.json"
manifest_written=0
station_uploads=()
for path in "${to_upload[@]}"; do
  if [ "$path" = "$manifest_path" ]; then
    manifest_written=1
  else
    station_uploads+=("$path")
  fi
done

if [ "${#station_uploads[@]}" -gt 0 ] && [ "$manifest_written" -ne 1 ]; then
  echo "Stationarchieven gewijzigd zonder capability-manifest; upload geweigerd." >&2
  exit 1
fi

if [ "${#station_uploads[@]}" -gt 0 ]; then
  # Nieuwe ENS-run → 10 min cache ruim voldoende.
  R2_CACHE_CONTROL="public, max-age=600" "$REPO_DIR/shell/r2_publish.sh" "${station_uploads[@]}"
fi

if [ "$manifest_written" -eq 1 ]; then
  # Manifest-last maakt een nieuwe run/capability pas zichtbaar nadat ieder
  # bijbehorend stationbestand succesvol op R2 staat.
  R2_CACHE_CONTROL="public, max-age=60" "$REPO_DIR/shell/r2_publish.sh" "$manifest_path"
  published_revision=$("$PY" -c 'import json,sys; print(json.load(open(sys.argv[1]))["revision"])' "$manifest_path")
  if [[ ! "$published_revision" =~ ^[a-f0-9]{64}$ ]]; then
    echo "Ongeldige capability-manifestrevision na upload." >&2
    exit 1
  fi
  publish_stamp_tmp="${PUBLISHED_REVISION_STAMP}.$$"
  printf '%s\n' "$published_revision" > "$publish_stamp_tmp"
  mv -f "$publish_stamp_tmp" "$PUBLISHED_REVISION_STAMP"
  publish_stamp_tmp=""
elif [ "${#station_uploads[@]}" -eq 0 ]; then
  echo "Geen pluim_trend bestanden om te uploaden." >&2
  exit 1
fi

echo "[$(date -u +%FT%TZ)] pluim_trend_cache klaar"
