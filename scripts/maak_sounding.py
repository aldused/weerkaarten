#!/usr/bin/env python3
"""
Skew-T log-P diagram (sounding) generator
Haalt druklaagdata op via Open-Meteo API en rendert met MetPy/matplotlib.
"""
import os, sys, json, struct
import numpy as np
import requests
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.patches import FancyArrowPatch
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import metpy.calc as mpcalc
from metpy.plots import SkewT, Hodograph
from metpy.units import units

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
OUTDIR = "/Users/aldus/KNMI_Project/weerkaarten 2"

# Drukniveaus (hPa) - standaard niveaus voor sounding
PRESSURE_LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100]

# Stations
STATIONS = {
    "debilt":      {"name": "De Bilt",      "lat": 52.10, "lon": 5.18},
    "schiphol":    {"name": "Schiphol",     "lat": 52.31, "lon": 4.76},
    "vlissingen":  {"name": "Vlissingen",   "lat": 51.44, "lon": 3.60},
    "leeuwarden":  {"name": "Leeuwarden",   "lat": 53.22, "lon": 5.77},
    "maastricht":  {"name": "Maastricht",   "lat": 50.91, "lon": 5.77},
    "eindhoven":   {"name": "Eindhoven",    "lat": 51.45, "lon": 5.42},
    "rotterdam":   {"name": "Rotterdam",    "lat": 51.96, "lon": 4.45},
    "groningen":   {"name": "Groningen",    "lat": 53.13, "lon": 6.58},
}


def fetch_sounding_data(lat, lon, model="knmi_seamless"):
    """Haal druklaagdata op van Open-Meteo API."""
    # Bouw parameter-lijst
    hourly_params = []
    for lvl in PRESSURE_LEVELS:
        hourly_params.extend([
            f"temperature_{lvl}hPa",
            f"relative_humidity_{lvl}hPa",
            f"windspeed_{lvl}hPa",
            f"winddirection_{lvl}hPa",
            f"geopotential_height_{lvl}hPa",
        ])
    # Surface parameters
    hourly_params.extend([
        "temperature_2m", "dewpoint_2m",
        "surface_pressure",
        "windspeed_10m", "winddirection_10m",
        "cape",
    ])

    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": ",".join(hourly_params),
        "models": model,
        "forecast_days": 3,
        "timezone": "UTC",
    }

    r = requests.get(url, params=params, timeout=120)
    r.raise_for_status()
    data = r.json()

    if "error" in data:
        raise ValueError(f"API error: {data.get('reason', data['error'])}")

    return data


def extract_profile(data, time_idx):
    """Extraheer een verticaal profiel voor een specifiek tijdstip."""
    hourly = data["hourly"]

    p_levels = []
    t_levels = []
    td_levels = []
    ws_levels = []
    wd_levels = []
    h_levels = []

    for lvl in PRESSURE_LEVELS:
        t = hourly.get(f"temperature_{lvl}hPa", [None])[time_idx]
        rh = hourly.get(f"relative_humidity_{lvl}hPa", [None])[time_idx]
        ws = hourly.get(f"windspeed_{lvl}hPa", [None])[time_idx]
        wd = hourly.get(f"winddirection_{lvl}hPa", [None])[time_idx]
        gh = hourly.get(f"geopotential_height_{lvl}hPa", [None])[time_idx]

        if t is None or rh is None:
            continue

        # Bereken dauwpunt uit T en RH
        td = mpcalc.dewpoint_from_relative_humidity(
            t * units.degC, rh * units.percent
        ).magnitude

        p_levels.append(lvl)
        t_levels.append(t)
        td_levels.append(td)
        ws_levels.append(ws if ws is not None else 0)
        wd_levels.append(wd if wd is not None else 0)
        h_levels.append(gh if gh is not None else 0)

    if len(p_levels) < 4:
        return None

    # Converteer naar arrays met eenheden
    p = np.array(p_levels) * units.hPa
    T = np.array(t_levels) * units.degC
    Td = np.array(td_levels) * units.degC
    ws = np.array(ws_levels) * units("km/h")
    wd = np.array(wd_levels) * units.degrees
    heights = np.array(h_levels) * units.meter

    # Wind componenten (u, v) voor barbs
    u, v = mpcalc.wind_components(ws, wd)

    # Surface data
    sfc_t = hourly.get("temperature_2m", [None])[time_idx]
    sfc_td = hourly.get("dewpoint_2m", [None])[time_idx]
    sfc_p = hourly.get("surface_pressure", [None])[time_idx]
    sfc_ws = hourly.get("windspeed_10m", [None])[time_idx]
    sfc_wd = hourly.get("winddirection_10m", [None])[time_idx]
    cape_val = hourly.get("cape", [None])[time_idx]

    sfc = {
        "t": sfc_t, "td": sfc_td,
        "p": sfc_p / 100 if sfc_p else None,  # Pa -> hPa
        "ws": sfc_ws, "wd": sfc_wd,
        "cape_api": cape_val,
    }

    return {
        "p": p, "T": T, "Td": Td,
        "u": u, "v": v,
        "ws": ws, "wd": wd,
        "heights": heights,
        "sfc": sfc,
    }


def calc_thermodynamics(profile):
    """Bereken thermodynamische parameters."""
    p, T, Td = profile["p"], profile["T"], profile["Td"]
    heights = profile["heights"]
    sfc = profile["sfc"]

    results = {}

    # --- Surface-based parcel ---
    try:
        sfc_p_val = p[0]
        sfc_T_val = T[0]
        sfc_Td_val = Td[0]

        lcl_p, lcl_T = mpcalc.lcl(sfc_p_val, sfc_T_val, sfc_Td_val)
        results["lcl_p"] = lcl_p.magnitude
        results["lcl_t"] = lcl_T.magnitude

        # LCL hoogte schatten
        for i in range(len(p) - 1):
            if p[i] >= lcl_p >= p[i + 1]:
                frac = (p[i] - lcl_p) / (p[i] - p[i + 1])
                results["lcl_h"] = (heights[i] + frac * (heights[i + 1] - heights[i])).magnitude
                break
        else:
            results["lcl_h"] = None

        # Parcel path
        parcel_path = mpcalc.parcel_profile(p, sfc_T_val, sfc_Td_val)
        results["parcel_path"] = parcel_path

        # CAPE en CIN
        cape, cin = mpcalc.cape_cin(p, T, Td, parcel_path)
        results["cape_sfc"] = cape.magnitude
        results["cin_sfc"] = cin.magnitude

        # LFC
        try:
            lfc_p, lfc_T = mpcalc.lfc(p, T, Td)
            results["lfc_p"] = lfc_p.magnitude if not np.isnan(lfc_p.magnitude) else None
        except Exception:
            results["lfc_p"] = None

        # EL
        try:
            el_p, el_T = mpcalc.el(p, T, Td)
            results["el_p"] = el_p.magnitude if not np.isnan(el_p.magnitude) else None
        except Exception:
            results["el_p"] = None

        # Lifted Index
        try:
            li = mpcalc.lifted_index(p, T, parcel_path)
            results["li_sfc"] = li[0].magnitude
        except Exception:
            results["li_sfc"] = None

    except Exception as e:
        print(f"  Parcel calc error: {e}")
        results["cape_sfc"] = 0
        results["cin_sfc"] = 0
        results["lcl_p"] = None
        results["lcl_h"] = None
        results["lfc_p"] = None
        results["el_p"] = None
        results["li_sfc"] = None
        results["parcel_path"] = None

    # --- Mixed-layer parcel (50 hPa diep) ---
    try:
        ml_t, ml_td = mpcalc.mixed_parcel(p, T, Td, depth=50 * units.hPa)[:2]
        ml_path = mpcalc.parcel_profile(p, ml_t, ml_td)
        ml_cape, ml_cin = mpcalc.cape_cin(p, T, Td, ml_path)
        results["cape_ml"] = ml_cape.magnitude
        results["cin_ml"] = ml_cin.magnitude
        ml_lcl_p, _ = mpcalc.lcl(p[0], ml_t, ml_td)
        results["lcl_ml"] = ml_lcl_p.magnitude
        try:
            ml_li = mpcalc.lifted_index(p, T, ml_path)
            results["li_ml"] = ml_li[0].magnitude
        except Exception:
            results["li_ml"] = None
    except Exception:
        results["cape_ml"] = 0
        results["cin_ml"] = 0
        results["lcl_ml"] = None
        results["li_ml"] = None

    # --- Most Unstable parcel ---
    try:
        mu_p, mu_t, mu_td, mu_idx = mpcalc.most_unstable_parcel(p, T, Td, depth=300 * units.hPa)
        mu_path = mpcalc.parcel_profile(p[mu_idx:], mu_t, mu_td)
        mu_cape, mu_cin = mpcalc.cape_cin(p[mu_idx:], T[mu_idx:], Td[mu_idx:], mu_path)
        results["cape_mu"] = mu_cape.magnitude
        results["cin_mu"] = mu_cin.magnitude
        try:
            mu_li = mpcalc.lifted_index(p[mu_idx:], T[mu_idx:], mu_path)
            results["li_mu"] = mu_li[0].magnitude
        except Exception:
            results["li_mu"] = None
    except Exception:
        results["cape_mu"] = 0
        results["cin_mu"] = 0
        results["li_mu"] = None

    # --- Kinematics ---
    u, v = profile["u"], profile["v"]
    try:
        # Bulk wind shear 0-1 km
        u_shr_01, v_shr_01 = mpcalc.bulk_shear(p, u, v, heights=heights, depth=1000 * units.meter)
        results["shear_01"] = mpcalc.wind_speed(u_shr_01, v_shr_01).to("knots").magnitude
    except Exception:
        results["shear_01"] = None

    try:
        # Bulk wind shear 0-6 km
        u_shr_06, v_shr_06 = mpcalc.bulk_shear(p, u, v, heights=heights, depth=6000 * units.meter)
        results["shear_06"] = mpcalc.wind_speed(u_shr_06, v_shr_06).to("knots").magnitude
    except Exception:
        results["shear_06"] = None

    try:
        # Storm Relative Helicity 0-1 km en 0-3 km
        srh_pos_01, srh_neg_01, srh_tot_01 = mpcalc.storm_relative_helicity(
            heights, u, v, depth=1000 * units.meter
        )
        results["srh_01"] = srh_tot_01.magnitude
    except Exception:
        results["srh_01"] = None

    try:
        srh_pos_03, srh_neg_03, srh_tot_03 = mpcalc.storm_relative_helicity(
            heights, u, v, depth=3000 * units.meter
        )
        results["srh_03"] = srh_tot_03.magnitude
    except Exception:
        results["srh_03"] = None

    # --- Temperatuur indices ---
    try:
        # Freezing level
        found_freezing = False
        for i in range(len(T) - 1):
            if T[i].magnitude >= 0 >= T[i + 1].magnitude:
                frac = T[i].magnitude / (T[i].magnitude - T[i + 1].magnitude)
                results["freezing_h"] = (heights[i] + frac * (heights[i + 1] - heights[i])).magnitude
                found_freezing = True
                break
        if not found_freezing:
            if T[0].magnitude < 0:
                # Vorst aan de grond - nulgraadsgrens ligt onder het oppervlak
                results["freezing_h"] = 0
                results["freezing_below_sfc"] = True
            else:
                # Hele profiel boven nul (tropisch warm)
                results["freezing_h"] = None
    except Exception:
        results["freezing_h"] = None

    try:
        # Wet bulb zero
        Tw = mpcalc.wet_bulb_temperature(p, T, Td)
        for i in range(len(Tw) - 1):
            if Tw[i].magnitude >= 0 >= Tw[i + 1].magnitude:
                frac = Tw[i].magnitude / (Tw[i].magnitude - Tw[i + 1].magnitude)
                results["wbz_h"] = (heights[i] + frac * (heights[i + 1] - heights[i])).magnitude
                break
        else:
            results["wbz_h"] = None
    except Exception:
        results["wbz_h"] = None

    # Precipitable water
    try:
        pw = mpcalc.precipitable_water(p, Td)
        results["pw"] = pw.to("mm").magnitude
    except Exception:
        results["pw"] = None

    # Max temperature (surface)
    results["max_t"] = T[0].magnitude
    results["sfc_t"] = sfc.get("t", T[0].magnitude)

    # --- Inversies detecteren ---
    inversions = []
    T_mag = np.array([t.magnitude for t in T])
    h_mag = np.array([h.magnitude for h in heights])
    p_mag = np.array([pp.magnitude for pp in p])
    for i in range(len(T_mag) - 1):
        if T_mag[i + 1] > T_mag[i]:  # Temperatuur neemt toe met hoogte
            inv_sterkte = T_mag[i + 1] - T_mag[i]
            inversions.append({
                "h_onder": h_mag[i],
                "h_boven": h_mag[i + 1],
                "p_onder": p_mag[i],
                "p_boven": p_mag[i + 1],
                "t_onder": T_mag[i],
                "t_boven": T_mag[i + 1],
                "sterkte": inv_sterkte,
            })
    results["inversions"] = inversions

    # --- IJsdriehoek: zone 0 tot -20°C met T-Td < 3°C ---
    Td_mag = np.array([td.magnitude for td in Td])
    icing_zones = []
    for i in range(len(T_mag)):
        t_val = T_mag[i]
        spread = T_mag[i] - Td_mag[i]
        if -20 <= t_val <= 0 and spread < 3:
            icing_zones.append({
                "h": h_mag[i],
                "p": p_mag[i],
                "t": t_val,
                "spread": spread,
            })
    # Groepeer aaneengesloten zones
    icing_layers = []
    if icing_zones:
        current = {"p_top": icing_zones[0]["p"], "p_bot": icing_zones[0]["p"],
                   "h_bot": icing_zones[0]["h"], "h_top": icing_zones[0]["h"],
                   "t_min": icing_zones[0]["t"], "t_max": icing_zones[0]["t"]}
        for iz in icing_zones[1:]:
            current["p_top"] = iz["p"]
            current["h_top"] = iz["h"]
            current["t_min"] = min(current["t_min"], iz["t"])
            current["t_max"] = max(current["t_max"], iz["t"])
        icing_layers.append(current)
    results["icing_layers"] = icing_layers

    return results


def interpret_sounding(thermo, profile):
    """Vertaal technische sounding-data naar begrijpelijk Nederlands."""

    lines = []

    # --- Stabiliteit / buienkans ---
    cape = thermo.get("cape_sfc", 0) or 0
    cape_ml = thermo.get("cape_ml", 0) or 0
    best_cape = max(cape, cape_ml)
    li = thermo.get("li_sfc")

    if best_cape >= 2500:
        stab_tekst = "Zeer onstabiel"
        stab_kleur = "#c0392b"
        stab_detail = "Krachtige onweersbuien mogelijk met kans op hagel en windstoten"
    elif best_cape >= 1000:
        stab_tekst = "Onstabiel"
        stab_kleur = "#e67e22"
        stab_detail = "Onweersbuien waarschijnlijk, lokaal fors"
    elif best_cape >= 300:
        stab_tekst = "Licht onstabiel"
        stab_kleur = "#f39c12"
        stab_detail = "Kans op (onweers)buien"
    elif best_cape > 0:
        stab_tekst = "Marginaal onstabiel"
        stab_kleur = "#d4ac0d"
        stab_detail = "Kleine kans op een enkele bui"
    else:
        stab_tekst = "Stabiel"
        stab_kleur = "#27ae60"
        stab_detail = "Geen buien verwacht op basis van instabiliteit"

    lines.append(("Stabiliteit", stab_tekst, stab_kleur, stab_detail))

    # --- Wolkenbasis ---
    lcl_h = thermo.get("lcl_h")
    if lcl_h is not None:
        if lcl_h < 500:
            wb_tekst = f"{lcl_h:.0f} m (zeer laag)"
            wb_kleur = "#7f8c8d"
        elif lcl_h < 1500:
            wb_tekst = f"{lcl_h:.0f} m (laag)"
            wb_kleur = "#95a5a6"
        elif lcl_h < 3000:
            wb_tekst = f"{lcl_h:.0f} m"
            wb_kleur = "#2c3e50"
        else:
            wb_tekst = f"{lcl_h:.0f} m (hoog)"
            wb_kleur = "#3498db"
        lines.append(("Wolkenbasis", wb_tekst, wb_kleur, "Hoogte waar condensatie begint (cumulus-basis)"))
    else:
        lines.append(("Wolkenbasis", "---", "#95a5a6", ""))

    # --- Vriesgrens ---
    fh = thermo.get("freezing_h")
    if fh is not None:
        if thermo.get("freezing_below_sfc"):
            sfc_t = thermo.get("sfc_t", 0)
            fh_detail = f"Vorst aan de grond ({sfc_t:.0f}°C), neerslag valt als sneeuw of ijzel"
            lines.append(("Nulgraadsgrens", f"Aan het oppervlak (vorst)", "#c0392b", fh_detail))
        elif fh < 500:
            fh_detail = "Neerslag valt als sneeuw tot lage niveaus"
            lines.append(("Nulgraadsgrens", f"{fh:.0f} m", "#2980b9", fh_detail))
        elif fh < 1500:
            fh_detail = "Sneeuw/hagel kan de grond bereiken in buien"
            lines.append(("Nulgraadsgrens", f"{fh:.0f} m", "#2980b9", fh_detail))
        elif fh < 3000:
            fh_detail = "Regen aan de grond, sneeuw in de bergen"
            lines.append(("Nulgraadsgrens", f"{fh:.0f} m", "#2980b9", fh_detail))
        else:
            fh_detail = "Neerslag valt als regen"
            lines.append(("Nulgraadsgrens", f"{fh:.0f} m", "#27ae60", fh_detail))
    else:
        lines.append(("Nulgraadsgrens", "Boven bereik profiel", "#95a5a6", "Hele atmosfeer boven nul"))

    # --- Neerslaanbaar water ---
    pw = thermo.get("pw")
    if pw is not None:
        if pw > 40:
            pw_detail = "Veel vocht, kans op zware neerslag"
            pw_kleur = "#2980b9"
        elif pw > 25:
            pw_detail = "Flink vocht beschikbaar"
            pw_kleur = "#3498db"
        elif pw > 15:
            pw_detail = "Gemiddelde hoeveelheid vocht"
            pw_kleur = "#2c3e50"
        else:
            pw_detail = "Droge atmosfeer"
            pw_kleur = "#e67e22"
        lines.append(("Neerslaanbaar water", f"{pw:.0f} mm", pw_kleur, pw_detail))
    else:
        lines.append(("Neerslaanbaar water", "---", "#95a5a6", ""))

    # --- Windschering (buien-organisatie) ---
    shear = thermo.get("shear_06")
    if shear is not None:
        shear_kmh = shear * 1.852  # kt -> km/h
        if shear >= 40:
            sh_tekst = f"{shear_kmh:.0f} km/h (sterk)"
            sh_kleur = "#c0392b"
            sh_detail = "Sterke schering: buien kunnen georganiseerd/langlevend worden (supercellen)"
        elif shear >= 25:
            sh_tekst = f"{shear_kmh:.0f} km/h (matig)"
            sh_kleur = "#e67e22"
            sh_detail = "Matige schering: multicellen mogelijk, buien kunnen intenser worden"
        elif shear >= 15:
            sh_tekst = f"{shear_kmh:.0f} km/h (licht)"
            sh_kleur = "#f39c12"
            sh_detail = "Lichte schering: buien kortlevend maar mogelijk met windstoten"
        else:
            sh_tekst = f"{shear_kmh:.0f} km/h (zwak)"
            sh_kleur = "#27ae60"
            sh_detail = "Zwakke schering: buien weinig georganiseerd"
        lines.append(("Windschering 0-6 km", sh_tekst, sh_kleur, sh_detail))
    else:
        lines.append(("Windschering 0-6 km", "---", "#95a5a6", ""))

    # --- Oppervlaktewind ---
    sfc_ws = profile["sfc"].get("ws")
    sfc_wd = profile["sfc"].get("wd")
    if sfc_ws is not None and sfc_wd is not None:
        # Windrichting naar tekst
        dirs = ["N", "NNO", "NO", "ONO", "O", "OZO", "ZO", "ZZO",
                "Z", "ZZW", "ZW", "WZW", "W", "WNW", "NW", "NNW"]
        wd_txt = dirs[int((sfc_wd + 11.25) % 360 / 22.5)]
        # Beaufort
        bft_grenzen = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]
        bft = 0
        for g in bft_grenzen:
            if sfc_ws >= g:
                bft += 1
        lines.append(("Wind aan de grond",
                      f"{wd_txt} {sfc_ws:.0f} km/h (Bft {bft})",
                      "#2c3e50",
                      f"Richting {sfc_wd:.0f}°"))

    # --- Inversie ---
    inversions = thermo.get("inversions", [])
    if inversions:
        # Sterkste inversie
        strongest = max(inversions, key=lambda x: x["sterkte"])
        h_onder = strongest["h_onder"]
        h_boven = strongest["h_boven"]
        sterkte = strongest["sterkte"]
        if h_onder < 500:
            inv_detail = "Grondnabije inversie: mist/laaghangende bewolking, luchtkwaliteit kan verslechteren"
        elif h_onder < 2000:
            inv_detail = "Lage inversie: deksel op de atmosfeer, buiengroei geblokkeerd"
        else:
            inv_detail = "Inversie in de middenlaag: kan buiengroei beperken"
        if sterkte >= 5:
            inv_kleur = "#c0392b"
            inv_sterkte_txt = "sterk"
        elif sterkte >= 2:
            inv_kleur = "#e67e22"
            inv_sterkte_txt = "matig"
        else:
            inv_kleur = "#f39c12"
            inv_sterkte_txt = "zwak"
        h_txt = f"{h_onder:.0f}-{h_boven:.0f} m" if h_onder < 1000 else f"{h_onder/1000:.1f}-{h_boven/1000:.1f} km"
        lines.append(("Inversie",
                      f"{inv_sterkte_txt} (+{sterkte:.1f}°C) op {h_txt}",
                      inv_kleur, inv_detail))

    # --- IJsdriehoek ---
    icing = thermo.get("icing_layers", [])
    if icing:
        layer = icing[0]
        h_bot = layer["h_bot"]
        h_top = layer["h_top"]
        t_min = layer["t_min"]
        t_max = layer["t_max"]
        if h_bot < 500:
            ice_detail = "IJzel/aanvriezende neerslag mogelijk aan de grond"
            ice_kleur = "#c0392b"
        elif t_min < -12:
            ice_detail = "Ernstige ijsafzetting mogelijk (veel onderkoeld water)"
            ice_kleur = "#e67e22"
        else:
            ice_detail = "Lichte tot matige ijsafzetting mogelijk in wolken"
            ice_kleur = "#3498db"
        h_txt = f"{h_bot:.0f}-{h_top:.0f} m" if h_top < 1000 else f"{h_bot/1000:.1f}-{h_top/1000:.1f} km"
        lines.append(("IJsdriehoek",
                      f"{h_txt} ({t_max:.0f} tot {t_min:.0f}°C)",
                      ice_kleur,
                      ice_detail))

    # --- Bovenwind ---
    max_ws = 0
    max_ws_h = 0
    for i in range(len(profile["ws"])):
        ws_val = profile["ws"][i].magnitude
        if ws_val > max_ws:
            max_ws = ws_val
            max_ws_h = profile["heights"][i].magnitude
    if max_ws > 0:
        lines.append(("Sterkste bovenwind",
                      f"{max_ws:.0f} km/h op {max_ws_h:.0f} m",
                      "#8e44ad" if max_ws > 100 else "#2c3e50",
                      "Straalstroom" if max_ws > 120 else ""))

    return lines


def _draw_indicator(ax, x, y, color, size=0.018):
    """Teken een kleurindicator-bolletje."""
    circle = plt.Circle((x, y), size, color=color, transform=ax.transAxes,
                        clip_on=False, zorder=10)
    ax.add_patch(circle)


def plot_sounding(profile, thermo, station_name, lat, lon, valid_time, model_name, run_time):
    """Maak het Skew-T diagram met hodograaf, interpretatie en tabellen."""

    interpretation = interpret_sounding(thermo, profile)

    fig = plt.figure(figsize=(18, 16), facecolor="white")
    plt.rcParams.update({'font.size': 12})

    # ============================================================
    # TITEL
    # ============================================================
    valid_local = valid_time.astimezone(LOCAL_TZ)
    run_local = run_time.astimezone(LOCAL_TZ) if run_time else valid_local

    _nl_dagen = ["maandag", "dinsdag", "woensdag", "donderdag",
                 "vrijdag", "zaterdag", "zondag"]
    dag_tekst = _nl_dagen[valid_local.weekday()]
    _nl_maanden = ["jan", "feb", "mrt", "apr", "mei", "jun",
                   "jul", "aug", "sep", "okt", "nov", "dec"]
    mnd = _nl_maanden[valid_local.month - 1]

    fig.text(0.03, 0.975, f"Atmosferisch profiel  {station_name}",
             fontsize=18, fontweight="bold", va="top", color="#2c3e50")
    fig.text(0.03, 0.960,
             f"{dag_tekst} {valid_local.day} {mnd} {valid_local.year}  "
             f"{valid_local.strftime('%H:%M')} LT",
             fontsize=13, va="top", color="#7f8c8d")
    fig.text(0.97, 0.975,
             f"{model_name}",
             fontsize=12, va="top", ha="right", color="#95a5a6")
    fig.text(0.97, 0.960,
             f"Run {run_local.strftime('%d %b %HZ')}  |  "
             f"{lat:.2f}°N  {lon:.2f}°E",
             fontsize=12, va="top", ha="right", color="#bdc3c7")

    # ============================================================
    # INTERPRETATIE-PANEEL (rechts boven)
    # Dynamische hoogte op basis van aantal items
    # ============================================================
    n_items = len(interpretation)
    item_height = 0.028  # per item in fig-coords
    detail_extra = 0.012
    n_details = sum(1 for _, _, _, d in interpretation if d)
    interp_h = 0.03 + n_items * item_height + n_details * detail_extra
    interp_top = 0.945
    interp_bot = interp_top - interp_h

    ax_interp = fig.add_axes([0.58, interp_bot, 0.40, interp_h])
    ax_interp.axis("off")
    ax_interp.set_xlim(0, 1)
    ax_interp.set_ylim(0, 1)

    # Lichte achtergrond
    from matplotlib.patches import FancyBboxPatch
    bg = FancyBboxPatch((0, 0), 1, 1, boxstyle="round,pad=0.02",
                        facecolor="#f8f9fa", edgecolor="#dfe6e9", linewidth=1,
                        transform=ax_interp.transAxes, clip_on=False)
    ax_interp.add_patch(bg)

    ax_interp.text(0.04, 0.97, "Samenvatting", fontsize=13, fontweight="bold",
                  transform=ax_interp.transAxes, va="top", color="#2c3e50")

    # Bereken stap per item
    usable = 0.88  # van 0.88 tot ~0.02
    step_with_detail = usable / max(n_items, 1)

    y_pos = 0.88
    for label, waarde, kleur, detail in interpretation:
        _draw_indicator(ax_interp, 0.03, y_pos, kleur, size=0.014)
        ax_interp.text(0.06, y_pos, label, fontsize=11.5, fontweight="bold",
                      transform=ax_interp.transAxes, va="center", color="#2c3e50")
        ax_interp.text(0.40, y_pos, waarde, fontsize=11.5,
                      transform=ax_interp.transAxes, va="center", color=kleur,
                      fontweight="bold")
        if detail:
            ax_interp.text(0.40, y_pos - 0.045, detail, fontsize=10.5,
                          transform=ax_interp.transAxes, va="center",
                          color="#7f8c8d", style="italic")
            y_pos -= step_with_detail
        else:
            y_pos -= step_with_detail * 0.75

    # Bereken beschikbare ruimte onder samenvatting
    space_below_interp = interp_bot - 0.01

    # ============================================================
    # SKEW-T DIAGRAM
    # ============================================================
    skew = SkewT(fig, rotation=45, rect=[0.05, 0.08, 0.52, 0.82])
    ax_skew = skew.ax

    p, T, Td = profile["p"], profile["T"], profile["Td"]
    u, v = profile["u"], profile["v"]

    # Temperatuur en dauwpunt lijnen
    skew.plot(p, T, "r", linewidth=2.5, label="Temperatuur", zorder=5)
    skew.plot(p, Td, "#2980b9", linewidth=2.5, label="Dauwpunt", zorder=5)

    # Parcel path
    if thermo.get("parcel_path") is not None:
        skew.plot(p, thermo["parcel_path"], color="#7f8c8d", linestyle="--",
                 linewidth=1.0, label="Luchtpakket", zorder=4)

    # Wind barbs
    u_kt = u.to("knots")
    v_kt = v.to("knots")
    skew.plot_barbs(p, u_kt, v_kt, xloc=1.06, linewidth=0.7)

    # CAPE/CIN arcering
    if thermo.get("parcel_path") is not None:
        try:
            skew.shade_cape(p, T, thermo["parcel_path"], alpha=0.12,
                           facecolor="#e74c3c")
            skew.shade_cin(p, T, thermo["parcel_path"], alpha=0.08,
                          facecolor="#3498db")
        except Exception:
            pass

    # Achtergrond lijnen (subtiel)
    skew.plot_dry_adiabats(linewidth=0.3, alpha=0.25, colors="#e74c3c")
    skew.plot_moist_adiabats(linewidth=0.3, alpha=0.25, colors="#1abc9c")
    skew.plot_mixing_lines(linewidth=0.3, alpha=0.15, colors="#27ae60")

    # Markers met Nederlandse labels
    if thermo.get("lcl_p") is not None:
        lcl_p = thermo["lcl_p"]
        ax_skew.axhline(lcl_p, color="#3498db", linewidth=0.8,
                       linestyle=":", alpha=0.6)
        ax_skew.text(48, lcl_p, "wolkenbasis", fontsize=11,
                    color="#3498db", ha="right", va="bottom",
                    fontweight="bold", alpha=0.8,
                    bbox=dict(boxstyle="round,pad=0.15", facecolor="white",
                             edgecolor="#3498db", alpha=0.7, linewidth=0.5))

    if thermo.get("freezing_h") is not None:
        fh = thermo["freezing_h"]
        # Zoek bijbehorende druklaag
        heights = profile["heights"].magnitude
        for i in range(len(heights) - 1):
            if heights[i] <= fh <= heights[i + 1]:
                frac = (fh - heights[i]) / (heights[i + 1] - heights[i])
                fz_p = p[i].magnitude + frac * (p[i + 1].magnitude - p[i].magnitude)
                ax_skew.axhline(fz_p, color="#2980b9", linewidth=0.8,
                               linestyle=":", alpha=0.4)
                ax_skew.text(48, fz_p, "0°C grens", fontsize=11,
                            color="#2980b9", ha="right", va="bottom",
                            fontweight="bold", alpha=0.7,
                            bbox=dict(boxstyle="round,pad=0.15", facecolor="white",
                                     edgecolor="#2980b9", alpha=0.6, linewidth=0.5))
                break

    # --- Inversie-banden ---
    for inv in thermo.get("inversions", []):
        ax_skew.axhspan(inv["p_onder"], inv["p_boven"],
                       facecolor="#e67e22", alpha=0.10, zorder=1)
        # Label
        p_mid = (inv["p_onder"] + inv["p_boven"]) / 2
        ax_skew.text(-38, p_mid, f"inversie +{inv['sterkte']:.1f}°C",
                    fontsize=10.5, color="#e67e22", va="center", ha="left",
                    fontweight="bold", alpha=0.8,
                    bbox=dict(boxstyle="round,pad=0.12", facecolor="white",
                             edgecolor="#e67e22", alpha=0.7, linewidth=0.5))

    # --- IJsdriehoek arcering ---
    # Zone waar T tussen 0 en -20°C en lucht vochtig (T-Td < 3°C)
    icing = thermo.get("icing_layers", [])
    if icing:
        layer = icing[0]
        # Arceer de druklaag waar ijsafzetting mogelijk is
        ax_skew.axhspan(layer["p_bot"], layer["p_top"],
                       facecolor="#81ecec", alpha=0.12, zorder=1)
        p_mid = (layer["p_bot"] + layer["p_top"]) / 2
        # Driehoekje + label
        ax_skew.text(-38, p_mid, "ijsdriehoek",
                    fontsize=10.5, color="#00b894", va="center", ha="left",
                    fontweight="bold", alpha=0.8,
                    bbox=dict(boxstyle="round,pad=0.12", facecolor="white",
                             edgecolor="#00b894", alpha=0.7, linewidth=0.5))
        # Driehoekje als unicode symbool in het label
        ax_skew.text(-38.5, p_mid, "\u25B2", fontsize=12, color="#00b894",
                    va="center", ha="center", alpha=0.7, zorder=6)

    # Assen
    ax_skew.set_xlim(-40, 50)
    ax_skew.set_ylim(1050, 100)
    ax_skew.set_xlabel("Temperatuur (°C)", fontsize=13)
    ax_skew.set_ylabel("Druk (hPa)", fontsize=13)
    ax_skew.tick_params(labelsize=11)

    # Hoogte-labels rechts
    std_heights = {1000: "zeeniveau", 925: "~750 m", 850: "~1,5 km",
                   700: "~3 km", 500: "~5,5 km", 300: "~9 km",
                   200: "~12 km", 100: "~16 km"}
    for plvl, hlbl in std_heights.items():
        if 100 <= plvl <= 1050:
            ax_skew.text(51, plvl, hlbl, fontsize=10.5, color="#95a5a6",
                        va="center", ha="left")

    # Legenda op het diagram
    from matplotlib.lines import Line2D
    legend_elements = [
        Line2D([0], [0], color="r", linewidth=2, label="Temperatuur"),
        Line2D([0], [0], color="#2980b9", linewidth=2, label="Dauwpunt"),
        Line2D([0], [0], color="#7f8c8d", linewidth=1, linestyle="--",
               label="Luchtpakket (stijgend)"),
    ]
    from matplotlib.patches import Patch
    cape_val = thermo.get("cape_sfc", 0) or 0
    if cape_val > 0:
        legend_elements.append(
            Patch(facecolor="#e74c3c", alpha=0.2,
                  label=f"Buienenergie (CAPE): {cape_val:.0f} J/kg"))
    if thermo.get("inversions"):
        legend_elements.append(
            Patch(facecolor="#e67e22", alpha=0.15, label="Inversie (temp. toename)"))
    if thermo.get("icing_layers"):
        legend_elements.append(
            Patch(facecolor="#81ecec", alpha=0.2, label="IJsdriehoek (0 tot -20°C, vochtig)"))
    ax_skew.legend(handles=legend_elements, loc="upper left", fontsize=11,
                  framealpha=0.85, fancybox=True)

    # Uitleg-tekst onder het diagram
    fig.text(0.05, 0.055,
             "Rode lijn = temperatuur  |  Blauwe lijn = dauwpunt  |  "
             "Dicht bij elkaar = vochtig (wolken)  |  "
             "Windvanen: streep = 10 kt, vlaggetje = 50 kt  |  "
             "Oranje = inversie  |  Lichtblauw = ijsdriehoek",
             fontsize=10, color="#95a5a6", style="italic")

    # ============================================================
    # HODOGRAAF (rechts, onder samenvatting)
    # ============================================================
    hodo_top = interp_bot - 0.02
    hodo_h = 0.30
    ax_hodo = fig.add_axes([0.60, hodo_top - hodo_h, 0.35, hodo_h])

    hodo = Hodograph(ax_hodo, component_range=60)
    hodo.add_grid(increment=10, linewidth=0.4, alpha=0.3)

    heights_arr = profile["heights"]
    u_kt_arr = u.to("knots").magnitude
    v_kt_arr = v.to("knots").magnitude
    h_arr = heights_arr.magnitude

    colors_seg = ["#e74c3c", "#e67e22", "#2ecc71", "#3498db", "#9b59b6"]
    labels_seg = ["0-1 km", "1-3 km", "3-6 km", "6-9 km", "9+ km"]
    bounds_seg = [0, 1000, 3000, 6000, 9000, 20000]

    for i_seg in range(len(bounds_seg) - 1):
        mask = (h_arr >= bounds_seg[i_seg]) & (h_arr <= bounds_seg[i_seg + 1])
        idx = np.where(mask)[0]
        if len(idx) >= 2:
            if idx[0] > 0:
                idx = np.insert(idx, 0, idx[0] - 1)
            hodo.plot(u_kt_arr[idx], v_kt_arr[idx], color=colors_seg[i_seg],
                     linewidth=2.0, label=labels_seg[i_seg])
        elif len(idx) == 1:
            ax_hodo.plot(u_kt_arr[idx], v_kt_arr[idx], "o",
                        color=colors_seg[i_seg], markersize=4, label=labels_seg[i_seg])

    for i in range(len(p)):
        plvl = p[i].magnitude
        if plvl in [1000, 850, 700, 500, 300]:
            ax_hodo.annotate(f"{plvl:.0f}", (u_kt_arr[i], v_kt_arr[i]),
                           fontsize=11, color="#95a5a6", ha="left", va="bottom",
                           xytext=(3, 3), textcoords="offset points")

    ax_hodo.set_xlabel("u (kt)", fontsize=11)
    ax_hodo.set_ylabel("v (kt)", fontsize=11)
    ax_hodo.tick_params(labelsize=6)
    ax_hodo.legend(fontsize=11, loc="upper left", framealpha=0.8)
    ax_hodo.set_title("Winddraaiing met hoogte", fontsize=12, fontweight="bold",
                     color="#2c3e50")
    ax_hodo.set_aspect("equal")

    # Windtabel en technische data worden in HTML getoond, niet in PNG

    # Technische data wordt in de HTML viewer getoond

    # Credit
    fig.text(0.97, 0.005, "weerlab.nl", fontsize=11, ha="right", color="#bdc3c7")

    return fig


def generate_soundings(station_id=None, model="knmi_seamless", hours=None):
    """Genereer soundings voor station(s)."""
    os.chdir(OUTDIR)
    model_labels = {
        "ecmwf_ifs025": "ECMWF IFS 0.25°",
        "ecmwf_ifs": "ECMWF IFS",
        "knmi_seamless": "KNMI Harmonie AROME",
        "icon_seamless": "DWD ICON",
        "gfs_seamless": "GFS",
    }
    model_name = model_labels.get(model, model)

    stations = {station_id: STATIONS[station_id]} if station_id else STATIONS
    if hours is None:
        hours = list(range(0, 49, 3))  # Elke 3 uur, 48 uur vooruit

    meta = {"model": model_name, "stations": {}, "generated": datetime.now(tz=LOCAL_TZ).isoformat()}
    all_files = []

    for sid, sinfo in stations.items():
        print(f"\n=== {sinfo['name']} ({sinfo['lat']:.2f}N, {sinfo['lon']:.2f}E) ===")
        try:
            data = fetch_sounding_data(sinfo["lat"], sinfo["lon"], model=model)
        except Exception as e:
            print(f"  FOUT bij ophalen data: {e}")
            continue

        times = data["hourly"]["time"]
        run_time_str = data.get("current", {}).get("time", times[0])

        meta["stations"][sid] = {"name": sinfo["name"], "lat": sinfo["lat"], "lon": sinfo["lon"], "files": []}

        for h_idx in hours:
            if h_idx >= len(times):
                break

            time_str = times[h_idx]
            valid_time = datetime.fromisoformat(time_str).replace(tzinfo=timezone.utc)
            run_time = datetime.fromisoformat(times[0]).replace(tzinfo=timezone.utc)

            print(f"  T+{h_idx:02d} ({valid_time.strftime('%d %b %H:%MZ')})...", end=" ")

            profile = extract_profile(data, h_idx)
            if profile is None:
                print("onvoldoende data, skip")
                continue

            thermo = calc_thermodynamics(profile)

            fig = plot_sounding(
                profile, thermo,
                sinfo["name"], sinfo["lat"], sinfo["lon"],
                valid_time, model_name, run_time
            )

            fname = f"sounding_{sid}_{valid_time.strftime('%Y%m%d%H')}.png"
            fig.savefig(fname, dpi=120, facecolor="white")
            plt.close(fig)
            print(f"OK -> {fname}")

            meta["stations"][sid]["files"].append({
                "file": fname,
                "valid_utc": valid_time.isoformat(),
                "hour": h_idx,
            })
            all_files.append(fname)

    # Metadata opslaan (merge met bestaande)
    meta_path = "sounding_meta.json"
    if os.path.exists(meta_path):
        try:
            with open(meta_path) as mf:
                existing = json.load(mf)
            # Merge: update bestaande stations, behoud andere
            for sid, sdata in meta["stations"].items():
                existing["stations"][sid] = sdata
            existing["model"] = meta["model"]
            existing["generated"] = meta["generated"]
            meta = existing
        except Exception:
            pass
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print(f"\nMetadata: {meta_path}")

    return all_files


def upload_to_r2(files):
    """Upload gegenereerde bestanden naar Cloudflare R2."""
    import boto3

    s3 = boto3.client("s3",
        endpoint_url="https://05da71c7c88b8ce49fbb2c2d0a570416.r2.cloudflarestorage.com",
        aws_access_key_id="baf991003ce3e4075d91b89f8726bc0f",
        aws_secret_access_key="0f33229e2e03fe7bc7f9fdf7f9fa0acd5336c40718c6e25fe0b6a631ade8ac97",
        region_name="auto")

    R2_BUCKET = "weerlab-harmonie"

    for f in files + ["sounding_meta.json"]:
        if not os.path.exists(f):
            continue
        ct = "application/json" if f.endswith(".json") else "image/png"
        s3.upload_file(f, R2_BUCKET, f, ExtraArgs={"ContentType": ct})
        print(f"  Upload: {f} ({os.path.getsize(f)/1024:.0f} KB)")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Skew-T sounding generator")
    parser.add_argument("--station", default=None, help="Station ID (bijv. debilt)")
    parser.add_argument("--model", default="knmi_seamless", help="Model (knmi_seamless, ecmwf_ifs025, icon_seamless, etc.)")
    parser.add_argument("--hours", default="0,3,6,9,12,15,18,21,24", help="Uurstappen (komma-gescheiden)")
    parser.add_argument("--upload", action="store_true", help="Upload naar R2")
    args = parser.parse_args()

    hours = [int(h) for h in args.hours.split(",")]

    files = generate_soundings(
        station_id=args.station,
        model=args.model,
        hours=hours,
    )

    if args.upload and files:
        print("\nUploaden naar R2...")
        upload_to_r2(files)

    print(f"\nKlaar! {len(files)} soundings gegenereerd.")
