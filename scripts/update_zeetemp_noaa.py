"""Publish the newest available daily sea surface analysis for Europe."""
import argparse
import datetime as dt
import io
import json
import math
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

import h5py
import numpy as np

OISST_BASE = (
    "https://www.ncei.noaa.gov/data/sea-surface-temperature-optimum-interpolation/"
    "v2.1/access/avhrr/"
)
MUR_URL = (
    "https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json?"
    + quote("analysed_sst[(last)][(34):25:(65)][(-14):25:(32)]", safe="():")
)
OISST_SOURCE = "NOAA NCEI OISST v2.1"
MUR_SOURCE = "NASA JPL MUR v4.1"
MAX_AGE_DAYS = 10


def fetch(url):
    request = Request(url, headers={"User-Agent": "Weerlab/1.0 (weerlab.nl)"})
    with urlopen(request, timeout=25) as response:
        return response.read()


def snapshot(source, url, stamp, points, preliminary=False):
    if len(points) < 1000:
        raise ValueError("Onvoldoende dekking van de Europese zeeën")
    return {
        "source": source,
        "url": url,
        "valid": stamp.isoformat(),
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
        "resolution": 0.25,
        "preliminary": preliminary,
        "points": points,
    }


def convert(content, url):
    with h5py.File(io.BytesIO(content)) as file:
        lat = file["lat"][:]
        lon = (file["lon"][:] + 180) % 360 - 180
        sst = file["sst"]
        raw = sst[0, 0, :, :]
        scale = float(sst.attrs["scale_factor"][0])
        offset = float(sst.attrs["add_offset"][0])
        fill = int(sst.attrs["_FillValue"][0])
        stamp = dt.datetime(1978, 1, 1, 12, tzinfo=dt.timezone.utc) + dt.timedelta(
            days=float(file["time"][0])
        )
        points = []
        for i in np.where((lat >= 34) & (lat <= 65))[0]:
            for j in np.where((lon >= -14) & (lon <= 32))[0]:
                value = int(raw[i, j])
                if value != fill and -300 <= value <= 4500:
                    points.append([float(lat[i]), float(lon[j]), round(value * scale + offset, 2)])
    return snapshot(OISST_SOURCE, url, stamp, points, preliminary="_preliminary" in url)


def convert_mur(content):
    table = json.loads(content)["table"]
    if (table["columnNames"] != ["time", "latitude", "longitude", "analysed_sst"]
            or table["columnUnits"] != ["UTC", "degrees_north", "degrees_east", "degree_C"]):
        raise ValueError("Onverwachte variabelen of eenheden in het MUR-rooster")
    stamps = set()
    points = []
    # Eén op de 25 punten van het oorspronkelijke 0,01°-rooster.
    for time, lat, lon, value in table["rows"]:
        stamps.add(time)
        if value is not None and all(math.isfinite(v) for v in (lat, lon, value)):
            if -3 <= value <= 45:
                points.append([lat, lon, round(value, 2)])
    if len(stamps) != 1:
        raise ValueError("MUR bevat meerdere analysedatums of is leeg")
    stamp = dt.datetime.fromisoformat(stamps.pop().replace("Z", "+00:00"))
    return snapshot(MUR_SOURCE, MUR_URL, stamp, points)


def analysis_date(data):
    return dt.datetime.fromisoformat(data["valid"]).date()


def download(now=None):
    today = (now or dt.datetime.now(dt.timezone.utc)).date()
    earliest = today - dt.timedelta(days=MAX_AGE_DAYS)
    mur = None
    try:
        candidate = convert_mur(fetch(MUR_URL))
        if earliest <= analysis_date(candidate) <= today:
            mur = candidate
    except (KeyError, TypeError, ValueError, OSError) as error:
        print(f"NASA MUR niet beschikbaar: {error}")

    max_age = (today - analysis_date(mur)).days if mur else MAX_AGE_DAYS
    for age in range(max_age + 1):
        day = today - dt.timedelta(days=age)
        for suffix in ("", "_preliminary"):
            url = f"{OISST_BASE}{day:%Y%m}/oisst-avhrr-v02r01.{day:%Y%m%d}{suffix}.nc"
            try:
                data = convert(fetch(url), url)
                if analysis_date(data) != day:
                    raise ValueError("Onverwachte analysedatum")
                return data
            except HTTPError as error:
                if error.code != 404:
                    print(f"NOAA OISST {day}: HTTP {error.code}")
            except (OSError, ValueError, KeyError) as error:
                print(f"NOAA OISST {day}: {error}")
    if mur:
        return mur
    raise RuntimeError("Geen recente zeewateranalyse beschikbaar; laatst geldige bestand behouden")


def save(data, target):
    if target.exists():
        try:
            previous = json.loads(target.read_text())
            if analysis_date(previous) > analysis_date(data):
                print(f"Behoud recentere analyse van {analysis_date(previous)}")
                return
            if data == {**previous, "generated": data["generated"]}:
                print(f"Analyse van {analysis_date(previous)} is ongewijzigd")
                return
        except (ValueError, KeyError, TypeError):
            pass

    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent, delete=False) as tmp:
        temporary = Path(tmp.name)
        try:
            json.dump(data, tmp, separators=(",", ":"), allow_nan=False)
            tmp.close()
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    print(f"{data['source']}: {data['valid']} · {len(data['points'])} zeepunten")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--source-url")
    parser.add_argument("--output", type=Path, default=Path("zeetemp_noaa.json"))
    args = parser.parse_args()
    if args.input and not args.source_url:
        parser.error("--input requires --source-url")
    data = convert(Path(args.input).read_bytes(), args.source_url) if args.input else download()
    save(data, args.output)
