#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Trend en Beta vernieuwen $(date) ==="

/usr/local/bin/python3 "$SCRIPT_DIR/maak_grafiek.py"          || { echo "FOUT: maak_grafiek.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/maak_beta_debilt.py"      || { echo "FOUT: maak_beta_debilt.py"; exit 1; }
/usr/local/bin/python3 "$SCRIPT_DIR/maak_beta_verificatie.py" || { echo "FOUT: maak_beta_verificatie.py"; exit 1; }

git add grafiek_trend.png beta_debilt.json beta_verificatie.json beta_verificatie_archive.json

if git diff --cached --quiet; then
    echo "Niets gewijzigd."
else
    git commit -m "Trend en beta update $(date '+%Y-%m-%d %H:%M')"
    git push
    echo "=== Klaar ==="
fi
