#!/bin/bash
set -uo pipefail

ROOT="/Users/aldus/KNMI_Project/weerlab"
PYTHON="/usr/local/bin/python3"

cd "$ROOT" || exit 1
echo "$(date): HARMONIE 46 update gestart"

"$PYTHON" scripts/harmonie46_update.py "$@"
status=$?
if [ "$status" -eq 10 ]; then
  echo "$(date): HARMONIE 46 ongewijzigd"
  exit 0
fi
if [ "$status" -ne 0 ]; then
  echo "$(date): HARMONIE 46 verwerking mislukt ($status)"
  exit "$status"
fi

files=(harmonie_overlay.png harmonie46_canvas_meta.json)
for file in harmonie46_data_*.bin; do
  [ -f "$file" ] && files+=("$file")
done

R2_GZIP=1 bash shell/r2_publish_harmonie.sh "${files[@]}" || exit 1
bash shell/r2_publish_point_source.sh harmonie46 harmonie46_canvas_meta.json || exit 1
echo "$(date): HARMONIE 46 update gepubliceerd"
