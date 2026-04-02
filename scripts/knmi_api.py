"""
knmi_api.py — Gedeelde KNMI API helper met fallback key
Importeer: from knmi_api import knmi_get
"""
import requests

KNMI_KEYS = [
    "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY2ZjIwYWZjOTMwYTRkNDY5M2Q3MTc5OWVhMTI4ZGQwIiwiaCI6Im11cm11cjEyOCJ9",
    "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjgzMDcwMzljZTYyYjRkYjM5NWY2ZDcxMGQ2OGZkNjVkIiwiaCI6Im11cm11cjEyOCJ9",
    "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjBkOWYwYzJjMmQzNzRjOGFhOTc5MzMyYTkwYTIzNmUwIiwiaCI6Im11cm11cjEyOCJ9",
    "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjcwNzVkMTU5NzkzYjQzMzc5ZjQyYzFjNjY1NzllZDMzIiwiaCI6Im11cm11cjEyOCJ9",
]

_actieve_key_idx = 0

def knmi_get(url, params=None, timeout=20, extra_headers=None):
    """
    GET request naar KNMI API met automatische fallback naar 3 keys.
    Gooit een Exception als alle keys falen.
    """
    global _actieve_key_idx
    # Probeer alle keys, begin bij de actieve
    volgorde = [(_actieve_key_idx + i) % len(KNMI_KEYS) for i in range(len(KNMI_KEYS))]
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
    raise Exception(f"Alle {len(KNMI_KEYS)} KNMI API-keys falen")
