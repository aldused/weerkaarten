#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerkaarten 2"
cd "$SCRIPT_DIR"
git checkout main 2>/dev/null || true

echo "=== Ed Aldus WM — upload $(date) ==="

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_waarschuwingen.py"       || { echo "FOUT: haal_waarschuwingen.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_guidance.py"             || echo "WAARSCHUWING: haal_guidance.py mislukt"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_luchtvaart_bulletin.py"  || echo "WAARSCHUWING: haal_luchtvaart_bulletin.py mislukt"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_maanddata.py"            || echo "WAARSCHUWING: haal_maanddata.py mislukt"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_fixed.py"        || { echo "FOUT: mosmix_kaart_fixed.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_beta_debilt.py"          || { echo "FOUT: maak_beta_debilt.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_beta_verificatie.py"     || { echo "FOUT: maak_beta_verificatie.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_grafiek.py"              || { echo "FOUT: maak_grafiek.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_grafiek_be.py"           || { echo "FOUT: maak_grafiek_be.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_toplijst.py"             || { echo "FOUT: maak_toplijst.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_toplijst_kaarten.py"     || { echo "FOUT: maak_toplijst_kaarten.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_waarnemingen_kaarten.py" || { echo "FOUT: maak_waarnemingen_kaarten.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_json.py"               || { echo "FOUT: mosmix_json.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_index.py"                || { echo "FOUT: maak_index.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/maak_p13_html.py"                     || { echo "FOUT: maak_p13_html.py"; exit 1; }

git add -A

if git diff --cached --quiet; then
    echo "Niets gewijzigd, geen commit nodig."
else
    git commit -m "Kaarten update $(date '+%Y-%m-%d %H:%M')"
    git push
    echo "=== Upload klaar ==="
fi
