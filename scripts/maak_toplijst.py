import os, requests, json, time
from datetime import date, timedelta, datetime, timezone
from math import isnan, isfinite
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

BASE_URL     = "https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations"
BASE_URL_DAG = "https://api.dataplatform.knmi.nl/edr/v1/collections/daily-in-situ-meteorological-observations-validated"
from knmi_api import knmi_get
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

# Startdatum: altijd vanaf 1 januari van het huidige jaar
HISTORIE_START = date(date.today().year, 1, 1)

# Minimale neerslagdrempel om meetruis te filteren (mm)
RR_DREMPEL = 0.2

# Stations die alleen wind meten (geen temperatuur)
WIND_ONLY_STATIONS = {
    "0-20000-0-06324",  # Stavenisse
    "0-20000-0-06331",  # Tholen
}

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
    "0-528-0-06392":   "Horst",
}

# ── Buienradar ────────────────────────────────────────────────────────────────

def _wigos_to_br_id(station_id: str) -> int:
    """WIGOS-ID "0-20000-0-06260" → Buienradar stationsnr 6260."""
    return int(station_id.split("-")[-1])

# Eenmalig gebouwde reverse-lookup: BR-stationsnr → stationsnaam
_BR_ID_TO_NAAM = {_wigos_to_br_id(wid): naam for wid, naam in STATIONS.items()}

def haal_buienradar() -> dict:
    """
    Haalt actuele metingen op via Buienradar JSON-feed.
    Retourneert dict: {stationsnaam: {
        "t10n": float|None,   ← groundtemperature  (altijd primair)
        "tx":   float|None,   ← temperature actueel (fallback voor TX)
        "tn":   float|None,   ← temperature actueel (fallback voor TN)
        "fx":   float|None,   ← windgusts m/s       (fallback voor FX)
        "ff":   float|None,   ← windspeed m/s        (fallback voor FF)
        "rr":   float|None,   ← rainFallLast24Hour mm (fallback voor RR)
    }}
    Noot: tx/tn/fx/ff/rr zijn momentopnames, geen etmaal-extremen.
    Ze dienen alleen als fallback als KNMI voor dat station helemaal uitvalt.
    """
    url = "https://data.buienradar.nl/2.0/feed/json"
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  Buienradar ophalen mislukt: {e}")
        return {}

    def _f(st, key):
        v = st.get(key)
        try:
            return float(v) if v is not None else None
        except (ValueError, TypeError):
            return None

    resultaat = {}
    for st in data.get("actual", {}).get("stationmeasurements", []):
        br_id = st.get("stationid")
        naam  = _BR_ID_TO_NAAM.get(br_id)
        if naam is None:
            continue
        resultaat[naam] = {
            "t10n": _f(st, "groundtemperature"),
            "tx":   _f(st, "temperature"),
            "tn":   _f(st, "temperature"),
            "fx":   _f(st, "windgusts"),
            "ff":   _f(st, "windspeed"),
            "rr":   _f(st, "rainFallLast24Hour"),
        }

    print(f"  Buienradar: {len(resultaat)}/{len(STATIONS)} stations gevonden")
    return resultaat

# ── helpers ───────────────────────────────────────────────────────────────────

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

# ── UTC-dag interval ──────────────────────────────────────────────────────────

def dag_interval_utc(dag: date) -> str:
    s = f"{dag.isoformat()}T00:00:00Z"
    e = f"{(dag + timedelta(days=1)).isoformat()}T00:00:00Z"
    return f"{s}/{e}"

def dag_interval_tot_nu_utc(dag: date) -> str:
    s   = f"{dag.isoformat()}T00:00:00Z"
    end = datetime.now(timezone.utc)
    e   = end.strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"{s}/{e}"

# ── API calls ─────────────────────────────────────────────────────────────────

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
    r = knmi_get(f"{BASE_URL}/locations/{station_id}", params=params, timeout=25)
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

def haal_t10n_knmi(station_id: str, dag: date, dt_range_10min: str = None) -> float | None:
    """
    T10N ophalen via de daggegevens API (validated daily observations).
    Fallback: laagste ta10 uit de 10-minuten API als daggegevens leeg zijn.
    Wordt alleen gebruikt als Buienradar geen groundtemperature heeft voor dit station.
    """
    s = f"{dag.isoformat()}T00:00:00Z"
    e = f"{(dag + timedelta(days=1)).isoformat()}T00:00:00Z"
    params = {"datetime": f"{s}/{e}", "parameter-name": "T10N"}
    try:
        r = knmi_get(f"{BASE_URL_DAG}/locations/{station_id}", params=params, timeout=20)
        if r.status_code not in (400, 404):
            r.raise_for_status()
            js = r.json()
            if js.get("coverages"):
                vals = to_floats(js["coverages"][0].get("ranges", {}).get("T10N", {}).get("values"))
                result = min_valid(vals)
                if result is not None:
                    return result
    except Exception:
        pass

    # Fallback: 10-minuten API, parameter ta10
    if dt_range_10min is None:
        dt_range_10min = f"{s}/{e}"
    try:
        params2 = {"datetime": dt_range_10min, "parameter-name": "ta10"}
        r2 = knmi_get(f"{BASE_URL}/locations/{station_id}", params=params2, timeout=20)
        if r2.status_code in (400, 404):
            return None
        r2.raise_for_status()
        js2 = r2.json()
        if not js2.get("coverages"):
            return None
        vals2 = to_floats(js2["coverages"][0].get("ranges", {}).get("ta10", {}).get("values"))
        return min_valid(vals2)
    except Exception:
        return None

def tijdstip_van_max(vals, tijden, local_tz):
    """Geeft tijdstip (HH:MM LT) van de maximale waarde."""
    best_val, best_t = None, None
    for v, t in zip(vals, tijden):
        if v is not None and (best_val is None or v > best_val):
            best_val, best_t = v, t
    if best_t is None: return None
    try:
        dt_utc = datetime.fromisoformat(best_t.replace("Z", "+00:00"))
        dt_lt  = dt_utc.astimezone(local_tz)
        return dt_lt.strftime("%H:%M")
    except: return None

def tijdstip_van_min(vals, tijden, local_tz):
    """Geeft tijdstip (HH:MM LT) van de minimale waarde."""
    best_val, best_t = None, None
    for v, t in zip(vals, tijden):
        if v is not None and (best_val is None or v < best_val):
            best_val, best_t = v, t
    if best_t is None: return None
    try:
        dt_utc = datetime.fromisoformat(best_t.replace("Z", "+00:00"))
        dt_lt  = dt_utc.astimezone(local_tz)
        return dt_lt.strftime("%H:%M")
    except: return None

def haal_temp_wind(station_id: str, dt_range: str) -> dict | None:
    """
    ta  → max = TX, min = TN (over UTC-etmaal)
    fx  → max windstoot
    Inclusief tijdstip van TX, TN en FX.
    """
    params = {"datetime": dt_range, "parameter-name": "ta,tx,tn,fx,ff"}
    r = knmi_get(f"{BASE_URL}/locations/{station_id}", params=params, timeout=25)
    if r.status_code in (400, 404): return None
    r.raise_for_status()
    js = r.json()
    if not js.get("coverages"): return None
    cov    = js["coverages"][0]
    t_vals = cov.get("domain", {}).get("axes", {}).get("t", {}).get("values") or []
    ranges = cov.get("ranges", {})
    ta  = to_floats(ranges.get("ta", {}).get("values"))
    tx  = to_floats(ranges.get("tx", {}).get("values"))
    tn  = to_floats(ranges.get("tn", {}).get("values"))
    fx  = to_floats(ranges.get("fx", {}).get("values"))
    tx_val = max_valid(tx) if max_valid(tx) is not None else max_valid(ta)
    tn_val = min_valid(tn) if min_valid(tn) is not None else min_valid(ta)
    fx_val = max_valid(fx)
    tx_t = tijdstip_van_max(tx if any(v is not None for v in tx) else ta, t_vals, LOCAL_TZ)
    tn_t = tijdstip_van_min(tn if any(v is not None for v in tn) else ta, t_vals, LOCAL_TZ)
    fx_t = tijdstip_van_max(fx, t_vals, LOCAL_TZ)
    # Windchill (min gevoelstemperatuur)
    ff_vals = to_floats(ranges.get("ff", {}).get("values"))
    gevoels_min = None
    gevoels_t = None
    for i, (t, f) in enumerate(zip(ta, ff_vals)):
        if t is None or f is None: continue
        if t < 15.0 and f * 3.6 > 4.8:
            wc = 13.12 + 0.6215*t - 11.37*(f*3.6)**0.16 + 0.3965*t*(f*3.6)**0.16
            wc = round(wc, 1)
            if gevoels_min is None or wc < gevoels_min:
                gevoels_min = wc
                if i < len(t_vals) and t_vals[i]:
                    from datetime import datetime, timezone
                    dt = datetime.fromisoformat(t_vals[i].replace("Z","+00:00"))
                    gevoels_t = dt.astimezone(LOCAL_TZ).strftime("%H:%M")
    return {
        "tx": tx_val, "tx_t": tx_t,
        "tn": tn_val, "tn_t": tn_t,
        "fx": fx_val, "fx_t": fx_t,
        "gevoels": gevoels_min, "gevoels_t": gevoels_t,
    }

def haal_neerslag(station_id: str, dt_range: str) -> float | None:
    """
    Neerslagsom uit rg (mm/uur × 10/60 per 10-min stap).
    Retourneert None als station geen regenmeter heeft (rg ontbreekt geheel).
    Waarden onder RR_DREMPEL worden als 0 beschouwd (meetruis).
    """
    params = {"datetime": dt_range, "parameter-name": "rg"}
    r = knmi_get(f"{BASE_URL}/locations/{station_id}", params=params, timeout=25)
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
    return total if total >= RR_DREMPEL else 0.0

def haal_wind_only(station_id: str, dt_range: str) -> dict | None:
    """
    Haal alleen fx en ff op voor wind-only stations (geen temperatuursensor).
    """
    params = {"datetime": dt_range, "parameter-name": "fx,ff"}
    r = knmi_get(f"{BASE_URL}/locations/{station_id}", params=params, timeout=25)
    if r.status_code in (400, 404): return None
    r.raise_for_status()
    js = r.json()
    if not js.get("coverages"): return None
    cov    = js["coverages"][0]
    t_vals = cov.get("domain", {}).get("axes", {}).get("t", {}).get("values") or []
    ranges = cov.get("ranges", {})
    fx  = to_floats(ranges.get("fx", {}).get("values"))
    fx_val = max_valid(fx)
    fx_t   = tijdstip_van_max(fx, t_vals, LOCAL_TZ)
    return {
        "tx": None, "tx_t": None,
        "tn": None, "tn_t": None,
        "fx": fx_val, "fx_t": fx_t,
        "gevoels": None, "gevoels_t": None,
    }

def haal_zon(station_id: str, dt_range: str) -> float | None:
    """
    Zonuren uit qg (globale straling W/m2).
    KNMI definitie: zon = straling > 120 W/m2.
    Per 10-min stap = 1/6 uur.
    """
    params = {"datetime": dt_range, "parameter-name": "qg"}
    r = knmi_get(f"{BASE_URL}/locations/{station_id}", params=params, timeout=25)
    if r.status_code in (400, 404): return None
    r.raise_for_status()
    js = r.json()
    if not js.get("coverages"): return None
    qg_raw = js["coverages"][0].get("ranges", {}).get("qg", {}).get("values")
    if not qg_raw: return None
    qg_vals = to_floats(qg_raw)
    zon_stappen = sum(1 for v in qg_vals if v is not None and v >= 120)
    return round(zon_stappen / 6.0, 1)

# ── Ophalen van één dag ────────────────────────────────────────────────────────

def haal_dag(dag: date) -> dict:
    is_vandaag = (dag == date.today())
    dt_range   = dag_interval_tot_nu_utc(dag) if is_vandaag else dag_interval_utc(dag)
    key        = dag.isoformat()
    res        = {"datum": key, "status": "voorlopig", "update": "",
                  "max": [], "min": [], "rr": [], "fx": [], "ff": [], "t10n": [], "sq": [], "gevoels": []}
    print(f"  Ophalen {dag} ({'tot nu' if is_vandaag else 'heel dag'})...")

    # ── Buienradar eenmalig ophalen ───────────────────────────────────────────
    # groundtemperature → altijd primair voor t10n
    # overige waarden   → fallback als KNMI voor dat station uitvalt
    br = haal_buienradar()

    for station_id, naam in STATIONS.items():
        br_st = br.get(naam, {})  # BR-data voor dit station (leeg dict als ontbreekt)

        # ── Temperatuur & wind (KNMI primair, BR fallback) ───────────────────
        try:
            if station_id in WIND_ONLY_STATIONS:
                tw = haal_wind_only(station_id, dt_range)
            else:
                tw = haal_temp_wind(station_id, dt_range)

            if tw:
                # TX
                if tw["tx"] is not None:
                    res["max"].append((tw["tx"], naam, tw.get("tx_t")))
                elif br_st.get("tx") is not None:
                    res["max"].append((br_st["tx"], naam, None))
                    print(f"    TX {naam}: KNMI None → BR {br_st['tx']:.1f}°")
                # TN
                if tw["tn"] is not None:
                    res["min"].append((tw["tn"], naam, tw.get("tn_t")))
                elif br_st.get("tn") is not None:
                    res["min"].append((br_st["tn"], naam, None))
                    print(f"    TN {naam}: KNMI None → BR {br_st['tn']:.1f}°")
                # FX
                if tw["fx"] is not None:
                    res["fx"].append((tw["fx"], naam, tw.get("fx_t")))
                elif br_st.get("fx") is not None:
                    res["fx"].append((br_st["fx"], naam, None))
                    print(f"    FX {naam}: KNMI None → BR {br_st['fx']:.1f} m/s")
                # Gevoelstemperatuur (alleen uit KNMI berekend)
                if tw.get("gevoels") is not None:
                    res["gevoels"].append((tw["gevoels"], naam, tw.get("gevoels_t")))
            else:
                # KNMI gaf None terug → volledig BR fallback
                if br_st.get("tx") is not None:
                    res["max"].append((br_st["tx"], naam, None))
                    print(f"    TX {naam}: KNMI leeg → BR {br_st['tx']:.1f}°")
                if br_st.get("tn") is not None:
                    res["min"].append((br_st["tn"], naam, None))
                    print(f"    TN {naam}: KNMI leeg → BR {br_st['tn']:.1f}°")
                if br_st.get("fx") is not None:
                    res["fx"].append((br_st["fx"], naam, None))
                    print(f"    FX {naam}: KNMI leeg → BR {br_st['fx']:.1f} m/s")

        except Exception as e:
            print(f"    Temp/wind fout {naam}: {e} → BR fallback")
            if br_st.get("tx") is not None:
                res["max"].append((br_st["tx"], naam, None))
            if br_st.get("tn") is not None:
                res["min"].append((br_st["tn"], naam, None))
            if br_st.get("fx") is not None:
                res["fx"].append((br_st["fx"], naam, None))

        # ── T10N: Buienradar groundtemperature altijd primair ─────────────────
        gt = br_st.get("t10n")
        if gt is not None:
            res["t10n"].append((gt, naam))
        else:
            # BR-station ontbreekt in feed → KNMI als fallback
            try:
                t10n_knmi = haal_t10n_knmi(station_id, dag, dt_range)
                if t10n_knmi is not None:
                    res["t10n"].append((t10n_knmi, naam))
                    print(f"    T10N {naam}: geen BR → KNMI {t10n_knmi:.1f}°")
            except Exception as e:
                print(f"    T10N {naam}: BR én KNMI mislukt: {e}")

        # ── FF anker-uur (KNMI primair, BR windspeed fallback) ────────────────
        try:
            ff_anker = hoogste_anker_uur(station_id, dt_range)
            if ff_anker is not None:
                res["ff"].append([ff_anker["ff"], naam, ff_anker["tijdvak"], ff_anker["dd"]])
            elif br_st.get("ff") is not None:
                res["ff"].append([br_st["ff"], naam, None, None])
                print(f"    FF {naam}: KNMI leeg → BR {br_st['ff']:.1f} m/s")
        except Exception as e:
            print(f"    Anker-uur fout {naam}: {e} → BR fallback")
            if br_st.get("ff") is not None:
                res["ff"].append([br_st["ff"], naam, None, None])

        # ── Zon (alleen KNMI) ─────────────────────────────────────────────────
        try:
            sq = haal_zon(station_id, dt_range)
            if sq is not None: res["sq"].append((sq, naam))
        except Exception as e:
            print(f"    Zon fout {naam}: {e}")

        # ── Neerslag (KNMI primair, BR rainFallLast24Hour fallback) ───────────
        try:
            mm = haal_neerslag(station_id, dt_range)
            if mm is not None:
                res["rr"].append((mm, naam))
            elif br_st.get("rr") is not None:
                res["rr"].append((br_st["rr"], naam))
                print(f"    RR {naam}: KNMI None → BR {br_st['rr']:.1f} mm")
        except Exception as e:
            print(f"    Neerslag fout {naam}: {e} → BR fallback")
            if br_st.get("rr") is not None:
                res["rr"].append((br_st["rr"], naam))

        time.sleep(0.05)

    res["max"]    = sorted(res["max"],  reverse=True)
    res["min"]    = sorted(res["min"])
    res["rr"]     = sorted(res["rr"],   reverse=True)
    res["fx"]     = sorted(res["fx"],   reverse=True)
    res["ff"]     = sorted(res["ff"],   key=lambda x: x[0], reverse=True)
    res["t10n"]   = sorted(res["t10n"])
    res["sq"]     = sorted(res["sq"],   reverse=True)
    res["gevoels"] = sorted(res["gevoels"])
    res["update"] = datetime.now().strftime("%d %b %Y %H:%M")

    print(f"    TX top3:   {res['max'][:3]}")
    print(f"    TN top3:   {res['min'][:3]}")
    print(f"    T10N top3: {res['t10n'][:3]}")
    print(f"    RR top3:   {res['rr'][:3]}")
    return res

# ── Hoofdlus met slim cachen ──────────────────────────────────────────────────

JSON_PATH  = "toplijst.json"
vandaag    = date.today()

# Laad bestaande data
if os.path.exists(JSON_PATH):
    with open(JSON_PATH) as f:
        resultaten = json.load(f)
    print(f"Bestaande data geladen: {len(resultaten)} dagen")
else:
    resultaten = {}

# Zet alle dagen vóór vandaag op definitief
for key, dag_data in resultaten.items():
    if key < vandaag.isoformat() and dag_data.get("status") == "voorlopig":
        dag_data["status"] = "definitief"

# Bepaal alle dagen van HISTORIE_START t/m vandaag
alle_dagen = []
d = HISTORIE_START
while d <= vandaag:
    alle_dagen.append(d)
    d += timedelta(days=1)

# Vandaag altijd eerst verwerken
resultaten[vandaag.isoformat()] = haal_dag(vandaag)

# Historische dagen: 2 ontbrekende dagen per run
aangevuld = 0
for dag in alle_dagen:
    if dag == vandaag:
        continue
    key = dag.isoformat()
    if key in resultaten:
        print(f"  {dag}: al in cache, overgeslagen")
        continue
    resultaten[key] = haal_dag(dag)
    aangevuld += 1
    if aangevuld >= 2:
        break

# Sorteer op datum
resultaten = dict(sorted(resultaten.items()))

vandaag_data = resultaten.get(vandaag.isoformat(), {})
if len(vandaag_data.get("max", [])) >= 5 or len(resultaten) > 1:
    with open(JSON_PATH, "w") as f:
        json.dump(resultaten, f)
    print(f"\ntoplijst.json bijgewerkt ({len(resultaten)} dagen)")
else:
    print(f"\nOnvoldoende data voor vandaag, toplijst.json NIET overschreven (fallback actief)")
