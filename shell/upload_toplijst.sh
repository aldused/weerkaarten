#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

echo "=== Toplijst update $(date) ==="

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_toplijst.py"          || { echo "FOUT: maak_toplijst.py";          exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_index.py"             || { echo "FOUT: maak_index.py";              exit 1; }

# ── Upload naar R2 (data.weerlab.nl) ────────────────────────────────────────
# Cache 60s bij Cloudflare edge — toplijst ververst elke ~10 min
"$SCRIPT_DIR/shell/r2_publish.sh" toplijst.json index.json
