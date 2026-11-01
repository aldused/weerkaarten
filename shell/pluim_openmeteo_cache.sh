#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REPO=/Users/aldus/KNMI_Project/weerlab
LOCK=/tmp/nl.edaldus.pluim-archive-writer.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  owner=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [[ "$owner" =~ ^[0-9]+$ ]] && kill -0 "$owner" 2>/dev/null; then exit 0; fi
  rm -f "$LOCK/pid";rmdir "$LOCK" 2>/dev/null || exit 0
  mkdir "$LOCK" 2>/dev/null || exit 0
fi
printf '%s\n' "$$" > "$LOCK/pid"
trap 'rm -f "$LOCK/pid";rmdir "$LOCK" 2>/dev/null || true' EXIT
/usr/local/bin/python3 -u "$REPO/shell/pluim_openmeteo_primary.py" --repo "$REPO" --state-dir "/Users/aldus/Library/Application Support/Weerlab/pluim-free"
