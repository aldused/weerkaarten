#!/bin/bash
set -e

SCRIPT_DIR="/Users/aldus/Desktop/KNMI_Project/weerkaarten 2"
cd "$SCRIPT_DIR"
git checkout main 2>/dev/null || true

echo "=== Ed Aldus WM — upload $(date) ==="

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_waarschuwingen.py"       || { echo "FOUT: haal_waarschuwingen.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_guidance.py"             || echo "WAARSCHUWING: haal_guidance.py mislukt"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_luchtvaart_bulletin.py"  || echo "WAARSCHUWING: haal_luchtvaart_bulletin.py mislukt"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_maanddata.py"            || echo "WAARSCHUWING: haal_maanddata.py mislukt"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_fixed.py"        || { echo "FOUT: mosmix_kaart_fixed.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_temp.py"         || { echo "FOUT: mosmix_kaart_temp.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_temp_dag.py"     || { echo "FOUT: mosmix_kaart_temp_dag.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_temp_nacht.py"   || { echo "FOUT: mosmix_kaart_temp_nacht.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_zon.py"          || { echo "FOUT: mosmix_kaart_zon.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_wind.py"         || { echo "FOUT: mosmix_kaart_wind.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_wind_nacht.py"   || { echo "FOUT: mosmix_kaart_wind_nacht.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_mist.py"         || { echo "FOUT: mosmix_kaart_mist.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_t5cm.py"         || { echo "FOUT: mosmix_kaart_t5cm.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_dauwpunt.py"     || { echo "FOUT: mosmix_kaart_dauwpunt.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_gevoels.py"      || { echo "FOUT: mosmix_kaart_gevoels.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_regen.py"        || { echo "FOUT: mosmix_kaart_regen.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_onweer.py"       || { echo "FOUT: mosmix_kaart_onweer.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_bewolking.py"    || { echo "FOUT: mosmix_kaart_bewolking.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_sneeuw.py"       || { echo "FOUT: mosmix_kaart_sneeuw.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_hagel.py"        || { echo "FOUT: mosmix_kaart_hagel.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_temp.py"      || { echo "FOUT: mosmix_kaart_be_temp.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_temp_dag.py"  || { echo "FOUT: mosmix_kaart_be_temp_dag.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_temp_nacht.py" || { echo "FOUT: mosmix_kaart_be_temp_nacht.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_wind.py"      || { echo "FOUT: mosmix_kaart_be_wind.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_wind_nacht.py" || { echo "FOUT: mosmix_kaart_be_wind_nacht.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_zon.py"       || { echo "FOUT: mosmix_kaart_be_zon.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_regen.py"     || { echo "FOUT: mosmix_kaart_be_regen.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_mist.py"      || { echo "FOUT: mosmix_kaart_be_mist.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_onweer.py"    || { echo "FOUT: mosmix_kaart_be_onweer.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_bewolking.py" || { echo "FOUT: mosmix_kaart_be_bewolking.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_sneeuw.py"    || { echo "FOUT: mosmix_kaart_be_sneeuw.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_hagel.py"     || { echo "FOUT: mosmix_kaart_be_hagel.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_gevoels.py"   || { echo "FOUT: mosmix_kaart_be_gevoels.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_dauwpunt.py"  || { echo "FOUT: mosmix_kaart_be_dauwpunt.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_kaart_be_t5cm.py"      || { echo "FOUT: mosmix_kaart_be_t5cm.py"; exit 1; }
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
