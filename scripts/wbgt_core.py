"""WBGT / Hittekracht volgens de Weerlab-berekeningshandleiding.

Formule buiten met zon (ISO 7243):
    WBGT = 0,7 * Tnw + 0,2 * Tg + 0,1 * Ta

Tnw: natuurlijke natteboltemperatuur via Liljegren (2008) warmte/massabalans
     op natte kokersilinder (d=7 mm), opgelost met Newton-Raphson.
     Initiaal geschat via Stull (2011); Tnw >= Tw bij lage windsnelheid.
Tg:  boltemperatuur via volledige Liljegren warmtebalans op 150 mm bol,
     opgelost met Newton-Raphson.
Bij weinig/geen zon (Sr < 50 W/m2): WBGT = 0,7 * Tnw + 0,3 * Ta.

De publieke helpers wbgt_outdoor() en wbgt_from_td() bewaren de bestaande
Weerlab-conventie: wind komt binnen als 10m-wind in m/s en wordt naar
borsthoogte (~1,1 m) gecorrigeerd met factor 0,6.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

SIGMA      = 5.67e-8
EPS_G      = 0.95
SOLAR_SCALE = 800.0

# Lucht- en thermodynamische constanten (≈ 25°C, 1013 hPa)
K_AIR      = 0.0263   # W/(mK)  warmtegeleiding lucht
NU_AIR     = 1.5e-5   # m²/s    kinematische viscositeit lucht
P_ATM      = 1013.25  # hPa     atmosferische standaarddruk
D_NWB      = 0.007    # m       diameter natte koker (Liljegren)
A_NATURAL  = 8.0e-4   # /°C/hPa psychrometrische constante nat bol (ongeventileerd)
ALPHA_WICK = 0.35     # -       zonabsorptie witte natte-koker katoen


def _finite(value: float | None) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value)


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _round1(value: float) -> float:
    return math.floor(value * 10.0 + 0.5) / 10.0


def _saturation_factor(T_c: float) -> float:
    return math.exp(17.625 * T_c / (243.04 + T_c))


def buck_es(T_c: float) -> float:
    """Verzadigde dampspanning [hPa], T in degC."""
    return 6.1094 * _saturation_factor(T_c)


def rh_from_td(Ta: float, Td: float) -> float:
    """Relatieve vochtigheid (%) uit Ta en Td (beide degC)."""
    return _clamp(100.0 * _saturation_factor(Td) / _saturation_factor(Ta), 0.0, 100.0)


def vapor_pressure(Ta: float, RH: float) -> float:
    """Actuele dampdruk [hPa] uit Ta en RH."""
    return _clamp(RH, 0.0, 100.0) / 100.0 * buck_es(Ta)


def stull_tw(Ta: float, RH: float) -> float:
    """Natteboltemperatuur Tw [degC] via Stull (2011)."""
    rh = _clamp(RH, 0.0, 100.0)
    return (
        Ta * math.atan(0.151977 * math.sqrt(rh + 8.313659))
        + math.atan(Ta + rh)
        - math.atan(rh - 1.676331)
        + 0.00391838 * rh**1.5 * math.atan(0.023101 * rh)
        - 4.686035
    )


def wind_10m_to_1m(u10: float) -> float:
    """10m-wind naar borsthoogte (~1,1 m), handleiding: v_1m ~= v_10m * 0,6."""
    return max(0.0, u10) * 0.6


def wind_10m_to_2m(u10: float) -> float:
    """Backwards-compatible alias voor oudere imports."""
    return wind_10m_to_1m(u10)


def solar_zenith_cos(lat_deg: float, lon_deg: float, dt_utc: datetime) -> float:
    """cos(zenith). dt_utc: timezone-aware UTC datetime; negatief wordt 0."""
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=timezone.utc)
    dt_utc = dt_utc.astimezone(timezone.utc)
    n = dt_utc.timetuple().tm_yday
    decl = math.radians(23.45) * math.sin(2 * math.pi * (284 + n) / 365.0)
    b = 2 * math.pi * (n - 81) / 364.0
    eot = 9.87 * math.sin(2 * b) - 7.53 * math.cos(b) - 1.5 * math.sin(b)
    utc_h = dt_utc.hour + dt_utc.minute / 60.0 + dt_utc.second / 3600.0
    solar_h = utc_h + lon_deg / 15.0 + eot / 60.0
    hour_angle = math.radians(15.0 * (solar_h - 12.0))
    lat = math.radians(lat_deg)
    cz = math.sin(lat) * math.sin(decl) + math.cos(lat) * math.cos(decl) * math.cos(hour_angle)
    return max(0.0, cz)


def clear_sky_ghi(cos_z: float) -> float:
    """Ruwe heldere-hemel instraling volgens de handleidingbasis."""
    return SOLAR_SCALE * _clamp(cos_z, 0.0, 1.0)


def estimate_ghi(cos_z: float, cloud_fraction: float) -> float:
    """Schat Sr uit bewolkingsfractie: (1 - bewolking) * 800 * cos(z)."""
    return clear_sky_ghi(cos_z) * (1.0 - _clamp(cloud_fraction, 0.0, 1.0))


def erbs_split(S: float, cos_z: float) -> tuple[float, float]:
    """Backwards-compatible grove direct/diffuus-split; niet gebruikt door WBGT."""
    s = max(0.0, S)
    cz = _clamp(cos_z, 0.0, 1.0)
    if s <= 0 or cz <= 0:
        return 0.0, 1.0
    fdif = _clamp(1.0 - s / max(1.0, clear_sky_ghi(cz)), 0.165, 1.0)
    return 1.0 - fdif, fdif


def calc_globe_temp(Ta: float, Sr: float, v: float) -> float:
    """Globetemperatuur Tg [degC] via Liljegren Newton-Raphson voor 150 mm bol.

    Oplost: eps*sigma*(Tg^4 - Ta^4) + h_c*(Tg - Ta) = eps*Sr/4
    h_c via Churchill-Bernstein gecalibreerd op 150 mm bol.
    """
    sr = max(0.0, Sr)
    if sr < 50:
        return Ta
    v_eff = max(v, 0.3)
    h_conv = 0.37 + 9.7 * math.sqrt(v_eff)
    Ta_K = Ta + 273.15
    Q = EPS_G * sr / 4.0
    # lineair startpunt
    Tg = Ta + Q / (h_conv + 4.0 * EPS_G * SIGMA * Ta_K ** 3)
    for _ in range(50):
        Tg_K = Tg + 273.15
        f  = EPS_G * SIGMA * (Tg_K ** 4 - Ta_K ** 4) + h_conv * (Tg - Ta) - Q
        fp = 4.0 * EPS_G * SIGMA * Tg_K ** 3 + h_conv
        dT = f / fp
        Tg -= dT
        if abs(dT) < 0.001:
            break
    return Tg


def globe_temperature(Ta: float, RH: float, S: float, cos_z: float,
                      u1m: float, cloud_fraction: float | None = None) -> float:
    """Backwards-compatible wrapper voor de oude exported signature."""
    return calc_globe_temp(Ta, S, u1m)


def natural_wet_bulb_liljegren(Ta: float, RH: float, v1m: float, Sr: float = 0.0) -> float:
    """Natuurlijke natteboltemperatuur via Liljegren (2008) energiebalans.

    Vergelijking: es(Tnw) = ea + AP*(Ta - Tnw) + AP*Qsol/hc
    - AP = A_NATURAL * P_ATM = 8,0e-4 * 1013,25 = 0,8106 hPa/°C
    - Qsol = ALPHA_WICK * Sr / pi  (witte katoen, cilindergeometrie)
    - hc via Nu = 0,53 * Re^0,5 (Liljegren-wick correlatie, d=7 mm)

    Garandeert Tnw >= Tw (psychrometrisch); verschil 0–1 °C afhankelijk van wind/zon.
    """
    rh    = _clamp(RH, 0.0, 100.0)
    s     = max(0.0, Sr)
    v_eff = max(v1m, 0.1)
    # Convectiecoëfficiënt natte koker-cilinder (Liljegren 2008)
    Re  = v_eff * D_NWB / NU_AIR
    Nu  = max(1.0, 0.53 * math.sqrt(Re))
    hc  = Nu * K_AIR / D_NWB
    # Zonabsorptie op wick (cilindergeometrie: 1/π)
    Qsol = ALPHA_WICK * s / math.pi if s > 50 else 0.0
    # Actuele dampdruk en psychrometrische constante
    ea     = rh / 100.0 * buck_es(Ta)
    AP     = A_NATURAL * P_ATM           # 0,8106 hPa/°C
    offset = AP * Qsol / hc             # effect zon op dampdruk-vergelijking
    # N-R: f(Tnw) = es(Tnw) - ea - AP*(Ta-Tnw) - offset = 0
    Tnw = stull_tw(Ta, rh) + 0.3        # startschatting iets boven Stull Tw
    for _ in range(50):
        es  = buck_es(Tnw)
        des = es * 17.625 * 243.04 / (243.04 + Tnw) ** 2
        f   = es - ea - AP * (Ta - Tnw) - offset
        fp  = des + AP
        dT  = -f / fp
        Tnw += dT
        if abs(dT) < 0.001:
            break
    return Tnw


def natural_wet_bulb(Tw: float, *args: float) -> float:
    """Backwards-compatible stub; gebruik natural_wet_bulb_liljegren voor Tnw."""
    return Tw


def wbgt_risico(wbgt: float) -> str:
    """Risicoklasse op basis van WBGT-waarde."""
    if wbgt < 19:
        return "Laag"
    if wbgt < 23:
        return "Matig"
    if wbgt < 28:
        return "Hoog"
    if wbgt < 32:
        return "Erg hoog"
    return "Extreem"


def wbgt_hittekracht(wbgt: float) -> int:
    """Schaal WBGT naar de KNMI Hittekracht-index (0-10).

    KNMI TR-26-04 gebruikt vaste intervallen van 2 graden WBGT:
    0 voor WBGT < 14, 1 voor 14-16, ..., 10 vanaf 32 graden.
    """
    if not _finite(wbgt):
        return 0
    return int(_clamp(math.floor((wbgt - 14.0) / 2.0) + 1, 0.0, 10.0))


def calc_wbgt(Ta: float, RH: float, v: float, Sr: float,
              outdoor: bool = True) -> dict[str, float | str]:
    """Bereken WBGT uit Ta, RH, borsthoogtewind en zonnestraling."""
    Tw  = stull_tw(Ta, RH)
    Tnw = natural_wet_bulb_liljegren(Ta, RH, v, Sr if outdoor else 0.0)
    has_sun = outdoor and Sr >= 50
    Tg = calc_globe_temp(Ta, Sr, v) if has_sun else Ta
    WBGT = 0.7 * Tnw + 0.2 * Tg + 0.1 * Ta if has_sun else 0.7 * Tnw + 0.3 * Ta
    return {
        "Tw": _round1(Tw),
        "Tnw": _round1(Tnw),
        "Tg": _round1(Tg),
        "WBGT": _round1(WBGT),
        "mode": "buiten" if has_sun else "binnen/schaduw",
        "risico": wbgt_risico(WBGT),
        "hittekracht": wbgt_hittekracht(WBGT),
    }


def wbgt_components(Ta: float, RH: float, S: float, u10: float,
                    cos_z: float, cloud_fraction: float | None = None) -> dict[str, float | str]:
    """Onderliggende WBGT-componenten. u10 is 10m-wind in m/s."""
    v1m = wind_10m_to_1m(u10 if _finite(u10) else 1.0)
    cz = _clamp(cos_z if _finite(cos_z) else 0.0, 0.0, 1.0)
    sr = max(0.0, S if _finite(S) else estimate_ghi(cz, cloud_fraction) if cloud_fraction is not None else 0.0)
    Tw  = stull_tw(Ta, RH)
    Tnw = natural_wet_bulb_liljegren(Ta, RH, v1m, sr)
    has_sun = sr >= 50
    Tg = calc_globe_temp(Ta, sr, v1m) if has_sun else Ta
    WBGT = 0.7 * Tnw + 0.2 * Tg + 0.1 * Ta if has_sun else 0.7 * Tnw + 0.3 * Ta
    return {
        "Ta": Ta,
        "RH": _clamp(RH, 0.0, 100.0),
        "Tw": Tw,
        "Tnw": Tnw,
        "Tg": Tg,
        "u1m": v1m,
        "u10": max(0.0, u10 if _finite(u10) else 1.0),
        "S": sr,
        "cos_z": cz,
        "WBGT": WBGT,
        "mode": "buiten" if has_sun else "binnen/schaduw",
        "risico": wbgt_risico(WBGT),
        "hittekracht": wbgt_hittekracht(WBGT),
    }


def wbgt_outdoor(Ta: float, RH: float, S: float, u10: float,
                 cos_z: float, cloud_fraction: float | None = None) -> float:
    """WBGT outdoor [degC]. u10 in m/s op 10 m; S in W/m2."""
    return float(wbgt_components(Ta, RH, S, u10, cos_z, cloud_fraction)["WBGT"])


def wbgt_from_td(Ta: float, Td: float, u10_ms: float,
                 lat: float, lon: float, dt_utc: datetime,
                 cloud_fraction: float | None = None,
                 S: float | None = None) -> float | None:
    """Bereken WBGT uit Ta, Td, 10m-wind, locatie/tijd, en optioneel Sr."""
    if Ta is None or Td is None:
        return None
    cos_z = solar_zenith_cos(lat, lon, dt_utc)
    if S is None:
        if cloud_fraction is None:
            return None
        S = estimate_ghi(cos_z, cloud_fraction)
    RH = rh_from_td(Ta, Td)
    u10 = u10_ms if u10_ms is not None else 1.0
    return wbgt_outdoor(Ta, RH, S, u10, cos_z, cloud_fraction)


if __name__ == "__main__":
    examples = [
        ("Hittegolf NL (gemiddeld)", 32.0, 50.0, 2.0, 700.0),
        ("Hittegolf windstil, zon",  35.0, 55.0, 0.5, 800.0),
        ("Binnen/schaduw 30C",       30.0, 60.0, 1.0,   0.0),
    ]
    for name, Ta, RH, v, Sr in examples:
        r = calc_wbgt(Ta, RH, v, Sr)
        print(
            f"{name}: WBGT {r['WBGT']:.1f} | Tw {r['Tw']:.1f} | Tnw {r['Tnw']:.1f} | "
            f"Tg {r['Tg']:.1f} | {r['risico']} | Hittekracht {r['hittekracht']}"
        )
