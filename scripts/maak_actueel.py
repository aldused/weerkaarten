"""
maak_actueel.py — Actuele KNMI 10-minuten waarnemingen
Haalt alle synop-velden op en slaat op als actueel.json
"""
import os, json, requests, time
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from knmi_api import knmi_get

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

BASE_URL = "https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations"
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

STATIONS = {
    "0-20000-0-06235": ("Den Helder",      4.789, 52.928),
    "0-20000-0-06240": ("Schiphol",        4.781, 52.309),
    "0-20000-0-06242": ("Vlieland",        4.920, 53.250),
    "0-20000-0-06251": ("Terschelling",    5.350, 53.392),
    "0-20000-0-06257": ("Wijk aan Zee",    4.600, 52.490),
    "0-20000-0-06260": ("De Bilt",         5.178, 52.101),
    "0-20000-0-06267": ("Stavoren",        5.380, 52.890),
    "0-20000-0-06269": ("Lelystad",        5.530, 52.458),
    "0-20000-0-06270": ("Leeuwarden",      5.774, 53.224),
    "0-20000-0-06273": ("Marknesse",       5.888, 52.703),
    "0-20000-0-06275": ("Deelen",          5.885, 52.060),
    "0-20000-0-06277": ("Lauwersoog",      6.200, 53.410),
    "0-20000-0-06279": ("Hoogeveen",       6.520, 52.730),
    "0-20000-0-06280": ("Eelde",           6.586, 53.123),
    "0-20000-0-06283": ("Hupsel",          6.657, 52.069),
    "0-20000-0-06286": ("Nieuw Beerta",    7.150, 53.195),
    "0-20000-0-06290": ("Twenthe",         6.889, 52.275),
    "0-20000-0-06310": ("Vlissingen",      3.596, 51.442),
    "0-20000-0-06319": ("Westdorpe",       3.861, 51.226),
    "0-20000-0-06323": ("Wilhelminadorp",  3.884, 51.527),
    "0-20000-0-06330": ("Hoek van Holland",4.131, 51.978),
    "0-20000-0-06340": ("Woensdrecht",     4.342, 51.450),
    "0-20000-0-06344": ("Rotterdam",       4.437, 51.957),
    "0-20000-0-06348": ("Cabauw",          4.926, 51.971),
    "0-20000-0-06350": ("Gilze-Rijen",     4.931, 51.567),
    "0-20000-0-06356": ("Herwijnen",       5.140, 51.859),
    "0-20000-0-06370": ("Eindhoven",       5.377, 51.451),
    "0-20000-0-06375": ("Volkel",          5.707, 51.657),
    "0-20000-0-06377": ("Ell",             5.763, 51.198),
    "0-20000-0-06380": ("Maastricht",      5.770, 50.911),
}

def haal_station(wigos, naam, lon, lat):
    nu  = datetime.now(timezone.utc)
    # 3u terug ophalen zodat we per station een historie-array (ta/td) kunnen opslaan
    van = nu - timedelta(minutes=180)
    dt  = f"{van.strftime('%Y-%m-%dT%H:%M:%SZ')}/{nu.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    params = {"datetime": dt, "parameter-name": "ta,td,ff,dd,fx,n,rh,vv,h,ww,tg,tgn,p0"}
    try:
        r = knmi_get(f"{BASE_URL}/locations/{wigos}", params=params, timeout=15)
        if r.status_code in (400, 404):
            print(f"  {naam}: HTTP {r.status_code}")
            return None
        js = r.json()
        if not js.get("coverages"): return None
        cov = js["coverages"][0]
        ranges = cov.get("ranges", {})
        # Tijden uit domain.axes.t.values (ISO-strings)
        try:
            tijden = cov.get("domain", {}).get("axes", {}).get("t", {}).get("values", [])
        except Exception:
            tijden = []
        def laatste(key):
            vals = ranges.get(key, {}).get("values", [])
            for v in reversed(vals):
                if v is not None: return v
            return None
        def rnd(key, d=1):
            v = laatste(key)
            return round(v, d) if v is not None else None
        # 3u-historie van ta/td/ff/dd/fx — voor nowcast OBS-overlay
        ta_serie = ranges.get("ta", {}).get("values", [])
        td_serie = ranges.get("td", {}).get("values", [])
        ff_serie = ranges.get("ff", {}).get("values", [])
        dd_serie = ranges.get("dd", {}).get("values", [])
        fx_serie = ranges.get("fx", {}).get("values", [])
        historie = []
        for i, t in enumerate(tijden):
            ta_v = ta_serie[i] if i < len(ta_serie) else None
            td_v = td_serie[i] if i < len(td_serie) else None
            ff_v = ff_serie[i] if i < len(ff_serie) else None
            dd_v = dd_serie[i] if i < len(dd_serie) else None
            fx_v = fx_serie[i] if i < len(fx_serie) else None
            if all(v is None for v in (ta_v, td_v, ff_v)):
                continue
            historie.append({
                "t": t,
                "ta": round(ta_v, 1) if ta_v is not None else None,
                "td": round(td_v, 1) if td_v is not None else None,
                "ff": round(ff_v, 1) if ff_v is not None else None,
                "dd": round(dd_v, 0) if dd_v is not None else None,
                "fx": round(fx_v, 1) if fx_v is not None else None,
            })
        return {
            "naam": naam, "lon": lon, "lat": lat,
            "ta": rnd("ta"), "td": rnd("td"),
            "ff": rnd("ff"), "dd": rnd("dd", 0),
            "fx": rnd("fx"), "n":  rnd("n",  0),
            "rh": rnd("rh", 0), "vv": rnd("vv", 0),
            "h":  rnd("h",  0), "ww": rnd("ww", 0),
            "tg": rnd("tg"), "tgn": rnd("tgn"), "p0": rnd("p0"),
            "historie": historie,
        }
    except Exception as e:
        print(f"  FOUT {naam}: {e}")
        return None

print("Actuele waarnemingen ophalen...")
resultaten = {}
for wigos, (naam, lon, lat) in STATIONS.items():
    data = haal_station(wigos, naam, lon, lat)
    if data:
        resultaten[naam] = data
        print(f"  {naam}: ta={data['ta']}° ff={data['ff']}m/s n={data['n']} oktas")
    time.sleep(0.1)

nu_str = datetime.now(LOCAL_TZ).strftime("%d %b %Y %H:%M")
with open("actueel.json", "w") as f:
    json.dump({"bijgewerkt": nu_str, "stations": resultaten}, f, ensure_ascii=False)
print(f"Opgeslagen: actueel.json ({len(resultaten)} stations, {nu_str})")
