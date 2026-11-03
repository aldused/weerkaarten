"""Explicit local estimates; original KNMI observations remain unchanged."""
import json
from pathlib import Path

def apply_corrections(station, rows):
    corrections = json.loads((Path(__file__).resolve().parents[1] / 'observation-corrections.json').read_text())
    applied = []
    for correction in corrections:
        if str(station) != correction['station']:
            continue
        for row in rows:
            key = correction['parameter'].lower()
            if row['datum'] == correction['date'] and row.get(key) == correction['original']:
                row[key] = correction['value']
                applied.append(dict(correction))
    return applied
