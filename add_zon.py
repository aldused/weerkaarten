#!/usr/bin/env python3
import os
os.chdir(os.path.expanduser("~/Desktop/KNMI_Project/weerkaarten 2"))

with open('scripts/maak_toplijst.py', 'r') as f:
    c = f.read()

haal_zon = '''
def haal_zon(station_id: str, dt_range: str) -> float | None:
    """
    Zonuren uit qg (globale straling W/m2, 10-min gemiddelde).
    KNMI definitie: zon = straling > 120 W/m2.
    Per 10-min stap = 1/6 uur.
    """
    params = {"datetime": dt_range, "parameter-name": "qg"}
    r = requests.get(f"{BASE_URL}/locations/{station_id}", headers=HEADERS, params=params, timeout=25)
    if r.status_code in (400, 404): return None
    r.raise_for_status()
    js = r.json()
    if not js.get("coverages"): return None
    qg_raw = js["coverages"][0].get("ranges", {}).get("qg", {}).get("values")
    if not qg_raw: return None
    qg_vals = to_floats(qg_raw)
    zon_stappen = sum(1 for v in qg_vals if v is not None and v > 120)
    return round(zon_stappen / 6.0, 1)

'''

# 1. Voeg haal_zon functie toe
if 'def haal_zon' not in c:
    c = c.replace('# ---- Ophalen van één dag ----', haal_zon + '# ---- Ophalen van één dag ----')
    print("haal_zon functie toegevoegd")

# 2. Voeg sq toe aan res dict
c = c.replace(
    '"max": [], "min": [], "rr": [], "fx": [], "ff": [], "t10n": []}',
    '"max": [], "min": [], "rr": [], "fx": [], "ff": [], "t10n": [], "sq": []}'
)
print("sq in res dict:", '"sq": []' in c)

# 3. Voeg haal_zon aanroep toe in loop
oud_neerslag = '        try:\n            mm = haal_neerslag(station_id, dt_range)'
nieuw = '''        try:
            sq = haal_zon(station_id, dt_range)
            if sq is not None: res["sq"].append((sq, naam))
        except Exception as e:
            print(f"    Zon fout {naam}: {e}")

        try:
            mm = haal_neerslag(station_id, dt_range)'''

if oud_neerslag in c:
    c = c.replace(oud_neerslag, nieuw)
    print("haal_zon aanroep toegevoegd")

# 4. Sorteer sq
c = c.replace(
    'res["t10n"] = sorted(res["t10n"])',
    'res["t10n"] = sorted(res["t10n"])\n    res["sq"]   = sorted(res["sq"],   reverse=True)'
)
print("sq sortering:", 'res["sq"]   = sorted' in c)

with open('scripts/maak_toplijst.py', 'w') as f:
    f.write(c)

print("Klaar!")
