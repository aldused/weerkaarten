#!/bin/bash
# Kaartenstudio Nederland: bouwt bij elke nieuwe run per veld een GIF + mp4 + eindkaart en
# zet die op R2. Velden: neerslagsom, windkracht, windstoten, temperatuur.
#
#   ECMWF HRES  vier runs per dag (00/06/12/18 UTC), steeds 3-uursstappen
#               t/m +144u (48 frames).
#   HARMONIE V46 elk uur een nieuwe KNMI-run, 60 frames van +1u t/m +60u. Leest
#               de bins die harmonie46_update.sh al wegschrijft, dus geen tweede
#               download van de run-tar.
#
# Bedoeld voor launchd (elke 10 min checken, no-op als de run al gebouwd is).
# HARMONIE gaat eerst: die is goedkoop en ververst het vaakst.
set -uo pipefail

ROOT="/Users/aldus/KNMI_Project"
OUT="$ROOT/benelux_neerslag"
GENERATOR="$ROOT/weerlab/scripts/benelux_neerslag_anim.py"
PY="/usr/local/bin/python3"
RCLONE="/opt/homebrew/bin/rclone"
R2_DIR="r2:weerlab-data/benelux-neerslag"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# Primaire ECMWF-portal gaat bij drukte op 429; de Google-spiegel heeft dezelfde runs.
export ECMWF_OPEN_DATA_SOURCE="${ECMWF_OPEN_DATA_SOURCE:-google}"

cd "$ROOT"

# ── Lock (verouderde lock >70 min opruimen: build duurt ~10 min) ─────────────
LOCK="$ROOT/.benelux_neerslag.lock"
if [ -d "$LOCK" ]; then
  NU="$(date +%s)"
  LOCKTIJD="$(stat -f %m "$LOCK" 2>/dev/null || echo "$NU")"
  if [ $((NU - LOCKTIJD)) -gt 4200 ]; then
    echo "$(date '+%F %T') verouderde lock verwijderd"
    rmdir "$LOCK" 2>/dev/null || { echo "FOUT: lock niet leeg — stop"; exit 1; }
  fi
fi
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%F %T') vorige run nog bezig — skip"; exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# ── Eén model bouwen en publiceren ───────────────────────────────────────────
# $1 = model-id (ecmwf|harmonie), $2 = bestandsprefix, $3 = markerbestand
VELDEN=(neerslag wind windstoten temp)

bouw_model() {
  local MODEL="$1" ACHTERVOEGSEL="$2" MARKER="$3"
  local RUN GEDAAN VELD PREFIX GIF MP4 PNG META EXTRA=()

  RUN="$("$PY" "$GENERATOR" --model "$MODEL" --latest-run 2>/dev/null | tail -1)"
  if ! [[ "$RUN" =~ ^[0-9]{10}$ ]]; then
    echo "$(date '+%F %T') [$MODEL] FOUT: runlabel niet bepaald (bron onbereikbaar?)" >&2
    return 1
  fi
  GEDAAN="$(cat "$MARKER" 2>/dev/null || echo '')"
  if [ "$RUN" = "$GEDAAN" ]; then
    echo "$(date '+%F %T') [$MODEL] run $RUN al gebouwd — niets te doen"; return 0
  fi

  echo "=== $(date '+%F %T') [$MODEL] nieuwe run $RUN → bouwen ==="
  if [ "$MODEL" = "ecmwf" ]; then
    EXTRA=(--run "$((10#${RUN: -2}))")
  fi
  if ! "$PY" "$GENERATOR" --model "$MODEL" ${EXTRA[@]+"${EXTRA[@]}"}; then
    echo "$(date '+%F %T') [$MODEL] FOUT: bouw mislukt — marker blijft op $GEDAAN" >&2
    return 1
  fi

  # ── Per veld naar R2: run-gesleuteld + vaste "laatste"-namen ──────────────
  echo "$(date '+%F %T') [$MODEL] upload naar R2"
  local F
  for VELD in "${VELDEN[@]}"; do
    PREFIX="benelux_${VELD}${ACHTERVOEGSEL}"
    GIF="$OUT/${PREFIX}_${RUN}.gif"
    MP4="$OUT/${PREFIX}_${RUN}.mp4"
    PNG="$OUT/${PREFIX}_totaal_${RUN}.png"
    META="$OUT/${PREFIX}_meta.json"
    if [ ! -s "$GIF" ]; then
      echo "$(date '+%F %T') [$MODEL/$VELD] FOUT: $GIF ontbreekt na bouw" >&2
      return 1
    fi
    for F in "$GIF" "$MP4" "$PNG"; do
      [ -s "$F" ] || continue
      "$RCLONE" copyto "$F" "$R2_DIR/$(basename "$F")" \
        --header-upload "Cache-Control: public, max-age=86400" --no-traverse
    done
    [ -s "$META" ] && "$RCLONE" copyto "$META" "$R2_DIR/$(basename "$META")" \
      --header-upload "Cache-Control: public, max-age=300" --no-traverse
    "$RCLONE" copyto "$GIF" "$R2_DIR/${PREFIX}_laatste.gif" \
      --header-upload "Cache-Control: public, max-age=300" --no-traverse
    [ -s "$MP4" ] && "$RCLONE" copyto "$MP4" "$R2_DIR/${PREFIX}_laatste.mp4" \
      --header-upload "Cache-Control: public, max-age=300" --no-traverse
    "$RCLONE" copyto "$PNG" "$R2_DIR/${PREFIX}_totaal_laatste.png" \
      --header-upload "Cache-Control: public, max-age=300" --no-traverse

    # Oude runs opruimen: hou de laatste 4 per veld
    ls -1t "$OUT/${PREFIX}"_2*.gif 2>/dev/null | tail -n +5 | while read -r F; do
      OUD="$(basename "$F" .gif)"; OUD="${OUD##*_}"
      rm -f "$OUT/${PREFIX}_${OUD}."{gif,mp4} "$OUT/${PREFIX}_totaal_${OUD}.png"
    done
  done

  echo "$RUN" > "$MARKER"
  echo "$(date '+%F %T') [$MODEL] klaar — run $RUN gepubliceerd (${#VELDEN[@]} velden)"
  return 0
}

STATUS=0
# HARMONIE is de goedkope, snel verversende reeks: die eerst, zodat een lange
# ECMWF-bouw hem nooit een uur laat wachten.
bouw_model harmonie "_harmonie" "$ROOT/.benelux_neerslag_harmonie46_x_v2_run" || STATUS=1
bouw_model ecmwf    ""          "$ROOT/.benelux_neerslag_ecmwf_144_x_v2_run"  || STATUS=1

# Twee dagen GRIB-cache bewaren blijft genoeg voor een herbouw zonder opnieuw
# te downloaden.
find "$ROOT/grib_cache" -name 'benelux_tp_*.grib2*' -mtime +2 -delete 2>/dev/null

exit "$STATUS"
