"""
open_meteo.py — centrale helper voor Open-Meteo API calls

Leest de commerciële API-key uit ~/.open_meteo_key (buiten de repo) en
bouwt URLs naar de customer-* endpoints zodat de scripts nooit
tegen rate limits aanlopen.

Fallback: als het keybestand ontbreekt, worden de gratis endpoints
gebruikt (zodat nieuwe installaties blijven werken).

Gebruik:
    from open_meteo import om_get, FORECAST, ENSEMBLE, PREVIOUS

    data = om_get(FORECAST, latitude=52.1, longitude=5.18,
                  hourly="temperature_2m", models="ecmwf_ifs",
                  forecast_days=16)

    # Of handmatig een URL bouwen:
    from open_meteo import om_url
    url = om_url(ENSEMBLE, latitude=52.1, longitude=5.18,
                 hourly="temperature_2m", models="ecmwf_ifs025")
    r = requests.get(url, timeout=40)
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any, Optional

import requests

# ---------------------------------------------------------------------------
# Key laden
# ---------------------------------------------------------------------------

_KEY_PATH = Path.home() / ".open_meteo_key"
_KEY_CACHE: Optional[str] = None
_KEY_CHECKED = False


def _load_key() -> Optional[str]:
    """Lees de API-key. Caching in proces — key verandert niet per run."""
    global _KEY_CACHE, _KEY_CHECKED
    if _KEY_CHECKED:
        return _KEY_CACHE
    _KEY_CHECKED = True

    # 1) Environment variable (voor CI/tests)
    env_key = os.environ.get("OPEN_METEO_KEY", "").strip()
    if env_key:
        _KEY_CACHE = env_key
        return _KEY_CACHE

    # 2) ~/.open_meteo_key bestand
    try:
        if _KEY_PATH.exists():
            key = _KEY_PATH.read_text().strip()
            if key:
                _KEY_CACHE = key
                return _KEY_CACHE
    except Exception:
        pass

    _KEY_CACHE = None
    return None


def has_key() -> bool:
    return _load_key() is not None


# ---------------------------------------------------------------------------
# Endpoint identifiers
# ---------------------------------------------------------------------------

# Interne tokens die door om_url/om_get worden omgezet naar de juiste host+path
FORECAST = "forecast"
ENSEMBLE = "ensemble"
PREVIOUS = "previous"
AIR_QUALITY = "air_quality"
MARINE = "marine"
ARCHIVE = "archive"
FLOOD = "flood"

_FREE_HOSTS = {
    FORECAST:    ("api.open-meteo.com",               "/v1/forecast"),
    ENSEMBLE:    ("ensemble-api.open-meteo.com",      "/v1/ensemble"),
    PREVIOUS:    ("previous-runs-api.open-meteo.com", "/v1/forecast"),
    AIR_QUALITY: ("air-quality-api.open-meteo.com",   "/v1/air-quality"),
    MARINE:      ("marine-api.open-meteo.com",        "/v1/marine"),
    ARCHIVE:     ("archive-api.open-meteo.com",       "/v1/archive"),
    FLOOD:       ("flood-api.open-meteo.com",         "/v1/flood"),
}

_CUSTOMER_HOSTS = {
    FORECAST:    ("customer-api.open-meteo.com",               "/v1/forecast"),
    ENSEMBLE:    ("customer-ensemble-api.open-meteo.com",      "/v1/ensemble"),
    PREVIOUS:    ("customer-previous-runs-api.open-meteo.com", "/v1/forecast"),
    AIR_QUALITY: ("customer-air-quality-api.open-meteo.com",   "/v1/air-quality"),
    MARINE:      ("customer-marine-api.open-meteo.com",        "/v1/marine"),
    ARCHIVE:     ("customer-archive-api.open-meteo.com",       "/v1/archive"),
    FLOOD:       ("customer-flood-api.open-meteo.com",         "/v1/flood"),
}


def _resolve_endpoint(endpoint: str) -> tuple[str, str]:
    if endpoint not in _FREE_HOSTS:
        raise ValueError(f"Onbekend Open-Meteo endpoint: {endpoint!r}")
    return _CUSTOMER_HOSTS[endpoint] if has_key() else _FREE_HOSTS[endpoint]


# ---------------------------------------------------------------------------
# URL bouwen
# ---------------------------------------------------------------------------

def _format_param(value: Any) -> str:
    if isinstance(value, (list, tuple)):
        return ",".join(str(v) for v in value)
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def om_url(endpoint: str, **params: Any) -> str:
    """Bouw een volledige Open-Meteo URL inclusief apikey indien beschikbaar."""
    host, path = _resolve_endpoint(endpoint)
    key = _load_key()

    parts = []
    for k, v in params.items():
        if v is None:
            continue
        parts.append(f"{k}={_format_param(v)}")
    if key:
        parts.append(f"apikey={key}")
    qs = "&".join(parts)
    return f"https://{host}{path}?{qs}"


# ---------------------------------------------------------------------------
# GET met retry (alleen nodig als iemand de gratis tier raakt)
# ---------------------------------------------------------------------------

def om_get(
    endpoint: str,
    *,
    timeout: float = 40,
    retries: int = 3,
    **params: Any,
) -> dict:
    """GET call met automatische retry bij 429/5xx."""
    url = om_url(endpoint, **params)
    last_err: Optional[Exception] = None
    for poging in range(retries):
        try:
            r = requests.get(url, timeout=timeout)
            if r.status_code == 429:
                wacht = min(4 * (poging + 1), 20)
                print(f"[open_meteo] 429 rate limit — wacht {wacht}s ({poging + 1}/{retries})")
                time.sleep(wacht)
                continue
            if r.status_code >= 500:
                wacht = min(2 * (poging + 1), 10)
                print(f"[open_meteo] {r.status_code} server error — wacht {wacht}s")
                time.sleep(wacht)
                continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            last_err = e
            print(f"[open_meteo] fout ({e}) — retry {poging + 1}/{retries}")
            time.sleep(2)
    raise RuntimeError(f"Open-Meteo call mislukt na {retries} pogingen: {last_err}")


# ---------------------------------------------------------------------------
# Utility: URL rewriten (voor scripts die nog inline URLs bouwen)
# ---------------------------------------------------------------------------

def upgrade_url(url: str) -> str:
    """Vervang een 'gratis' Open-Meteo URL door de customer-variant + apikey.

    Zo kunnen bestaande scripts minimaal worden aangepast: wikkel de URL en
    klaar. Als er geen key is, blijft de URL ongewijzigd.
    """
    key = _load_key()
    if not key:
        return url
    replaced = url
    # Sorteer op host-lengte (langste eerst) om ervoor te zorgen dat
    # 'ensemble-api.open-meteo.com' vóór 'api.open-meteo.com' wordt gematcht.
    # Match op '//host/' zodat we niet midden in een hostname replacen.
    hosts = sorted(
        ((free_host, _CUSTOMER_HOSTS[endpoint][0]) for endpoint, (free_host, _) in _FREE_HOSTS.items()),
        key=lambda pair: len(pair[0]),
        reverse=True,
    )
    for free_host, customer_host in hosts:
        marker = f"//{free_host}/"
        if marker in replaced:
            replaced = replaced.replace(marker, f"//{customer_host}/")
            break
    if "apikey=" in replaced:
        return replaced
    sep = "&" if "?" in replaced else "?"
    return f"{replaced}{sep}apikey={key}"


# ---------------------------------------------------------------------------
# Monkey-patch requests.get — voor scripts die inline Open-Meteo URLs bouwen
# ---------------------------------------------------------------------------
# Bestaande scripts hoeven alleen toe te voegen:
#
#     from open_meteo import install_requests_patch
#     install_requests_patch()
#
# Daarna worden alle requests.get() calls naar open-meteo.com automatisch
# omgezet naar customer-* endpoints + apikey. Andere URLs blijven onaangetast.

_PATCH_INSTALLED = False


def install_requests_patch() -> None:
    """Patch requests.get zodat Open-Meteo URLs automatisch worden geüpgrade."""
    global _PATCH_INSTALLED
    if _PATCH_INSTALLED:
        return
    if not has_key():
        # Geen key — niets te upgraden, geen patch nodig
        _PATCH_INSTALLED = True
        return

    original_get = requests.get

    def patched_get(url, *args, **kwargs):
        if isinstance(url, str) and "open-meteo.com" in url:
            url = upgrade_url(url)
        return original_get(url, *args, **kwargs)

    requests.get = patched_get  # type: ignore[assignment]
    _PATCH_INSTALLED = True


if __name__ == "__main__":
    print("Key geladen:", has_key())
    print("Voorbeeld URL:")
    print(om_url(FORECAST, latitude=52.1, longitude=5.18,
                 hourly="temperature_2m", models="ecmwf_ifs",
                 forecast_days=3))
    print()
    print("upgrade_url test:")
    print(upgrade_url("https://api.open-meteo.com/v1/forecast?latitude=52&hourly=temperature_2m"))
