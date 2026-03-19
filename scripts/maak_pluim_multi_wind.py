"""
maak_pluim_multi_wind.py — Multi-model ensemble pluim wind + windstoten
3 panelen: ECMWF ENS / ICON-EPS / GFS ENS
Per paneel: leden wind + mediaan wind + mediaan stoten + windrichtingspijltjes
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
    try:
        from ecmwf.opendata import Client
        latest = Client("ecmwf").latest(stream="enfo", type="pf", param="2t")
        return f"ECMWF run {latest.strftime('%d %b %H')}Z"
    except:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        uur = now.hour
        if uur >= 20:   run = 18
        elif uur >= 14: run = 12
        elif uur >= 8:  run = 6
        elif uur >= 2:  run = 0
        else:           run = 18
        return f"ECMWF {now.strftime('%d %b')} {run:02d}Z"

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

MODELLEN = [
    {"naam": "ECMWF ENS", "model": "ecmwf_ifs025", "kleur": "#27ae60", "days": 16},
    {"naam": "ICON-EPS",  "model": "icon_seamless", "kleur": "#2980b9", "days": 7},
    {"naam": "GFS ENS",   "model": "gfs025",        "kleur": "#e67e22", "days": 16},
]

def haal_ensemble(lat, lon, model, days):
    url = (f"https://ensemble-api.open-meteo.com/v1/ensemble"
           f"?latitude={lat}&longitude={lon}"
           f"&hourly=windspeed_10m,windgusts_10m,winddirection_10m"
           f"&models={model}&wind_speed_unit=kmh"
           f"&timezone=Europe/Amsterdam&forecast_days={days}")
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

def haal_leden(hourly, prefix):
    leden = []
    for key, vals in hourly.items():
        if key.startswith(f"{prefix}_member") or key == prefix:
            arr = np.array(vals, dtype=float)
            arr = np.where(np.isnan(arr), 0, arr)
            leden.append(arr)
    return np.vstack(leden) if leden else None

def maak_paneel(ax):
    ax.set_facecolor("#f8f9fa")
    ax.grid(axis="y", color="#e0e0e0", linewidth=0.6, zorder=0)
    ax.grid(axis="x", color="#eeeeee", linewidth=0.4, zorder=0)
    for spine in ["top","right"]: ax.spines[spine].set_visible(False)

# Bft referentielijnen in km/u
BFT_KMH = [0,1.1,5.6,12.3,19.8,28.8,38.9,50.0,61.9,74.7,88.2,102.6,117.5]

for station, (s_lon, s_lat) in STATIONS.items():
    print(f"\nMultimodel wind: {station}...")

    model_data = {}
    for m in MODELLEN:
        print(f"  {m['naam']}...")
        try:
            data   = haal_ensemble(s_lat, s_lon, m["model"], m["days"])
            hourly = data["hourly"]
            tijden = [datetime.fromisoformat(t) for t in hourly["time"]]
            alle_wind  = haal_leden(hourly, "windspeed_10m")
            alle_stoot = haal_leden(hourly, "windgusts_10m")
            alle_dir   = haal_leden(hourly, "winddirection_10m")
            if alle_wind is not None:
                model_data[m["naam"]] = {
                    "tijden":     tijden,
                    "alle_wind":  alle_wind,
                    "alle_stoot": alle_stoot,
                    "alle_dir":   alle_dir,
                    "kleur":      m["kleur"],
                }
                print(f"    {alle_wind.shape[0]} leden × {alle_wind.shape[1]} stappen")
        except Exception as e:
            print(f"    FOUT: {e}")

    if not model_data:
        print("  Geen data"); continue

    ref_tijden = model_data.get("ECMWF ENS", list(model_data.values())[0])["tijden"]
    x_ref = np.arange(len(ref_tijden))

    tick_pos, tick_lbl, vorige_dag = [], [], None
    for i, t in enumerate(ref_tijden):
        dag = t.date()
        if dag != vorige_dag:
            tick_pos.append(i)
            tick_lbl.append(f"{nl_dagen[dag.weekday()]}\n{dag.day} {nl_maanden[dag.month]}")
            vorige_dag = dag

    # Y-max
    y_max = max(float(np.max(md["alle_stoot"] if md["alle_stoot"] is not None else md["alle_wind"])) for md in model_data.values()) * 1.1
    y_max = max(y_max, 40)

    # Figuur
    fig = plt.figure(figsize=(16, 18))
    gs  = gridspec.GridSpec(4, 1, figure=fig,
                            height_ratios=[0.08, 1, 1, 1],
                            hspace=0.18)

    # Header
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#003366",zorder=0,clip_on=False))
    ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=13,color="white",
              weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.18,f"ECMWF ENS · ICON-EPS · GFS ENS · {bereken_runtime()}",
              fontsize=8,color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.62,f"Multi-model wind pluim – {station}",
              fontsize=15,color="white",weight="bold",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.18,f"run: {now_str}",fontsize=8,color="#a8c8e8",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=2)

    for pi, (model_naam, md) in enumerate(model_data.items()):
        ax = fig.add_subplot(gs[pi+1])
        maak_paneel(ax)

        tijden_m   = md["tijden"]
        alle_wind  = md["alle_wind"]
        alle_stoot = md["alle_stoot"]
        alle_dir   = md["alle_dir"]
        kleur      = md["kleur"]
        x_m        = np.arange(len(tijden_m))
        med_wind   = np.median(alle_wind,  axis=0)
        med_stoot  = np.median(alle_stoot, axis=0) if alle_stoot is not None else None

        # Windrichting mediaan (circulair)
        if alle_dir is not None:
            rad = np.deg2rad(alle_dir)
            med_dir = np.rad2deg(np.arctan2(
                np.median(np.sin(rad), axis=0),
                np.median(np.cos(rad), axis=0))) % 360
        else:
            med_dir = None

        # Alle windleden
        for lid in alle_wind:
            ax.plot(x_m, lid, color=kleur, linewidth=0.6, alpha=0.35, zorder=2)

        # 25-75% spreiding
        ax.fill_between(x_m,
                        np.percentile(alle_wind, 25, axis=0),
                        np.percentile(alle_wind, 75, axis=0),
                        color=kleur, alpha=0.2, zorder=3)

        # Wind mediaan
        ax.plot(x_m, med_wind, color=kleur, linewidth=2.5, zorder=6,
                path_effects=[__import__('matplotlib.patheffects', fromlist=['withStroke'])
                               .withStroke(linewidth=4, foreground='white')])

        # Windstoten mediaan
        if med_stoot is not None: ax.plot(x_m, med_stoot, color="#cc2200", linewidth=1.8,
                linestyle="--", zorder=5, alpha=0.85)

        # Windrichtingspijltjes elke 6 uur
        if med_dir is not None:
            for i in range(0, len(x_m), 6):
                if i >= len(med_wind): break
                rad = math.radians(med_dir[i])
                ms_val = med_wind[i]
                ax.annotate("",
                    xy=(i - math.sin(rad)*1.2, ms_val - math.cos(rad)*1.5),
                    xytext=(i, ms_val),
                    arrowprops=dict(arrowstyle="-|>", color="#003366",
                                    lw=1.8, mutation_scale=14),
                    zorder=7)

        # Bft referentielijnen
        for bft_val, bft_nr in zip(BFT_KMH[1:], range(1,13)):
            if bft_val > y_max: break
            ax.axhline(bft_val, color="#dddddd", linewidth=0.5,
                       linestyle="--", zorder=1)
            ax.text(len(x_ref)-0.5, bft_val+0.3, f"Bft {bft_nr}",
                    fontsize=6, color="#aaaaaa", ha="right", va="bottom")

        ax.set_ylim(0, y_max)
        ax.set_ylabel("Windsnelheid (km/u)", fontsize=9, color="#444444")
        ax.tick_params(axis="y", labelsize=8.5, colors="#444444")

        ax.set_xticks(tick_pos)
        if pi == len(model_data) - 1:
            ax.set_xticklabels(tick_lbl, fontsize=8.5, color="#444444")
        else:
            ax.set_xticklabels([])
        ax.set_xlim(0, len(x_ref)-1)
        for tp in tick_pos:
            ax.axvline(tp, color="#dddddd", linewidth=0.7, zorder=1)

        n_leden = alle_wind.shape[0]
        dagen   = len(tijden_m) // 24
        ax.set_title(f"{model_naam} · {n_leden} leden · {dagen} dagen",
                     fontsize=10, color="#333333", loc="left", pad=5, fontweight="bold")

        leg = [
            Line2D([0],[0], color=kleur, lw=1, alpha=0.5, label=f"Wind leden ({n_leden})"),
            Line2D([0],[0], color=kleur, lw=2.5, label="Wind mediaan"),
            Line2D([0],[0], color="#cc2200", lw=1.8, linestyle="--", label="Stoten mediaan"),
            Line2D([0],[0], color="#003366", lw=0, marker=">", markersize=6, label="Windrichting"),
        ]
        ax.legend(handles=leg, loc="upper right", fontsize=7.5,
                  framealpha=0.9, edgecolor="#cccccc", ncol=4)

    fig.text(0.98, 0.01, f"© Ed Aldus | Data: ECMWF/ICON/GFS via Open-Meteo | {now_str}",
             fontsize=7, style="italic", ha="right", va="bottom", color="#555555")

    naam_clean = station.lower().replace(" ","_").replace(".","")
    fname = f"kaart_pluim_multi_wind_{naam_clean}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight", pad_inches=0.3)
    plt.close()
    print(f"  Opgeslagen: {fname}")

print("\nKlaar!")
