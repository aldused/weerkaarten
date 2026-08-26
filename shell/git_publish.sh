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

# 1. De gevraagde publicatie als eigen, scherp gelabelde commit.
git add -- "$@" 2>/dev/null || true
if ! git diff --cached --quiet -- "$@"; then
  git commit -m "$MESSAGE" -- "$@"
fi

# 2. Runtime-data hoort op R2, niet in Pages. Laat gewijzigde data daarom
#    bewust ongestaged: de afzonderlijke updatejobs publiceren deze al via
#    shell/r2_publish.sh. Zo triggert een dataverloop geen Pages-deploy meer.
#    Alleen de expliciet opgegeven bronbestanden bovenaan worden gecommit.

# 3. Niets nieuws en niets klaarstaan om te pushen -> klaar.
if [ "$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)" = "0" ]; then
  echo "Niets gewijzigd, geen commit nodig."
  exit 0
fi

# 4. Meestal is origin/main al een voorouder van HEAD. Push dan direct: een
#    generator mag ondertussen opnieuw tracked databestanden hebben gewijzigd,
#    want voor een fast-forward push hoeft de werkboom niet schoon te zijn.
#    Alleen wanneer origin echt nieuwe commits bevat is nog een rebase nodig.
#    Dit voorkomt dat continue data-updates iedere publicatie blokkeren met
#    "cannot pull with rebase: You have unstaged changes".
for attempt in 1 2 3; do
  git fetch origin main

  if git merge-base --is-ancestor origin/main HEAD; then
    if git push origin main; then
      echo "Git publicatie klaar."
      exit 0
    fi
  elif git pull --rebase -X theirs origin main && git push origin main; then
    echo "Git publicatie klaar."
    exit 0
  fi

  git rebase --abort 2>/dev/null || true

  if [ "$attempt" -lt 3 ]; then
    echo "Push/rebase poging $attempt mislukt; probeer opnieuw over 10s..."
    sleep 10
  fi
done

echo "FOUT: git publicatie mislukt na 3 pogingen."
exit 1
