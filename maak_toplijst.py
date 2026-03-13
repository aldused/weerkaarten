import os, requests, json, time
from datetime import date, timedelta, datetime, timezone
from math import isnan, isfinite
from zoneinfo import ZoneInfo

os.chdir(os.path.dirname(os.path.abspath(__file__)))

KNMI_KEY = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY2ZjIwYWZjOTMwYTRkNDY5M2Q3MTc5OWVhMTI4ZGQwIiwiaCI6Im11cm11cjEyOCJ9"
BASE_URL = "https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations"
HEADERS  = {"Authorization": KNMI_KEY, "Accept": "application/json"}
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

# Startdatum: altijd vanaf 1 januari van het huidige jaar
HISTORIE_START = date(date.today().year, 1, 1)

# Minimale neerslagdrempel om meetruis te filteren (mm)
# rg kan bij droge stations kleine spurious waarden geven
RR_DREMPEL = 0.2

STATIONS = {
    "0-20000-0-06215": "Voorschoten",
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
    "0-20000-0-06392": "Horst",
}

# ---- helpers ----

def to_floats(vals):
    out = []
    for v in (vals or []):
        try:
            x = float(v)
            out.append(x if isfinite(x) and not isnan(x) else None)
        except Exception:
            out.append(None)
    return out

def max_valid(vals):
    v = [x for x in vals if x is not None]
    return max(v) if v else None

def min_valid(vals):
    v = [x for x in vals if x is not None]
    return min(v) if v else None

# ---- UTC-dag interval (KNMI TX/TN etmaal = 00:00–00:00 UTC) ----

def dag_interval_utc(dag: date) -> str:
    s = f"{dag.isoformat()}T00:00:00Z"
    e = f"{(dag + timedelta(days=1)).isoformat()}T00:00:00Z"
    return f"{s}/{e}"

def dag_interval_tot_nu_utc(dag: date) -> str:
    s   = f"{dag.isoformat()}T00:00:00Z"
    end = datetime.now(timezone.utc)
    e   = end.strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"{s}/{e}"

# ---- API calls ----

def dd_gemiddeld(graden_lijst):
    """Circulair gemiddelde van windrichtingen in graden."""
    import math
    valide = [g for g in graden_lijst if g is not None]
    if not valide: return None
    sin_gem = sum(math.sin(math.radians(g)) for g in valide) / len(valide)
    cos_gem = sum(math.cos(math.radians(g)) for g in valide) / len(valide)
    gem = math.degrees(math.atan2(sin_gem, cos_gem)) % 360
    return round(gem)

def hoogste_anker_uur(station_id: str, dt_range: str) -> dict | None:
    """
    Hoogste uurgemiddelde wind (ff) op basis van anker-uren.
    Anker-uur = gemiddelde van 6 tijdstappen: HH:10, :20, :30, :40, :50, (HH+1):00
    Retourneert: {"ff": float, "tijdvak": "13:10-14:00", "dd": graden_of_None}
    """
    params = {"datetime": dt_range, "parameter-name": "ff,dd"}
    r = requests.get(f"{BASE_URL}/locations/{station_id}", headers=HEADERS, params=params, timeout=25)
    if r.status_code in (400, 404): return None
    r.raise_for_status()
    js = r.json()
    if not js.get("coverages"): return None
    cov    = js["coverages"][0]
    t_vals = cov.get("domain", {}).get("axes", {}).get("t", {}).get("values") or []
    ff_raw = to_floats(cov.get("ranges", {}).get("ff", {}).get("values"))
    dd_raw = to_floats(cov.get("ranges", {}).get("dd", {}).get("values"))
    if not t_vals or not ff_raw: return None

    tijden = []
    for ts in t_vals:
        try:
            tijden.append(datetime.fromisoformat(ts.replace("Z", "+00:00")))
        except Exception:
            tijden.append(None)

    ankers: dict = {}
    for i, (dt, ff) in enumerate(zip(tijden, ff_raw)):
        if dt is None or ff is None: continue
        m = dt.minute
        if m in (10, 20, 30, 40, 50):
            eind_uur  = (dt.hour + 1) % 24
            start_uur = dt.hour
            sleutel   = (dt.date(), eind_uur)
        elif m == 0:
            sleutel   = (dt.date(), dt.hour)
            start_uur = (dt.hour - 1) % 24
        else:
            continue
        if sleutel not in ankers:
            ankers[sleutel] = {"ff": [], "dd": [], "start_uur": start_uur}
        ankers[sleutel]["ff"].append(ff)
        dd_val = dd_raw[i] if dd_raw and i < len(dd_raw) else None
        ankers[sleutel]["dd"].append(dd_val)

    best_ff   = None
    best_info = None
    for (dag, eind_uur), data in ankers.items():
        if len(data["ff"]) == 6:
            gem = sum(data["ff"]) / 6.0
            if best_ff is None or gem > best_ff:
                best_ff   = gem
                best_info = {
                    "ff":      round(gem, 2),
                    "tijdvak": f"{data['start_uur']:02d}:10-{eind_uur:02d}:00",
                    "dd":      dd_gemiddeld(data["dd"]),
                }
    return best_info

def haal_temp_wind(station_id: str, dt_range: str) -> dict | None:
    """
    ta  → max = TX, min = TN (over UTC-etmaal)
    fx  → max windstoot
    ff via anker-uur → hoogste uurgemiddelde wind (officiële KNMI-definitie)
    """
    params = {"datetime": dt_range, "parameter-name": "ta,tx,tn,fx"}
    r = requests.get(f"{BASE_URL}/locations/{station_id}", headers=HEADERS, params=params, timeout=25)
    if r.status_code in (400, 404): return None
    r.raise_for_status()
    js = r.json()
    if not js.get("coverages"): return None
    ranges = js["coverages"][0].get("ranges", {})
    ta = to_floats(ranges.get("ta", {}).get("values"))
    tx = to_floats(ranges.get("tx", {}).get("values"))
    tn = to_floats(ranges.get("tn", {}).get("values"))
    fx = to_floats(ranges.get("fx", {}).get("values"))
    return {
        "tx": max_valid(tx) if max_valid(tx) is not None else max_valid(ta),
        "tn": min_valid(tn) if min_valid(tn) is not None else min_valid(ta),
        "fx": max_valid(fx),
    }

def haal_neerslag(station_id: str, dt_range: str) -> float | None:
    """
    Neerslagsom uit rg (mm/uur × 10/60 per 10-min stap).
    Retourneert None als station geen regenmeter heeft (rg ontbreekt geheel).
    Waarden onder RR_DREMPEL worden als 0 beschouwd (meetruis).
    """
    params = {"datetime": dt_range, "parameter-name": "rg"}
    r = requests.get(f"{BASE_URL}/locations/{station_id}", headers=HEADERS, params=params, timeout=25)
    if r.status_code in (400, 404): return None
    r.raise_for_status()
    js = r.json()
    if not js.get("coverages"): return None
    rg_raw = js["coverages"][0].get("ranges", {}).get("rg", {}).get("values")
    if not rg_raw:
        return None  # geen regenmeter
    rg_vals = to_floats(rg_raw)
    valide = [v for v in rg_vals if v is not None and v >= 0]
    if not valide:
        return None
    total = round(sum(v * (10.0 / 60.0) for v in valide), 1)
    # Meetruis onder drempel → 0.0
    return total if total >= RR_DREMPEL else 0.0

# ---- Ophalen van één dag ----

def haal_dag(dag: date) -> dict:
    is_vandaag = (dag == date.today())
    dt_range   = dag_interval_tot_nu_utc(dag) if is_vandaag else dag_interval_utc(dag)
    key        = dag.isoformat()
    res        = {"datum": key, "status": "voorlopig", "update": "",
                  "max": [], "min": [], "rr": [], "fx": [], "ff": []}
    print(f"  Ophalen {dag} ({'tot nu' if is_vandaag else 'heel dag'})...")

    for station_id, naam in STATIONS.items():
        try:
            tw = haal_temp_wind(station_id, dt_range)
            if tw:
                if tw["tx"] is not None: res["max"].append((tw["tx"], naam))
                if tw["tn"] is not None: res["min"].append((tw["tn"], naam))
                if tw["fx"] is not None: res["fx"].append((tw["fx"], naam))
        except Exception as e:
            print(f"    Temp/wind fout {naam}: {e}")

        try:
            ff_anker = hoogste_anker_uur(station_id, dt_range)
            if ff_anker is not None:
                res["ff"].append([ff_anker["ff"], naam, ff_anker["tijdvak"], ff_anker["dd"]])
        except Exception as e:
            print(f"    Anker-uur fout {naam}: {e}")

        try:
            mm = haal_neerslag(station_id, dt_range)
            if mm is not None:
                res["rr"].append((mm, naam))  # ook 0.0 opnemen
        except Exception as e:
            print(f"    Neerslag fout {naam}: {e}")

        time.sleep(0.05)

    res["max"] = sorted(res["max"], reverse=True)[:20]
    res["min"] = sorted(res["min"])[:20]
    res["rr"]  = sorted(res["rr"],  reverse=True)[:20]
    res["fx"]  = sorted(res["fx"],  reverse=True)[:20]
    res["ff"]  = sorted(res["ff"],  key=lambda x: x[0], reverse=True)[:20]
    res["update"] = datetime.now().strftime("%d %b %Y %H:%M")

    print(f"    TX top3: {res['max'][:3]}")
    print(f"    TN top3: {res['min'][:3]}")
    print(f"    RR top3: {res['rr'][:3]}")
    return res

# ---- Hoofdlus met slim cachen ----

JSON_PATH  = "toplijst.json"
vandaag    = date.today()

# Laad bestaande data
if os.path.exists(JSON_PATH):
    with open(JSON_PATH) as f:
        resultaten = json.load(f)
    print(f"Bestaande data geladen: {len(resultaten)} dagen")
else:
    resultaten = {}

# Bepaal alle dagen van HISTORIE_START t/m vandaag
alle_dagen = []
d = HISTORIE_START
while d <= vandaag:
    alle_dagen.append(d)
    d += timedelta(days=1)

for dag in alle_dagen:
    key = dag.isoformat()
    # Sla over als al aanwezig én niet vandaag
    if key in resultaten and dag != vandaag:
        print(f"  {dag}: al in cache, overgeslagen")
        continue
    resultaten[key] = haal_dag(dag)

# Sorteer op datum
resultaten = dict(sorted(resultaten.items()))

with open(JSON_PATH, "w") as f:
    json.dump(resultaten, f)
print(f"\ntoplijst.json bijgewerkt ({len(resultaten)} dagen)")
