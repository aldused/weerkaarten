#!/bin/bash
# backup_weerlab.sh — dagelijks herstelpunt van de weerlab-map.
#
# Beschermt tegen wat de MacBook-mirror níet opvangt: eigen fouten. Die mirror
# doet `git reset --hard`, dus een verwijdering die je pusht wordt daar netjes
# overgenomen. Hier houd je veertien momentopnamen waar je op terug kunt vallen.
#
# Ruimte: rsync --link-dest laat ongewijzigde bestanden als hardlink naar de
# vorige backup wijzen. Elk herstelpunt oogt als een volledige map, maar alleen
# de gewijzigde bestanden kosten echt schijfruimte.
#
# .git gaat mee: daarmee is elk herstelpunt op zichzelf compleet en ben je niet
# afhankelijk van GitHub. Downloadcaches, logs en opnieuw te genereren/R2-data
# blijven buiten de backup; die maakten oude herstelpunten onnodig groot.
#
# Dagelijks via launchd (nl.edaldus.backup.plist).
# Handmatig: bash shell/backup_weerlab.sh
#
# Exit: 0 = klaar · 1 = mislukt

set -uo pipefail

SRC="$HOME/KNMI_Project/weerlab"
BACKUP_ROOT="$HOME/KNMI_Project/backups"
BEWAAR=14
# Seconden meenemen: zonder dat krijgen twee runs binnen dezelfde minuut
# dezelfde naam en zou --link-dest naar de doelmap zelf wijzen.
STAMP="$(date '+%Y-%m-%d-%H%M%S')"
DST="$BACKUP_ROOT/weerlab-$STAMP"
HEARTBEAT="$SRC/shell/heartbeat.sh"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

if [ ! -d "$SRC" ]; then
  log "FOUT: bronmap niet gevonden: $SRC"
  exit 1
fi

mkdir -p "$BACKUP_ROOT" || { log "FOUT: kan $BACKUP_ROOT niet maken"; exit 1; }

# Meest recente eerdere backup — daar linken we ongewijzigde bestanden naartoe.
VORIGE="$(find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'weerlab-*' 2>/dev/null \
          | sort | tail -1)"
# Vangnet: nooit naar onszelf linken, wat er ook met de naamgeving gebeurt.
[ "$VORIGE" = "$DST" ] && VORIGE=""

log "=== Weerlab backup ==="
log "Bron:  $SRC"
log "Doel:  $DST"
# Opties in één array. macOS levert bash 3.2 als /bin/bash; daar geeft een lege
# array onder `set -u` een fout, dus deze array mag nooit leeg raken.
OPTS=(-a --delete
      --exclude ".DS_Store"
      --exclude "__pycache__/"
      --exclude "*.pyc"
      --exclude "logs/"
      --exclude "macbook/*.log"
      --exclude ".ecmwf_short_cache/"
      --exclude ".ecmwf_long_cache/"
      --exclude ".ecmwf_europa_cache/"
      --exclude "neerslag_cache/"
      --exclude "ev24_cache/"
      --exclude "*.bin"
      --exclude "*.bin.gz"
      --exclude "beta_harmonie_uur*.png"
      --exclude "beta_icond2_uur*.png"
      --exclude "beta_topmeteo_uur*.png"
      --exclude "kaart_synop_*.png"
      --exclude "launchd_out.log"
      --exclude "launchd_err.log"
      --exclude "modelkaarten_out.log"
      --exclude "modelkaarten_err.log")

if [ -n "$VORIGE" ]; then
  log "Basis: $(basename "$VORIGE") (ongewijzigde bestanden worden gehardlinkt)"
  OPTS+=(--link-dest="$VORIGE")
else
  log "Basis: geen — dit wordt de eerste, volledige backup"
fi

rsync "${OPTS[@]}" "$SRC/" "$DST/"
RSYNC_STATUS=$?

if [ "$RSYNC_STATUS" -ne 0 ]; then
  log "FOUT: rsync eindigde met status $RSYNC_STATUS — backup mogelijk onvolledig"
  # Halve backup weggooien: anders wordt hij morgen de --link-dest-basis.
  [ -d "$DST" ] && rm -rf "$DST" && log "Onvolledige backup verwijderd: $DST"
  exit 1
fi

GROOTTE="$(du -sh "$DST" 2>/dev/null | cut -f1)"
log "Klaar: $DST ($GROOTTE zoals het eruitziet)"

# ── Rotatie: alleen de nieuwste $BEWAAR herstelpunten houden ────────────────
# Verwijderen is veilig ondanks de hardlinks: een bestand verdwijnt pas echt
# als de laatste verwijzing weg is, dus nieuwere backups blijven compleet.
# Geen mapfile hier — die bestaat niet in de bash 3.2 van macOS.
find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'weerlab-*' \
  | sort -r | tail -n +$((BEWAAR + 1)) \
  | while IFS= read -r map; do
      [ -n "$map" ] || continue
      log "Verwijder oude backup: $(basename "$map")"
      rm -rf "$map"
    done

AANTAL="$(find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'weerlab-*' | wc -l | tr -d ' ')"
TOTAAL="$(du -sh "$BACKUP_ROOT" 2>/dev/null | cut -f1)"
log "Herstelpunten: $AANTAL · totaal op schijf: $TOTAAL"

[ -x "$HEARTBEAT" ] && bash "$HEARTBEAT" backup
exit 0
