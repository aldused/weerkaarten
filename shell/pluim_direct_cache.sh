#!/bin/bash
# Directe ECMWF IFS ENS-ingest voor de Weerlab-pluimen.
#
# De Python-producent downloadt kleine tijdelijke GRIB-blokken naar /tmp,
# bemonstert alle 39 locaties en verwijdert elk blok direct na het uitlezen.
# Alleen de compacte schema-3 JSON-bestanden blijven lokaal en gaan naar R2.

set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
PY="/usr/local/bin/python3"
LOCK_DIR="/tmp/nl.edaldus.pluim-direct.lock"
WRITER_LOCK_DIR="/tmp/nl.edaldus.pluim-archive-writer.lock"
STATE_DIR="${PLUIM_DIRECT_STATE_DIR:-/Users/aldus/Library/Application Support/Weerlab}"
PUBLISH_STATE="$STATE_DIR/pluim-direct-published.json"
REMOTE_META_URL="${PLUIM_DIRECT_META_URL:-https://data.weerlab.nl/pluim_direct_meta.json}"
ARCHIVE_MANIFEST="$REPO_DIR/pluim_archive_meta.json"
PUBLISHED_REVISION_STAMP="/tmp/nl.edaldus.pluim-archive-published-revision"
# All heavy transient sources and checkpoints live on the designated 10 TB disk.
if ! /usr/sbin/diskutil info -plist /Volumes/WEERLAB | "$PY" -c 'import plistlib,sys; a=plistlib.loads(sys.stdin.buffer.read()); sys.exit(0 if a.get("VolumeUUID")=="BBD67AB1-0A13-4865-B651-E9B8EF6AD337" else 1)'; then
  echo "WEERLAB-schijf ontbreekt; laatste gepubliceerde pluimen behouden" >&2
  exit 1
fi
export ECMWF_NATIVE_RUNTIME="/Volumes/WEERLAB/Modeldata/ECMWF/pluimen/runtime"
mkdir -p "$ECMWF_NATIVE_RUNTIME"
FIELDS="${PLUIM_DIRECT_FIELDS:-complete}"
if [[ "$FIELDS" != "core" && "$FIELDS" != "complete" ]]; then
  echo "Productiewrapper weigert veldenset '$FIELDS'; alle Weerlab-pluimen vereisen core." >&2
  exit 2
fi
mkdir -p "$STATE_DIR"
CYCLE_ARGS=()
if [[ -n "${PLUIM_DIRECT_CYCLE:-}" ]]; then
  CYCLE_ARGS+=(--cycle "$PLUIM_DIRECT_CYCLE")
  if [[ -n "${PLUIM_DIRECT_DATE:-}" ]]; then
    CYCLE_ARGS+=(--date "$PLUIM_DIRECT_DATE")
  fi
fi

# Four daily cycles, explicitly selected after the normal public-data delay.
if ((${#CYCLE_ARGS[@]} == 0)); then
  read -r cycle_date cycle_hour < <("$PY" -c 'from datetime import datetime,timedelta,timezone; n=datetime.now(timezone.utc)-timedelta(hours=6, minutes=30); print(n.strftime("%Y%m%d"),n.hour//6*6)')
  CYCLE_ARGS=(--date "$cycle_date" --cycle "$cycle_hour")
fi

acquire_lock() {
  local directory="$1" label="$2" existing_pid=""
  if mkdir "$directory" 2>/dev/null; then
    printf '%s\n' "$$" > "$directory/pid"
    return 0
  fi
  existing_pid=$(sed -n '1p' "$directory/pid" 2>/dev/null || true)
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "[$(date -u +%FT%TZ)] $label draait al (pid $existing_pid) — skip"
    return 1
  fi
  rm -f "$directory/pid"
  rmdir "$directory" 2>/dev/null || return 1
  mkdir "$directory"
  printf '%s\n' "$$" > "$directory/pid"
}

acquire_lock "$LOCK_DIR" "directe pluim" || exit 0
if ! acquire_lock "$WRITER_LOCK_DIR" "pluimarchief-schrijver"; then
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
  exit 0
fi
RUN_LOG=$(mktemp /tmp/nl.edaldus.pluim-direct-output.XXXXXX)
active_pid=""
state_tmp=""
archive_stamp_tmp=""
cleanup() {
  rm -f "$RUN_LOG"
  [[ -z "$state_tmp" ]] || rm -f "$state_tmp"
  [[ -z "$archive_stamp_tmp" ]] || rm -f "$archive_stamp_tmp"
  rm -f "$WRITER_LOCK_DIR/pid"
  rmdir "$WRITER_LOCK_DIR" 2>/dev/null || true
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
terminate() {
  local exit_status="$1"
  trap - INT TERM
  if [[ "$active_pid" =~ ^[0-9]+$ ]] && kill -0 "$active_pid" 2>/dev/null; then
    kill -TERM "$active_pid" 2>/dev/null || true
    wait "$active_pid" 2>/dev/null || true
  fi
  exit "$exit_status"
}
trap cleanup EXIT
trap 'terminate 130' INT
trap 'terminate 143' TERM

meta_run() {
  "$PY" -c 'import json,sys; d=json.load(open(sys.argv[1])); value=d.get("run"); assert d.get("complete") is True and isinstance(value,str) and value; print(value)' "$1"
}

archive_revision() {
  "$PY" -c 'import hashlib,json,sys; d=json.load(open(sys.argv[1])); s={k:d.get(k) for k in ("schema","complete","station_count","member_count","runs")}; expected=hashlib.sha256(json.dumps(s,sort_keys=True,separators=(",",":")).encode()).hexdigest(); value=d.get("revision"); assert d.get("complete") is True and value == expected; print(value)' "$1"
}

persist_publish_state() {
  state_tmp=$(mktemp "$STATE_DIR/.pluim-direct-published.XXXXXX")
  /bin/cp "$1" "$state_tmp"
  meta_run "$state_tmp" >/dev/null
  chmod 600 "$state_tmp"
  /bin/mv -f "$state_tmp" "$PUBLISH_STATE"
  state_tmp=""
}

seed_publish_state() {
  if [[ -f "$PUBLISH_STATE" ]]; then
    meta_run "$PUBLISH_STATE" >/dev/null
    return 0
  fi
  state_tmp=$(mktemp "$STATE_DIR/.pluim-direct-seed.XXXXXX")
  if ! /usr/bin/curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
      -H 'Cache-Control: no-cache' -o "$state_tmp" \
      "${REMOTE_META_URL}?rollback_check=$(date -u +%s)"; then
    echo "Kan het gepubliceerde pluimmanifest niet controleren; veilige poll overgeslagen." >&2
    return 1
  fi
  meta_run "$state_tmp" >/dev/null
  chmod 600 "$state_tmp"
  /bin/mv -f "$state_tmp" "$PUBLISH_STATE"
  state_tmp=""
  echo "Gepubliceerde runstatus duurzaam ingelezen: $(meta_run "$PUBLISH_STATE")"
}

run_publisher() {
  local cache_control="$1" status
  shift
  set +e
  R2_CACHE_CONTROL="$cache_control" \
    "$REPO_DIR/shell/r2_publish.sh" "$@" &
  active_pid=$!
  wait "$active_pid"
  status=$?
  active_pid=""
  set -e
  return "$status"
}

sync_jan_visser_native() {
  if "$PY" - "$REPO_DIR/pluim_direct_meta.json" "$REPO_DIR/jvens.json" <<'CHECK'
import json,sys
from datetime import datetime
try:
 target=json.load(open(sys.argv[1]))['run']
 current=json.load(open(sys.argv[2])).get('current_run','')
 sys.exit(0 if not current or datetime.fromisoformat(target.replace('Z','+00:00'))>datetime.fromisoformat(current.replace('Z','+00:00')) else 1)
except Exception:sys.exit(0)
CHECK
  then
    if ! /bin/bash "$REPO_DIR/shell/jan_visser_ens_cache.sh" >> /tmp/nl.edaldus.janvisser-ens.log 2>> /tmp/nl.edaldus.janvisser-ens.err; then
      echo "Jan Visser wacht op beschikbare eigen ECMWF-data; volgende controle probeert opnieuw."
    fi
  fi
}

cd "$REPO_DIR"
seed_publish_state
echo "[$(date -u +%FT%TZ)] pluim_direct_cache start (velden: $FIELDS)"

producer_command=(
  "$PY" shell/ecmwf_pluim_direct.py
  --repo-dir "$REPO_DIR"
  --out-dir "$REPO_DIR"
  --fields "$FIELDS"
  --published-state "$PUBLISH_STATE"
)
if ((${#CYCLE_ARGS[@]})); then
  producer_command+=("${CYCLE_ARGS[@]}")
fi
producer_command+=(--batch-steps 1 --max-temp-gib 4 --workers 4 --source ecmwf --hourly)
if [[ "${PLUIM_DIRECT_ARCHIVE_ONLY:-0}" == "1" ]]; then
  producer_command+=(--archive-only)
fi

# Publish verified growing prefixes before the final-run readiness gate.
if [[ "${PLUIM_DIRECT_ARCHIVE_ONLY:-0}" != "1" ]]; then
progressive_command=("${producer_command[@]}")
progressive_command[1]="shell/ecmwf_pluim_progressive.py"
"${progressive_command[@]}" > "$RUN_LOG" &
active_pid=$!
set +e
wait "$active_pid"
progressive_status=$?
active_pid=""
set -e
cat "$RUN_LOG"
if ((progressive_status != 0)); then
  echo "Progressieve aanvoer onderbroken; laatst gepubliceerde pluim behouden" >&2
  exit "$progressive_status"
fi
if ! /usr/bin/grep -q '^PROGRESSIVE_FULL:' "$RUN_LOG"; then
  exit 0
fi

fi

set +e
"${producer_command[@]}" > "$RUN_LOG" &
active_pid=$!
wait "$active_pid"
producer_status=$?
active_pid=""
set -e
cat "$RUN_LOG"
if ((producer_status != 0)); then
  echo "Directe ECMWF-producent stopte met status $producer_status" >&2
  exit "$producer_status"
fi

written_line=$(sed -n 's/^WRITTEN://p' "$RUN_LOG" | tail -1)
if [[ -z "$written_line" ]]; then
  echo "Geen nieuwe directe pluimbestanden om te uploaden."
  exit 0
fi

read -r -a to_upload <<< "$written_line"
meta="$REPO_DIR/pluim_direct_meta.json"
station_files=()
archive_manifest_written=0
for path in "${to_upload[@]}"; do
  if [[ "$path" == "$meta" ]]; then
    continue
  elif [[ "$path" == "$ARCHIVE_MANIFEST" ]]; then
    archive_manifest_written=1
  else
    station_files+=("$path")
  fi
done
if ((archive_manifest_written != 1)); then
  echo "Directe pluimbatch mist het capability-manifest; upload geweigerd." >&2
  exit 1
fi
local_archive_revision=$(archive_revision "$ARCHIVE_MANIFEST")

assert_publish_not_rollback() {
  [[ -f "$PUBLISH_STATE" ]] || return 0
  local candidate published
  candidate=$(meta_run "$meta")
  published=$(meta_run "$PUBLISH_STATE")
  if [[ "$candidate" < "$published" ]]; then
    echo "Weiger R2-terugval van $published naar $candidate" >&2
    return 1
  fi
}

assert_publish_not_rollback
published_archive_revision=$(sed -n '1p' "$PUBLISHED_REVISION_STAMP" 2>/dev/null || true)
if [[ -f "$PUBLISH_STATE" ]] && cmp -s "$meta" "$PUBLISH_STATE" \
    && [[ "$local_archive_revision" == "$published_archive_revision" ]]; then
  echo "Directe run is lokaal en op R2 al volledig gepubliceerd."
  sync_jan_visser_native
  exit 0
fi

# Stationdata eerst, dan het capability-manifest en pas daarna het directe
# runmanifest. Zo kan geen oude specialist-capability naar nieuwe coredata
# wijzen, ook niet wanneer een upload halverwege wordt afgebroken.
if ((${#station_files[@]})); then
  echo "[$(date -u +%FT%TZ)] publicatie stationbestanden start (${#station_files[@]})"
  run_publisher "public, max-age=600" "${station_files[@]}"
  echo "[$(date -u +%FT%TZ)] publicatie stationbestanden klaar"
fi
assert_publish_not_rollback
echo "[$(date -u +%FT%TZ)] publicatie capability-manifest start"
run_publisher "public, max-age=60" "$ARCHIVE_MANIFEST"
archive_stamp_tmp="${PUBLISHED_REVISION_STAMP}.$$"
printf '%s\n' "$local_archive_revision" > "$archive_stamp_tmp"
/bin/mv -f "$archive_stamp_tmp" "$PUBLISHED_REVISION_STAMP"
archive_stamp_tmp=""
echo "[$(date -u +%FT%TZ)] publicatie capability-manifest klaar"
assert_publish_not_rollback
echo "[$(date -u +%FT%TZ)] publicatie runmanifest start"
run_publisher "public, max-age=60" "$meta"
persist_publish_state "$meta"
echo "[$(date -u +%FT%TZ)] publicatie runmanifest klaar"

sync_jan_visser_native
echo "[$(date -u +%FT%TZ)] pluim_direct_cache klaar"
