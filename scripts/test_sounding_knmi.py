#!/usr/bin/env python3
"""
Test: hoe lang duurt het extracten van pressure-level sounding-data
uit een HARMONIE 43 GRIB-tar voor 6 stations?
"""
import os, sys, time, tempfile, tarfile, json
import numpy as np
import requests
import eccodes

KEY = 'eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6Ijk5YjZhMzkwMTlkYzQxYzlhMzJjNmNmY2MyNDgxNGRkIiwiaCI6Im11cm11cjEyOCJ9'

STATIONS = {
    'debilt':     (52.10, 5.18),
    'schiphol':   (52.31, 4.76),
    'eindhoven':  (51.45, 5.42),
    'maastricht': (50.91, 5.77),
    'groningen':  (53.13, 6.58),
    'vlissingen': (51.44, 3.60),
}

# eccodes indicators
IND_T = 11    # Temperature
IND_RH = 52   # Relative humidity
IND_U = 33    # U-wind
IND_V = 34    # V-wind
IND_Z = 6     # Geopotential height (in some products) — controleer ook 7

def bilinear(grid, lats, lons, lat, lon):
    """Bilineair interpoleren in 2D grid op (lat, lon)."""
    i1 = np.searchsorted(lats, lat) - 1
    j1 = np.searchsorted(lons, lon) - 1
    i1 = np.clip(i1, 0, len(lats)-2)
    j1 = np.clip(j1, 0, len(lons)-2)
    f = (lat - lats[i1]) / (lats[i1+1] - lats[i1])
    g = (lon - lons[j1]) / (lons[j1+1] - lons[j1])
    a = grid[i1, j1]; b = grid[i1, j1+1]; c = grid[i1+1, j1]; d = grid[i1+1, j1+1]
    return (1-f)*(1-g)*a + (1-f)*g*b + f*(1-g)*c + f*g*d

def main():
    t0 = time.time()
    # 1. Find latest
    url = 'https://api.dataplatform.knmi.nl/open-data/v1/datasets/harmonie_arome_cy43_p1/versions/1.0/files'
    r = requests.get(url, headers={'Authorization': KEY},
                     params={'maxKeys':1,'orderBy':'created','sorting':'desc'}, timeout=30)
    filename = r.json()['files'][0]['filename']
    print(f'[{time.time()-t0:5.1f}s] file: {filename}')

    # 2. Get download URL
    url2 = f'https://api.dataplatform.knmi.nl/open-data/v1/datasets/harmonie_arome_cy43_p1/versions/1.0/files/{filename}/url'
    r2 = requests.get(url2, headers={'Authorization': KEY}, timeout=15)
    download_url = r2.json()['temporaryDownloadUrl']

    # 3. Download
    t1 = time.time()
    with tempfile.TemporaryDirectory(prefix='harmonie_test_') as tmpdir:
        tarpath = os.path.join(tmpdir, filename)
        with requests.get(download_url, stream=True, timeout=600) as r3:
            r3.raise_for_status()
            with open(tarpath, 'wb') as f:
                for chunk in r3.iter_content(chunk_size=1024*1024):
                    f.write(chunk)
        sz_mb = os.path.getsize(tarpath)/1024/1024
        print(f'[{time.time()-t0:5.1f}s] download klaar: {sz_mb:.1f} MB ({(time.time()-t1):.1f}s)')

        # 4. Extract
        t2 = time.time()
        with tarfile.open(tarpath, 'r') as tar:
            tar.extractall(path=tmpdir)
        grib_files = sorted([os.path.join(tmpdir, f) for f in os.listdir(tmpdir) if f.endswith('_GB')])
        print(f'[{time.time()-t0:5.1f}s] extract klaar: {len(grib_files)} bestanden ({(time.time()-t2):.1f}s)')

        # 5. Parse all GRIB files: per file, lees alle pressure-level data
        t3 = time.time()
        pressure_levels_seen = set()
        all_levels_per_file = []
        lats = lons = None

        # Voor stations: per file accumuleer lijst (station, hour, level, T/RH/U/V/Z)
        sounding = {sid: [] for sid in STATIONS}

        for hour_idx, gf in enumerate(grib_files):
            file_data = {}  # {(level, ind): grid}
            with open(gf, 'rb') as fh:
                while True:
                    msgid = eccodes.codes_grib_new_from_file(fh)
                    if msgid is None: break
                    try:
                        ltype = eccodes.codes_get(msgid, 'indicatorOfTypeOfLevel')
                    except:
                        ltype = None
                    ind = eccodes.codes_get(msgid, 'indicatorOfParameter')
                    lvl = eccodes.codes_get(msgid, 'level')
                    # We willen alleen pressure-level data: ltype 100 = isobaric
                    # ind 11 (T), 52 (RH), 33 (U), 34 (V), 6 (Z)
                    if ltype == 100 and ind in (IND_T, IND_RH, IND_U, IND_V, IND_Z):
                        ni2 = eccodes.codes_get(msgid, 'Ni')
                        nj2 = eccodes.codes_get(msgid, 'Nj')
                        vals = eccodes.codes_get_values(msgid).reshape(nj2, ni2)
                        if lats is None:
                            lat1 = eccodes.codes_get(msgid, 'latitudeOfFirstGridPointInDegrees')
                            lat2 = eccodes.codes_get(msgid, 'latitudeOfLastGridPointInDegrees')
                            lon1 = eccodes.codes_get(msgid, 'longitudeOfFirstGridPointInDegrees')
                            lon2 = eccodes.codes_get(msgid, 'longitudeOfLastGridPointInDegrees')
                            lats = np.linspace(lat1, lat2, nj2)
                            lons = np.linspace(lon1, lon2, ni2)
                            if lats[0] > lats[-1]:
                                lats = lats[::-1]
                                vals = vals[::-1, :]
                            file_data[(lvl, ind)] = vals
                        else:
                            if lats[0] < lats[-1] and lat1 > lat2:
                                vals = vals[::-1, :]
                            file_data[(lvl, ind)] = vals
                        pressure_levels_seen.add(lvl)
                    eccodes.codes_release(msgid)

            # Per station: extract profile op deze hour
            for sid, (slat, slon) in STATIONS.items():
                profile = []
                for lvl in sorted(pressure_levels_seen, reverse=True):  # van laag naar hoog (1000 hPa eerst)
                    rec = {'p': lvl}
                    for name, ind in [('T', IND_T), ('RH', IND_RH), ('U', IND_U), ('V', IND_V), ('Z', IND_Z)]:
                        g = file_data.get((lvl, ind))
                        if g is not None:
                            rec[name] = float(bilinear(g, lats, lons, slat, slon))
                        else:
                            rec[name] = None
                    profile.append(rec)
                sounding[sid].append({'hour_idx': hour_idx, 'profile': profile})

            if hour_idx == 0:
                print(f'[{time.time()-t0:5.1f}s] eerste file gelezen, {len(file_data)} pressure-level msgs, levels: {sorted(pressure_levels_seen, reverse=True)}')

        print(f'[{time.time()-t0:5.1f}s] alle {len(grib_files)} files geparsed ({(time.time()-t3):.1f}s, {(time.time()-t3)/len(grib_files):.2f}s per file)')

        # 6. Sample output
        sample = sounding['debilt'][0]['profile']
        print(f'\nDe Bilt hour 0 profiel (alleen niveaus met data):')
        for r in sample:
            if r.get('T') is not None:
                T_C = r['T'] - 273.15 if r['T'] > 100 else r['T']
                print(f"  {r['p']:>4} hPa  T={T_C:6.1f}°C  RH={r.get('RH','---'):>5}  U={r.get('U','---'):>6}  V={r.get('V','---'):>6}  Z={r.get('Z','---')}")

        # 7. Save JSON sample
        out = {'levels': sorted(pressure_levels_seen, reverse=True), 'stations': {}}
        for sid in STATIONS:
            out['stations'][sid] = sounding[sid][:5]  # eerste 5 uren als sample
        with open('/Users/aldus/KNMI_Project/weerlab/harmonie_sounding_test.json', 'w') as f:
            json.dump(out, f, indent=2, default=str)
        print(f'\n[{time.time()-t0:5.1f}s] JSON sample geschreven: harmonie_sounding_test.json')
        print(f'\nTOTAAL: {time.time()-t0:.1f}s')

if __name__ == '__main__':
    main()
