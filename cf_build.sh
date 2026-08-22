#!/bin/bash
# Cloudflare Pages build: maak _deploy volledig opnieuw vanuit de repo-root.
# _deploy is build-output, nooit handmatig te onderhouden broncode.
set -euo pipefail

OUTPUT="${CF_PAGES_OUTPUT_DIR:-_deploy}"
STAGE="${OUTPUT}.tmp"

rm -rf "$STAGE"
mkdir -p "$STAGE"
for f in *.html *.json *.js *.css *.svg *.ico *.png *.txt *.webp; do
  [ -f "$f" ] || continue
  size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo 0)
  if [ "$size" -lt 26214400 ]; then
    cp "$f" "$STAGE/"
  fi
done

# Pas vervangen wanneer de volledige staging-build geslaagd is. Hiermee
# verdwijnen ook oude bestanden die niet meer in de bronroot bestaan.
rm -rf "$OUTPUT"
mv "$STAGE" "$OUTPUT"
echo "Build klaar: $(find "$OUTPUT" -maxdepth 1 -type f | wc -l) bestanden in $OUTPUT"
