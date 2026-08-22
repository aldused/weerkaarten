"""
maak_pluim.py — ECMWF ensemble pluim via Open-Meteo
51 ensemble leden, 10 dagen vooruit
Geen GRIB, geen grote downloads — gewoon JSON per station
"""
import os, requests, numpy as np
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

os.chdir(os.path.dirname(os.path.abspath(__file__)))

def bereken_runtime():
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    uur = now.hour
    if uur >= 20:   run = 18
    elif uur >= 14: run = 12
    elif uur >= 8:  run = 6
    elif uur >= 2:  run = 0
    else:           run = 18
    return f"ECMWF {now.strftime('%d %b')} {run:02d}Z"



def bereken_runtime():
    try:
        url = (f"https://ensemble-api.open-meteo.com/v1/ensemble"
               f"?latitude={lat}&longitude={lon}"
               f"&hourly=temperature_2m&models={model}"
               f"&timezone=Europe/Amsterdam&forecast_days=1")
        r = requests.get(url, timeout=10).json()
        rt = r.get("hourly",{}).get("time",[""])[0]
        if rt:
            from datetime import datetime
            run_dt = datetime.fromisoformat(rt)
            return f"ECMWF run {run_dt.strftime('%d %b %H:%M')} UTC"
    except: pass
    return ""


LOCAL_TZ   = ZoneInfo("Europe/Amsterdam")
now_lokaal = datetime.now(timezone.utc).astimezone(LOCAL_TZ)
now_str    = now_lokaal.strftime("%d %b %Y  %H:%M")
nl_dagen   = ["Ma","Di","Wo","Do","Vr","Za","Zo"]
nl_maanden = ["","jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"]

STATIONS = {
    "De Bilt":    (5.18,  52.10),
    "Rotterdam":  (4.44,  51.96),
    "Maastricht": (5.77,  50.91),
    "Eelde":      (6.59,  53.12),
    "Vlissingen": (3.60,  51.44),
    "Enschede":   (6.89,  52.28),
}

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

for station, (s_lon, s_lat) in STATIONS.items():
    print(f"Pluim: {station}...")
    try:
        data = haal_ensemble(s_lat, s_lon)
    except Exception as e:
        print(f"  FOUT: {e}"); continue

    hourly = data["hourly"]
    tijden = [datetime.fromisoformat(t) for t in hourly["time"]]

    # Alle ensemble leden ophalen (member01 t/m member51)
    leden = []
    for key, vals in hourly.items():
        if key.startswith("temperature_2m_member") or key == "temperature_2m":
            leden.append(np.array(vals, dtype=float))

    if not leden:
        print("  Geen ensemble leden gevonden"); continue

    alle = np.vstack(leden)  # shape: (n_leden, n_tijden)
    print(f"  {alle.shape[0]} leden × {alle.shape[1]} tijdstappen")

    mediaan = np.median(alle, axis=0)
    p10  = np.percentile(alle, 10,  axis=0)
    p25  = np.percentile(alle, 25,  axis=0)
    p75  = np.percentile(alle, 75,  axis=0)
    p90  = np.percentile(alle, 90,  axis=0)
    minv = np.min(alle, axis=0)
    maxv = np.max(alle, axis=0)
    x    = np.arange(len(tijden))

    tick_pos, tick_lbl, vorige_dag = [], [], None
    for i, t in enumerate(tijden):
        dag = t.date()
        if dag != vorige_dag:
            tick_pos.append(i)
            tick_lbl.append(f"{nl_dagen[dag.weekday()]}\n{dag.day} {nl_maanden[dag.month]}")
            vorige_dag = dag

    fig = plt.figure(figsize=(14, 7))
    gs  = gridspec.GridSpec(2, 1, figure=fig, height_ratios=[0.10, 1], hspace=0.02)

    # Header
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#003366",zorder=0,clip_on=False))
    ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=11,color="white",
              weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.22,f"ECMWF ENS · {alle.shape[0]} leden",fontsize=7.5,
              color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.62,f"Ensemble pluim 2m temperatuur – {station}",
              fontsize=12,color="white",weight="bold",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.22,f"run: {now_str}  ·  {bereken_runtime()}",fontsize=7.5,color="#a8c8e8",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=1.5)

    # Pluim
    ax = fig.add_subplot(gs[1])
    ax.set_facecolor("#f8f9fa")
    ax.grid(axis="y",color="#e0e0e0",linewidth=0.6,zorder=0)
    ax.grid(axis="x",color="#eeeeee",linewidth=0.4,zorder=0)

    for lid in alle:
        ax.plot(x, lid, color="#bbbbbb", linewidth=0.4, alpha=0.35, zorder=2)

    ax.fill_between(x, minv, maxv, color="#cce5ff", alpha=0.5, zorder=3, label="Min–Max")
    ax.fill_between(x, p10,  p90,  color="#6baed6", alpha=0.5, zorder=4, label="10–90%")
    ax.fill_between(x, p25,  p75,  color="#2171b5", alpha=0.6, zorder=5, label="25–75%")
    ax.plot(x, mediaan, color="#cc2200", linewidth=2.5, zorder=6, label="Mediaan")
    ax.axhline(0, color="#444444", linewidth=0.8, linestyle=":", zorder=8)

    for tp in tick_pos:
        ax.axvline(tp, color="#dddddd", linewidth=0.7, zorder=1)

    ax.set_xticks(tick_pos); ax.set_xticklabels(tick_lbl, fontsize=8.5, color="#444444")
    ax.set_xlim(0, len(x)-1)
    ax.set_ylabel("Temperatuur (°C)", fontsize=9, color="#444444")
    ax.tick_params(axis="y", labelsize=8.5, colors="#444444")
    for spine in ["top","right"]: ax.spines[spine].set_visible(False)
    ax.legend(loc="upper right", fontsize=7.5, framealpha=0.9,
              edgecolor="#cccccc", ncol=4)
    ax.text(1.0,-0.08,
            f"© Ed Aldus | Data: ECMWF ENS via Open-Meteo | {now_str}",
            transform=ax.transAxes,fontsize=6.5,style="italic",
            ha="right",va="top",color="#555555")

    naam_clean = station.lower().replace(" ","_").replace(".","")
    fname = f"kaart_pluim_{naam_clean}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight"); plt.close()
    print(f"  Opgeslagen: {fname}")

print("\nKlaar!")
