#!/bin/bash
# CF Pages build script - kopieert alleen kleine bestanden (<25MB) naar _deploy/
mkdir -p _deploy
for f in *.html *.json *.js *.css *.svg *.ico *.png *.txt *.webp; do
  [ -f "$f" ] || continue
  size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo 0)
  if [ "$size" -lt 26214400 ]; then
    cp "$f" _deploy/
  fi
done
echo "Build klaar: $(ls _deploy | wc -l) bestanden"
