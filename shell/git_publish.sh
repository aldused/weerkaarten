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

# 2. Alle overige tracked data-churn (toplijst.json, mosmix_*.json, sat_*.png,
#    records_*.json, ...) mee-committen zodat de werkboom SCHOON is voor de
#    rebase. Vroeger bleef die churn dirty en gebruikte `git pull --autostash`
#    een stash; bij een pop-conflict bleef die staan en stapelde zich op (43+
#    verweesde autostashes). Untracked bestanden (logs, *_uurNN.png, *.local.json)
#    blijven met rust — die horen niet in git.
git add -u
if ! git diff --cached --quiet; then
  git commit -m "data: werkboom-churn meegepubliceerd (auto)"
fi

# 3. Niets nieuws en niets klaarstaan om te pushen -> klaar.
if [ "$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)" = "0" ]; then
  echo "Niets gewijzigd, geen commit nodig."
  exit 0
fi

# 4. Schone werkboom -> gewone rebase, GEEN --autostash meer, dus ook geen
#    achterblijvende autostash-stapel. Bij een zeldzaam conflict op dezelfde
#    data-regel winnen onze net gegenereerde waarden (-X theirs = de replayed
#    lokale commits). Bij een mislukte poging de rebase afbreken zodat een
#    volgende poging (of job) niet in een halve rebase vastloopt.
for attempt in 1 2 3; do
  if git pull --rebase -X theirs origin main && git push origin main; then
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
