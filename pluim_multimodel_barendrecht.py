"""
pluim_multimodel_barendrecht.py — Multi-model vergelijking Barendrecht
ECMWF ENS mediaan + ICON-EPS mediaan + UKMO deterministisch
3 panelen: temperatuur / neerslag / wind+stoten
Lokaal gebruik
"""
import os, requests, numpy as np
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.lines import Line2D

os.chdir(os.path.dirname(os.path.abspath(__file__)))

LOCAL_TZ   = ZoneInfo("Europe/Amsterdam")
now_lokaal = datetime.now(timezone.utc).astimezone(LOCAL_TZ)
now_str    = now_lokaal.strftime("%d %b %Y  %H:%M")
nl_dagen   = ["Ma","Di","Wo","Do","Vr","Za","Zo"]
nl_maanden = ["","jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"]

LAT, LON = 51.845, 4.534

def bereken_runtime():
    try:
        from ecmwf.opendata import Client
        latest = Client("ecmwf").latest(stream="enfo", type="pf", param="2t")
        return f"ECMWF run {latest.strftime('%d %b %H')}Z"
    except:
        now = datetime.now(timezone.utc)
        uur = now.hour
        run = 18 if uur >= 20 else 12 if uur >= 14 else 6 if uur >= 8 else 0 if uur >= 2 else 18
        return f"ECMWF {now.strftime('%d %b')} {run:02d}Z"

def haal_ens(model, days):
    url = (
        "https://ensemble-api.open-meteo.com/v1/ensemble"
        f"?latitude={LAT}&longitude={LON}"
        "&hourly=temperature_2m,precipitation,windspeed_10m,windgusts_10m"
        f"&models={model}&timezone=Europe/Amsterdam"
        f"&forecast_days={days}&windspeed_unit=kmh"
    )
    r = requests.get(url, timeout=30); r.raise_for_status()
    return r.json()

def haal_det(model, days):
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={LAT}&longitude={LON}"
        "&hourly=temperature_2m,precipitation,windspeed_10m,windgusts_10m"
        f"&models={model}&timezone=Europe/Amsterdam"
        f"&forecast_days={days}&windspeed_unit=kmh"
    )
    r = requests.get(url, timeout=30); r.raise_for_status()
    return r.json()

def leden_mediaan(hourly, prefix):
    arr = []
    for key, vals in hourly.items():
        if key.startswith(prefix + "_member") or key == prefix:
            a = np.array(vals, dtype=float)
            arr.append(np.where(np.isnan(a), 0, a))
    alle = np.vstack(arr)
    return np.median(alle, axis=0), alle.shape[0]

def det_vals(hourly, key):
    a = np.array(hourly.get(key, []), dtype=float)
    return np.where(np.isnan(a), 0, a)

print("Data ophalen...")
runtime = bereken_runtime()

# ECMWF ENS
print("  ECMWF ENS...")
ecmwf_d = haal_ens("ecmwf_ifs025", 16)
ecmwf_t = [datetime.fromisoformat(t) for t in ecmwf_d["hourly"]["time"]]
ecmwf_temp, n_ecmwf = leden_mediaan(ecmwf_d["hourly"], "temperature_2m")
ecmwf_rr,   _       = leden_mediaan(ecmwf_d["hourly"], "precipitation")
ecmwf_wind, _       = leden_mediaan(ecmwf_d["hourly"], "windspeed_10m")
ecmwf_stoot,_       = leden_mediaan(ecmwf_d["hourly"], "windgusts_10m")

# Trailing nullen ECMWF
laatste = int(np.max(np.where(ecmwf_temp != 0)))
ecmwf_temp  = ecmwf_temp[:laatste+1]
ecmwf_rr    = ecmwf_rr[:laatste+1]
ecmwf_wind  = ecmwf_wind[:laatste+1]
ecmwf_stoot = ecmwf_stoot[:laatste+1]
ecmwf_t     = ecmwf_t[:laatste+1]

# ICON-EPS
print("  ICON-EPS...")
icon_d = haal_ens("icon_seamless", 7)
icon_t = [datetime.fromisoformat(t) for t in icon_d["hourly"]["time"]]
icon_temp, n_icon = leden_mediaan(icon_d["hourly"], "temperature_2m")
icon_rr,   _      = leden_mediaan(icon_d["hourly"], "precipitation")
icon_wind, _      = leden_mediaan(icon_d["hourly"], "windspeed_10m")
icon_stoot,_      = leden_mediaan(icon_d["hourly"], "windgusts_10m")

# UKMO deterministisch
print("  UKMO...")
ukmo_d = haal_det("ukmo_seamless", 7)
ukmo_t = [datetime.fromisoformat(t) for t in ukmo_d["hourly"]["time"]]
ukmo_temp  = det_vals(ukmo_d["hourly"], "temperature_2m")
ukmo_rr    = det_vals(ukmo_d["hourly"], "precipitation")
ukmo_wind  = det_vals(ukmo_d["hourly"], "windspeed_10m")
ukmo_stoot = det_vals(ukmo_d["hourly"], "windgusts_10m")

# Gemeenschappelijke tijdas = ECMWF (langste)
ref_t = ecmwf_t
x_ecmwf = np.arange(len(ecmwf_t))

# Helper: interpoleer kortere reeks naar ECMWF tijdas
def map_naar_ref(t_model, vals):
    t_dict = {t.strftime("%Y-%m-%dT%H:%M"): v for t, v in zip(t_model, vals)}
    return np.array([t_dict.get(t.strftime("%Y-%m-%dT%H:%M"), np.nan) for t in ref_t])

icon_temp_r  = map_naar_ref(icon_t, icon_temp)
icon_rr_r    = map_naar_ref(icon_t, icon_rr)
icon_wind_r  = map_naar_ref(icon_t, icon_wind)
icon_stoot_r = map_naar_ref(icon_t, icon_stoot)
ukmo_temp_r  = map_naar_ref(ukmo_t, ukmo_temp)
ukmo_rr_r    = map_naar_ref(ukmo_t, ukmo_rr)
ukmo_wind_r  = map_naar_ref(ukmo_t, ukmo_wind)
ukmo_stoot_r = map_naar_ref(ukmo_t, ukmo_stoot)

# Daglabels
tick_pos, tick_lbl, vorige_dag = [], [], None
for i, t in enumerate(ref_t):
    dag = t.date()
    if dag != vorige_dag:
        tick_pos.append(i)
        tick_lbl.append(f"{nl_dagen[dag.weekday()]}\n{dag.day} {nl_maanden[dag.month]}")
        vorige_dag = dag

# ── Figuur ──
fig = plt.figure(figsize=(16, 18))
gs  = gridspec.GridSpec(3, 1, figure=fig, height_ratios=[1, 0.6, 0.7], hspace=0.12)
fig.subplots_adjust(top=0.93)

# Header
header_ax = fig.add_axes([0, 0.94, 1, 0.06])
header_ax.set_xlim(0,1); header_ax.set_ylim(0,1); header_ax.axis("off")
header_ax.add_patch(plt.Rectangle((0,0),1,1,transform=header_ax.transAxes,
               facecolor="#003366",zorder=0,clip_on=False))
header_ax.text(0.012,0.65,"Ed Aldus WM",fontsize=13,color="white",
          weight="bold",va="center",transform=header_ax.transAxes)
header_ax.text(0.012,0.22,f"ECMWF ENS ({n_ecmwf} leden) · ICON-EPS ({n_icon} leden) · UKMO 2km · {runtime}",
          fontsize=8,color="#a8c8e8",va="center",transform=header_ax.transAxes)
header_ax.text(0.988,0.65,"Multi-model pluim – Barendrecht",
          fontsize=15,color="white",weight="bold",
          ha="right",va="center",transform=header_ax.transAxes)
header_ax.text(0.988,0.22,f"run: {now_str}",fontsize=8,color="#a8c8e8",
          ha="right",va="center",transform=header_ax.transAxes)
header_ax.axhline(0,color="#4a90c4",linewidth=2)

import matplotlib.ticker as ticker

def dag_lijnen(ax, labels=False):
    for tp in tick_pos:
        ax.axvline(tp, color="#dddddd", linewidth=0.7, zorder=1)
    ax.set_xticks(tick_pos)
    ax.set_xticklabels(tick_lbl if labels else [], fontsize=8.5, color="#444444")
    ax.set_xlim(0, len(x_ecmwf)-1)

ECMWF_K = "#cc2200"
ICON_K   = "#0055cc"
UKMO_K   = "#007700"

leg_elems = [
    Line2D([0],[0], color=ECMWF_K, lw=2.5, label=f"ECMWF mediaan ({n_ecmwf} leden)"),
    Line2D([0],[0], color=ICON_K,  lw=2.0, label=f"ICON mediaan ({n_icon} leden)"),
    Line2D([0],[0], color=UKMO_K,  lw=2.0, linestyle="--", label="UKMO 2km"),
    Line2D([0],[0], color=ECMWF_K, lw=1.5, linestyle=":", label="10°C"),
]

# ── Paneel 1: Temperatuur ──
ax1 = fig.add_subplot(gs[0])
ax1.set_facecolor("#f8f9fa")
ax1.grid(axis="y",color="#e0e0e0",linewidth=0.6,zorder=0)
for spine in ["top","right"]: ax1.spines[spine].set_visible(False)
ax1.plot(x_ecmwf, ecmwf_temp,   color=ECMWF_K, lw=2.5, zorder=5)
ax1.plot(x_ecmwf, icon_temp_r,  color=ICON_K,  lw=2.0, zorder=4)
ax1.plot(x_ecmwf, ukmo_temp_r,  color=UKMO_K,  lw=2.0, linestyle="--", zorder=4)
ax1.axhline(10, color=ECMWF_K, lw=1.5, linestyle=":", zorder=8, alpha=0.7)
ax1.text(x_ecmwf[-1], 10.2, "10°C", fontsize=8, color=ECMWF_K, ha="right", va="bottom")
ax1.axhline(0, color="#444444", lw=0.7, linestyle=":", zorder=8)
dag_lijnen(ax1)
ax1.set_ylabel("Temperatuur (°C)", fontsize=9, color="#444444")
ax1.tick_params(axis="y", labelsize=8.5, colors="#444444")
ax1.yaxis.set_major_locator(ticker.MultipleLocator(2.5))
ax1.set_title("Temperatuur", fontsize=11, color="#333", loc="left", pad=4, fontweight="bold")
ax1.legend(handles=leg_elems, loc="upper right", fontsize=8, framealpha=0.9, edgecolor="#cccccc", ncol=2)

# ── Paneel 2: Neerslag ──
ax2 = fig.add_subplot(gs[1])
ax2.set_facecolor("#f8f9fa")
ax2.grid(axis="y",color="#e0e0e0",linewidth=0.6,zorder=0)
for spine in ["top","right"]: ax2.spines[spine].set_visible(False)
ax2.plot(x_ecmwf, ecmwf_rr,  color=ECMWF_K, lw=2.5, zorder=5)
ax2.plot(x_ecmwf, icon_rr_r, color=ICON_K,  lw=2.0, zorder=4)
ax2.plot(x_ecmwf, ukmo_rr_r, color=UKMO_K,  lw=2.0, linestyle="--", zorder=4)
dag_lijnen(ax2)
ax2.set_ylim(bottom=0)
ax2.set_ylabel("Neerslag (mm/u)", fontsize=9, color="#444444")
ax2.tick_params(axis="y", labelsize=8.5, colors="#444444")
ax2.set_title("Neerslag", fontsize=11, color="#333", loc="left", pad=4, fontweight="bold")

# ── Paneel 3: Wind + stoten ──
ax3 = fig.add_subplot(gs[2])
ax3.set_facecolor("#f8f9fa")
ax3.grid(axis="y",color="#e0e0e0",linewidth=0.6,zorder=0)
for spine in ["top","right"]: ax3.spines[spine].set_visible(False)
ax3.plot(x_ecmwf, ecmwf_wind,   color=ECMWF_K, lw=2.5, zorder=5, label="ECMWF wind")
ax3.plot(x_ecmwf, icon_wind_r,  color=ICON_K,  lw=2.0, zorder=4, label="ICON wind")
ax3.plot(x_ecmwf, ukmo_wind_r,  color=UKMO_K,  lw=2.0, linestyle="--", zorder=4, label="UKMO wind")
ax3.plot(x_ecmwf, ecmwf_stoot,  color=ECMWF_K, lw=1.5, linestyle=":", zorder=5, alpha=0.7, label="ECMWF stoten")
ax3.plot(x_ecmwf, icon_stoot_r, color=ICON_K,  lw=1.5, linestyle=":", zorder=4, alpha=0.7, label="ICON stoten")
ax3.plot(x_ecmwf, ukmo_stoot_r, color=UKMO_K,  lw=1.5, linestyle="-.", zorder=4, alpha=0.7, label="UKMO stoten")
for ms, lbl in [(19,"Bft 3"),(29,"Bft 4"),(39,"Bft 5"),(50,"Bft 6"),(62,"Bft 7")]:
    ax3.axhline(ms, color="#aaaaaa", lw=0.6, linestyle=":", zorder=1)
    ax3.text(1, ms+0.5, lbl, fontsize=6.5, color="#888888", ha="left", va="bottom")
dag_lijnen(ax3, labels=True)
ax3.set_ylim(bottom=0)
ax3.set_ylabel("Wind (km/u)", fontsize=9, color="#444444")
ax3.tick_params(axis="y", labelsize=8.5, colors="#444444")
ax3.set_title("Wind + windstoten", fontsize=11, color="#333", loc="left", pad=4, fontweight="bold")
ax3.legend(loc="upper right", fontsize=7.5, framealpha=0.9, edgecolor="#cccccc", ncol=3)

fig.text(0.98, 0.005, f"© Ed Aldus | Data: ECMWF/ICON/UKMO via Open-Meteo | {now_str}",
         fontsize=7, style="italic", ha="right", va="bottom", color="#555555")

fname = "pluim_multimodel_barendrecht.png"
plt.savefig(fname, dpi=150, bbox_inches="tight", pad_inches=0.3)
plt.close()
print(f"\nOpgeslagen: {fname}")
