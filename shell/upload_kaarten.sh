#!/bin/bash
# Draait 6x/dag (02:30/06:30/10:30/14:30/18:30/22:30) via
# nl.edaldus.weerkaarten (~/Library/LaunchAgents) -> weerlab/weerkaarten_run.sh.
# Dit script is dus NIET verweesd; log: weerlab/launchd_out.log.
#
# Elders (bewust dubbel of verhuisd):
#  - haal_luchtvaart_bulletin.py: eigen job nl.edaldus.bulletin (elke 15 min,
#    weerlab/upload_bulletin.sh) — hier verwijderd op 2 jul 2026
#  - haal_guidance.py: draait ook in shell/guidance_update.sh (2x/dag);
#    blijft hier staan omdat 6x/dag guidance.json verser houdt
#  - scrape_waarschuwingen.py / haal_maanddata.py /
#    maak_index.py / mosmix_json.py: hebben ook eigen frequentere jobs
set -e

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"

echo "=== Ed Aldus WM — upload $(date) ==="

/usr/local/bin/python3 "$SCRIPT_DIR/scripts/scrape_waarschuwingen.py"    || { echo "FOUT: scrape_waarschuwingen.py"; exit 1; }
/usr/local/bin/python3 -c "
import json, sys
try:
    d = json.load(open('waarschuwingen.json'))
    assert 'provinces' in d, 'sleutel provinces ontbreekt'
    assert 'warnings'  in d, 'sleutel warnings ontbreekt'
    assert 'generated' in d, 'sleutel generated ontbreekt'
except Exception as e:
    print('FOUT: waarschuwingen.json verkeerd formaat:', e)
    sys.exit(1)
" || { echo "BLOKKEER R2 upload — waarschuwingen.json heeft oud/kapot formaat"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_guidance.py"             || echo "WAARSCHUWING: haal_guidance.py mislukt"
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/haal_maanddata.py"            || echo "WAARSCHUWING: haal_maanddata.py mislukt"
# Statische kaarten verwijderd (alles nu dynamisch via HTML/JS)
# mosmix_kaart_fixed.py, maak_toplijst_kaarten.py, maak_waarnemingen_kaarten.py → niet meer nodig
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_beta_debilt.py"          || { echo "FOUT: maak_beta_debilt.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_beta_verificatie.py"     || { echo "FOUT: maak_beta_verificatie.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_grafiek.py"              || { echo "FOUT: maak_grafiek.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_grafiek_be.py"           || { echo "FOUT: maak_grafiek_be.py"; exit 1; }
# Toplijst wordt exclusief door nl.edaldus.toplijst gegenereerd en gepubliceerd.
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/mosmix_json.py"               || { echo "FOUT: mosmix_json.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_index.py"                || { echo "FOUT: maak_index.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/maak_p13_html.py"                     || { echo "FOUT: maak_p13_html.py"; exit 1; }

"$SCRIPT_DIR/shell/r2_publish.sh" \
    waarschuwingen.json guidance.json dwd_guidance.json \
    maanddata_*.json beta_debilt.json beta_verificatie.json grafiek_trend.json grafiek_trend_be.json \
    index.json \
    mosmix_nl.json mosmix_be.json mosmix_fr.json mosmix_ibe.json mosmix_de.json mosmix_gb.json \
    mosmix_uurlijks_nl.json mosmix_uurlijks_be.json mosmix_uurlijks_fr.json \
    mosmix_uurlijks_ibe.json mosmix_uurlijks_de.json mosmix_uurlijks_gb.json
