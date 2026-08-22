#!/usr/bin/env python3
"""Inspecteer 1 HARMONIE GRIB file: welke parameters/levels zitten erin?"""
import os, sys, time, tempfile, tarfile, requests, eccodes
from collections import Counter

KEY = 'eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6Ijk5YjZhMzkwMTlkYzQxYzlhMzJjNmNmY2MyNDgxNGRkIiwiaCI6Im11cm11cjEyOCJ9'

# Get latest file URL
DATASET = sys.argv[1] if len(sys.argv) > 1 else 'harmonie_arome_cy43_p1'
url = f'https://api.dataplatform.knmi.nl/open-data/v1/datasets/{DATASET}/versions/1.0/files'
r = requests.get(url, headers={'Authorization': KEY},
                 params={'maxKeys':1,'orderBy':'created','sorting':'desc'}, timeout=30)
filename = r.json()['files'][0]['filename']
print(f'file: {filename}')

url2 = f'https://api.dataplatform.knmi.nl/open-data/v1/datasets/{DATASET}/versions/1.0/files/{filename}/url'
r2 = requests.get(url2, headers={'Authorization': KEY}, timeout=15)
download_url = r2.json()['temporaryDownloadUrl']

with tempfile.TemporaryDirectory(prefix='harmonie_inspect_') as tmpdir:
    tarpath = os.path.join(tmpdir, filename)
    with requests.get(download_url, stream=True, timeout=600) as r3:
        with open(tarpath, 'wb') as f:
            for chunk in r3.iter_content(chunk_size=1024*1024):
                f.write(chunk)
    with tarfile.open(tarpath, 'r') as tar:
        tar.extractall(path=tmpdir, filter='data')
    grib_files = sorted(
        os.path.join(root, name)
        for root, _, names in os.walk(tmpdir)
        for name in names
        if name.endswith(('_GB', '.grib', '.grib1', '.grib2'))
    )
    if not grib_files:
        raise RuntimeError('Geen GRIB-bestanden in het KNMI-archief gevonden')
    gf = grib_files[0]
    print(f'\n--- Inspecting: {os.path.basename(gf)} ---\n')

    combos = Counter()
    samples = {}  # (param, ltype) -> list of levels
    with open(gf, 'rb') as fh:
        while True:
            msgid = eccodes.codes_grib_new_from_file(fh)
            if msgid is None: break
            edition = eccodes.codes_get_long(msgid, 'edition')
            if edition == 1:
                code = f"grib1:{eccodes.codes_get_long(msgid, 'indicatorOfParameter')}"
            else:
                code = 'grib2:{}/{}/{}'.format(
                    eccodes.codes_get_long(msgid, 'discipline'),
                    eccodes.codes_get_long(msgid, 'parameterCategory'),
                    eccodes.codes_get_long(msgid, 'parameterNumber'),
                )
            try:
                ltype = eccodes.codes_get(msgid, 'indicatorOfTypeOfLevel')
            except:
                ltype = -1
            try: param_name = eccodes.codes_get_string(msgid, 'name')
            except Exception: param_name = '?'
            try: param_units = eccodes.codes_get_string(msgid, 'units')
            except Exception: param_units = '?'
            try: short_name = eccodes.codes_get_string(msgid, 'shortName')
            except Exception: short_name = '?'
            try: type_of_level = eccodes.codes_get_string(msgid, 'typeOfLevel')
            except Exception: type_of_level = '?'
            try: step_type = eccodes.codes_get_string(msgid, 'stepType')
            except Exception: step_type = '?'
            lvl = eccodes.codes_get(msgid, 'level')
            key = (edition, code, ltype, type_of_level, short_name, step_type, param_name, param_units)
            combos[key] += 1
            samples.setdefault(key, set()).add(lvl)
            eccodes.codes_release(msgid)

    print(f'Aantal verschillende (param, leveltype) combinaties: {len(combos)}\n')
    print(f'{"ed":>2} {"code":<16} {"ltype":>5} {"typeOfLevel":<22} {"short":<10} {"step":<10} {"levels":<35} name / units')
    print('-'*150)
    for key, cnt in sorted(combos.items(), key=lambda item: str(item[0])):
        edition, code, ltype, type_of_level, short_name, step_type, name, units = key
        levels = sorted(samples[key])
        lev_str = str(levels) if len(levels) <= 10 else f'{levels[:5]}...{levels[-3:]} ({len(levels)} total)'
        print(f'{edition:>2} {code:<16} {ltype:>5} {type_of_level:<22} {short_name:<10} {step_type:<10} {lev_str:<35} {name} / {units}')
