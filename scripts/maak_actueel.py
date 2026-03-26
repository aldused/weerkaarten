"""
maak_actueel.py — Actuele KNMI 10-minuten waarnemingen
Haalt per station alle parameters op in 1 API call
Slaat op als actueel.json
"""
import os, json, requests, time
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

KNMI_KEY = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjgzMDcwMzljZTYyYjRkYjM5NWY2ZDcxMGQ2OGZkNjVkIiwiaCI6Im11cm11cjEyOCJ9"
BASE_URL = "https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations"
HEADERS  = {"Authorization": KNMI_KEY}
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

STATIONS = {
    "0-20000-0-06201": "IJmuiden",
    "0-20000-0-06203": "Wijk aan Zee",
    "0-20000-0-06210": "Valkenburg",
    "0-20000-0-06225": "IJmuiden",
    "0-20000-0-06229": "Texelhors",
    "0-20000-0-06235": "Den Helder",
    "0-20000-0-06240": "Schiphol",
    "0-20000-0-06242": "Vlieland",
    "0-20000-0-06248": "Wijdenes",
    "0-20000-0-06249": "Berkhout",
    "0-20000-0-06251": "Terschelling",
    "0-20000-0-06257": "Wijk aan Zee",
    "0-20000-0-06258": "Houtribdijk",
    "0-20000-0-06260": "De Bilt",
    "0-20000-0-06265": "Soesterberg",
    "0-20000-0-06267": "Stavoren",
    "0-20000-0-06269": "Lelystad",
    "0-20000-0-06270": "Leeuwarden",
    "0-20000-0-06273": "Marknesse",
    "0-20000-0-06275": "Deelen",
    "0-20000-0-06277": "Lauwersoog",
    "0-20000-0-06278": "Heino",
    "0-20000-0-06279": "Hoogeveen",
    "0-20000-0-06280": "Eelde",
    "0-20000-0-06283": "Hupsel",
    "0-20000-0-06286": "Nieuw Beerta",
    "0-20000-0-06290": "Twenthe",
    "0-20000-0-06310": "Vlissingen",
    "0-20000-0-06319": "Westdorpe",
    "0-20000-0-06323": "Wilhelminadorp",
    "0-20000-0-06324": "Stavenisse",
    "0-20000-0-06330": "Hoek van Holland",
    "0-20000-0-06331": "Tholen",
    "0-20000-0-06340": "Woensdrecht",
    "0-20000-0-06343": "Rotterdam Geulhaven",
    "0-20000-0-06344": "Rotterdam Airport",
    "0-20000-0-06348": "Cabauw",
    "0-20000-0-06350": "Gilze-Rijen",
    "0-20000-0-06356": "Herwijnen",
    "0-20000-0-06370": "Eindhoven",
    "0-20000-0-06375": "Volkel",
    "0-20000-0-06377": "Ell",
    "0-20000-0-06380": "Maastricht",
    "0-20000-0-06391": "Arcen",
    "0-528-0-06392": "Horst",
}

COORDS = {
    "IJmuiden":          (4.555, 52.458), "Wijk aan Zee":      (4.601, 52.504),
    "Valkenburg":        (4.417, 52.270), "Texelhors":         (4.862, 52.982),
    "Den Helder":        (4.789, 52.928), "Schiphol":          (4.781, 52.309),
    "Vlieland":          (4.920, 53.250), "Wijdenes":          (5.166, 52.632),
    "Berkhout":          (4.979, 52.644), "Terschelling":      (5.350, 53.392),
    "Houtribdijk":       (5.385, 52.649), "De Bilt":           (5.178, 52.101),
    "Soesterberg":       (5.276, 52.128), "Stavoren":          (5.362, 52.882),
    "Lelystad":          (5.521, 52.458), "Leeuwarden":        (5.774, 53.224),
    "Marknesse":         (5.888, 52.703), "Deelen":            (5.885, 52.060),
    "Lauwersoog":        (6.201, 53.413), "Heino":             (6.261, 52.439),
    "Hoogeveen":         (6.520, 52.730), "Eelde":             (6.586, 53.123),
    "Hupsel":            (6.657, 52.069), "Nieuw Beerta":      (7.150, 53.197),
    "Twenthe":           (6.889, 52.275), "Vlissingen":        (3.596, 51.442),
    "Westdorpe":         (3.861, 51.226), "Wilhelminadorp":    (3.884, 51.527),
    "Stavenisse":        (4.001, 51.594), "Hoek van Holland":  (4.131, 51.978),
    "Tholen":            (4.219, 51.531), "Woensdrecht":       (4.342, 51.449),
    "Rotterdam Geulhaven":(4.320, 51.850),"Rotterdam Airport": (4.437, 51.957),
    "Cabauw":            (4.926, 51.971), "Gilze-Rijen":       (4.931, 51.567),
    "Herwijnen":         (5.146, 51.859), "Eindhoven":         (5.377, 51.451),
    "Volkel":            (5.707, 51.657), "Ell":               (5.763, 51.198),
    "Maastricht":        (5.770, 50.911), "Arcen":             (6.196, 51.500),
    "Horst":             (6.029, 51.449),
}

def haal_station(wigos, naam):
    # Laatste 30 minuten
    nu  = datetime.now(timezone.utc)
    van = nu - timedelta(minutes=30)
    dt  = f"{van.strftime('%Y-%m-%dT%H:%M:%SZ')}/{nu.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    params = {
        "datetime": dt,
        "parameter-name": "ta,ff,fx,dd,vv,rh"
    }
    try:
        r = requests.get(f"{BASE_URL}/locations/{wigos}", headers=HEADERS, params=params, timeout=15)
        if r.status_code in (400, 403, 404): print(f"  {naam}: HTTP {r.status_code}"); return None
        r.raise_for_status()
        js = r.json()
        if not js.get("coverages"): return None
        cov = js["coverages"][0]
        ranges = cov.get("ranges", {})

        def laatste(key):
            vals = ranges.get(key, {}).get("values", [])
            for v in reversed(vals):
                if v is not None: return v
            return None

        ta   = laatste("ta")
        ff   = laatste("ff")
        fx   = laatste("fx")
        dd   = laatste("dd")
        vv   = laatste("vv")
        uu   = laatste("rh")

        # t10n apart ophalen (niet alle stations)
        t10n = None
        try:
            r2 = requests.get(f"{BASE_URL}/locations/{wigos}", headers=HEADERS,
                             params={"datetime": dt, "parameter-name": "t10n"}, timeout=10)
            if r2.status_code == 200:
                js2 = r2.json()
                if js2.get("coverages"):
                    cov2 = js2["coverages"][0]
                    vals2 = cov2.get("ranges",{}).get("t10n",{}).get("values",[])
                    for v in reversed(vals2):
                        if v is not None: t10n = v; break
        except:
            pass

        return {
            "naam": naam,
            "lon":  COORDS.get(naam, (None, None))[0],
            "lat":  COORDS.get(naam, (None, None))[1],
            "ta":   round(ta,   1) if ta   is not None else None,
            "ff":   round(ff,   1) if ff   is not None else None,
            "fx":   round(fx,   1) if fx   is not None else None,
            "dd":   round(dd,   0) if dd   is not None else None,
            "t10n": round(t10n, 1) if t10n is not None else None,
            "vv":   round(vv,   0) if vv   is not None else None,
            "uu":   round(uu,   0) if uu   is not None else None,
        }
    except Exception as e:
        print(f"  FOUT {naam}: {type(e).__name__}: {e}")
        return None

print("Actuele waarnemingen ophalen...")
resultaten = {}
for wigos, naam in STATIONS.items():
    data = haal_station(wigos, naam)
    if data:
        resultaten[naam] = data
        print(f"  {naam}: ta={data['ta']}°C ff={data['ff']}m/s")
    time.sleep(0.1)

nu_str = datetime.now(LOCAL_TZ).strftime("%d %b %Y %H:%M")
output = {
    "bijgewerkt": nu_str,
    "stations": resultaten
}

with open("actueel.json", "w") as f:
    json.dump(output, f, ensure_ascii=False)

print(f"Opgeslagen: actueel.json ({len(resultaten)} stations, {nu_str})")
