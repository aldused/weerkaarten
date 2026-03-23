"""
pluim_debilt_knmi.py — KNMI-stijl ensemble pluim De Bilt
6 panelen: temp / windsnelheid / neerslag 6u / windstoten / neerslagsom / sneeuwval
Grijze nachtblokken, rode HRES, zwart gestippeld P50
Lokaal gebruik
"""
import os, requests, numpy as np
from datetime import datetime, timezone, timedelta
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
dag_nl     = ["Zondag","Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag"]
dag_kort   = ["zo","ma","di","wo","do","vr","za"]
nl_maanden = ["","jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"]

LAT, LON = 52.10, 5.18  # De Bilt

def bereken_runtime():
    try:
        from ecmwf.opendata import Client
        latest = Client("ecmwf").latest(stream="enfo", type="pf", param="2t")
        return latest.strftime("%a %d %b %H")+"Z"
    except:
        now = datetime.now(timezone.utc)
        uur = now.hour
        run = 18 if uur >= 20 else 12 if uur >= 14 else 6 if uur >= 8 else 0 if uur >= 2 else 18
        return now.strftime(f"%a %d %b {run:02d}Z")

def haal_ensemble():
    url = (
        "https://ensemble-api.open-meteo.com/v1/ensemble"
        f"?latitude={LAT}&longitude={LON}"
        "&hourly=temperature_2m,precipitation,snowfall,windspeed_10m,windgusts_10m"
        "&models=ecmwf_ifs025"
        "&timezone=Europe/Amsterdam"
        "&forecast_days=16"
        "&windspeed_unit=kmh"
    )
    r = requests.get(url, timeout=30); r.raise_for_status()
    return r.json()

def haal_hres():
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={LAT}&longitude={LON}"
        "&hourly=temperature_2m,precipitation,snowfall,windspeed_10m,windgusts_10m"
        "&models=ecmwf_ifs"
        "&timezone=Europe/Amsterdam"
        "&forecast_days=16"
        "&windspeed_unit=kmh"
    )
    r = requests.get(url, timeout=30); r.raise_for_status()
    return r.json()

print("Data ophalen De Bilt...")
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
alle_snow  = leden("snowfall")
alle_wind  = leden("windspeed_10m")
alle_stoot = leden("windgusts_10m")
n_leden    = alle_temp.shape[0]

# Trailing nullen afkappen
laatste = int(np.max(np.where(np.any(alle_temp != 0, axis=0))))
def kap(a): return a[:, :laatste+1]
alle_temp  = kap(alle_temp)
alle_rr    = kap(alle_rr)
alle_snow  = kap(alle_snow)
alle_wind  = kap(alle_wind)
alle_stoot = kap(alle_stoot)
tijden     = tijden[:laatste+1]
x = np.arange(len(tijden))

# Neerslag 6-uurs aggregeren
def agg6u(alle):
    n = alle.shape[1] // 6 * 6
    return alle[:, :n].reshape(alle.shape[0], -1, 6).sum(axis=2)

alle_rr6    = agg6u(alle_rr)
alle_snow6  = agg6u(alle_snow)
x6 = np.arange(alle_rr6.shape[1]) * 6

# Neerslagsom cumulatief
alle_rr_cum = np.cumsum(alle_rr, axis=1)

# HRES
def hres_arr(key):
    vals = hres_d["hourly"].get(key, [])
    a = np.array(vals[:laatste+1], dtype=float)
    return np.where(np.isnan(a), 0, a)

hres_temp  = hres_arr("temperature_2m")
hres_rr    = hres_arr("precipitation")
hres_snow  = hres_arr("snowfall")
hres_wind  = hres_arr("windspeed_10m")
hres_stoot = hres_arr("windgusts_10m")
hres_rr6   = hres_rr[:len(hres_rr)//6*6].reshape(-1,6).sum(axis=1)
hres_snow6 = hres_snow[:len(hres_snow)//6*6].reshape(-1,6).sum(axis=1)
hres_cum   = np.cumsum(hres_rr)

p50_temp  = np.percentile(alle_temp,  50, axis=0)
p50_wind  = np.percentile(alle_wind,  50, axis=0)
p50_stoot = np.percentile(alle_stoot, 50, axis=0)

# Daglabels (elke dag)
tick_pos, tick_lbl, vorige_dag = [], [], None
for i, t in enumerate(tijden):
    dag = t.date()
    if dag != vorige_dag and t.hour == 0:
        tick_pos.append(i)
        tick_lbl.append(f"{dag_kort[dag.weekday()]}\n{dag.day}-{dag.month:02d}")
        vorige_dag = dag

# Nacht blokken (18:00-06:00)
nacht_blokken = []
i = 0
while i < len(tijden):
    t = tijden[i]
    if t.hour == 18:
        start = i
        j = i + 1
        while j < len(tijden) and tijden[j].hour != 6:
            j += 1
        nacht_blokken.append((start, j if j < len(tijden) else len(tijden)-1))
        i = j
    else:
        i += 1

def teken_nacht(ax, xmax=None):
    if xmax is None: xmax = len(x)-1
    for s, e in nacht_blokken:
        if s < xmax:
            ax.axvspan(s, min(e, xmax), color="#e8e8e8", zorder=0)

def dag_lijnen(ax, x_ref, lbl=None, labels=False):
    for tp in tick_pos:
        if tp < len(x_ref):
            ax.axvline(tp, color="#cccccc", linewidth=0.5, zorder=1)
    ax.set_xticks([tp for tp in tick_pos if tp < len(x_ref)])
    if labels and lbl:
        ax.set_xticklabels([l for tp, l in zip(tick_pos, tick_lbl) if tp < len(x_ref)],
                           fontsize=7, color="#444")
    else:
        ax.set_xticklabels([])
    ax.set_xlim(0, len(x_ref)-1)

GROEN  = "#27ae60"
ROOD   = "#cc2200"
ZWART  = "#333333"
BLAUW  = "#003366"

# ── Figuur 2x3 ──
fig = plt.figure(figsize=(18, 20))
gs  = gridspec.GridSpec(3, 2, figure=fig, hspace=0.18, wspace=0.12)
fig.subplots_adjust(top=0.93)

# Header
header_ax = fig.add_axes([0, 0.945, 1, 0.055])
header_ax.set_xlim(0,1); header_ax.set_ylim(0,1); header_ax.axis("off")
header_ax.add_patch(plt.Rectangle((0,0),1,1,transform=header_ax.transAxes,
               facecolor="#003366",zorder=0,clip_on=False))
header_ax.text(0.012,0.65,"Ed Aldus WM",fontsize=13,color="white",
          weight="bold",va="center",transform=header_ax.transAxes)
header_ax.text(0.012,0.22,f"ECMWF ENS · {n_leden} leden · Versie {runtime}",
          fontsize=8,color="#a8c8e8",va="center",transform=header_ax.transAxes)
header_ax.text(0.988,0.65,f"De Bilt, {now_lokaal.strftime('%A %d %B %Y').capitalize()}",
          fontsize=14,color="white",weight="bold",
          ha="right",va="center",transform=header_ax.transAxes)
header_ax.text(0.988,0.22,f"run: {now_str}",fontsize=8,color="#a8c8e8",
          ha="right",va="center",transform=header_ax.transAxes)
header_ax.axhline(0,color="#4a90c4",linewidth=2)

leg_elems = [
    Line2D([0],[0], color=GROEN, lw=0.8, alpha=0.5, label="Verstoorde runs"),
    Line2D([0],[0], color=ROOD,  lw=2.0, label="Hoge resolutie (HRES)"),
    Line2D([0],[0], color=ZWART, lw=1.5, linestyle="--", label=f"Middelste (P50)"),
]

# ── Paneel 1: Temperatuur ──
ax1 = fig.add_subplot(gs[0,0])
ax1.set_facecolor("white")
teken_nacht(ax1)
for lid in alle_temp:
    ax1.plot(x, lid, color=GROEN, lw=0.7, alpha=0.35, zorder=2)
ax1.plot(x, hres_temp, color=ROOD,  lw=2.0, zorder=6)
ax1.plot(x, p50_temp,  color=ZWART, lw=1.5, linestyle="--", zorder=5)
ax1.axhline(10, color=ROOD, lw=1.2, linestyle="--", alpha=0.7, zorder=7)
ax1.axhline(0,  color="#888888", lw=0.7, linestyle=":", zorder=3)
ax1.text(x[-1], 10.3, "10°C", fontsize=7, color=ROOD, ha="right", va="bottom")
dag_lijnen(ax1, x)
ax1.set_ylabel("°C", fontsize=9)
ax1.set_title("Temperatuur (°C)", fontsize=10, fontweight="bold")
ax1.tick_params(labelsize=7)
ax1.legend(handles=leg_elems, fontsize=6.5, framealpha=0.9, loc="upper right", ncol=1)
ax1.yaxis.set_major_locator(matplotlib.ticker.MultipleLocator(5))
ax1.grid(axis="y", color="#eeeeee", lw=0.5)

# ── Paneel 2: Windsnelheid ──
ax2 = fig.add_subplot(gs[0,1])
ax2.set_facecolor("white")
teken_nacht(ax2)
for lid in alle_wind:
    ax2.plot(x, lid, color=GROEN, lw=0.7, alpha=0.35, zorder=2)
ax2.plot(x, hres_wind, color=ROOD,  lw=2.0, zorder=6)
ax2.plot(x, p50_wind,  color=ZWART, lw=1.5, linestyle="--", zorder=5)
dag_lijnen(ax2, x)
ax2.set_ylabel("km/u", fontsize=9)
ax2.set_title("Windsnelheid (km/uur)", fontsize=10, fontweight="bold")
ax2.tick_params(labelsize=7)
ax2.set_ylim(bottom=0)
ax2.grid(axis="y", color="#eeeeee", lw=0.5)

# ── Paneel 3: Neerslag 6-uurs ──
ax3 = fig.add_subplot(gs[1,0])
ax3.set_facecolor("white")
nacht_6u = [(s//6, e//6) for s,e in nacht_blokken]
for s,e in nacht_6u:
    if s < len(x6): ax3.axvspan(s, min(e, len(x6)-1), color="#e8e8e8", zorder=0)
for lid in alle_rr6:
    ax3.plot(np.arange(len(lid)), lid, color=GROEN, lw=0.7, alpha=0.35, zorder=2)
ax3.plot(np.arange(len(hres_rr6)), hres_rr6, color=ROOD, lw=2.0, zorder=6)
ax3.plot(np.arange(alle_rr6.shape[1]), np.percentile(alle_rr6,50,axis=0),
         color=ZWART, lw=1.5, linestyle="--", zorder=5)
dag_lijnen(ax3, np.arange(alle_rr6.shape[1]))
ax3.set_ylabel("mm", fontsize=9)
ax3.set_title("Neerslag (mm, 6 uurlijks)", fontsize=10, fontweight="bold")
ax3.tick_params(labelsize=7)
ax3.set_ylim(bottom=0)
ax3.grid(axis="y", color="#eeeeee", lw=0.5)

# ── Paneel 4: Windstoten ──
ax4 = fig.add_subplot(gs[1,1])
ax4.set_facecolor("white")
teken_nacht(ax4)
for lid in alle_stoot:
    ax4.plot(x, lid, color=GROEN, lw=0.7, alpha=0.35, zorder=2)
ax4.plot(x, hres_stoot, color=ROOD,  lw=2.0, zorder=6)
ax4.plot(x, p50_stoot,  color=ZWART, lw=1.5, linestyle="--", zorder=5)
ax4.axhline(60, color=ROOD, lw=1.2, linestyle="--", alpha=0.7, zorder=7)
ax4.text(x[-1], 61, "60 km/u", fontsize=7, color=ROOD, ha="right", va="bottom")
dag_lijnen(ax4, x)
ax4.set_ylabel("km/u", fontsize=9)
ax4.set_title("Windstoten (km/uur)", fontsize=10, fontweight="bold")
ax4.tick_params(labelsize=7)
ax4.set_ylim(bottom=0)
ax4.grid(axis="y", color="#eeeeee", lw=0.5)

# ── Paneel 5: Neerslagsom cumulatief ──
ax5 = fig.add_subplot(gs[2,0])
ax5.set_facecolor("white")
teken_nacht(ax5)
for lid in alle_rr_cum:
    ax5.plot(x, lid, color=GROEN, lw=0.7, alpha=0.35, zorder=2)
ax5.plot(x, hres_cum, color=ROOD,  lw=2.0, zorder=6)
ax5.plot(x, np.percentile(alle_rr_cum,50,axis=0),
         color=ZWART, lw=1.5, linestyle="--", zorder=5)
dag_lijnen(ax5, x, tick_lbl, labels=True)
ax5.set_ylabel("mm", fontsize=9)
ax5.set_title("Neerslagsom (mm)", fontsize=10, fontweight="bold")
ax5.tick_params(labelsize=7)
ax5.set_ylim(bottom=0)
ax5.grid(axis="y", color="#eeeeee", lw=0.5)

# ── Paneel 6: Sneeuwval 6-uurs ──
ax6 = fig.add_subplot(gs[2,1])
ax6.set_facecolor("white")
for s,e in nacht_6u:
    if s < len(x6): ax6.axvspan(s, min(e, len(x6)-1), color="#e8e8e8", zorder=0)
for lid in alle_snow6:
    ax6.plot(np.arange(len(lid)), lid, color=GROEN, lw=0.7, alpha=0.35, zorder=2)
ax6.plot(np.arange(len(hres_snow6)), hres_snow6, color=ROOD, lw=2.0, zorder=6)
ax6.plot(np.arange(alle_snow6.shape[1]), np.percentile(alle_snow6,50,axis=0),
         color=ZWART, lw=1.5, linestyle="--", zorder=5)
dag_lijnen(ax6, np.arange(alle_snow6.shape[1]), tick_lbl, labels=True)
ax6.set_ylabel("cm", fontsize=9)
ax6.set_title("Sneeuwval (cm, 6 uurlijks)", fontsize=10, fontweight="bold")
ax6.tick_params(labelsize=7)
ax6.set_ylim(bottom=0)
ax6.grid(axis="y", color="#eeeeee", lw=0.5)

# Copyright
fig.text(0.98, 0.005, f"© Ed Aldus | Data: ECMWF ENS via Open-Meteo | {now_str}",
         fontsize=7, style="italic", ha="right", va="bottom", color="#555555")

fname = "pluim_debilt_knmi.png"
plt.savefig(fname, dpi=150, bbox_inches="tight", pad_inches=0.3)
plt.close()
print(f"\nOpgeslagen: {fname}")
