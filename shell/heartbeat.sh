#!/bin/bash
# heartbeat.sh — registreer succesvolle pipeline-run in heartbeat.json en
# publiceer naar R2 (data.weerlab.nl/heartbeat.json).
#
# Gebruik: heartbeat.sh <pipeline_naam>
#   bv. heartbeat.sh dagdata
#       heartbeat.sh mtg-benelux
#       heartbeat.sh waarschuwingen
#
# Output JSON-vorm:
#   {
#     "updated": "2026-05-02T12:34:56Z",
#     "pipelines": {
#       "dagdata":         { "ts": "2026-05-02T12:00:11Z" },
#       "mtg-benelux":     { "ts": "2026-05-02T12:30:02Z" },
#       ...
#     }
#   }

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Gebruik: heartbeat.sh <pipeline_naam>" >&2
  exit 2
fi

PIPELINE="$1"
REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
HEARTBEAT_FILE="$REPO_DIR/data/heartbeat.json"
LOCK_DIR="$REPO_DIR/data/.heartbeat.lock"
LOCK_TIMEOUT=60
WAITED=0

mkdir -p "$REPO_DIR/data"

# Eenvoudige file-lock (meerdere pipelines kunnen tegelijk eindigen).
while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  if [ "$WAITED" -ge "$LOCK_TIMEOUT" ]; then
    echo "FOUT: heartbeat-lock bleef te lang staan: $LOCK_DIR" >&2
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

NOW="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

/usr/local/bin/python3 - "$HEARTBEAT_FILE" "$PIPELINE" "$NOW" <<'PY'
import json, os, sys

path, pipeline, now = sys.argv[1], sys.argv[2], sys.argv[3]

data = {"updated": now, "pipelines": {}}
if os.path.exists(path):
    try:
        with open(path) as f:
            existing = json.load(f)
        if isinstance(existing, dict):
            data["pipelines"] = existing.get("pipelines", {}) or {}
    except Exception:
        pass

data["pipelines"][pipeline] = {"ts": now}
data["updated"] = now

tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(data, f, indent=2, sort_keys=True)
os.replace(tmp, path)
PY

# Push naar R2 (dezelfde Cache-Control zoals andere data-files).
"$REPO_DIR/shell/r2_publish.sh" "$HEARTBEAT_FILE" >/dev/null || {
  echo "Waarschuwing: R2-upload heartbeat mislukte (lokale file is wel bijgewerkt)" >&2
}

echo "heartbeat: $PIPELINE @ $NOW"
