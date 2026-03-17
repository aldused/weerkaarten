"""
maak_pluim_compleet.py — ECMWF ensemble pluim compleet
4 panelen: temperatuur, neerslag, bewolking, wind+stoten
"""
import os, requests, numpy as np, math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

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
    "De Bilt":      (5.18,  52.10),
    "Rotterdam":    (4.44,  51.96),
    "Barendrecht":  (4.534, 51.845),
    "Vlissingen":   (3.60,  51.44),
    "Eelde":        (6.59,  53.12),
    "Maastricht":   (5.77,  50.91),
}

def haal_ensemble(lat, lon):
    url = (
        "https://ensemble-api.open-meteo.com/v1/ensemble"
        f"?latitude={lat}&longitude={lon}"
        "&hourly=temperature_2m,precipitation,cloudcover,windspeed_10m,winddirection_10m,windgusts_10m"
        "&models=ecmwf_ifs025"
        "&wind_speed_unit=kmh"
        "&timezone=Europe/Amsterdam"
        "&forecast_days=16"
    )
    r = requests.get(url, timeout=40)
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

def leden(hourly, prefix):
    """Haal alle ensemble leden op voor een parameter."""
    result = []
    for key, vals in hourly.items():
        if key.startswith(f"{prefix}_member") or key == prefix:
            arr = np.array(vals, dtype=float)
            arr = np.where(np.isnan(arr), 0, arr)
            result.append(arr)
    return np.vstack(result) if result else None

def kans_kleur(k):
    if k >= 80: return "#1a5fb4"
    if k >= 60: return "#3584e4"
    if k >= 40: return "#62a0ea"
    if k >= 20: return "#99c1f1"
    return "#ddeeff"

def maak_paneel(ax):
    ax.set_facecolor("#f8f9fa")
    ax.grid(axis="y", color="#e0e0e0", linewidth=0.6, zorder=0)
    ax.grid(axis="x", color="#eeeeee", linewidth=0.4, zorder=0)
    for spine in ["top","right"]: ax.spines[spine].set_visible(False)

for station, (s_lon, s_lat) in STATIONS.items():
    print(f"\nPluim: {station}...")
    try:
        data  = haal_ensemble(s_lat, s_lon)
        hres  = haal_hres(s_lat, s_lon)
    except Exception as e:
        print(f"  FOUT: {e}"); continue

    hourly = data["hourly"]
    tijden = [datetime.fromisoformat(t) for t in hourly["time"]]
    x = np.arange(len(tijden))

    # Alle leden
    alle_temp  = leden(hourly, "temperature_2m")
    alle_rr    = leden(hourly, "precipitation")
    alle_wolk  = leden(hourly, "cloudcover")
    alle_wind  = leden(hourly, "windspeed_10m")
    alle_stoot = leden(hourly, "windgusts_10m")
    alle_dir   = leden(hourly, "winddirection_10m")

    # HRES temperatuur
    hres_dict = dict(zip(hres["hourly"]["time"],
                         hres["hourly"]["temperature_2m"]))
    hres_lijn = np.array([hres_dict.get(t.strftime("%Y-%m-%dT%H:%M"), np.nan)
                          for t in tijden])


    # Verwijder trailing nullen/NaN (Open-Meteo vult laatste uren met 0)
    laatste_geldig = len(tijden)
    for i in range(len(tijden)-1, 0, -1):
        if alle_temp[:,i].mean() != 0 and not np.isnan(alle_temp[:,i]).all():
            laatste_geldig = i + 1
            break
    tijden = tijden[:laatste_geldig]
    x = x[:laatste_geldig]
    alle_temp  = alle_temp[:, :laatste_geldig]
    alle_rr    = alle_rr[:,   :laatste_geldig]
    alle_wolk  = alle_wolk[:,  :laatste_geldig]
    alle_wind  = alle_wind[:,  :laatste_geldig]
    alle_stoot = alle_stoot[:, :laatste_geldig]
    alle_dir   = alle_dir[:,   :laatste_geldig]
    hres_lijn  = hres_lijn[:laatste_geldig]

    # Medianen
    med_temp  = np.median(alle_temp,  axis=0)
    med_rr    = np.median(alle_rr,    axis=0)
    med_wolk  = np.median(alle_wolk,  axis=0)
    med_wind  = np.median(alle_wind,  axis=0)
    med_stoot = np.median(alle_stoot, axis=0)

    # Windrichting mediaan (circulair)
    if alle_dir is not None:
        rad = np.deg2rad(alle_dir)
        med_dir = np.rad2deg(np.arctan2(
            np.median(np.sin(rad), axis=0),
            np.median(np.cos(rad), axis=0))) % 360
    else:
        med_dir = None

    # Neerslagkans
    kans_rr = np.sum(alle_rr > 0.1, axis=0) / alle_rr.shape[0] * 100

    # X-as daglabels
    tick_pos, tick_lbl, vorige_dag = [], [], None
    for i, t in enumerate(tijden):
        dag = t.date()
        if dag != vorige_dag:
            tick_pos.append(i)
            tick_lbl.append(f"{nl_dagen[dag.weekday()]}\n{dag.day} {nl_maanden[dag.month]}")
            vorige_dag = dag

    # ── Figuur ──
    fig = plt.figure(figsize=(16, 20))
    gs  = gridspec.GridSpec(5, 1, figure=fig,
                            height_ratios=[0.12, 1, 0.7, 0.7, 1],
                            hspace=0.14)

    # Header
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#003366",zorder=0,clip_on=False))
    ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=13,color="white",
              weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.18,f"ECMWF ENS · {alle_temp.shape[0]} leden · Open-Meteo",
              fontsize=8,color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.62,f"Ensemble pluim – {station}",
              fontsize=15,color="white",weight="bold",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.18,f"run: {now_str}  ·  {bereken_runtime()}",fontsize=8,color="#a8c8e8",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=2)


    def zet_nacht(ax):
        """Grijze achtergrond voor nachturen (22:00-06:00)."""
        for i, t in enumerate(tijden):
            if t.hour >= 22 or t.hour < 6:
                ax.axvspan(i-0.5, i+0.5, color="#f0f0f0", alpha=0.7, zorder=0)

    def zet_xticks(ax, labels=False):
        ax.set_xticks(tick_pos)
        if labels:
            ax.set_xticklabels(tick_lbl, fontsize=8, color="#444444")
        else:
            ax.set_xticklabels([])
        ax.set_xlim(0, len(x)-1)
        for tp in tick_pos:
            ax.axvline(tp, color="#dddddd", linewidth=0.7, zorder=1)

    # ── Paneel 1: Temperatuur ──
    ax1 = fig.add_subplot(gs[1])
    maak_paneel(ax1)
    zet_nacht(ax1)
    for lid in alle_temp:
        ax1.plot(x, lid, color="#4CAF50", linewidth=0.6, alpha=0.35, zorder=2)
    ax1.plot(x, med_temp,  color="#000000", linewidth=1.8, zorder=5, linestyle="--")
    ax1.plot(x, hres_lijn, color="#DD0000", linewidth=2.8, zorder=6, linestyle="-")
    ax1.axhline(0, color="#444444", linewidth=0.7, linestyle=":", zorder=5)
    ax1.set_ylabel("Temperatuur (°C)", fontsize=9, color="#444444")
    ax1.tick_params(labelsize=8, colors="#444444")
    ax1.set_title("Temperatuur 2m", fontsize=9, color="#333", loc="left", pad=3)
    import matplotlib.ticker as ticker
    ax1.yaxis.set_major_locator(ticker.MultipleLocator(2.5))
    zet_xticks(ax1)
    leg1 = [Line2D([0],[0],color="#4CAF50",lw=1,alpha=0.6,label=f"Verstoorde runs ({alle_temp.shape[0]})"),
            Line2D([0],[0],color="#000000",lw=1.8,linestyle="--",label="Mediaan (P50)"),
            Line2D([0],[0],color="#DD0000",lw=2.8,label="Hoge resolutie (HRES)")]
    ax1.legend(handles=leg1,loc="upper right",fontsize=7.5,framealpha=0.9,edgecolor="#ccc",ncol=3)

    # ── Paneel 2: Neerslag ──
    ax2 = fig.add_subplot(gs[2])
    maak_paneel(ax2)
    zet_nacht(ax2)
    for lid in alle_rr:
        ax2.plot(x, lid, color="#4CAF50", linewidth=0.5, alpha=0.35, zorder=2)
    ax2.plot(x, med_rr, color="#000000", linewidth=1.8, zorder=5, linestyle="--")
    ax2.set_ylabel("Neerslag (mm/u)", fontsize=9, color="#444444")
    ax2.tick_params(labelsize=8, colors="#444444")
    ax2.set_ylim(bottom=0)
    ax2.set_title("Neerslag", fontsize=9, color="#333", loc="left", pad=3)
    zet_xticks(ax2)
    # Neerslagkans als kleur op x-as
    ax2b = ax2.twinx()
    ax2b.bar(x, kans_rr, color=[kans_kleur(k) for k in kans_rr],
             width=1.0, alpha=0.4, zorder=1)
    ax2b.set_ylim(0,200); ax2b.set_ylabel("Kans (%)", fontsize=8, color="#3584e4")
    ax2b.tick_params(labelsize=7, colors="#3584e4")
    ax2b.set_yticks([0,20,40,60,80,100])

    # ── Paneel 3: Bewolking ──
    ax3 = fig.add_subplot(gs[3])
    maak_paneel(ax3)
    zet_nacht(ax3)
    for lid in alle_wolk:
        ax3.plot(x, lid, color="#4CAF50", linewidth=0.5, alpha=0.30, zorder=2)
    ax3.plot(x, med_wolk, color="#000000", linewidth=1.8, zorder=5, linestyle="--")
    ax3.set_ylabel("Bewolking (%)", fontsize=9, color="#444444")
    ax3.tick_params(labelsize=8, colors="#444444")
    ax3.set_ylim(0,105)
    ax3.set_title("Bewolkingsgraad", fontsize=9, color="#333", loc="left", pad=3)
    zet_xticks(ax3)

    # ── Paneel 4: Wind + stoten ──
    ax4 = fig.add_subplot(gs[4])
    maak_paneel(ax4)
    zet_nacht(ax4)
    for lid in alle_wind:
        ax4.plot(x, lid, color="#4CAF50", linewidth=0.5, alpha=0.30, zorder=2)
    ax4.fill_between(x, np.percentile(alle_wind,25,axis=0),
                        np.percentile(alle_wind,75,axis=0),
                        color="#2171b5", alpha=0.2, zorder=3)
    ax4.plot(x, med_wind,  color="#DD0000", linewidth=2.5, zorder=6, label="Wind mediaan")
    ax4.plot(x, med_stoot, color="#e67e22", linewidth=1.5, zorder=5,
             linestyle="--", label="Windstoot mediaan")

    # Windrichtingspijltjes elke 6 uur
    if med_dir is not None:
        for i in range(0, len(x), 6):
            rad = math.radians(med_dir[i])
            ms_val = med_wind[i]
            ax4.annotate("",
                xy=(i - math.sin(rad)*1.2, ms_val - math.cos(rad)*2),
                xytext=(i, ms_val),
                arrowprops=dict(arrowstyle="-|>", color="#003366",
                                lw=1.8, mutation_scale=16),
                zorder=7)

    # Bft referentielijnen (km/u)
    bft_kmh = [0,1.1,5.6,12.3,19.8,28.8,38.9,50.0,61.9,74.7,88.2,102.6,117.5]
    bft_lbl_v = [f"Bft {i}" for i in range(13)]
    ymax = max(np.max(med_stoot)*1.1, 30)
    for bft_val, bft_name in zip(bft_kmh[1:], bft_lbl_v[1:]):
        if bft_val > ymax: break
        ax4.axhline(bft_val, color="#dddddd", linewidth=0.5, linestyle="--", zorder=1)
        ax4.text(len(x)-0.5, bft_val+0.3, bft_name, fontsize=6,
                 color="#aaaaaa", ha="right", va="bottom")

    ax4.set_ylabel("Windsnelheid (km/u)", fontsize=9, color="#444444")
    ax4.tick_params(labelsize=8, colors="#444444")
    ax4.set_ylim(bottom=0)
    ax4.set_title("Wind 10m + windstoten", fontsize=9, color="#333", loc="left", pad=3)
    zet_xticks(ax4, labels=True)
    leg4 = [Line2D([0],[0],color="#27ae60",lw=1,alpha=0.6,label=f"ENS leden ({alle_wind.shape[0]})"),
            Line2D([0],[0],color="#cc2200",lw=2.5,label="Wind mediaan"),
            Line2D([0],[0],color="#e67e22",lw=1.5,linestyle="--",label="Windstoot mediaan"),
            Line2D([0],[0],color="#003366",lw=0,marker=">",markersize=6,label="Windrichting")]
    ax4.legend(handles=leg4,loc="upper right",fontsize=7.5,framealpha=0.9,edgecolor="#ccc",ncol=4)

    ax4.text(1.0, -0.02,
             f"© Ed Aldus | Data: ECMWF ENS via Open-Meteo | {now_str}",
             transform=ax4.transAxes, fontsize=7, style="italic",
             ha="right", va="top", color="#555555")

    plt.subplots_adjust(bottom=0.04)

    naam_clean = station.lower().replace(" ","_").replace(".","")
    fname = f"kaart_pluim_compleet_{naam_clean}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight", pad_inches=0.3)
    plt.close()
    print(f"  Opgeslagen: {fname}")

print("\nKlaar!")
