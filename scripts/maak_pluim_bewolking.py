"""
maak_pluim_bewolking.py — ECMWF ensemble pluim bewolking + zonuren
Alle leden groen, mediaan rood
"""
import os, requests, numpy as np
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
        "&hourly=cloudcover"
        "&models=ecmwf_ifs025"
        "&timezone=Europe/Amsterdam"
        "&forecast_days=16"
    )
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

for station, (s_lon, s_lat) in STATIONS.items():
    print(f"Pluim bewolking: {station}...")
    try:
        data = haal_ensemble(s_lat, s_lon)
    except Exception as e:
        print(f"  FOUT: {e}"); continue

    hourly = data["hourly"]
    tijden = [datetime.fromisoformat(t) for t in hourly["time"]]
    x = np.arange(len(tijden))

    # Bewolking leden
    wolk_leden = []
    zon_leden  = []
    for key, vals in hourly.items():
        if key.startswith("cloudcover_member") or key == "cloudcover":
            wolk_leden.append(np.array(vals, dtype=float))
        if key.startswith("sunshine_duration_member") or key == "sunshine_duration":
            zon_leden.append(np.array(vals, dtype=float) / 60)  # seconden → minuten

    if not wolk_leden:
        print("  Geen bewolkingsleden gevonden"); continue

    alle_wolk = np.vstack(wolk_leden)
    mediaan_wolk = np.median(alle_wolk, axis=0)

    alle_zon  = np.vstack(zon_leden) if zon_leden else None
    mediaan_zon = np.median(alle_zon, axis=0) if alle_zon is not None else None

    # X-as daglabels
    tick_pos, tick_lbl, vorige_dag = [], [], None
    for i, t in enumerate(tijden):
        dag = t.date()
        if dag != vorige_dag:
            tick_pos.append(i)
            tick_lbl.append(f"{nl_dagen[dag.weekday()]}\n{dag.day} {nl_maanden[dag.month]}")
            vorige_dag = dag

    # ── Figuur: 2 panelen (bewolking + zonuren) ──
    fig = plt.figure(figsize=(14, 7))
    gs  = gridspec.GridSpec(2, 1, figure=fig,
                            height_ratios=[0.10, 1], hspace=0.02)

    # Header
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#003366",zorder=0,clip_on=False))
    ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=11,color="white",
              weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.22,f"ECMWF ENS · {alle_wolk.shape[0]} leden",
              fontsize=7.5,color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.62,f"Ensemble pluim bewolking – {station}",
              fontsize=12,color="white",weight="bold",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.22,f"run: {now_str}  ·  {bereken_runtime()}",fontsize=7.5,color="#a8c8e8",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=1.5)

    # ── Paneel 1: Bewolking ──
    ax1 = fig.add_subplot(gs[1])
    ax1.set_facecolor("#f0f4f8")
    ax1.grid(axis="y",color="#e0e0e0",linewidth=0.6,zorder=0)
    ax1.grid(axis="x",color="#eeeeee",linewidth=0.4,zorder=0)

    for lid in alle_wolk:
        ax1.plot(x, lid, color="#2c7bb6", linewidth=0.6, alpha=0.3, zorder=2)
    ax1.plot(x, mediaan_wolk, color="#cc2200", linewidth=2.5, zorder=6)
    ax1.fill_between(x, 0, mediaan_wolk, color="#2c7bb6", alpha=0.15, zorder=1)

    for tp in tick_pos:
        ax1.axvline(tp, color="#dddddd", linewidth=0.7, zorder=1)
    ax1.set_xticks(tick_pos); ax1.set_xticklabels(tick_lbl, fontsize=8.5, color="#444444")
    ax1.set_xlim(0, len(x)-1)
    ax1.set_ylim(0, 105)
    ax1.set_ylabel("Bewolking (%)", fontsize=9, color="#444444")
    ax1.tick_params(axis="y", labelsize=8.5, colors="#444444")
    ax1.set_title("Bewolkingsgraad", fontsize=9, color="#333333", loc="left", pad=4)
    for spine in ["top","right"]: ax1.spines[spine].set_visible(False)
    legenda1 = [
        Line2D([0],[0], color="#2c7bb6", linewidth=1.2, alpha=0.6, label=f"Ensemble leden ({alle_wolk.shape[0]})"),
        Line2D([0],[0], color="#cc2200", linewidth=2.5, label="Mediaan"),
    ]
    ax1.legend(handles=legenda1, loc="upper right", fontsize=7.5,
               framealpha=0.9, edgecolor="#cccccc")

    ax1.text(1.0,-0.08,
            f"© Ed Aldus | Data: ECMWF ENS via Open-Meteo | {now_str}",
            transform=ax1.transAxes,fontsize=6.5,style="italic",
            ha="right",va="top",color="#555555")

    naam_clean = station.lower().replace(" ","_").replace(".","")
    fname = f"kaart_pluim_bewolking_{naam_clean}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight"); plt.close()
    print(f"  Opgeslagen: {fname}")

print("\nKlaar!")
