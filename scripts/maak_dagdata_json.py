#!/usr/bin/env python3
"""
Converteer KNMI dagdata CSV's naar compacte JSON-bestanden.
Alleen de kolommen die stationsanalyse.html nodig heeft:
YYYYMMDD, TX, TN, RH, FXX, SQ

Output: dagdata_XXX.json per station, compact genoeg voor Cloudflare Pages.
"""

import csv
import json
import glob
import os

# Kolommen die we nodig hebben (naast datum)
KOLOMMEN = ['TX', 'TN', 'RH', 'FXX', 'SQ']

def parse_csv(filepath):
    """Parse een KNMI dagdata CSV en retourneer compacte data."""
    data = []
    kolom_index = {}

    with open(filepath, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            # Header-regel: "# STN,YYYYMMDD,..."
            if line.startswith('# STN'):
                cols = [c.strip() for c in line[2:].split(',')]
                for i, c in enumerate(cols):
                    kolom_index[c] = i
                continue

            # Skip commentaar/metadata
            if line.startswith('#') or line.startswith('BRON') or line.startswith('SOURCE'):
                continue
            if 'YYYYMMDD' in line or 'DDVEC' in line:
                continue

            if not kolom_index:
                continue

            velden = [v.strip() for v in line.split(',')]
            if len(velden) < 10:
                continue

            datum_idx = kolom_index.get('YYYYMMDD')
            if datum_idx is None:
                continue

            datum = velden[datum_idx]
            if not datum or len(datum) != 8:
                continue

            # Haal alleen de kolommen op die we nodig hebben
            rij = [datum]
            for kol in KOLOMMEN:
                idx = kolom_index.get(kol)
                if idx is not None and idx < len(velden):
                    val = velden[idx].strip()
                    if val == '':
                        rij.append(None)
                    else:
                        rij.append(int(val))
                else:
                    rij.append(None)

            data.append(rij)

    return data


def main():
    basedir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    csv_pattern = os.path.join(basedir, 'knmi_dagdata_*.csv')
    csv_files = sorted(glob.glob(csv_pattern))

    if not csv_files:
        print("Geen CSV-bestanden gevonden!")
        return

    print(f"Gevonden: {len(csv_files)} CSV-bestanden")

    for csv_path in csv_files:
        filename = os.path.basename(csv_path)
        # knmi_dagdata_260.csv -> 260
        stn = filename.replace('knmi_dagdata_', '').replace('.csv', '')

        data = parse_csv(csv_path)
        if not data:
            print(f"  {stn}: geen data, overgeslagen")
            continue

        # Compacte JSON: array van arrays, header als eerste element
        output = {
            'stn': int(stn),
            'kolommen': ['YYYYMMDD'] + KOLOMMEN,
            'data': data
        }

        out_path = os.path.join(basedir, f'dagdata_{stn}.json')
        with open(out_path, 'w') as f:
            # Compact: geen indent, geen spaties
            json.dump(output, f, separators=(',', ':'))

        csv_size = os.path.getsize(csv_path)
        json_size = os.path.getsize(out_path)
        ratio = (1 - json_size / csv_size) * 100
        print(f"  {stn}: {len(data)} dagen, {csv_size//1024}KB -> {json_size//1024}KB ({ratio:.0f}% kleiner)")

    print("Klaar!")


if __name__ == '__main__':
    main()
