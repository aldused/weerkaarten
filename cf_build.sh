#!/bin/bash
# CF Pages build script - kopieert alleen kleine bestanden (<25MB) naar _deploy/
mkdir -p _deploy
find . -maxdepth 1 -type f \( \
  -name "*.html" -o -name "*.json" -o -name "*.js" \
  -o -name "*.css" -o -name "*.svg" -o -name "*.ico" \
  -o -name "*.png" -o -name "*.txt" -o -name "*.webp" \
) | while read f; do
  size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo 0)
  if [ "$size" -lt 26214400 ]; then
    cp "$f" _deploy/
  fi
done
echo "Build klaar: $(ls _deploy | wc -l) bestanden"
