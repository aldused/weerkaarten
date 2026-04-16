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
import boto3

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


R2_ENDPOINT  = "https://05da71c7c88b8ce49fbb2c2d0a570416.r2.cloudflarestorage.com"
R2_ACCESS_KEY = "baf991003ce3e4075d91b89f8726bc0f"
R2_SECRET_KEY = "0f33229e2e03fe7bc7f9fdf7f9fa0acd5336c40718c6e25fe0b6a631ade8ac97"
R2_BUCKET    = "weerlab-dagdata"


def upload_r2(s3, local_path, filename):
    try:
        s3.upload_file(local_path, R2_BUCKET, filename,
            ExtraArgs={'ContentType': 'application/json'})
        return True
    except Exception as e:
        print(f"    R2-upload mislukt voor {filename}: {e}")
        return False


def main():
    basedir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    csv_pattern = os.path.join(basedir, 'knmi_dagdata_*.csv')
    csv_files = sorted(glob.glob(csv_pattern))

    if not csv_files:
        print("Geen CSV-bestanden gevonden!")
        return

    print(f"Gevonden: {len(csv_files)} CSV-bestanden")

    s3 = boto3.client('s3',
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name='auto'
    )

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
        ok = upload_r2(s3, out_path, f'dagdata_{stn}.json')
        r2_status = "→ R2 ✓" if ok else "→ R2 ✗"
        print(f"  {stn}: {len(data)} dagen, {csv_size//1024}KB -> {json_size//1024}KB ({ratio:.0f}% kleiner) {r2_status}")

    print("Klaar!")


if __name__ == '__main__':
    main()
