#!/bin/bash
# Immutable data first; publish the discovery pointer only after every upload.
set -euo pipefail
ROOT="${WEERLAB_PROJECT_ROOT:-/Users/aldus/KNMI_Project/weerlab}"
MODEL="${1:?model ontbreekt}"
case "$MODEL" in harmonie) META=harmonie_canvas_meta.json;; harmonie46) META=harmonie46_canvas_meta.json;; *) exit 2;; esac
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
OUTPUT="$(mktemp -d /tmp/weerlab-map-source.XXXXXX)"
trap 'rm -rf "$OUTPUT"' EXIT
/usr/local/bin/python3 "$SCRIPTS/build_map_source.py" --model "$MODEL" --meta "$ROOT/$META" --output "$OUTPUT"
DIR="$(find "$OUTPUT" -mindepth 1 -maxdepth 1 -type d | head -1)"
VERSION="$(basename "$DIR")"
REMOTE="r2:weerlab-harmonie/map-source/$MODEL"
if /opt/homebrew/bin/rclone cat "$REMOTE/latest.json" --quiet 2>/dev/null | /usr/local/bin/python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("version")==sys.argv[1] else 1)' "$VERSION" 2>/dev/null; then
  printf 'Weerkaartbron %s is ongewijzigd: %s\n' "$MODEL" "$VERSION"
  exit 0
fi
/opt/homebrew/bin/rclone copy "$DIR" "$REMOTE/$VERSION" --transfers 8 --checkers 8 --header-upload 'Content-Type: application/octet-stream' --header-upload 'Cache-Control: public, max-age=86400, immutable' --quiet
/opt/homebrew/bin/rclone copyto "$DIR/meta.json" "$REMOTE/latest.json" --header-upload 'Content-Type: application/json' --header-upload 'Cache-Control: public, max-age=30' --quiet
# Keep four immutable snapshots; cleanup is limited to our own generated prefix.
/opt/homebrew/bin/rclone lsf "$REMOTE" --dirs-only | sort -r | tail -n +5 | while IFS= read -r OLD; do
  if [[ "$OLD" =~ ^[0-9]{10}-[0-9a-f]{16}/$ ]] && [ "$OLD" != "$VERSION/" ]; then /opt/homebrew/bin/rclone purge "$REMOTE/$OLD" --quiet; fi
done
printf 'Weerkaartbron %s gepubliceerd: %s\n' "$MODEL" "$VERSION"
