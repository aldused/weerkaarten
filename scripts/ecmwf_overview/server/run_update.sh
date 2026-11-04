#!/bin/bash
# launchd-wrapper (elke minuut): nieuwe ECMWF-stappen verwerken en bij wijziging naar R2.
# launchd heeft een kale PATH en 256 fd's; beide hier expliciet zetten.
set -uo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
ulimit -n 4096
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
LOG=logs/update.log
LOCK=.update.lock

if ! mkdir "$LOCK" 2>/dev/null; then
  # een gekilde run laat de lock staan: na 40 min overnemen
  age=$(( $(date +%s) - $(stat -f %m "$LOCK") ))
  if [ "$age" -lt 2400 ]; then exit 0; fi
  echo "$(date '+%F %T') oude lock (${age}s) overgenomen" >> "$LOG"
  rm -rf "$LOCK"; mkdir "$LOCK" || exit 1
fi
trap 'rm -rf "$LOCK"' EXIT

echo "$(date '+%F %T') start" >> "$LOG"
# 0,25° eerst: die is bij ECMWF ~2 uur eerder en is de standaardkaart; AIFS staat stap voor stap nog eerder online
LIVE=--live-publish; [ "${OVERVIEW_NO_PUBLISH:-0}" = "1" ] && LIVE=
# Deterministische kaarten vóór de zware ensembles (50/51 leden per stap).
for model in ecmwf025 aifs ecmwf aifsens ifsens; do
  MAX=; case $model in *ens) MAX="--max-runs 2";; esac
  out=$(python3 pipeline/update.py --model "$model" $LIVE $MAX 2>&1); rc=$?
  echo "$out" >> "$LOG"
  if [ $rc -ne 0 ]; then echo "$(date '+%F %T') update.py $model faalde ($rc)" >> "$LOG"; continue; fi
  if [ "${OVERVIEW_NO_PUBLISH:-0}" != "1" ]; then
    # stappen staan al online via --live-publish; dit maakt de run definitief en haalt mislukte
    # uploads in. Mislukt dit, dan de volgende keer alles.
    PENDING=.publish_pending.$model
    runs=$(sed -n 's/^WIJZIGING //p' <<<"$out")
    if [ -e "$PENDING" ]; then
      python3 pipeline/publish.py --model "$model" >> "$LOG" 2>&1 && rm -f "$PENDING" || echo "$(date '+%F %T') publish $model faalde" >> "$LOG"
    elif [ -n "$runs" ]; then
      python3 pipeline/publish.py --model "$model" --runs "$runs" >> "$LOG" 2>&1 || { touch "$PENDING"; echo "$(date '+%F %T') publish $model faalde" >> "$LOG"; }
    fi
  fi
done
# logrotatie: laatste ~5000 regels
tail -n 5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
