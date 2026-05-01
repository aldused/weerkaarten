#!/bin/bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Gebruik: git_publish.sh <commit message> <bestand...>"
  exit 2
fi

MESSAGE="$1"
shift

REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
LOCK_DIR="$REPO_DIR/.git/weerlab-publish.lock"
LOCK_TIMEOUT=900
WAITED=0

cd "$REPO_DIR"

while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  if [ "$WAITED" -ge "$LOCK_TIMEOUT" ]; then
    echo "FOUT: git publicatie-lock bleef langer dan ${LOCK_TIMEOUT}s staan: $LOCK_DIR"
    exit 1
  fi
  echo "Git publicatie is bezig in een andere job; wacht 5s..."
  sleep 5
  WAITED=$((WAITED + 5))
done

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

# Vorige run kan een autostash hebben achtergelaten (mislukte retry van
# `git pull --rebase --autostash`). Eerst opruimen voor we wijzigingen maken,
# anders gaan archiverende files (verificatie_archief.json e.d.) verloren.
recover_stale_autostash() {
  while git stash list | head -1 | grep -q "autostash"; do
    if git stash pop --quiet 2>/dev/null; then
      echo "Oude autostash hersteld in werkboom."
    else
      echo "FOUT: oude autostash kon niet worden gepopt (conflict). Handmatig oplossen met 'git stash list/pop'."
      exit 1
    fi
  done
}
recover_stale_autostash

git checkout main 2>/dev/null || true
git add -- "$@" 2>/dev/null || true

if git diff --cached --quiet -- "$@"; then
  if [ "$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)" = "0" ]; then
    echo "Niets gewijzigd, geen commit nodig."
    exit 0
  fi
  echo "Geen nieuwe wijzigingen, maar er staan nog lokale commits klaar om te pushen."
else
  git commit -m "$MESSAGE" -- "$@"
fi

for attempt in 1 2 3; do
  if git pull --rebase --autostash origin main && git push origin main; then
    echo "Git publicatie klaar."
    exit 0
  fi

  # Pull/rebase kan halverwege falen en de autostash niet poppen — als we dan
  # gewoon retryen maakt git een NIEUWE autostash bovenop de oude en raakt de
  # eerste voor altijd kwijt. Dus eerst herstellen voor we het opnieuw doen.
  recover_stale_autostash

  if [ "$attempt" -lt 3 ]; then
    echo "Push/rebase poging $attempt mislukt; probeer opnieuw over 10s..."
    sleep 10
  fi
done

echo "FOUT: git publicatie mislukt na 3 pogingen."
exit 1
