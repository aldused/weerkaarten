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


def fetch_sounding_data(lat, lon, model="ecmwf_ifs025"):
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
        for i in range(len(T) - 1):
            if T[i].magnitude >= 0 >= T[i + 1].magnitude:
                frac = T[i].magnitude / (T[i].magnitude - T[i + 1].magnitude)
                results["freezing_h"] = (heights[i] + frac * (heights[i + 1] - heights[i])).magnitude
                break
        else:
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

    return results


def plot_sounding(profile, thermo, station_name, lat, lon, valid_time, model_name, run_time):
    """Maak het Skew-T diagram met hodograaf en tabellen."""

    fig = plt.figure(figsize=(16, 20), facecolor="white")

    # ============================================================
    # SKEW-T DIAGRAM (bovenste 65% van figuur)
    # ============================================================
    # SkewT met rect ipv GridSpec (voorkomt bbox_inches='tight' problemen)
    skew = SkewT(fig, rotation=45, rect=[0.05, 0.32, 0.55, 0.62])
    ax_skew = skew.ax

    p, T, Td = profile["p"], profile["T"], profile["Td"]
    u, v = profile["u"], profile["v"]

    # Temperatuur en dauwpunt lijnen
    skew.plot(p, T, "r", linewidth=2.2, label="Temperatuur")
    skew.plot(p, Td, "b", linewidth=2.2, label="Dauwpunt")

    # Parcel path
    if thermo.get("parcel_path") is not None:
        skew.plot(p, thermo["parcel_path"], "k--", linewidth=1.0, label="Parcel")

    # Wind barbs (in knopen)
    u_kt = u.to("knots")
    v_kt = v.to("knots")
    skew.plot_barbs(p, u_kt, v_kt, xloc=1.06, linewidth=0.7)

    # CAPE/CIN arcering
    if thermo.get("parcel_path") is not None:
        try:
            skew.shade_cape(p, T, thermo["parcel_path"], alpha=0.15)
            skew.shade_cin(p, T, thermo["parcel_path"], alpha=0.10)
        except Exception:
            pass

    # Achtergrond lijnen
    skew.plot_dry_adiabats(linewidth=0.4, alpha=0.35, colors="orangered")
    skew.plot_moist_adiabats(linewidth=0.4, alpha=0.35, colors="teal")
    skew.plot_mixing_lines(linewidth=0.4, alpha=0.25, colors="green")

    # LCL marker
    if thermo.get("lcl_p") is not None:
        ax_skew.axhline(thermo["lcl_p"], color="royalblue", linewidth=0.8,
                       linestyle="--", alpha=0.5)
        ax_skew.text(48, thermo["lcl_p"], "LCL", fontsize=8, color="royalblue",
                    ha="right", va="bottom", fontweight="bold", alpha=0.8)

    # Assen
    ax_skew.set_xlim(-40, 50)
    ax_skew.set_ylim(1050, 100)
    ax_skew.set_xlabel("Temperatuur (°C)", fontsize=9)
    ax_skew.set_ylabel("Druk (hPa)", fontsize=9)
    ax_skew.tick_params(labelsize=8)

    # Hoogte-labels rechts op de y-as
    std_heights = {1000: "0m", 925: "~750m", 850: "~1500m", 700: "~3000m",
                   500: "~5500m", 300: "~9200m", 200: "~11800m", 100: "~16200m"}
    for plvl, hlbl in std_heights.items():
        if 100 <= plvl <= 1050:
            ax_skew.text(51, plvl, hlbl, fontsize=6.5, color="gray",
                        va="center", ha="left")

    # ============================================================
    # HODOGRAAF (rechtsboven)
    # ============================================================
    ax_hodo = fig.add_axes([0.62, 0.55, 0.35, 0.38])

    hodo = Hodograph(ax_hodo, component_range=60)
    hodo.add_grid(increment=10, linewidth=0.5, alpha=0.4)

    heights = profile["heights"]
    u_kt_arr = u.to("knots").magnitude
    v_kt_arr = v.to("knots").magnitude
    h_arr = heights.magnitude

    # Segmenten per hoogte
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

    # Druklaag-labels op hodograaf
    for i in range(len(p)):
        plvl = p[i].magnitude
        if plvl in [1000, 850, 700, 500, 300, 200]:
            ax_hodo.annotate(f"{plvl:.0f}", (u_kt_arr[i], v_kt_arr[i]),
                           fontsize=6, color="gray", ha="left", va="bottom",
                           xytext=(3, 3), textcoords="offset points")

    ax_hodo.set_xlabel("u (kt)", fontsize=8)
    ax_hodo.set_ylabel("v (kt)", fontsize=8)
    ax_hodo.tick_params(labelsize=7)
    ax_hodo.legend(fontsize=6.5, loc="upper left", framealpha=0.8)
    ax_hodo.set_title("Hodograaf", fontsize=10, fontweight="bold")
    ax_hodo.set_aspect("equal")

    # ============================================================
    # WINDPROFIEL TEKST (rechts midden)
    # ============================================================
    ax_wind = fig.add_axes([0.62, 0.32, 0.35, 0.22])
    ax_wind.axis("off")
    ax_wind.set_title("Wind profiel", fontsize=9, fontweight="bold", loc="left")

    wind_header = f"{'hPa':>6s}  {'m':>6s}  {'°':>4s}  {'kt':>4s}  {'km/h':>5s}"
    ax_wind.text(0.02, 0.92, wind_header, fontsize=7, fontweight="bold",
                family="monospace", transform=ax_wind.transAxes, color="#2c3e50")
    for i in range(len(p)):
        plvl = p[i].magnitude
        hgt = heights[i].magnitude if i < len(heights) else 0
        wdir = profile["wd"][i].magnitude
        wspd_kt = profile["ws"][i].to("knots").magnitude
        wspd_kmh = profile["ws"][i].magnitude
        y = 0.85 - i * 0.065
        if y < 0:
            break
        line = f"{plvl:6.0f}  {hgt:6.0f}  {wdir:4.0f}  {wspd_kt:4.0f}  {wspd_kmh:5.0f}"
        ax_wind.text(0.02, y, line, fontsize=6.5, family="monospace",
                    transform=ax_wind.transAxes, color="#34495e")

    # ============================================================
    # TABELLEN (onderste deel)
    # ============================================================
    def fmt(val, decimals=0, suffix=""):
        if val is None or (isinstance(val, float) and np.isnan(val)):
            return "---"
        if decimals == 0:
            return f"{val:.0f}{suffix}"
        return f"{val:.{decimals}f}{suffix}"

    # --- Parcels tabel ---
    ax_parcels = fig.add_axes([0.05, 0.05, 0.30, 0.24])
    ax_parcels.axis("off")
    ax_parcels.set_title("Parcels", fontsize=10, fontweight="bold",
                        loc="left", color="#2c3e50")

    parcel_rows = [
        ["", "Surface", "Mixed 50hPa", "Most Unstable"],
        ["CAPE [J/kg]", fmt(thermo.get("cape_sfc")), fmt(thermo.get("cape_ml")), fmt(thermo.get("cape_mu"))],
        ["CIN [J/kg]", fmt(thermo.get("cin_sfc")), fmt(thermo.get("cin_ml")), fmt(thermo.get("cin_mu"))],
        ["LI [°C]", fmt(thermo.get("li_sfc"), 1), fmt(thermo.get("li_ml"), 1), fmt(thermo.get("li_mu"), 1)],
        ["LCL [m]", fmt(thermo.get("lcl_h")), fmt(thermo.get("lcl_ml")), ""],
        ["LFC [hPa]", fmt(thermo.get("lfc_p")), "", ""],
        ["EL [hPa]", fmt(thermo.get("el_p")), "", ""],
    ]

    tbl_parcels = ax_parcels.table(
        cellText=parcel_rows, loc="upper left",
        cellLoc="center", colWidths=[0.30, 0.23, 0.23, 0.24],
    )
    tbl_parcels.auto_set_font_size(False)
    tbl_parcels.set_fontsize(7.5)
    for (row, col), cell in tbl_parcels.get_celld().items():
        cell.set_linewidth(0.3)
        if row == 0:
            cell.set_facecolor("#ecf0f1")
            cell.set_text_props(fontweight="bold", fontsize=7)
        elif col == 0:
            cell.set_text_props(fontweight="bold")
            cell.set_facecolor("#f8f9fa")
        else:
            cell.set_facecolor("white")
        cell.set_edgecolor("#bdc3c7")

    # --- Kinematics tabel ---
    ax_kin = fig.add_axes([0.37, 0.05, 0.25, 0.24])
    ax_kin.axis("off")
    ax_kin.set_title("Kinematics", fontsize=10, fontweight="bold",
                    loc="left", color="#2c3e50")

    kin_rows = [
        ["Wind Shear [kt]", ""],
        ["0-1 km", fmt(thermo.get("shear_01"))],
        ["0-6 km", fmt(thermo.get("shear_06"))],
        ["", ""],
        ["SRH [m²/s²]", ""],
        ["0-1 km", fmt(thermo.get("srh_01"))],
        ["0-3 km", fmt(thermo.get("srh_03"))],
    ]

    tbl_kin = ax_kin.table(
        cellText=kin_rows, loc="upper left",
        cellLoc="center", colWidths=[0.55, 0.45],
    )
    tbl_kin.auto_set_font_size(False)
    tbl_kin.set_fontsize(7.5)
    for (row, col), cell in tbl_kin.get_celld().items():
        cell.set_linewidth(0.3)
        if row in [0, 4]:
            cell.set_facecolor("#ecf0f1")
            cell.set_text_props(fontweight="bold", fontsize=7)
        elif col == 0:
            cell.set_text_props(fontweight="bold")
            cell.set_facecolor("#f8f9fa")
        else:
            cell.set_facecolor("white")
        cell.set_edgecolor("#bdc3c7")

    # --- Thermodynamics tabel ---
    ax_thermo = fig.add_axes([0.64, 0.05, 0.33, 0.24])
    ax_thermo.axis("off")
    ax_thermo.set_title("Thermodynamics", fontsize=10, fontweight="bold",
                       loc="left", color="#2c3e50")

    thermo_rows = [
        ["Parameter", "Waarde"],
        ["Freezing Level [m]", fmt(thermo.get("freezing_h"))],
        ["Wet Bulb Zero [m]", fmt(thermo.get("wbz_h"))],
        ["Max Temp [°C]", fmt(thermo.get("max_t"), 1)],
        ["Sfc Temp [°C]", fmt(thermo.get("sfc_t"), 1)],
        ["PW [mm]", fmt(thermo.get("pw"), 1)],
        ["CAPE API [J/kg]", fmt(profile["sfc"].get("cape_api"))],
    ]

    tbl_thermo = ax_thermo.table(
        cellText=thermo_rows, loc="upper left",
        cellLoc="center", colWidths=[0.55, 0.45],
    )
    tbl_thermo.auto_set_font_size(False)
    tbl_thermo.set_fontsize(7.5)
    for (row, col), cell in tbl_thermo.get_celld().items():
        cell.set_linewidth(0.3)
        if row == 0:
            cell.set_facecolor("#ecf0f1")
            cell.set_text_props(fontweight="bold", fontsize=7)
        elif col == 0:
            cell.set_text_props(fontweight="bold")
            cell.set_facecolor("#f8f9fa")
        else:
            cell.set_facecolor("white")
        cell.set_edgecolor("#bdc3c7")

    # ============================================================
    # TITEL
    # ============================================================
    valid_local = valid_time.astimezone(LOCAL_TZ)
    run_local = run_time.astimezone(LOCAL_TZ) if run_time else valid_local

    title = (
        f"{model_name}  |  {lat:.2f}°N {lon:.2f}°E  |  "
        f"Run: {run_local.strftime('%d %b %Y %HZ')}  |  "
        f"Valid: {valid_local.strftime('%d %b %Y %H:%M LT')}"
    )
    fig.suptitle(title, fontsize=12, fontweight="bold", y=0.97, x=0.5)
    fig.text(0.5, 0.955, station_name, fontsize=11, ha="center", color="#7f8c8d")

    # Credit
    fig.text(0.97, 0.005, "weerlab.nl", fontsize=7, ha="right", color="#bdc3c7")

    return fig


def generate_soundings(station_id=None, model="ecmwf_ifs025", hours=None):
    """Genereer soundings voor station(s)."""
    os.chdir(OUTDIR)
    model_labels = {
        "ecmwf_ifs025": "ECMWF IFS 0.25°",
        "ecmwf_ifs": "ECMWF IFS",
        "knmi_seamless": "KNMI Harmonie (seamless)",
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
            fig.savefig(fname, dpi=150, facecolor="white")
            plt.close(fig)
            print(f"OK -> {fname}")

            meta["stations"][sid]["files"].append({
                "file": fname,
                "valid_utc": valid_time.isoformat(),
                "hour": h_idx,
            })
            all_files.append(fname)

    # Metadata opslaan
    with open("sounding_meta.json", "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print(f"\nMetadata: sounding_meta.json")

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
    parser.add_argument("--model", default="ecmwf_ifs025", help="Model (ecmwf_ifs025, knmi_seamless, etc.)")
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
