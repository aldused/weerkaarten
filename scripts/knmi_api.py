"""
knmi_api.py — Gedeelde KNMI API helper met key-rotatie
Importeer: from knmi_api import knmi_get

5 EDR API keys met automatische rotatie om de 6 uur, fallback bij 403/401,
begrensde backoff voor tijdelijke server/netwerkfouten en een proces-overstijgende
circuitbreaker wanneer alle EDR-keys hun uurquota hebben bereikt.
"""
import json
import math
import os
import time
import requests
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

KNMI_KEYS = [
    "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY2ZjIwYWZjOTMwYTRkNDY5M2Q3MTc5OWVhMTI4ZGQwIiwiaCI6Im11cm11cjEyOCJ9",
    "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjgzMDcwMzljZTYyYjRkYjM5NWY2ZDcxMGQ2OGZkNjVkIiwiaCI6Im11cm11cjEyOCJ9",
    "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjBkOWYwYzJjMmQzNzRjOGFhOTc5MzMyYTkwYTIzNmUwIiwiaCI6Im11cm11cjEyOCJ9",
    "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjcwNzVkMTU5NzkzYjQzMzc5ZjQyYzFjNjY1NzllZDMzIiwiaCI6Im11cm11cjEyOCJ9",
    "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6IjY1MjM5YTkzYmIyNjRlMTQ5MGYwNmY2YWY5OTg3NzdhIiwiaCI6Im11cm11cjEyOCJ9",
]


def _rotatie_key():
    """Kies key op basis van uur: roteert om de 6 uur over alle keys."""
    uur = datetime.now().hour
    return (uur // 6) % len(KNMI_KEYS)

_actieve_key_idx = _rotatie_key()

_CIRCUIT_PATH = "/tmp/weerlab-knmi-edr-circuit.json"
_QUOTA_COOLDOWN_SECONDS = 300
_MAX_TRANSIENT_RETRIES = 2
_TRANSIENT_STATUSSEN = {500, 502, 503, 504}


class KnmiApiError(RuntimeError):
    """Basisklasse voor fouten die niet met een andere API-key worden opgelost."""


class KnmiQuotaError(KnmiApiError):
    """Alle beschikbare EDR-keys zitten tijdelijk aan hun uurquota."""


def _is_edr_url(url):
    return "/edr/" in url


def _lees_circuit_until():
    try:
        with open(_CIRCUIT_PATH) as f:
            waarde = json.load(f).get("blocked_until", 0)
        return float(waarde)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return 0.0


def _schrijf_circuit(until, reden):
    """Schrijf de EDR-circuitstatus atomair, zodat alle launchd-processen hem delen."""
    tijdelijk = f"{_CIRCUIT_PATH}.{os.getpid()}.tmp"
    try:
        with open(tijdelijk, "w") as f:
            json.dump({"blocked_until": until, "reason": reden}, f)
        os.replace(tijdelijk, _CIRCUIT_PATH)
    except OSError as exc:
        print(f"  Waarschuwing: KNMI-circuitstatus niet opgeslagen: {exc}")


def _retry_after_seconds(response):
    waarde = response.headers.get("Retry-After")
    if not waarde:
        return None
    try:
        return max(0.0, float(waarde))
    except (TypeError, ValueError):
        try:
            moment = parsedate_to_datetime(waarde)
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=timezone.utc)
            return max(0.0, (moment - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return None


def _is_quota_response(response):
    if response.status_code == 429:
        return True
    if response.status_code != 403:
        return False
    try:
        return "quota" in response.text.lower()
    except Exception:
        return False


def _request_met_backoff(url, headers, params, timeout):
    """Herhaal alleen sleutel-onafhankelijke netwerk- en 5xx-fouten begrensd."""
    laatste_fout = None
    for poging in range(_MAX_TRANSIENT_RETRIES + 1):
        try:
            response = requests.get(url, headers=headers, params=params, timeout=timeout)
        except requests.RequestException as exc:
            laatste_fout = exc
            if poging >= _MAX_TRANSIENT_RETRIES:
                raise KnmiApiError(f"KNMI-netwerkfout na {poging + 1} pogingen: {exc}") from exc
            wachttijd = 0.5 * (2 ** poging)
            print(f"  KNMI-netwerkfout, nieuwe poging over {wachttijd:.1f}s: {exc}")
            time.sleep(wachttijd)
            continue

        if response.status_code in _TRANSIENT_STATUSSEN and poging < _MAX_TRANSIENT_RETRIES:
            wachttijd = _retry_after_seconds(response)
            if wachttijd is None:
                wachttijd = 0.5 * (2 ** poging)
            wachttijd = min(wachttijd, 10.0)
            print(f"  KNMI HTTP {response.status_code}, nieuwe poging over {wachttijd:.1f}s")
            time.sleep(wachttijd)
            continue
        return response

    raise KnmiApiError(f"KNMI-aanvraag mislukt: {laatste_fout}")


def knmi_get(url, params=None, timeout=20, extra_headers=None):
    """
    GET request naar KNMI API met keyrotatie, quota-circuitbreaker en backoff.
    """
    global _actieve_key_idx

    nu = time.time()
    if _is_edr_url(url):
        geblokkeerd_tot = _lees_circuit_until()
        if geblokkeerd_tot > nu:
            resterend = math.ceil(geblokkeerd_tot - nu)
            raise KnmiQuotaError(f"KNMI EDR-circuit open; nieuwe poging over {resterend}s")

    # Probeer alle keys, begin bij de actieve (rotatie-based)
    volgorde = [(_actieve_key_idx + i) % len(KNMI_KEYS) for i in range(len(KNMI_KEYS))]
    quota_blokkades = []
    geweigerde_keys = 0
    for idx in volgorde:
        headers = {"Authorization": KNMI_KEYS[idx], "Accept": "application/json"}
        if extra_headers:
            headers.update(extra_headers)
        r = _request_met_backoff(url, headers, params, timeout)

        if _is_quota_response(r):
            wachttijd = _retry_after_seconds(r)
            if wachttijd is None:
                wachttijd = _QUOTA_COOLDOWN_SECONDS
            quota_blokkades.append(nu + min(wachttijd, 3600.0))
            print(f"  Key {idx+1} quota bereikt (HTTP {r.status_code}), probeer andere key...")
            continue

        if r.status_code in (401, 403):
            geweigerde_keys += 1
            print(f"  Key {idx+1} geweigerd (HTTP {r.status_code}), probeer andere key...")
            continue

        if r.status_code == 200:
            if idx != _actieve_key_idx:
                print(f"  Overgeschakeld naar key {idx+1}")
                _actieve_key_idx = idx
            return r

        return r  # ook 400/404 en een laatste 5xx teruggeven voor normale afhandeling

    alle_keys_onbruikbaar = len(quota_blokkades) + geweigerde_keys == len(KNMI_KEYS)
    if _is_edr_url(url) and quota_blokkades and alle_keys_onbruikbaar:
        geblokkeerd_tot = max(quota_blokkades)
        _schrijf_circuit(geblokkeerd_tot, "all_keys_quota")
        resterend = math.ceil(geblokkeerd_tot - time.time())
        raise KnmiQuotaError(
            f"Alle {len(KNMI_KEYS)} KNMI EDR-keys onbruikbaar (quota/403); "
            f"circuit {resterend}s open"
        )

    raise KnmiApiError(f"Alle {len(KNMI_KEYS)} KNMI API-keys falen")
