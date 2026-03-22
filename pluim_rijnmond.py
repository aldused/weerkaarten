"""
pluim_rijnmond.py — Ensemble temperatuurpluim Rhoon / Ridderkerk / Rotterdam
3 panelen onder elkaar, groene leden + mediaan rood + HRES blauw
Lokaal gebruik — geen upload
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

STATIONS = [
    ("Rotterdam",  51.96,  4.44),
    ("Ridderkerk", 51.866, 4.600),
    ("Rhoon",      51.858, 4.417),
]

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
tijden_ref   = None

for naam, lat, lon in STATIONS:
    print(f"  {naam}...")
    data = haal_ensemble(lat, lon)
    hres = haal_hres(lat, lon)

    hourly = data["hourly"]
    tijden = [datetime.fromisoformat(t) for t in hourly["time"]]
    if tijden_ref is None:
        tijden_ref = tijden

    leden = []
    for key, vals in hourly.items():
        if key.startswith("temperature_2m_member") or key == "temperature_2m":
            leden.append(np.array(vals, dtype=float))
    alle = np.vstack(leden)

    hres_dict = dict(zip(hres["hourly"]["time"], hres["hourly"]["temperature_2m"]))
    hres_lijn = np.array([hres_dict.get(t.strftime("%Y-%m-%dT%H:%M"), np.nan) for t in tijden])

    station_data.append({
        "naam":    naam,
        "alle":    alle,
        "mediaan": np.median(alle, axis=0),
        "hres":    hres_lijn,
    })

x = np.arange(len(tijden_ref))

# Daglabels
tick_pos, tick_lbl, vorige_dag = [], [], None
for i, t in enumerate(tijden_ref):
    dag = t.date()
    if dag != vorige_dag:
        tick_pos.append(i)
        tick_lbl.append(f"{nl_dagen[dag.weekday()]}\n{dag.day} {nl_maanden[dag.month]}")
        vorige_dag = dag

# ── Figuur: header + 3 panelen ──
fig = plt.figure(figsize=(16, 18))
gs  = gridspec.GridSpec(4, 1, figure=fig,
                        height_ratios=[0.07, 1, 1, 1],
                        hspace=0.12)

# Header
ax_h = fig.add_subplot(gs[0])
ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
               facecolor="#003366",zorder=0,clip_on=False))
ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=13,color="white",
          weight="bold",va="center",transform=ax_h.transAxes)
ax_h.text(0.012,0.18,f"ECMWF ENS · 51 leden · {runtime}",
          fontsize=8,color="#a8c8e8",va="center",transform=ax_h.transAxes)
ax_h.text(0.988,0.62,"Ensemble pluim temperatuur – Rijnmond",
          fontsize=15,color="white",weight="bold",
          ha="right",va="center",transform=ax_h.transAxes)
ax_h.text(0.988,0.18,f"run: {now_str}",fontsize=8,color="#a8c8e8",
          ha="right",va="center",transform=ax_h.transAxes)
ax_h.axhline(0,color="#4a90c4",linewidth=2)

import matplotlib.ticker as ticker

for pi, d in enumerate(station_data):
    ax = fig.add_subplot(gs[pi+1])
    ax.set_facecolor("#f8f9fa")
    ax.grid(axis="y",color="#e0e0e0",linewidth=0.6,zorder=0)
    ax.grid(axis="x",color="#eeeeee",linewidth=0.4,zorder=0)
    for spine in ["top","right"]: ax.spines[spine].set_visible(False)

    # Alle groene leden
    for lid in d["alle"]:
        ax.plot(x, lid, color="#27ae60", linewidth=0.6, alpha=0.35, zorder=2)

    # Mediaan rood
    ax.plot(x, d["mediaan"], color="#cc2200", linewidth=2.5, zorder=6)

    # HRES blauw
    ax.plot(x, d["hres"], color="#003366", linewidth=2.0, zorder=7)

    ax.axhline(0, color="#444444", linewidth=0.7, linestyle=":", zorder=8)
    for tp in tick_pos:
        ax.axvline(tp, color="#dddddd", linewidth=0.7, zorder=1)

    ax.set_xticks(tick_pos)
    if pi == len(station_data) - 1:
        ax.set_xticklabels(tick_lbl, fontsize=8.5, color="#444444")
    else:
        ax.set_xticklabels([])
    ax.set_xlim(0, len(x)-1)
    ax.set_ylabel("Temperatuur (°C)", fontsize=9, color="#444444")
    ax.tick_params(axis="y", labelsize=8.5, colors="#444444")
    ax.yaxis.set_major_locator(ticker.MultipleLocator(2.5))
    ax.set_title(d["naam"], fontsize=11, color="#333333",
                 loc="left", pad=5, fontweight="bold")

    leg = [
        Line2D([0],[0], color="#27ae60", lw=1.2, alpha=0.6,
               label=f"ENS leden ({d['alle'].shape[0]})"),
        Line2D([0],[0], color="#cc2200", lw=2.5, label="Mediaan"),
        Line2D([0],[0], color="#003366", lw=2.0, label="HRES"),
    ]
    ax.legend(handles=leg, loc="upper right", fontsize=8,
              framealpha=0.9, edgecolor="#cccccc", ncol=3)

# Copyright
fig.text(0.98, 0.01, f"© Ed Aldus | Data: ECMWF ENS via Open-Meteo | {now_str}",
         fontsize=7, style="italic", ha="right", va="bottom", color="#555555")

fname = "pluim_rijnmond_temp.png"
plt.savefig(fname, dpi=150, bbox_inches="tight", pad_inches=0.3)
plt.close()
print(f"\nOpgeslagen: {fname}")
