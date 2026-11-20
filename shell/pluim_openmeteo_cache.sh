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
cleanup() { rm -f "$LOCK/pid";rmdir "$LOCK" 2>/dev/null || true; }
trap cleanup EXIT
primary_status=0
/usr/local/bin/python3 -u "$REPO/shell/pluim_openmeteo_primary.py" --repo "$REPO" --state-dir "/Users/aldus/Library/Application Support/Weerlab/pluim-free" || primary_status=$?
# Landelijke sampling heeft een eigen lock en houdt de 39-stationschrijver vrij.
cleanup
trap - EXIT
TOP3_STATE="/Volumes/WEERLAB/Modeldata/ECMWF/pluimen/top3"
TOP3_PYTHON="/Users/aldus/Library/Application Support/Weerlab/pluim-top3-python"
if /usr/sbin/diskutil info -plist /Volumes/WEERLAB | /usr/local/bin/python3 -c 'import plistlib,sys; d=plistlib.loads(sys.stdin.buffer.read()); sys.exit(0 if d.get("VolumeUUID")=="BBD67AB1-0A13-4865-B651-E9B8EF6AD337" else 1)'; then
  PYTHONPATH="$TOP3_PYTHON${PYTHONPATH:+:$PYTHONPATH}" /usr/local/bin/python3 -u "$REPO/shell/pluim_top3_landelijk.py" --repo "$REPO" --state "$TOP3_STATE" >> /tmp/nl.edaldus.pluim-top3.log 2>> /tmp/nl.edaldus.pluim-top3.err || echo "Landelijke top 3 wacht op brongegevens; bestaande ranglijsten behouden."
fi
exit "$primary_status"
