#!/bin/bash
set -e

# Eén writer voor generatie + upload. Ook handmatige starts en een eventueel
# nog geladen oud launchd-pad kunnen zo niet tegelijk toplijst.json vervangen.
LOCK_FILE="/tmp/weerlab-toplijst.lock"
exec 9>"$LOCK_FILE"
if ! /usr/bin/lockf -s -t 0 9; then
  echo "Toplijst-update overgeslagen: vorige ronde draait nog ($(date))"
  exit 0
fi

# Logrotatie: launchd appendt stdout naar logs/toplijst.log; zonder guard
# groeit die onbegrensd (was 110 MB). Boven 5 MB leegmaken.
LOGFILE="/Users/aldus/KNMI_Project/logs/toplijst.log"
if [ -f "$LOGFILE" ] && [ "$(stat -f%z "$LOGFILE")" -gt 5242880 ]; then
  : > "$LOGFILE"
  echo "[logrotatie] toplijst.log geleegd $(date)"
fi

SCRIPT_DIR="/Users/aldus/KNMI_Project/weerlab"
cd "$SCRIPT_DIR"
echo "=== Toplijst update $(date) ==="
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_toplijst.py" || { echo "FOUT: maak_toplijst.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_index.py"    || { echo "FOUT: maak_index.py";    exit 1; }

# ── Upload naar R2 (data.weerlab.nl) ────────────────────────────────────────
"$SCRIPT_DIR/shell/r2_publish.sh" toplijst.json index.json

# ── Hittegolven verversen met lopende dagtemperaturen (~1,6s) ───────────────
# Leest de zojuist bijgewerkte toplijst.json zodat de hittegolfpagina de
# lopende max van vandaag meeneemt en niet achterloopt.
/usr/local/bin/python3 "$SCRIPT_DIR/scripts/maak_hittegolven.py" || { echo "FOUT: maak_hittegolven.py"; exit 1; }
"$SCRIPT_DIR/shell/r2_publish.sh" hittegolven.json
