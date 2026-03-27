"""
knmi_api.py — Gedeelde KNMI API helper met fallback key
Importeer: from knmi_api import knmi_get
"""
import requests

KNMI_KEYS = [
    "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY2ZjIwYWZjOTMwYTRkNDY5M2Q3MTc5OWVhMTI4ZGQwIiwiaCI6Im11cm11cjEyOCJ9",
    "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjgzMDcwMzljZTYyYjRkYjM5NWY2ZDcxMGQ2OGZkNjVkIiwiaCI6Im11cm11cjEyOCJ9",
]

_actieve_key_idx = 0

def knmi_get(url, params=None, timeout=20, extra_headers=None):
    """
    GET request naar KNMI API met automatische fallback naar tweede key.
    Geeft (response, key_idx) terug, of gooit een Exception als beide falen.
    """
    global _actieve_key_idx
    # Probeer eerst de actieve key, dan de andere
    volgorde = [_actieve_key_idx, 1 - _actieve_key_idx]
    for idx in volgorde:
        headers = {"Authorization": KNMI_KEYS[idx], "Accept": "application/json"}
        if extra_headers:
            headers.update(extra_headers)
        try:
            r = requests.get(url, headers=headers, params=params, timeout=timeout)
            if r.status_code in (401, 403):
                print(f"  Key {idx+1} geweigerd (HTTP {r.status_code}), probeer andere key...")
                continue
            if r.status_code == 200:
                if idx != _actieve_key_idx:
                    print(f"  Overgeschakeld naar key {idx+1}")
                    _actieve_key_idx = idx
                return r
            return r  # ook 400/404 etc. teruggeven voor normale afhandeling
        except Exception as e:
            print(f"  Key {idx+1} fout: {e}")
            continue
    raise Exception("Beide KNMI API-keys falen")
