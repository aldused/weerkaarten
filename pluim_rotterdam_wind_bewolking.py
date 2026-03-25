"""
pluim_rotterdam_compact.py — Ensemble pluim Rotterdam
3 panelen: temperatuur / neerslag+kans / wind+stoten
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

LAT, LON = 51.96, 4.44

def bereken_runtime():
    try:
        from ecmwf.opendata import Client
        latest = Client("ecmwf").latest(stream="enfo", type="pf", param="2t")
        return f"ECMWF run {latest.strftime('%d %b %H')}Z"
    except:
        now = datetime.now(timezone.utc)
        uur = now.hour
        if uur >= 20:   run = 18
        elif uur >= 14: run = 12
        elif uur >= 8:  run = 6
        elif uur >= 2:  run = 0
        else:           run = 18
        return f"ECMWF {now.strftime('%d %b')} {run:02d}Z"

def haal_ensemble():
    url = (
        "https://ensemble-api.open-meteo.com/v1/ensemble"
        f"?latitude={LAT}&longitude={LON}"
        "&hourly=temperature_2m,precipitation,windspeed_10m,windgusts_10m,cloudcover"
        "&models=ecmwf_ifs025"
        "&timezone=Europe/Amsterdam"
        "&forecast_days=16"
        "&windspeed_unit=kmh"
    )
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

def haal_hres():
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={LAT}&longitude={LON}"
        "&hourly=temperature_2m"
        "&models=ecmwf_ifs"
        "&timezone=Europe/Amsterdam"
        "&forecast_days=16"
    )
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

print("Data ophalen Rotterdam...")
runtime = bereken_runtime()
data   = haal_ensemble()
hres_d = haal_hres()

hourly = data["hourly"]
tijden = [datetime.fromisoformat(t) for t in hourly["time"]]

def leden(prefix):
    arr = []
    for key, vals in hourly.items():
        if key.startswith(prefix + "_member") or key == prefix:
            a = np.array(vals, dtype=float)
            arr.append(np.where(np.isnan(a), 0, a))
    return np.vstack(arr)

alle_temp  = leden("temperature_2m")
alle_rr    = leden("precipitation")
alle_wind  = leden("windspeed_10m")
alle_stoot = leden("windgusts_10m")
alle_cloud = leden("cloudcover")

n_leden = alle_temp.shape[0]

# Trailing nullen afkappen
laatste = int(np.max(np.where(np.any(alle_temp != 0, axis=0))))
alle_temp  = alle_temp[:,  :laatste+1]
alle_rr    = alle_rr[:,    :laatste+1]
alle_wind  = alle_wind[:,  :laatste+1]
alle_stoot = alle_stoot[:, :laatste+1]
alle_cloud = alle_cloud[:, :laatste+1]
tijden     = tijden[:laatste+1]
x = np.arange(len(tijden))

med_temp  = np.median(alle_temp, axis=0)
p25_temp  = np.percentile(alle_temp, 25, axis=0)
p75_temp  = np.percentile(alle_temp, 75, axis=0)
med_rr    = np.median(alle_rr, axis=0)
kans_rr   = np.sum(alle_rr > 0.1, axis=0) / n_leden * 100
med_wind  = np.median(alle_wind, axis=0)
med_stoot = np.median(alle_stoot, axis=0)
p75_stoot = np.percentile(alle_stoot, 75, axis=0)

hres_dict = dict(zip(hres_d["hourly"]["time"], hres_d["hourly"]["temperature_2m"]))
hres_lijn = np.array([hres_dict.get(t.strftime("%Y-%m-%dT%H:%M"), np.nan) for t in tijden])

# Bewolkingscategorieën
CATEGORIEEN = [
    ("Onbewolkt",       0,  10,  "#FFFAAA"),
    ("Licht bewolkt",  10,  30,  "#FFD080"),
    ("Half bewolkt",   30,  70,  "#C8C8C8"),
    ("Zwaar bewolkt",  70,  90,  "#909090"),
    ("Geheel bewolkt", 90, 101,  "#505050"),
]
bew_stapels = []
for _, low, high, _ in CATEGORIEEN:
    pct = np.sum((alle_cloud >= low) & (alle_cloud < high), axis=0) / n_leden * 100
    bew_stapels.append(pct)

# Daglabels
tick_pos, tick_lbl, vorige_dag = [], [], None
for i, t in enumerate(tijden):
    dag = t.date()
    if dag != vorige_dag:
        tick_pos.append(i)
        tick_lbl.append(f"{nl_dagen[dag.weekday()]}\n{dag.day} {nl_maanden[dag.month]}")
        vorige_dag = dag

# ── Figuur ──
fig = plt.figure(figsize=(16, 14))
gs  = gridspec.GridSpec(2, 1, figure=fig, height_ratios=[1, 1], hspace=0.45)
fig.subplots_adjust(top=0.93)

# Header
header_ax = fig.add_axes([0, 0.94, 1, 0.06])
header_ax.set_xlim(0,1); header_ax.set_ylim(0,1); header_ax.axis("off")
header_ax.add_patch(plt.Rectangle((0,0),1,1,transform=header_ax.transAxes,
               facecolor="#003366",zorder=0,clip_on=False))
header_ax.text(0.012,0.65,"Ed Aldus WM",fontsize=13,color="white",
          weight="bold",va="center",transform=header_ax.transAxes)
header_ax.text(0.012,0.22,f"ECMWF ENS · {n_leden} leden · {runtime}",
          fontsize=8,color="#a8c8e8",va="center",transform=header_ax.transAxes)
header_ax.text(0.988,0.65,"Ensemble pluim – Rotterdam  |  Wind & Bewolking",
          fontsize=15,color="white",weight="bold",
          ha="right",va="center",transform=header_ax.transAxes)
header_ax.text(0.988,0.22,f"run: {now_str}",fontsize=8,color="#a8c8e8",
          ha="right",va="center",transform=header_ax.transAxes)
header_ax.axhline(0,color="#4a90c4",linewidth=2)

import matplotlib.ticker as ticker

def dag_lijnen(ax, labels=True):
    for tp in tick_pos:
        ax.axvline(tp, color="#dddddd", linewidth=0.7, zorder=1)
    ax.set_xticks(tick_pos)
    ax.set_xticklabels(tick_lbl if labels else [], fontsize=8.5, color="#444444")
    ax.tick_params(axis="x", pad=4)
    ax.set_xlim(0, len(x)-1)

def kans_kleur(k):
    if k >= 80: return "#1a5fb4"
    if k >= 60: return "#3584e4"
    if k >= 40: return "#62a0ea"
    if k >= 20: return "#99c1f1"
    return "#ddeeff"

# ── Paneel 3: Wind + stoten ──
ax3 = fig.add_subplot(gs[0])
ax3.set_facecolor("#f8f9fa")
ax3.grid(axis="y",color="#e0e0e0",linewidth=0.6,zorder=0)
for spine in ["top","right"]: ax3.spines[spine].set_visible(False)
for lid in alle_wind:
    ax3.plot(x, lid, color="#27ae60", linewidth=0.5, alpha=0.25, zorder=2)
ax3.fill_between(x, med_wind, p75_stoot, color="#003366", alpha=0.10, zorder=2)
ax3.plot(x, med_wind,  color="#003366", linewidth=2.0, zorder=5, label="Wind mediaan")
ax3.plot(x, med_stoot, color="#cc6600", linewidth=1.5, zorder=5, label="Stoten mediaan")
ax3.plot(x, p75_stoot, color="#cc2200", linewidth=1.5, linestyle="--", zorder=6, label="Stoten p75")
for ms, lbl in [(19,"Bft 3"),(29,"Bft 4"),(39,"Bft 5"),(50,"Bft 6"),(62,"Bft 7")]:
    ax3.axhline(ms, color="#aaaaaa", linewidth=0.6, linestyle=":", zorder=1)
    ax3.text(1, ms+0.5, lbl, fontsize=6.5, color="#888888", ha="left", va="bottom")
dag_lijnen(ax3, labels=True)
ax3.set_ylim(bottom=0)
ax3.set_ylabel("Wind (km/u)", fontsize=9, color="#444444")
ax3.tick_params(axis="y", labelsize=8.5, colors="#444444")
ax3.set_title("Wind + windstoten", fontsize=11, color="#333", loc="left", pad=4, fontweight="bold")
ax3.legend(loc="upper right", fontsize=8, framealpha=0.9, edgecolor="#cccccc", ncol=3)

# ── Paneel 4: Bewolking gestapeld ──
import matplotlib.patches as mpatches
ax4 = fig.add_subplot(gs[1])
ax4.set_facecolor("#f8f9fa")
for spine in ["top","right"]: ax4.spines[spine].set_visible(False)
onderkant = np.zeros(len(x))
for (naam, low, high, kleur), pct in zip(CATEGORIEEN, bew_stapels):
    ax4.bar(x, pct, bottom=onderkant, color=kleur, width=1.0, linewidth=0, zorder=3)
    onderkant += pct
for tp in tick_pos:
    ax4.axvline(tp, color="white", lw=0.8, zorder=4)
dag_lijnen(ax4, labels=True)
ax4.set_ylim(0, 100)
ax4.set_ylabel("Kans (%)", fontsize=9, color="#444444")
ax4.tick_params(axis="y", labelsize=8.5, colors="#444444")
ax4.set_title("Bewolking", fontsize=11, color="#333", loc="left", pad=4, fontweight="bold")
ax4r = ax4.twinx()
ax4r.set_ylim(0, 100)
ax4r.tick_params(axis="y", labelsize=8.5, colors="#444444")
ax4r.set_xlim(0, len(x)-1)
legenda = [mpatches.Patch(facecolor=k, label=n, edgecolor="#aaaaaa", lw=0.5)
           for n, _, _, k in CATEGORIEEN]
ax4.legend(handles=legenda, loc="lower center", ncol=5,
           fontsize=8, framealpha=0.95, edgecolor="#cccccc",
           bbox_to_anchor=(0.5, -0.22))

fig.text(0.98, 0.005, f"© Ed Aldus | Data: ECMWF ENS via Open-Meteo | {now_str}",
         fontsize=7, style="italic", ha="right", va="bottom", color="#555555")

fname = "pluim_rotterdam_wind_bewolking.png"
plt.savefig(fname, dpi=150, bbox_inches="tight", pad_inches=0.3)
plt.close()
print(f"\nOpgeslagen: {fname}")
