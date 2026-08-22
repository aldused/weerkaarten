#!/bin/bash
# check_macbook.sh — controleer of de MacBook-mirror echt gelijkloopt.
#
# Vergelijkt de commit op de MacBook met origin/main zoals GitHub die nu kent.
# Een eerdere versie keek alleen naar de mtime van pull.log; een pull die
# halverwege faalde liet die log toch vers achter en werd dus als "OK" gemeld.
#
# Draait vanaf beide machines:
#   · op de iMac     → via SSH naar de MacBook (zo draait de launchd-job)
#   · op de MacBook  → rechtstreeks op de eigen repo, geen SSH nodig
#
# Schrijft heartbeat-pipeline 'macbook-pull' alleen bij een schone, gelijke
# kopie, en alleen vanaf de iMac (daar staat heartbeat.sh).
#
# Hourly via launchd (nl.edaldus.macbook-check.plist).
# Handmatig: bash shell/check_macbook.sh
#
# Exit: 0 = gelijk · 1 = loopt achter of vuil · 2 = onbereikbaar

MACBOOK_HOST="eds-macbook-pro.local"
MACBOOK_USER="edaldus"
MACBOOK_REPO="/Users/edaldus/KNMI_Project/weerlab"
IMAC_REPO="/Users/aldus/KNMI_Project/weerlab"
HEARTBEAT="$IMAC_REPO/shell/heartbeat.sh"
STALE_SEC=7200        # pull.log ouder dan 2 uur = pull-job draait niet meer

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# ── 0. Draaien we op de MacBook zelf of op de iMac? ─────────────────────────
# De MacBook heeft de mirror-repo lokaal staan; de iMac niet. Zonder deze
# detectie probeert het script op de MacBook via SSH bij zichzelf binnen te
# komen en meldt het ten onrechte "onbereikbaar".
if [ -d "$MACBOOK_REPO/.git" ]; then
  LOKAAL=1
  REF_REPO="$MACBOOK_REPO"
  log "Modus: lokaal (draait op de MacBook)"
else
  LOKAAL=0
  REF_REPO="$IMAC_REPO"
fi

# Voer een commando uit op de MacBook — lokaal of via SSH, zelfde interface.
op_macbook() {
  if [ "$LOKAAL" -eq 1 ]; then
    bash -c "$1"
  else
    ssh -o ConnectTimeout=10 -o BatchMode=yes "$MACBOOK_USER@$MACBOOK_HOST" "$1"
  fi
}

# ── 1. Wat zou de MacBook moeten hebben? ────────────────────────────────────
# Rechtstreeks bij GitHub opvragen: immuun voor een verouderde lokale fetch.
VERWACHT="$(cd "$REF_REPO" && git ls-remote origin main 2>/dev/null | cut -f1)"
if [ -z "$VERWACHT" ]; then
  log "GitHub onbereikbaar — val terug op lokale origin/main"
  VERWACHT="$(cd "$REF_REPO" && git rev-parse origin/main 2>/dev/null)"
fi
if [ -z "$VERWACHT" ]; then
  log "FOUT: kan geen referentie-commit bepalen"
  exit 2
fi

# ── 2. Status van de MacBook ophalen ────────────────────────────────────────
UITVOER="$(op_macbook "cd '$MACBOOK_REPO' 2>/dev/null || exit 9
   git fetch -q --prune origin 2>/dev/null
   echo \"head=\$(git rev-parse HEAD 2>/dev/null)\"
   echo \"tak=\$(git rev-parse --abbrev-ref HEAD 2>/dev/null)\"
   echo \"vuil=\$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')\"
   echo \"logts=\$(stat -f %m '$MACBOOK_REPO/macbook/pull.log' 2>/dev/null || echo 0)\"" 2>/dev/null)"
STATUS=$?

if [ "$STATUS" -eq 9 ]; then
  log "Repo ontbreekt: $MACBOOK_REPO"
  exit 2
fi
if [ "$STATUS" -ne 0 ] || [ -z "$UITVOER" ]; then
  if [ "$LOKAAL" -eq 1 ]; then
    log "Kan de repo niet uitlezen (status $STATUS)"
  else
    log "MacBook onbereikbaar via SSH (status $STATUS) — aan, op het netwerk, sshd actief?"
  fi
  exit 2
fi

HEAD="$(echo "$UITVOER"  | sed -n 's/^head=//p')"
TAK="$(echo "$UITVOER"   | sed -n 's/^tak=//p')"
VUIL="$(echo "$UITVOER"  | sed -n 's/^vuil=//p')"
LOGTS="$(echo "$UITVOER" | sed -n 's/^logts=//p')"
# Alleen zuivere getallen accepteren. Geeft stat onverwachte uitvoer, dan liever
# "ontbreekt" melden dan doorrekenen met rommel en ten onrechte OK zeggen.
case "$VUIL"  in ''|*[!0-9]*) VUIL=0  ;; esac
case "$LOGTS" in ''|*[!0-9]*) LOGTS=0 ;; esac

# ── 3. Oordeel ─────────────────────────────────────────────────────────────
PROBLEEM=0
KORT_MB="$(echo "$HEAD" | cut -c1-10)"
KORT_GH="$(echo "$VERWACHT" | cut -c1-10)"

if [ "$HEAD" != "$VERWACHT" ]; then
  ACHTER="$(op_macbook "cd '$MACBOOK_REPO' && git rev-list --count HEAD..origin/main 2>/dev/null" 2>/dev/null)"
  log "ACHTER: MacBook $KORT_MB vs GitHub $KORT_GH${ACHTER:+ (${ACHTER} commits achter)}"
  PROBLEEM=1
fi

if [ "$TAK" != "main" ]; then
  log "TAK: MacBook staat op '$TAK' in plaats van main"
  PROBLEEM=1
fi

if [ "$VUIL" -gt 0 ]; then
  # reset --hard gooit dit bij de volgende pull weg; wél het signaleren waard.
  log "VUIL: $VUIL ongecommitte wijziging(en) op de MacBook"
  PROBLEEM=1
fi

NU="$(date +%s)"
LEEFTIJD=$((NU - LOGTS))
if [ "$LOGTS" -eq 0 ]; then
  log "PULL-LOG: ontbreekt — draait de launchd-job op de MacBook wel?"
  PROBLEEM=1
elif [ "$LEEFTIJD" -gt "$STALE_SEC" ]; then
  log "PULL-LOG: ${LEEFTIJD}s oud (> ${STALE_SEC}s) — pull-job lijkt gestopt"
  PROBLEEM=1
fi

if [ "$PROBLEEM" -eq 0 ]; then
  log "OK: MacBook gelijk aan GitHub ($KORT_MB), schoon, pull ${LEEFTIJD}s geleden"
  [ -x "$HEARTBEAT" ] && bash "$HEARTBEAT" macbook-pull
  exit 0
fi

exit 1
