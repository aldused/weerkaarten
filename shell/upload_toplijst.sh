SCRIPT_DIR="/Users/aldus/KNMI_Project/weerkaarten 2"
cd "$SCRIPT_DIR"

echo "=== Toplijst update $(date) ==="

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_toplijst.py"          || { echo "FOUT: maak_toplijst.py";          exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_toplijst_kaarten.py"  || { echo "FOUT: maak_toplijst_kaarten.py";  exit 1; }
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

# Toplijst-kaarten (PNG) — alleen uploaden als ze bestaan
shopt -s nullglob 2>/dev/null
for png in kaart_top_*.png; do
    r2push "$png"
done

# ── Git commit+push (vangnet tijdens overgang) ─────────────────────────────
git add toplijst.json toplijst.html index.json kaart_top_*.png

if git diff --cached --quiet; then
    echo "Niets gewijzigd."
else
    git commit -m "Toplijst update $(date '+%Y-%m-%d %H:%M')"
    git push
    echo "=== Upload klaar ==="
fi
