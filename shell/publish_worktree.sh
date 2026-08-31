#!/bin/bash
#
# Publiceer losse bestanden naar origin/main via een tijdelijke worktree.
#
# Waarom deze omweg?
#   De live-tree /Users/aldus/KNMI_Project/weerlab kan van origin divergeren:
#   auto-datacommits (wxbeta, zeetemp, marifoon, tekort) stapelen zich lokaal
#   op, terwijl bronfixes elders bovenop origin/main worden gezet. Zodra dat
#   gebeurt weigert een gewone `git push` uit die tree met "non-fast-forward"
#   en staat elke publicatie stil -- in augustus 2026 vijf dagen lang, zonder
#   dat iemand het zag.
#
#   Deze helper raakt de live-tree en zijn historie niet aan. Hij zet de
#   opgegeven bestanden altijd bovenop een verse origin/main en pusht dat.
#
# Gebruik:
#   publish_worktree.sh "<commit message>" <bestand> [bestand...]
#
# Paden zijn relatief aan de repo-root. Exit-code is niet-nul zodra de
# publicatie mislukt, zodat aanroepende scripts hard kunnen falen.

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Gebruik: publish_worktree.sh <commit message> <bestand...>" >&2
  exit 2
fi

MESSAGE="$1"
shift

REPO_DIR="/Users/aldus/KNMI_Project/weerlab"
LOCK_DIR="$REPO_DIR/.git/weerlab-publish.lock"
LOCK_TIMEOUT=900
WAITED=0

cd "$REPO_DIR"

# Zelfde lock als git_publish.sh: twee publicaties tegelijk levert onnodige
# push-races op.
while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  if [ "$WAITED" -ge "$LOCK_TIMEOUT" ]; then
    echo "FOUT: git publicatie-lock bleef langer dan ${LOCK_TIMEOUT}s staan: $LOCK_DIR" >&2
    exit 1
  fi
  echo "Git publicatie is bezig in een andere job; wacht 5s..."
  sleep 5
  WAITED=$((WAITED + 5))
done

WT="/private/tmp/weerlab-publish-$$-$(date +%s)"

cleanup() {
  git worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"
  git worktree prune 2>/dev/null || true
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

git fetch origin main

git worktree add --detach "$WT" origin/main >/dev/null

for f in "$@"; do
  if [ ! -e "$REPO_DIR/$f" ]; then
    echo "FOUT: te publiceren bestand bestaat niet: $f" >&2
    exit 1
  fi
  mkdir -p "$WT/$(dirname "$f")"
  cp -p "$REPO_DIR/$f" "$WT/$f"
done

git -C "$WT" add -- "$@"

if git -C "$WT" diff --cached --quiet; then
  echo "Niets gewijzigd t.o.v. origin/main; geen publicatie nodig."
  exit 0
fi

git -C "$WT" commit -q -m "$MESSAGE"

# De worktree is schoon, dus een rebase op een intussen verschoven origin/main
# kan hier wel -- anders dan in de live-tree.
for attempt in 1 2 3; do
  if git -C "$WT" push origin HEAD:main; then
    echo "Gepubliceerd naar origin/main: $MESSAGE"
    exit 0
  fi

  echo "Push poging $attempt mislukt; origin opnieuw ophalen en rebasen..."
  git -C "$WT" fetch origin main
  if ! git -C "$WT" rebase origin/main; then
    git -C "$WT" rebase --abort 2>/dev/null || true
    echo "FOUT: rebase op origin/main mislukt." >&2
    exit 1
  fi

  [ "$attempt" -lt 3 ] && sleep 5
done

echo "FOUT: publicatie mislukt na 3 pogingen." >&2
exit 1
