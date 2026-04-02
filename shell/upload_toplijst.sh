SCRIPT_DIR="/Users/aldus/KNMI_Project/weerkaarten 2"
cd "$SCRIPT_DIR"

echo "=== Toplijst update $(date) ==="

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_toplijst.py"          || { echo "FOUT: maak_toplijst.py";          exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_toplijst_kaarten.py"  || { echo "FOUT: maak_toplijst_kaarten.py";  exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_index.py"             || { echo "FOUT: maak_index.py";              exit 1; }

git add toplijst.json toplijst.html index.json kaart_top_*.png

if git diff --cached --quiet; then
    echo "Niets gewijzigd."
else
    git commit -m "Toplijst update $(date '+%Y-%m-%d %H:%M')"
    git push
    echo "=== Upload klaar ==="
fi
