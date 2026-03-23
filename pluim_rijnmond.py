"""
pluim_rijnmond.py — Ensemble temperatuurpluim
Rhoon / Rotterdam / Ridderkerk — 3 panelen onder elkaar
Rode stippellijn bij 10°C
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

STATIONS = [
    ("Rhoon",      51.858, 4.417),
    ("Rotterdam",  51.96,  4.44),
    ("Ridderkerk", 51.866, 4.600),
]

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

def haal_ensemble(lat, lon):
    url = (
        "https://ensemble-api.open-meteo.com/v1/ensemble"
        f"?latitude={lat}&longitude={lon}"
        "&hourly=temperature_2m"
        "&models=ecmwf_ifs025"
        "&timezone=Europe/Amsterdam"
        "&forecast_days=16"
    )
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

def haal_hres(lat, lon):
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&hourly=temperature_2m"
        "&models=ecmwf_ifs"
        "&timezone=Europe/Amsterdam"
        "&forecast_days=16"
    )
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

print("Data ophalen...")
runtime = bereken_runtime()

station_data = []
tijden_ref = None

for naam, lat, lon in STATIONS:
    print(f"  {naam}...")
    data   = haal_ensemble(lat, lon)
    hres_d = haal_hres(lat, lon)
    hourly = data["hourly"]
    tijden = [datetime.fromisoformat(t) for t in hourly["time"]]
    if tijden_ref is None:
        tijden_ref = tijden

    leden = []
    for key, vals in hourly.items():
        if key.startswith("temperature_2m_member") or key == "temperature_2m":
            leden.append(np.array(vals, dtype=float))
    alle = np.vstack(leden)

    # Trailing nullen afkappen
    laatste = int(np.max(np.where(np.any(alle != 0, axis=0))))
    alle = alle[:, :laatste+1]
    tijden_cut = tijden[:laatste+1]

    hres_dict = dict(zip(hres_d["hourly"]["time"], hres_d["hourly"]["temperature_2m"]))
    hres_lijn = np.array([hres_dict.get(t.strftime("%Y-%m-%dT%H:%M"), np.nan) for t in tijden_cut])

    station_data.append({
        "naam":    naam,
        "alle":    alle,
        "mediaan": np.median(alle, axis=0),
        "p25":     np.percentile(alle, 25, axis=0),
        "p75":     np.percentile(alle, 75, axis=0),
        "hres":    hres_lijn,
        "tijden":  tijden_cut,
    })

# Gebruik kortste tijdreeks als referentie
n_min = min(len(d["tijden"]) for d in station_data)
x = np.arange(n_min)

# Daglabels
tick_pos, tick_lbl, vorige_dag = [], [], None
for i, t in enumerate(station_data[0]["tijden"][:n_min]):
    dag = t.date()
    if dag != vorige_dag:
        tick_pos.append(i)
        tick_lbl.append(f"{nl_dagen[dag.weekday()]}\n{dag.day} {nl_maanden[dag.month]}")
        vorige_dag = dag

n = len(STATIONS)
fig = plt.figure(figsize=(16, 4 + n * 5))
gs  = gridspec.GridSpec(n, 1, figure=fig, hspace=0.12)
fig.subplots_adjust(top=0.93)

# Header
header_ax = fig.add_axes([0, 0.94, 1, 0.06])
header_ax.set_xlim(0,1); header_ax.set_ylim(0,1); header_ax.axis("off")
header_ax.add_patch(plt.Rectangle((0,0),1,1,transform=header_ax.transAxes,
               facecolor="#003366",zorder=0,clip_on=False))
header_ax.text(0.012,0.65,"Ed Aldus WM",fontsize=13,color="white",
          weight="bold",va="center",transform=header_ax.transAxes)
header_ax.text(0.012,0.22,f"ECMWF ENS · {station_data[0]['alle'].shape[0]} leden · {runtime}",
          fontsize=8,color="#a8c8e8",va="center",transform=header_ax.transAxes)
header_ax.text(0.988,0.65,"Ensemble temperatuur – Rhoon · Rotterdam · Ridderkerk",
          fontsize=14,color="white",weight="bold",
          ha="right",va="center",transform=header_ax.transAxes)
header_ax.text(0.988,0.22,f"run: {now_str}",fontsize=8,color="#a8c8e8",
          ha="right",va="center",transform=header_ax.transAxes)
header_ax.axhline(0,color="#4a90c4",linewidth=2)

import matplotlib.ticker as ticker

for pi, d in enumerate(station_data):
    is_last = (pi == n - 1)
    ax = fig.add_subplot(gs[pi])
    ax.set_facecolor("#f8f9fa")
    ax.grid(axis="y",color="#e0e0e0",linewidth=0.6,zorder=0)
    ax.grid(axis="x",color="#eeeeee",linewidth=0.4,zorder=0)
    for spine in ["top","right"]: ax.spines[spine].set_visible(False)

    alle = d["alle"][:, :n_min]
    for lid in alle:
        ax.plot(x, lid, color="#27ae60", linewidth=0.6, alpha=0.3, zorder=2)
    ax.fill_between(x, d["p25"][:n_min], d["p75"][:n_min],
                    color="#27ae60", alpha=0.15, zorder=3)
    ax.plot(x, d["mediaan"][:n_min], color="#cc2200", linewidth=2.5, zorder=6)
    ax.plot(x, d["hres"][:n_min],    color="#003366", linewidth=2.0, zorder=7)

    # Rode stippellijn 10°C
    ax.axhline(10, color="#cc2200", linewidth=1.5, linestyle="--", zorder=8, alpha=0.8)
    ax.text(x[-1], 10.2, "10°C", fontsize=8, color="#cc2200", ha="right", va="bottom")
    # Blauwe stippellijn 0°C
    ax.axhline(0, color="#1a5fb4", linewidth=1.5, linestyle="--", zorder=8, alpha=0.8)
    ax.text(x[-1], 0.2, "0°C", fontsize=8, color="#1a5fb4", ha="right", va="bottom")

    for tp in tick_pos:
        ax.axvline(tp, color="#dddddd", linewidth=0.7, zorder=1)
    ax.set_xticks(tick_pos)
    if is_last:
        ax.set_xticklabels(tick_lbl, fontsize=8.5, color="#444444")
    else:
        ax.set_xticklabels([])
    ax.set_xlim(0, n_min-1)
    ax.set_ylabel("Temperatuur (°C)", fontsize=9, color="#444444")
    ax.tick_params(axis="y", labelsize=8.5, colors="#444444")
    ax.yaxis.set_major_locator(ticker.MultipleLocator(2.5))
    ax.set_title(d["naam"], fontsize=11, color="#333",
                 loc="left", pad=4, fontweight="bold")

    if pi == 0:
        leg = [
            Line2D([0],[0], color="#27ae60", lw=1, alpha=0.6, label=f"ENS leden ({alle.shape[0]})"),
            Line2D([0],[0], color="#cc2200", lw=2.5, label="Mediaan"),
            Line2D([0],[0], color="#003366", lw=2.0, label="HRES"),
            Line2D([0],[0], color="#cc2200", lw=1.5, linestyle="--", label="10°C"),
        ]
        ax.legend(handles=leg, loc="upper right", fontsize=8,
                  framealpha=0.9, edgecolor="#cccccc", ncol=4)

fig.text(0.98, 0.005, f"© Ed Aldus | Data: ECMWF ENS via Open-Meteo | {now_str}",
         fontsize=7, style="italic", ha="right", va="bottom", color="#555555")

fname = "pluim_rijnmond.png"
plt.savefig(fname, dpi=150, bbox_inches="tight", pad_inches=0.3)
plt.close()
print(f"\nOpgeslagen: {fname}")
