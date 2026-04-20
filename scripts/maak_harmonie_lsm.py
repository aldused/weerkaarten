#!/usr/bin/env python3
"""Extract HARMONIE Land-Sea Mask (LSM) uit een GRIB en sla op als .bin.

Output: harmonie_data_lsm.bin — zelfde format als andere harmonie_data_*.bin
  Header: <HHHH: n_lat, n_lon, n_steps=1, n_comp=1> + 8 bytes padding
  Data:   float32 per gridcel (0=zee, 1=land)

De LSM verandert niet per run, dus eenmalig draaien volstaat. Wordt
daarna in harmonie_update.sh automatisch mee-ge-upload naar R2.

Run:  python3 scripts/maak_harmonie_lsm.py
"""
import os, struct, sys, tempfile, tarfile
import numpy as np
import eccodes
import requests

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

KEY = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6Ijk5YjZhMzkwMTlkYzQxYzlhMzJjNmNmY2MyNDgxNGRkIiwiaCI6Im11cm11cjEyOCJ9"
EXTENT = [0.5, 12.5, 47.5, 56.5]


def laatste_grib():
    url = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/harmonie_arome_cy43_p1/versions/1.0/files"
    r = requests.get(url, headers={"Authorization": KEY},
                     params={"maxKeys": 1, "orderBy": "created", "sorting": "desc"}, timeout=30)
    return r.json()["files"][0]["filename"]


def download_eerste_grib():
    fn = laatste_grib()
    print(f"Download {fn}...")
    url2 = f"https://api.dataplatform.knmi.nl/open-data/v1/datasets/harmonie_arome_cy43_p1/versions/1.0/files/{fn}/url"
    dl_url = requests.get(url2, headers={"Authorization": KEY}, timeout=15).json()["temporaryDownloadUrl"]
    tmp = tempfile.mkdtemp(prefix="harmonie_lsm_")
    tarpath = os.path.join(tmp, fn)
    r3 = requests.get(dl_url, stream=True, timeout=600)
    with open(tarpath, "wb") as f:
        for chunk in r3.iter_content(chunk_size=1 << 20):
            f.write(chunk)
    with tarfile.open(tarpath) as tar:
        member = [m for m in tar.getmembers() if m.name.endswith("_GB")][0]
        tar.extract(member, tmp)
    return os.path.join(tmp, member.name)


def extract_lsm(grib_path):
    lats = lons = lsm = None
    with open(grib_path, "rb") as fh:
        while True:
            m = eccodes.codes_grib_new_from_file(fh)
            if m is None:
                break
            if eccodes.codes_get(m, "indicatorOfParameter") == 81:
                Ni = eccodes.codes_get(m, "Ni")
                Nj = eccodes.codes_get(m, "Nj")
                lat1 = eccodes.codes_get(m, "latitudeOfFirstGridPointInDegrees")
                lat2 = eccodes.codes_get(m, "latitudeOfLastGridPointInDegrees")
                lon1 = eccodes.codes_get(m, "longitudeOfFirstGridPointInDegrees")
                lon2 = eccodes.codes_get(m, "longitudeOfLastGridPointInDegrees")
                lats = np.linspace(lat1, lat2, Nj)
                lons = np.linspace(lon1, lon2, Ni)
                lsm = eccodes.codes_get_values(m).reshape(Nj, Ni)
                eccodes.codes_release(m)
                break
            eccodes.codes_release(m)
    if lats[0] > lats[-1]:
        lats = lats[::-1]
        lsm = lsm[::-1, :]
    return lats, lons, lsm


def main():
    grib = sys.argv[1] if len(sys.argv) > 1 else download_eerste_grib()
    lats, lons, lsm = extract_lsm(grib)
    lat_idx = np.where((lats >= EXTENT[2]) & (lats <= EXTENT[3]))[0]
    lon_idx = np.where((lons >= EXTENT[0]) & (lons <= EXTENT[1]))[0]
    crop = lsm[np.ix_(lat_idx, lon_idx)]
    n_lat, n_lon = crop.shape
    with open("harmonie_data_lsm.bin", "wb") as f:
        f.write(struct.pack("<HHHH", n_lat, n_lon, 1, 1))
        f.write(b"\x00" * 8)
        f.write(crop.astype(np.float32).tobytes())
    print(f"harmonie_data_lsm.bin: {n_lat}×{n_lon}, {os.path.getsize('harmonie_data_lsm.bin')/1024:.0f} KB")


if __name__ == "__main__":
    main()
