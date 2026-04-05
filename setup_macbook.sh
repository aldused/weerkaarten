#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
# Weerlab.nl Backup Setup Script voor MacBook
# Draai dit script op je MacBook om alles in te richten als backup
# Gebruik: bash setup_macbook.sh
# ══════════════════════════════════════════════════════════════════════

set -e
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Weerlab.nl — MacBook Backup Setup                         ║"
echo "║  Dit script richt je MacBook in als backup voor weerlab.nl  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Project directory ──
PROJECT_DIR="$HOME/KNMI_Project"
REPO_DIR="$PROJECT_DIR/weerkaarten 2"

if [ -d "$REPO_DIR/.git" ]; then
    echo "✅ Repository bestaat al: $REPO_DIR"
    cd "$REPO_DIR"
    git pull
else
    echo "📦 Repository clonen..."
    mkdir -p "$PROJECT_DIR"
    cd "$PROJECT_DIR"
    git clone https://github.com/aldused/weerkaarten.git "weerkaarten 2"
    cd "$REPO_DIR"
    echo "✅ Repository gekloond"
fi

# ── 2. Python packages installeren ──
echo ""
echo "📦 Python packages installeren..."
pip3 install --user requests beautifulsoup4 openpyxl pandas numpy matplotlib pillow lxml 2>/dev/null || {
    /usr/local/bin/pip3 install requests beautifulsoup4 openpyxl pandas numpy matplotlib pillow lxml 2>/dev/null || {
        echo "⚠️  Kan packages niet installeren. Probeer handmatig: pip3 install requests beautifulsoup4 openpyxl pandas numpy matplotlib pillow lxml"
    }
}
echo "✅ Packages geïnstalleerd"

# ── 3. Cache directories aanmaken ──
echo ""
echo "📁 Cache directories aanmaken..."
mkdir -p "$REPO_DIR/neerslag_cache"
mkdir -p "$REPO_DIR/l5_cache"
mkdir -p "$REPO_DIR/p13_cache"
echo "✅ Cache directories klaar"

# ── 4. LaunchAgents installeren ──
echo ""
echo "⏰ LaunchAgents installeren..."
echo "   (Worden NIET automatisch gestart — gebruik 'bash start_backup.sh' om te activeren)"

LAUNCH_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$LAUNCH_DIR"

# Python pad detecteren
PYTHON=$(which python3 2>/dev/null || echo "/usr/local/bin/python3")
echo "   Python: $PYTHON"

# Functie om LaunchAgent te maken
maak_agent() {
    local LABEL="$1"
    local INTERVAL="$2"
    local CMD="$3"
    local RUN_AT_LOAD="${4:-false}"

    cat > "$LAUNCH_DIR/${LABEL}.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>${CMD}</string>
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL}</integer>
  <key>StandardOutPath</key>
  <string>/tmp/${LABEL}.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/${LABEL}.err</string>
  <key>RunAtLoad</key>
  <${RUN_AT_LOAD}/>
</dict>
</plist>
PLIST
    echo "   ✓ ${LABEL} (elke $((INTERVAL/60)) min)"
}

# Toplijst — elke 10 min
maak_agent "nl.edaldus.toplijst" 600 \
    "cd \"$REPO_DIR\" && $PYTHON scripts/maak_toplijst.py && $PYTHON scripts/maak_index.py && git add toplijst.json toplijst.html index.json && git diff --cached --quiet || (git commit -m \"Toplijst update \$(date '+%Y-%m-%d %H:%M')\" && git push)" \
    "true"

# Synopkaart + waarschuwingen — elke 10 min
maak_agent "nl.edaldus.synopkaart" 600 \
    "cd \"$REPO_DIR\" && $PYTHON scripts/haal_waarschuwingen.py && $PYTHON scripts/maak_synop_kaart.py && $PYTHON scripts/maak_actueel.py && git add waarschuwingen.json actueel.json kaart_synop_*.png && git diff --cached --quiet || (git commit -m \"Synop + waarschuwingen + toplijst update\" && git push)"

# METAR — elke 15 min
maak_agent "nl.edaldus.metar" 900 \
    "cd \"$REPO_DIR\" && $PYTHON scripts/haal_metar.py && git add metar_data.json && git diff --cached --quiet || (git commit -m \"METAR update \$(date '+%Y-%m-%d %H:%M')\" && git push)" \
    "true"

# Bulletin — elke 15 min
maak_agent "nl.edaldus.bulletin" 900 \
    "cd \"$REPO_DIR\" && $PYTHON scripts/haal_luchtvaart_bulletin.py && git add luchtvaart_bulletin.json && git diff --cached --quiet || (git commit -m \"Luchtvaart bulletin update \$(date '+%H:%M')\" && git push)" \
    "true"

# Guidance — elke 30 min
maak_agent "nl.edaldus.guidance" 1800 \
    "cd \"$REPO_DIR\" && $PYTHON scripts/haal_guidance.py && git add guidance.json && git diff --cached --quiet || (git commit -m \"Guidance update \$(date '+%H:%M')\" && git push)" \
    "true"

# MOSMIX JSON — elk uur
maak_agent "nl.edaldus.mosmix-json" 3600 \
    "cd \"$REPO_DIR\" && $PYTHON scripts/mosmix_json.py && git add mosmix_nl.json mosmix_be.json && git diff --cached --quiet || (git commit -m \"MOSMIX JSON update \$(date '+%Y-%m-%d %H:%M')\" && git push)" \
    "true"

# Verwachting — elke 15 min
maak_agent "nl.edaldus.verwachting" 900 \
    "cd \"$REPO_DIR\" && $PYTHON scripts/haal_knmi_verwachting.py && git add knmi_verwachting.json && git diff --cached --quiet || (git commit -m \"KNMI verwachting update \$(date '+%Y-%m-%d %H:%M')\" && git push)"

# Weerkaarten (volledige update) — 4x per dag
cat > "$LAUNCH_DIR/nl.edaldus.weerkaarten.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>nl.edaldus.weerkaarten</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>cd "$REPO_DIR" && bash shell/upload_kaarten.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>15</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>30</integer></dict>
  </array>
  <key>StandardOutPath</key>
  <string>$REPO_DIR/launchd_out.log</string>
  <key>StandardErrorPath</key>
  <string>$REPO_DIR/launchd_err.log</string>
</dict>
</plist>
PLIST
echo "   ✓ nl.edaldus.weerkaarten (4x per dag)"

# Dagelijkse records
maak_agent "nl.edaldus.weerrecords" 86400 \
    "cd \"$REPO_DIR/scripts\" && $PYTHON knmi_records.py"

echo ""
echo "✅ LaunchAgents aangemaakt (nog niet geladen)"

# ── 5. Start/Stop scripts maken ──
cat > "$PROJECT_DIR/start_backup.sh" << 'STARTSCRIPT'
#!/bin/bash
echo "🟢 Backup LaunchAgents starten..."
for plist in ~/Library/LaunchAgents/nl.edaldus.*.plist; do
    launchctl load "$plist" 2>/dev/null && echo "  ✓ $(basename "$plist" .plist)"
done
echo "✅ Alle agents gestart!"
echo "   Check status: launchctl list | grep edaldus"
STARTSCRIPT
chmod +x "$PROJECT_DIR/start_backup.sh"

cat > "$PROJECT_DIR/stop_backup.sh" << 'STOPSCRIPT'
#!/bin/bash
echo "🔴 Backup LaunchAgents stoppen..."
for plist in ~/Library/LaunchAgents/nl.edaldus.*.plist; do
    launchctl unload "$plist" 2>/dev/null && echo "  ✓ $(basename "$plist" .plist)"
done
echo "✅ Alle agents gestopt"
STOPSCRIPT
chmod +x "$PROJECT_DIR/stop_backup.sh"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ✅ Setup compleet!                                        ║"
echo "║                                                            ║"
echo "║  Starten:  bash ~/KNMI_Project/start_backup.sh             ║"
echo "║  Stoppen:  bash ~/KNMI_Project/stop_backup.sh              ║"
echo "║  Status:   launchctl list | grep edaldus                   ║"
echo "║                                                            ║"
echo "║  ⚠️  Start NIET tegelijk met je desktop!                    ║"
echo "║  Eerst desktop stoppen, dan MacBook starten.                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
