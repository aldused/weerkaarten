"""
maak_pluim_wind.py — ECMWF ensemble pluim wind
Windkracht (m/s) als pluim, windrichting als pijltjes op mediaan
"""
import os, requests, numpy as np, math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.lines import Line2D

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

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
    "De Bilt":      (5.18,  52.10),
    "Rotterdam":    (4.44,  51.96),
    "Barendrecht":  (4.534, 51.845),
    "Vlissingen":   (3.60,  51.44),
    "Eelde":        (6.59,  53.12),
    "Maastricht":   (5.77,  50.91),
}

def ms_naar_bft(ms):
    schaal = [0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5,28.5,32.7]
    for i, g in enumerate(schaal): 
        if ms < g: return i
    return 12

def haal_ensemble(lat, lon):
    url = (
        "https://ensemble-api.open-meteo.com/v1/ensemble"
        f"?latitude={lat}&longitude={lon}"
        "&hourly=windspeed_10m,winddirection_10m"
        "&models=ecmwf_ifs025"
        "&wind_speed_unit=ms"
        "&timezone=Europe/Amsterdam"
        "&forecast_days=16"
    )
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

for station, (s_lon, s_lat) in STATIONS.items():
    print(f"Pluim wind: {station}...")
    try:
        data = haal_ensemble(s_lat, s_lon)
    except Exception as e:
        print(f"  FOUT: {e}"); continue

    hourly = data["hourly"]
    tijden = [datetime.fromisoformat(t) for t in hourly["time"]]
    x = np.arange(len(tijden))

    # Windkracht leden
    wind_leden = []
    dir_leden  = []
    for key, vals in hourly.items():
        if key.startswith("windspeed_10m_member") or key == "windspeed_10m":
            wind_leden.append(np.array(vals, dtype=float))
        if key.startswith("winddirection_10m_member") or key == "winddirection_10m":
            dir_leden.append(np.array(vals, dtype=float))

    if not wind_leden:
        print("  Geen windleden"); continue

    alle_wind = np.vstack(wind_leden)
    mediaan_wind = np.median(alle_wind, axis=0)
    p25 = np.percentile(alle_wind, 25, axis=0)
    p75 = np.percentile(alle_wind, 75, axis=0)

    # Circulaire mediaan windrichting
    if dir_leden:
        alle_dir = np.vstack(dir_leden)
        rad = np.deg2rad(alle_dir)
        mediaan_dir = np.rad2deg(np.arctan2(
            np.median(np.sin(rad), axis=0),
            np.median(np.cos(rad), axis=0)
        )) % 360
    else:
        mediaan_dir = None

    # X-as daglabels
    tick_pos, tick_lbl, vorige_dag = [], [], None
    for i, t in enumerate(tijden):
        dag = t.date()
        if dag != vorige_dag:
            tick_pos.append(i)
            tick_lbl.append(f"{nl_dagen[dag.weekday()]}\n{dag.day} {nl_maanden[dag.month]}")
            vorige_dag = dag

    # Beaufort Y-as ticks
    bft_ms = [0, 0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7]
    bft_lbl= [f"Bft {i}" for i in range(13)]

    # Figuur
    fig = plt.figure(figsize=(14, 7))
    gs  = gridspec.GridSpec(2, 1, figure=fig, height_ratios=[0.10, 1], hspace=0.02)

    # Header
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#003366",zorder=0,clip_on=False))
    ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=11,color="white",
              weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.22,f"ECMWF ENS · {alle_wind.shape[0]} leden",fontsize=7.5,
              color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.62,f"Ensemble pluim wind – {station}",
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

    # Alle leden groen
    for lid in alle_wind:
        ax.plot(x, lid, color="#27ae60", linewidth=0.5, alpha=0.3, zorder=2)

    # 25-75% vlak
    ax.fill_between(x, p25, p75, color="#2171b5", alpha=0.25, zorder=3)

    # Mediaan rood
    ax.plot(x, mediaan_wind, color="#cc2200", linewidth=2.5, zorder=6)

    # Windrichtingspijltjes op mediaan — elke 6 uur
    if mediaan_dir is not None:
        pijl_stap = 6
        for i in range(0, len(x), pijl_stap):
            ms_val = mediaan_wind[i]
            dd = mediaan_dir[i]
            # Pijl wijst in windrichting (van waar wind vandaan komt)
            rad = math.radians(dd)
            dx = -math.sin(rad) * 1.2
            dy = -math.cos(rad) * 0.5
            ax.annotate("",
                xy=(i + dx, ms_val + dy),
                xytext=(i, ms_val),
                arrowprops=dict(arrowstyle="-|>", color="#003366",
                                lw=1.8, mutation_scale=16),
                zorder=7)

    # Bft referentielijnen
    ymax = max(np.max(alle_wind), 15)
    for bft_val, bft_name in zip(bft_ms[1:], bft_lbl[1:]):
        if bft_val > ymax * 1.1: break
        ax.axhline(bft_val, color="#dddddd", linewidth=0.5, linestyle="--", zorder=1)
        ax.text(len(x)-0.5, bft_val+0.1, bft_name, fontsize=6,
                color="#aaaaaa", ha="right", va="bottom")

    for tp in tick_pos:
        ax.axvline(tp, color="#dddddd", linewidth=0.7, zorder=1)
    ax.set_xticks(tick_pos); ax.set_xticklabels(tick_lbl, fontsize=8.5, color="#444444")
    ax.set_xlim(0, len(x)-1)
    ax.set_ylim(bottom=0)
    ax.set_ylabel("Windsnelheid (m/s)", fontsize=9, color="#444444")
    ax.tick_params(axis="y", labelsize=8.5, colors="#444444")
    for spine in ["top","right"]: ax.spines[spine].set_visible(False)

    legenda = [
        Line2D([0],[0], color="#27ae60", linewidth=1.2, alpha=0.6,
               label=f"Ensemble leden ({alle_wind.shape[0]})"),
        Line2D([0],[0], color="#2171b5", linewidth=6, alpha=0.25, label="25–75%"),
        Line2D([0],[0], color="#cc2200", linewidth=2.5, label="Mediaan"),
        Line2D([0],[0], color="#003366", linewidth=0, marker=">",
               markersize=6, label="Windrichting (mediaan)"),
    ]
    ax.legend(handles=legenda, loc="upper right", fontsize=7.5,
              framealpha=0.9, edgecolor="#cccccc", ncol=4)

    ax.text(1.0,-0.08,
            f"© Ed Aldus | Data: ECMWF ENS via Open-Meteo | {now_str}",
            transform=ax.transAxes,fontsize=6.5,style="italic",
            ha="right",va="top",color="#555555")

    naam_clean = station.lower().replace(" ","_").replace(".","")
    fname = f"kaart_pluim_wind_{naam_clean}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight"); plt.close()
    print(f"  Opgeslagen: {fname}")

print("\nKlaar!")
