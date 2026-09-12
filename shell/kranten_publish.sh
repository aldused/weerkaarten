#!/bin/bash
set -euo pipefail

REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
LOCK_DIR="$REPO_DIR/.git/weerlab-publish.lock"
LOCK_TIMEOUT=900
WAITED=0
MESSAGE="${1:-Krantconcepten bijgewerkt}"
FILES=(data/kranten_demo.json data/kranten_status.json)
DEPLOY_PARENT=""
DEPLOY_DIR=""

cleanup() {
  if [ -n "$DEPLOY_DIR" ] && git -C "$REPO_DIR" worktree list --porcelain | grep -Fq "worktree $DEPLOY_DIR"; then
    git -C "$REPO_DIR" worktree remove --force "$DEPLOY_DIR" 2>/dev/null || true
  fi
  if [ -n "$DEPLOY_PARENT" ]; then
    rmdir "$DEPLOY_PARENT" 2>/dev/null || true
  fi
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

cd "$REPO_DIR"
while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  if [ "$WAITED" -ge "$LOCK_TIMEOUT" ]; then
    echo "FOUT: git publicatie-lock bleef langer dan ${LOCK_TIMEOUT}s staan."
    exit 1
  fi
  sleep 5
  WAITED=$((WAITED + 5))
done

git add -- "${FILES[@]}"
if git diff --cached --quiet -- "${FILES[@]}"; then
  echo "Geen gewijzigde krantbestanden; niets gepubliceerd."
  exit 0
fi

# Maak één lokale broncommit met uitsluitend de gevalideerde online gegevens.
git commit -m "$MESSAGE" -- "${FILES[@]}"
SOURCE_COMMIT="$(git rev-parse HEAD)"

# Publiceer dezelfde kleine wijziging vanaf een schone origin/main-checkout.
# Dit blijft werken wanneer de operationele hoofdwerkmap vuile of afwijkende
# weerdata bevat die niet in deze publicatie thuishoort.
git fetch origin main
DEPLOY_PARENT="$(mktemp -d /private/tmp/weerlab-kranten-publish.XXXXXX)"
DEPLOY_DIR="$DEPLOY_PARENT/worktree"
git worktree add --detach "$DEPLOY_DIR" origin/main
git -C "$DEPLOY_DIR" cherry-pick "$SOURCE_COMMIT"

for attempt in 1 2 3; do
  git -C "$DEPLOY_DIR" fetch origin main
  git -C "$DEPLOY_DIR" rebase origin/main
  if git -C "$DEPLOY_DIR" push origin HEAD:main; then
    echo "Krantconcepten gepubliceerd."
    exit 0
  fi
  if [ "$attempt" -lt 3 ]; then sleep 5; fi
done

echo "FOUT: krantconcepten konden niet worden gepubliceerd."
exit 1
