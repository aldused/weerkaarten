#!/bin/bash
# Windplaat: bouwt bij elke nieuwe HARMONIE 43-run (of nieuwe ECMWF-cache) het windrooster
# voor heel Nederland en zet het op R2 (data.weerlab.nl/windplaat/). De pagina windplaat.html
# rekent daaruit per ingetikte plaats de 90-uursverwachting. No-op als de run al gebouwd is.
set -uo pipefail
ROOT="/Users/aldus/KNMI_Project"
PY="/usr/local/bin/python3"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$ROOT"
LOCK="$ROOT/.windplaat.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # verouderde lock (>30 min) opruimen
  if [ $(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || date +%s) )) -gt 1800 ]; then rmdir "$LOCK"; mkdir "$LOCK" || exit 0; else exit 0; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
echo "$(date '+%F %T') windplaat-check"
"$PY" "$ROOT/weerlab/scripts/windplaat_grid.py" --out "$ROOT/windplaat_cache" --publish

# Afzonderlijke modelroosters voor wind en neerslag; geen modelmix.
"$PY" "$ROOT/weerlab/scripts/modelplaten.py" --root "$ROOT" --out "$ROOT/modelplaten_cache" --publish
