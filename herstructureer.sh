#!/bin/bash
set -e
cd ~/Desktop/KNMI_Project/"weerkaarten 2"

echo "=== Mappen aanmaken ==="
mkdir -p scripts shell

echo "=== Scripts verplaatsen ==="
mv -f mosmix_kaart_fixed.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_temp_dag.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_temp_nacht.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_be_temp.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_be_temp_dag.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_be_temp_nacht.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_bewolking.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_dauwpunt.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_gevoels.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_mist.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_onweer.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_regen.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_t5cm.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_wind.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_wind_nacht.py scripts/ 2>/dev/null || true
mv -f mosmix_kaart_zon.py scripts/ 2>/dev/null || true
mv -f maak_grafiek.py scripts/ 2>/dev/null || true
mv -f maak_index.py scripts/ 2>/dev/null || true
mv -f maak_beta_debilt.py scripts/ 2>/dev/null || true
mv -f maak_beta_verificatie.py scripts/ 2>/dev/null || true
mv -f maak_synop_kaart.py scripts/ 2>/dev/null || true
mv -f maak_toplijst.py scripts/ 2>/dev/null || true
mv -f maak_waarnemingen_kaarten.py scripts/ 2>/dev/null || true
mv -f maak_pluim_lijnen.py scripts/ 2>/dev/null || true
mv -f maak_pluim_compleet.py scripts/ 2>/dev/null || true
mv -f maak_pluim_multi_neerslag.py scripts/ 2>/dev/null || true
mv -f maak_pluim_multimodel.py scripts/ 2>/dev/null || true
mv -f maak_pluim_multi_wind.py scripts/ 2>/dev/null || true
mv -f maak_pluim_bewolking.py scripts/ 2>/dev/null || true
mv -f maak_pluim_bewolking_stapel.py scripts/ 2>/dev/null || true
mv -f maak_pluim_multi_bewolking.py scripts/ 2>/dev/null || true
mv -f maak_pluim_neerslag.py scripts/ 2>/dev/null || true
mv -f maak_pluim_wind.py scripts/ 2>/dev/null || true
mv -f haal_waarschuwingen.py scripts/ 2>/dev/null || true
mv -f knmi_records.py scripts/ 2>/dev/null || true
mv -f knmi_p13.py scripts/ 2>/dev/null || true

echo "=== Shell/plist verplaatsen ==="
mv -f upload_kaarten.sh shell/ 2>/dev/null || true
mv -f backup_weerkaarten.sh shell/ 2>/dev/null || true
mv -f upload_toplijst.sh shell/ 2>/dev/null || true
mv -f nl.edaldus.weerkaarten.plist shell/ 2>/dev/null || true
mv -f nl.edaldus.weerkaarten.backup.plist shell/ 2>/dev/null || true
mv -f nl.edaldus.weerrecords.plist shell/ 2>/dev/null || true
mv -f nl.edaldus.synopkaart.plist shell/ 2>/dev/null || true

echo "=== os.chdir aanpassen in alle scripts ==="
for f in scripts/*.py; do
    # Vervang os.chdir(os.path.dirname(os.path.abspath(__file__)))
    # door os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    sed -i '' 's|os\.chdir(os\.path\.dirname(os\.path\.abspath(__file__)))|os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))|g' "$f"
    echo "  Aangepast: $f"
done

echo "=== upload_kaarten.sh paden aanpassen ==="
sed -i '' 's|\$SCRIPT_DIR/mosmix_|\$SCRIPT_DIR/scripts/mosmix_|g' shell/upload_kaarten.sh
sed -i '' 's|\$SCRIPT_DIR/maak_|\$SCRIPT_DIR/scripts/maak_|g' shell/upload_kaarten.sh
sed -i '' 's|\$SCRIPT_DIR/haal_|\$SCRIPT_DIR/scripts/haal_|g' shell/upload_kaarten.sh

echo "=== LaunchAgent plists aanpassen ==="
# upload
sed -i '' 's|weerkaarten 2/upload_kaarten.sh|weerkaarten 2/shell/upload_kaarten.sh|g' shell/nl.edaldus.weerkaarten.plist 2>/dev/null || true
# backup
sed -i '' 's|weerkaarten 2/backup_weerkaarten.sh|weerkaarten 2/shell/backup_weerkaarten.sh|g' shell/nl.edaldus.weerkaarten.backup.plist 2>/dev/null || true
# synop
sed -i '' 's|weerkaarten 2/maak_synop_kaart.py|weerkaarten 2/scripts/maak_synop_kaart.py|g' shell/nl.edaldus.synopkaart.plist 2>/dev/null || true
# records
sed -i '' 's|weerkaarten 2/knmi_records.py|weerkaarten 2/scripts/knmi_records.py|g' shell/nl.edaldus.weerrecords.plist 2>/dev/null || true

echo ""
echo "=== Klaar! Controleer met: ls scripts/ shell/ ==="
