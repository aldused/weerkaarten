#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Ed Aldus WM — upload $(date) ==="

/usr/local/bin/python3 "$SCRIPT_DIR/mosmix_kaart_fixed.py" || { echo "FOUT: mosmix_kaart_fixed.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/mosmix_kaart_zon.py"   || { echo "FOUT: mosmix_kaart_zon.py";   exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/mosmix_kaart_wind.py"  || { echo "FOUT: mosmix_kaart_wind.py";  exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/mosmix_kaart_wind_nacht.py" || { echo "FOUT: mosmix_kaart_wind_nacht.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/mosmix_kaart_mist.py" || { echo "FOUT: mosmix_kaart_mist.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/mosmix_kaart_t5cm.py" || { echo "FOUT: mosmix_kaart_t5cm.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/mosmix_kaart_dauwpunt.py" || { echo "FOUT: mosmix_kaart_dauwpunt.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/mosmix_kaart_gevoels.py"  || { echo "FOUT: mosmix_kaart_gevoels.py";  exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/mosmix_kaart_regen.py" || { echo "FOUT: mosmix_kaart_regen.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/maak_beta_debilt.py"      || { echo "FOUT: maak_beta_debilt.py";      exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/maak_beta_verificatie.py" || { echo "FOUT: maak_beta_verificatie.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/maak_grafiek.py"          || { echo "FOUT: maak_grafiek.py";          exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/maak_toplijst.py"      || { echo "FOUT: maak_toplijst.py";      exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/maak_index.py"         || { echo "FOUT: maak_index.py";         exit 1; }

git add kaart_*.png kaart_zon_*.png kaart_wind_*.png kaart_regen_*.png kaart_mist_*.png kaart_t5cm_*.png kaart_dauwpunt_*.png kaart_gevoels_*.png \
        index.json index.html toplijst.html toplijst.json grafiek_trend.png beta_debilt.html beta_debilt.json beta_verificatie.json beta_verificatie_archive.json

if git diff --cached --quiet; then
    echo "Niets gewijzigd, geen commit nodig."
else
    git commit -m "Kaarten update $(date '+%Y-%m-%d %H:%M')"
    git push
    echo "=== Upload klaar ==="
fi
