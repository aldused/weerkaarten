"""
maak_pluim_multi_neerslag.py — Multi-model ensemble pluim neerslag
3 panelen: ECMWF ENS / ICON-EPS / GFS ENS
Per paneel: leden + mediaan + neerslagkans staafjes
"""
import os, requests, numpy as np
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
           f"&hourly=precipitation&models={model}"
           f"&timezone=Europe/Amsterdam&forecast_days={days}")
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

def haal_leden(hourly):
    leden = []
    for key, vals in hourly.items():
        if key.startswith("precipitation_member") or key == "precipitation":
            arr = np.array(vals, dtype=float)
            arr = np.where(np.isnan(arr), 0, arr)
            leden.append(arr)
    return np.vstack(leden) if leden else None

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
    print(f"\nMultimodel neerslag: {station}...")

    model_data = {}
    for m in MODELLEN:
        print(f"  {m['naam']}...")
        try:
            data   = haal_ensemble(s_lat, s_lon, m["model"], m["days"])
            hourly = data["hourly"]
            tijden = [datetime.fromisoformat(t) for t in hourly["time"]]
            alle   = haal_leden(hourly)
            if alle is not None:
                model_data[m["naam"]] = {
                    "tijden": tijden,
                    "alle":   alle,
                    "kleur":  m["kleur"],
                }
                print(f"    {alle.shape[0]} leden × {alle.shape[1]} stappen")
        except Exception as e:
            print(f"    FOUT: {e}")

    if not model_data:
        print("  Geen data"); continue

    # Ref tijdas = langste (ECMWF)
    ref_tijden = model_data.get("ECMWF ENS", list(model_data.values())[0])["tijden"]
    x_ref = np.arange(len(ref_tijden))

    # Daglabels
    tick_pos, tick_lbl, vorige_dag = [], [], None
    for i, t in enumerate(ref_tijden):
        dag = t.date()
        if dag != vorige_dag:
            tick_pos.append(i)
            tick_lbl.append(f"{nl_dagen[dag.weekday()]}\n{dag.day} {nl_maanden[dag.month]}")
            vorige_dag = dag

    # Y-max bepalen
    y_max = max(
        float(np.max(md["alle"])) for md in model_data.values()
    ) * 1.15
    y_max = max(y_max, 1.0)

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
    ax_h.text(0.988,0.62,f"Multi-model neerslag pluim – {station}",
              fontsize=15,color="white",weight="bold",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.18,f"run: {now_str}",fontsize=8,color="#a8c8e8",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=2)

    # Panelen
    for pi, (model_naam, md) in enumerate(model_data.items()):
        ax = fig.add_subplot(gs[pi+1])
        maak_paneel(ax)

        tijden_m = md["tijden"]
        alle_m   = md["alle"]
        kleur    = md["kleur"]
        x_m      = np.arange(len(tijden_m))
        med_m    = np.median(alle_m, axis=0)
        kans_m   = np.sum(alle_m > 0.1, axis=0) / alle_m.shape[0] * 100

        # Alle leden
        for lid in alle_m:
            ax.plot(x_m, lid, color=kleur, linewidth=0.6, alpha=0.45, zorder=2)

        # Mediaan
        ax.plot(x_m, med_m, color=kleur, linewidth=2.2, zorder=5,
                path_effects=[__import__('matplotlib.patheffects', fromlist=['withStroke'])
                               .withStroke(linewidth=4, foreground='white')])

        ax.set_ylim(0, y_max)
        ax.set_ylabel("Neerslag (mm/u)", fontsize=9, color="#444444")
        ax.tick_params(axis="y", labelsize=8.5, colors="#444444")

        # Neerslagkans rechter Y-as
        ax2 = ax.twinx()
        ax2.bar(x_m, kans_m, color=[kans_kleur(k) for k in kans_m],
                width=1.0, alpha=0.35, zorder=1)
        ax2.set_ylim(0, 200)
        ax2.set_ylabel("Kans (%)", fontsize=8, color="#3584e4")
        ax2.tick_params(labelsize=7, colors="#3584e4")
        ax2.set_yticks([0,20,40,60,80,100])

        # X-as
        ax.set_xticks(tick_pos)
        if pi == len(model_data) - 1:
            ax.set_xticklabels(tick_lbl, fontsize=8.5, color="#444444")
        else:
            ax.set_xticklabels([])
        ax.set_xlim(0, len(x_ref)-1)
        ax2.set_xlim(0, len(x_ref)-1)
        for tp in tick_pos:
            ax.axvline(tp, color="#dddddd", linewidth=0.7, zorder=1)

        n_leden = alle_m.shape[0]
        dagen   = len(tijden_m) // 24
        ax.set_title(f"{model_naam} · {n_leden} leden · {dagen} dagen",
                     fontsize=10, color="#333333", loc="left", pad=5, fontweight="bold")

        leg = [
            Line2D([0],[0], color=kleur, lw=1, alpha=0.5, label=f"Ensemble leden ({n_leden})"),
            Line2D([0],[0], color=kleur, lw=2.2, label="Mediaan"),
            Patch(facecolor="#1a5fb4", alpha=0.5, label="Kans ≥80%"),
            Patch(facecolor="#62a0ea", alpha=0.5, label="Kans 40–60%"),
            Patch(facecolor="#ddeeff", alpha=0.5, label="Kans <20%"),
        ]
        ax.legend(handles=leg, loc="upper right", fontsize=7.5,
                  framealpha=0.9, edgecolor="#cccccc", ncol=5)

    fig.text(0.98, 0.01, f"© Ed Aldus | Data: ECMWF/ICON/GFS via Open-Meteo | {now_str}",
             fontsize=7, style="italic", ha="right", va="bottom", color="#555555")

    naam_clean = station.lower().replace(" ","_").replace(".","")
    fname = f"kaart_pluim_multi_neerslag_{naam_clean}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight", pad_inches=0.3)
    plt.close()
    print(f"  Opgeslagen: {fname}")

print("\nKlaar!")
