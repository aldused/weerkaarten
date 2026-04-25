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

git checkout main 2>/dev/null || true
git add -- "$@" 2>/dev/null || true

if git diff --cached --quiet; then
  if [ "$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)" = "0" ]; then
    echo "Niets gewijzigd, geen commit nodig."
    exit 0
  fi
  echo "Geen nieuwe wijzigingen, maar er staan nog lokale commits klaar om te pushen."
else
  git commit -m "$MESSAGE"
fi

for attempt in 1 2 3; do
  if git pull --rebase --autostash origin main && git push origin main; then
    echo "Git publicatie klaar."
    exit 0
  fi

  if [ "$attempt" -lt 3 ]; then
    echo "Push/rebase poging $attempt mislukt; probeer opnieuw over 10s..."
    sleep 10
  fi
done

echo "FOUT: git publicatie mislukt na 3 pogingen."
exit 1
