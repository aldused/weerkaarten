#!/bin/bash
# wxcharts-kloon BETA (HRES 10-daags): bouwt nieuwe runs, uploadt naar R2,
# publiceert meta. build_wxbeta.py beslist zelf per cyclus (00/06/12/18) of er
# een nieuwe run is (marker weerlab/.wxbeta_runs.json) en bouwt alleen die.
# Alleen bij WIJZIGING volgt upload + git-publish. Bedoeld voor launchd (~20 min).
set -uo pipefail

ROOT="/Users/aldus/KNMI_Project"
WEERLAB="$ROOT/weerlab"
PY="/usr/local/bin/python3"
RCLONE="/opt/homebrew/bin/rclone"
# De primaire ECMWF-portal kan bij drukte langdurig op 429 blijven hangen.
# De officiële Google Cloud-spiegel bevat dezelfde Open Data-runs en is hiervoor de
# standaardbron; handmatig overschrijven blijft mogelijk via de omgeving.
export ECMWF_OPEN_DATA_SOURCE="${ECMWF_OPEN_DATA_SOURCE:-google}"

cd "$ROOT"

# Lock: geen overlappende builds. Verwijder een verouderde lock (>40 min =
# afgebroken run), zodat de pijplijn niet dagenlang stil kan blijven staan.
LOCK="$ROOT/.wxbeta.lock"
if [ -d "$LOCK" ]; then
  NU="$(date +%s)"
  LOCKTIJD="$(stat -f %m "$LOCK" 2>/dev/null || echo "$NU")"
  if [ $((NU - LOCKTIJD)) -gt 2400 ]; then
    echo "$(date '+%F %T') verouderde lock (>40min) verwijderd"
    rmdir "$LOCK" 2>/dev/null || {
      echo "FOUT: verouderde wxbeta-lock is niet leeg — stop veilig"
      exit 1
    }
  fi
fi
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%F %T') vorige run nog bezig — skip"; exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

echo "=== $(date '+%F %T') wxbeta-check ==="

BUILD_LOG="$(mktemp -t wxbeta_build.XXXXXX)"
MAX_BUILD_SECONDS="${WXBETA_MAX_BUILD_SECONDS:-3600}"
"$PY" build_wxbeta.py >"$BUILD_LOG" 2>&1 &
BUILD_PID=$!
SECONDS=0

# Een vastgelopen netwerk- of renderproces mag de volgende ECMWF-run niet
# dagenlang blokkeren. Een volledige kaartopbouw krijgt ruim een uur; daarna
# stoppen we de hoofd- en workerprocessen en geeft launchd de volgende beurt
# een schone start.
while kill -0 "$BUILD_PID" 2>/dev/null; do
  if [ "$SECONDS" -ge "$MAX_BUILD_SECONDS" ]; then
    echo "$(date '+%F %T') FOUT: wxbeta-opbouw duurde langer dan ${MAX_BUILD_SECONDS}s — afgebroken" >&2
    pkill -TERM -P "$BUILD_PID" 2>/dev/null || true
    kill -TERM "$BUILD_PID" 2>/dev/null || true
    wait "$BUILD_PID" 2>/dev/null || true
    cat "$BUILD_LOG" >&2
    rm -f "$BUILD_LOG"
    exit 1
  fi
  sleep 10
done

if ! wait "$BUILD_PID"; then
  cat "$BUILD_LOG" >&2
  rm -f "$BUILD_LOG"
  exit 1
fi
OUT="$(<"$BUILD_LOG")"
rm -f "$BUILD_LOG"
echo "$OUT" | grep -E "^[0-9]{2}Z|WIJZIGING|geen wijziging|Meta:" || true

if echo "$OUT" | grep -q "WIJZIGING"; then
  echo "$(date '+%F %T') nieuwe run(s) → upload naar R2 + publiceren"
  "$RCLONE" copy "$WEERLAB/wxbeta/" r2:weerlab-data/wxbeta/ \
    --transfers 16 --header-upload "Cache-Control: public, max-age=300" --no-traverse || exit 1
  # Publiceer de bijbehorende tijden pas nadat alle kaartbestanden zijn geüpload.
  bash "$WEERLAB/shell/r2_publish.sh" "$WEERLAB/wxbeta_meta.json" || exit 1
  bash "$WEERLAB/shell/git_publish.sh" "wxbeta auto-update $(date '+%F %H:%M')" wxbeta_meta.json
  echo "$(date '+%F %T') klaar"
else
  echo "$(date '+%F %T') geen nieuwe run — niets te doen"
fi
