"""
maak_pluim_neerslag.py — ECMWF ensemble pluim neerslag
Paneel 1: alle leden (mm/uur) groen + mediaan rood
Paneel 2: neerslagkans (% leden > 0.1mm)
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
        "&hourly=precipitation"
        "&models=ecmwf_ifs025"
        "&timezone=Europe/Amsterdam"
        "&forecast_days=16"
    )
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

for station, (s_lon, s_lat) in STATIONS.items():
    print(f"Pluim neerslag: {station}...")
    try:
        data = haal_ensemble(s_lat, s_lon)
    except Exception as e:
        print(f"  FOUT: {e}"); continue

    hourly = data["hourly"]
    tijden = [datetime.fromisoformat(t) for t in hourly["time"]]
    x = np.arange(len(tijden))

    # Neerslag leden
    leden = []
    for key, vals in hourly.items():
        if key.startswith("precipitation_member") or key == "precipitation":
            arr = np.array(vals, dtype=float)
            arr = np.where(np.isnan(arr), 0, arr)
            leden.append(arr)

    if not leden:
        print("  Geen neerslagleden gevonden"); continue

    alle = np.vstack(leden)  # shape: (n_leden, n_tijden)
    n_leden = alle.shape[0]
    mediaan = np.median(alle, axis=0)

    # Neerslagkans: % leden > 0.1 mm
    kans = np.sum(alle > 0.1, axis=0) / n_leden * 100

    # Kleur voor kans
    def kans_kleur(k):
        if k >= 80: return "#1a5fb4"
        if k >= 60: return "#3584e4"
        if k >= 40: return "#62a0ea"
        if k >= 20: return "#99c1f1"
        return "#ddeeff"

    # X-as daglabels
    tick_pos, tick_lbl, vorige_dag = [], [], None
    for i, t in enumerate(tijden):
        dag = t.date()
        if dag != vorige_dag:
            tick_pos.append(i)
            tick_lbl.append(f"{nl_dagen[dag.weekday()]}\n{dag.day} {nl_maanden[dag.month]}")
            vorige_dag = dag

    # ── Figuur ──
    fig = plt.figure(figsize=(14, 9))
    gs  = gridspec.GridSpec(3, 1, figure=fig,
                            height_ratios=[0.08, 1, 0.55], hspace=0.10)

    # Header
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#003366",zorder=0,clip_on=False))
    ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=11,color="white",
              weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.22,f"ECMWF ENS · {n_leden} leden",fontsize=7.5,
              color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.62,f"Ensemble pluim neerslag – {station}",
              fontsize=12,color="white",weight="bold",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.22,f"run: {now_str}  ·  {bereken_runtime()}",fontsize=7.5,color="#a8c8e8",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=1.5)

    # ── Paneel 1: Neerslag leden ──
    ax1 = fig.add_subplot(gs[1])
    ax1.set_facecolor("#f8f9fa")
    ax1.grid(axis="y",color="#e0e0e0",linewidth=0.6,zorder=0)
    ax1.grid(axis="x",color="#eeeeee",linewidth=0.4,zorder=0)

    for lid in alle:
        ax1.plot(x, lid, color="#27ae60", linewidth=0.5, alpha=0.3, zorder=2)
    ax1.plot(x, mediaan, color="#cc2200", linewidth=2.5, zorder=6)

    for tp in tick_pos:
        ax1.axvline(tp, color="#dddddd", linewidth=0.7, zorder=1)
    ax1.set_xticks(tick_pos); ax1.set_xticklabels([], fontsize=8.5)
    ax1.set_xlim(0, len(x)-1)
    ax1.set_ylim(bottom=0)
    ax1.set_ylabel("Neerslag (mm/u)", fontsize=9, color="#444444")
    ax1.tick_params(axis="y", labelsize=8.5, colors="#444444")
    ax1.set_title("Neerslag per uur", fontsize=9, color="#333333", loc="left", pad=4)
    for spine in ["top","right"]: ax1.spines[spine].set_visible(False)
    legenda1 = [
        Line2D([0],[0], color="#27ae60", linewidth=1.2, alpha=0.6, label=f"Ensemble leden ({n_leden})"),
        Line2D([0],[0], color="#cc2200", linewidth=2.5, label="Mediaan"),
    ]
    ax1.legend(handles=legenda1, loc="upper right", fontsize=7.5,
               framealpha=0.9, edgecolor="#cccccc")

    # ── Paneel 2: Neerslagkans als staafdiagram ──
    ax2 = fig.add_subplot(gs[2])
    ax2.set_facecolor("#f8f9fa")
    ax2.grid(axis="y",color="#e0e0e0",linewidth=0.6,zorder=0)

    kleuren = [kans_kleur(k) for k in kans]
    ax2.bar(x, kans, color=kleuren, width=1.0, zorder=3)

    # Drempellijnen
    for niveau, label in [(20,"20%"), (40,"40%"), (60,"60%"), (80,"80%")]:
        ax2.axhline(niveau, color="#aaaaaa", linewidth=0.6, linestyle="--", zorder=2)
        ax2.text(len(x)-1, niveau+1, label, fontsize=6, color="#aaaaaa", ha="right")

    for tp in tick_pos:
        ax2.axvline(tp, color="#dddddd", linewidth=0.7, zorder=1)
    ax2.set_xticks(tick_pos); ax2.set_xticklabels(tick_lbl, fontsize=8.5, color="#444444")
    ax2.set_xlim(0, len(x)-1)
    ax2.set_ylim(0, 105)
    ax2.set_ylabel("Neerslagkans (%)", fontsize=9, color="#444444")
    ax2.tick_params(axis="y", labelsize=8.5, colors="#444444")
    ax2.set_title("Neerslagkans (% leden > 0.1 mm)", fontsize=9,
                  color="#333333", loc="left", pad=4)
    for spine in ["top","right"]: ax2.spines[spine].set_visible(False)

    # Kleurlegenda kans
    from matplotlib.patches import Patch
    leg_kans = [
        Patch(facecolor="#1a5fb4", label="≥80%"),
        Patch(facecolor="#3584e4", label="60–80%"),
        Patch(facecolor="#62a0ea", label="40–60%"),
        Patch(facecolor="#99c1f1", label="20–40%"),
        Patch(facecolor="#ddeeff", label="<20%"),
    ]
    ax2.legend(handles=leg_kans, loc="upper right", fontsize=7,
               framealpha=0.9, edgecolor="#cccccc", ncol=5)

    ax2.text(1.0,-0.18,
            f"© Ed Aldus | Data: ECMWF ENS via Open-Meteo | {now_str}",
            transform=ax2.transAxes,fontsize=6.5,style="italic",
            ha="right",va="top",color="#555555")

    naam_clean = station.lower().replace(" ","_").replace(".","")
    fname = f"kaart_pluim_neerslag_{naam_clean}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight"); plt.close()
    print(f"  Opgeslagen: {fname}")

print("\nKlaar!")
