#!/usr/bin/env python3
"""
extend_dagdata.py

Vult dagdata_{stn}.json aan met de meest recente dagen via de KNMI EDR API
(daily-in-situ-meteorological-observations), zodat de data loopt tot en met
gisteren. maak_dagdata_json.py moet eerst zijn gedraaid om de CSV-basis te
leveren. Aangevulde JSON wordt lokaal opgeslagen en ge-upload naar R2.

Parameters: TX, TN, RH, FXX, SQ (zelfde als maak_dagdata_json.py).

EDR API gebruikt UTC-etmalen (00-00), KNMI ZIP gebruikt 08-08 UTC. De EDR-
datum loopt daardoor 1 dag voor, dus we vragen datum+1 aan bij EDR (zoals
ook in haal_maanddata.py).
"""
import os, json, sys, requests
from datetime import date, timedelta
import boto3

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# ── R2 config (zelfde als maak_dagdata_json.py) ─────────────────────────────
R2_ENDPOINT   = "https://05da71c7c88b8ce49fbb2c2d0a570416.r2.cloudflarestorage.com"
R2_ACCESS_KEY = "baf991003ce3e4075d91b89f8726bc0f"
R2_SECRET_KEY = "0f33229e2e03fe7bc7f9fdf7f9fa0acd5336c40718c6e25fe0b6a631ade8ac97"
R2_BUCKET     = "weerlab-dagdata"

# ── KNMI EDR config ─────────────────────────────────────────────────────────
KNMI_KEY = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY2ZjIwYWZjOTMwYTRkNDY5M2Q3MTc5OWVhMTI4ZGQwIiwiaCI6Im11cm11cjEyOCJ9"
EDR_BASE = "https://api.dataplatform.knmi.nl/edr/v1/collections"
HEADERS  = {"Authorization": KNMI_KEY}
EDR_COLLECTIES = [
    "daily-in-situ-meteorological-observations-validated",
    "daily-in-situ-meteorological-observations",
]
EDR_PARAMS = "TX,TN,RH,FXX,SQ"

# Alle stations uit stationsanalyse.html
STATIONS = [
    210, 215, 225, 235, 240, 242, 248, 249, 251, 257, 258, 260, 265, 267,
    269, 270, 273, 275, 277, 278, 279, 280, 283, 286, 290, 310, 319, 323,
    330, 331, 340, 343, 344, 348, 350, 356, 370, 375, 377, 380, 391, 392,
]

def wigos(stn):
    return f"0-20000-0-06{stn:03d}"

def haal_edr(stn, datum_iso):
    """Haal 1 dag op via EDR. Returnt dict met raw ints (0.1-eenheden) of None.
    Tekst-datum = KNMI ZIP-conventie (08-08 UTC); wij vragen datum+1 bij EDR."""
    edr_datum = (date.fromisoformat(datum_iso) + timedelta(days=1)).isoformat()
    params = {
        "datetime": f"{edr_datum}T00:00:00Z/{edr_datum}T23:59:59Z",
        "parameter-name": EDR_PARAMS,
    }
    for col in EDR_COLLECTIES:
        try:
            r = requests.get(
                f"{EDR_BASE}/{col}/locations/{wigos(stn)}",
                headers=HEADERS, params=params, timeout=15
            )
            if r.status_code == 429 or (r.status_code == 200 and '"error"' in r.text and "Quota" in r.text):
                raise RuntimeError("EDR-quota uitgeput — stoppen")
            if r.status_code != 200:
                continue
            js = r.json()
            if js.get("error"):
                if "Quota" in str(js.get("error", "")):
                    raise RuntimeError("EDR-quota uitgeput — stoppen")
                continue
            if not js.get("coverages"):
                continue
            ranges = js["coverages"][0].get("ranges", {})

            def laatste(key):
                vals = ranges.get(key, {}).get("values", [])
                for v in reversed(vals):
                    if v is not None:
                        return v
                return None

            tx  = laatste("TX")
            tn  = laatste("TN")
            rh  = laatste("RH")
            fxx = laatste("FXX")
            sq  = laatste("SQ")
            if all(v is None for v in [tx, tn, rh, fxx, sq]):
                continue

            def naar_raw(v):
                return None if v is None else int(round(v * 10))

            return {
                "TX":  naar_raw(tx),
                "TN":  naar_raw(tn),
                "RH":  naar_raw(rh),
                "FXX": naar_raw(fxx),
                "SQ":  naar_raw(sq),
                "_bron": "validated" if "validated" in col else "realtime",
            }
        except RuntimeError:
            raise  # quota-fouten doorgeven naar main()
        except Exception as e:
            print(f"    EDR-fout {stn} {datum_iso}: {e}")
            continue
    return None


def laatste_datum_in_json(js):
    """Geef de laatste YYYYMMDD-datum in de JSON als isoformaat (YYYY-MM-DD)."""
    idx = {c: i for i, c in enumerate(js["kolommen"])}
    datum_idx = idx["YYYYMMDD"]
    laatste_str = js["data"][-1][datum_idx]
    return f"{laatste_str[:4]}-{laatste_str[4:6]}-{laatste_str[6:8]}"


def main():
    vandaag   = date.today()
    gisteren  = vandaag - timedelta(days=1)
    print(f"Uitbreiden t/m {gisteren.isoformat()}")
    print("")

    s3 = boto3.client("s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name="auto",
    )

    totaal_aangevuld = 0
    stations_geraakt = 0
    for stn in STATIONS:
        pad = f"dagdata_{stn}.json"
        if not os.path.exists(pad):
            print(f"  {stn}: geen {pad}, overgeslagen")
            continue

        with open(pad) as f:
            js = json.load(f)
        if not js.get("data"):
            print(f"  {stn}: leeg")
            continue

        laatste_iso = laatste_datum_in_json(js)
        laatste_d   = date.fromisoformat(laatste_iso)
        if laatste_d >= gisteren:
            print(f"  {stn}: al actueel t/m {laatste_iso}")
            continue

        # Station met >14 dagen lag is waarschijnlijk gesloten → skip
        MAX_LAG = 14
        if (gisteren - laatste_d).days > MAX_LAG:
            print(f"  {stn}: CSV t/m {laatste_iso} is >{MAX_LAG} dagen oud, station waarschijnlijk gesloten — overgeslagen")
            continue

        volgorde = ["TX", "TN", "RH", "FXX", "SQ"]
        verwacht = ["YYYYMMDD"] + volgorde
        if js["kolommen"] != verwacht:
            print(f"  {stn}: onverwachte kolommen {js['kolommen']}, overgeslagen")
            continue

        nieuwe = []
        d = laatste_d + timedelta(days=1)
        geen_data_telling = 0
        MAX_GEEN_DATA = 3
        while d <= gisteren:
            try:
                edr = haal_edr(stn, d.isoformat())
            except RuntimeError as e:
                print(f"  AFBREKEN: {e}")
                print(f"  (evt. eerder geslaagde stations zijn al opgeslagen)")
                return
            if edr is None:
                geen_data_telling += 1
                print(f"    {stn} {d}: geen EDR-data ({geen_data_telling}/{MAX_GEEN_DATA})")
                if geen_data_telling >= MAX_GEEN_DATA:
                    print(f"    {stn}: {MAX_GEEN_DATA}x geen data → stoppen met aanvullen")
                    break
                d += timedelta(days=1)
                continue
            geen_data_telling = 0
            bron = edr.pop("_bron", "?")
            rij  = [d.strftime("%Y%m%d")] + [edr[k] for k in volgorde]
            nieuwe.append(rij)
            print(f"    {stn} {d} [{bron}]: TX={edr['TX']} TN={edr['TN']} RH={edr['RH']} FXX={edr['FXX']} SQ={edr['SQ']}")
            d += timedelta(days=1)

        if not nieuwe:
            print(f"  {stn}: niets nieuw toegevoegd")
            continue

        js["data"].extend(nieuwe)
        with open(pad, "w") as f:
            json.dump(js, f, separators=(",", ":"))

        try:
            s3.upload_file(pad, R2_BUCKET, pad,
                ExtraArgs={"ContentType": "application/json"})
            r2_status = "→ R2 ✓"
        except Exception as e:
            r2_status = f"→ R2 ✗ ({e})"

        totaal_aangevuld += len(nieuwe)
        stations_geraakt += 1
        print(f"  {stn}: +{len(nieuwe)} dag(en), t/m {nieuwe[-1][0]} {r2_status}")

    print("")
    print(f"Klaar: {stations_geraakt} stations aangevuld, {totaal_aangevuld} dag-records toegevoegd")


if __name__ == "__main__":
    main()
