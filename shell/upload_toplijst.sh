#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

echo "=== Toplijst update $(date) ==="

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_toplijst.py"          || { echo "FOUT: maak_toplijst.py";          exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_index.py"             || { echo "FOUT: maak_index.py";              exit 1; }

# ── Upload naar R2 (data.weerlab.nl) ────────────────────────────────────────
# Cache 60s bij Cloudflare edge — toplijst ververst elke ~10 min
r2push() {
    /opt/homebrew/bin/rclone copy "$1" r2:weerlab-data/ \
        --header-upload "Cache-Control: public, max-age=60" \
        --no-traverse
}

r2push toplijst.json
r2push index.json

# ── Git commit+push (vangnet tijdens overgang) ─────────────────────────────
"$SCRIPT_DIR/shell/git_publish.sh" \
    "Toplijst update $(date '+%Y-%m-%d %H:%M')" \
    toplijst.json toplijst.html index.json
