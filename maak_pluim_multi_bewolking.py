"""
maak_pluim_multi_bewolking_stapel.py — Multi-model gestapeld bewolkingsdiagram
3 panelen: ECMWF ENS / ICON-EPS / GFS ENS
"""
import os, requests, numpy as np
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import matplotlib.patches as mpatches

os.chdir(os.path.dirname(os.path.abspath(__file__)))

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
    {"naam": "ECMWF ENS", "model": "ecmwf_ifs025", "days": 16},
    {"naam": "ICON-EPS",  "model": "icon_seamless", "days": 7},
    {"naam": "GFS ENS",   "model": "gfs025",        "days": 16},
]

CATEGORIEEN = [
    ("Onbewolkt",       0,  10,  "#FFFAAA"),
    ("Licht bewolkt",  10,  30,  "#FFD080"),
    ("Half bewolkt",   30,  70,  "#C8C8C8"),
    ("Zwaar bewolkt",  70,  90,  "#909090"),
    ("Geheel bewolkt", 90, 101,  "#505050"),
]

def haal_ensemble(lat, lon, model, days):
    url = (f"https://ensemble-api.open-meteo.com/v1/ensemble"
           f"?latitude={lat}&longitude={lon}"
           f"&hourly=cloudcover&models={model}"
           f"&timezone=Europe/Amsterdam&forecast_days={days}")
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

def haal_leden(hourly):
    leden = []
    for key, vals in hourly.items():
        if key.startswith("cloudcover_member") or key == "cloudcover":
            leden.append(np.array(vals, dtype=float))
    return np.vstack(leden) if leden else None

for station, (s_lon, s_lat) in STATIONS.items():
    print(f"\nMulti bewolking: {station}...")

    model_data = {}
    for m in MODELLEN:
        print(f"  {m['naam']}...")
        try:
            data   = haal_ensemble(s_lat, s_lon, m["model"], m["days"])
            hourly = data["hourly"]
            tijden = [datetime.fromisoformat(t) for t in hourly["time"]]
            alle   = haal_leden(hourly)
            if alle is not None:
                model_data[m["naam"]] = {"tijden": tijden, "alle": alle}
                print(f"    {alle.shape[0]} leden")
        except Exception as e:
            print(f"    FOUT: {e}")

    if not model_data: continue

    # Ref tijdas = ECMWF (langste)
    ref_tijden = model_data.get("ECMWF ENS", list(model_data.values())[0])["tijden"]

    # Daglabels
    tick_pos, tick_lbl, vorige_dag = [], [], None
    for i, t in enumerate(ref_tijden):
        dag = t.date()
        if dag != vorige_dag:
            tick_pos.append(i)
            tick_lbl.append(f"{nl_dagen[dag.weekday()]}\n{dag.day} {nl_maanden[dag.month]}")
            vorige_dag = dag

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
    ax_h.text(0.988,0.62,f"Multi-model bewolking pluim – {station}",
              fontsize=15,color="white",weight="bold",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.18,f"run: {now_str}",fontsize=8,color="#a8c8e8",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=2)

    for pi, (model_naam, md) in enumerate(model_data.items()):
        ax = fig.add_subplot(gs[pi+1])
        ax.set_facecolor("#f8f9fa")

        tijden_m = md["tijden"]
        alle_m   = md["alle"]
        n_leden  = alle_m.shape[0]
        x_m      = np.arange(len(tijden_m))

        # Stapels per categorie
        onderkant = np.zeros(len(tijden_m))
        for naam, low, high, kleur in CATEGORIEEN:
            pct = np.sum((alle_m >= low) & (alle_m < high), axis=0) / n_leden * 100
            ax.bar(x_m, pct, bottom=onderkant, color=kleur, width=1.0, linewidth=0, zorder=3)
            onderkant += pct

        # Daglijnen
        for tp in tick_pos:
            if tp < len(x_m):
                ax.axvline(tp, color="white", linewidth=0.8, zorder=4)

        ax.set_xlim(0, len(ref_tijden))
        ax.set_ylim(0, 100)
        ax.set_xticks(tick_pos)
        if pi == len(model_data) - 1:
            ax.set_xticklabels(tick_lbl, fontsize=8.5, color="#444444")
        else:
            ax.set_xticklabels([])
        ax.set_ylabel("Kans (%)", fontsize=9, color="#444444")
        ax.tick_params(axis="y", labelsize=8.5, colors="#444444")

        # Rechter Y-as
        ax2 = ax.twinx()
        ax2.set_ylim(0, 100)
        ax2.tick_params(axis="y", labelsize=8.5, colors="#444444")
        ax2.set_xlim(0, len(ref_tijden))

        dagen = len(tijden_m) // 24
        ax.set_title(f"{model_naam} · {n_leden} leden · {dagen} dagen",
                     fontsize=10, color="#333333", loc="left", pad=5, fontweight="bold")

        # Legenda alleen bij laatste paneel
        if pi == len(model_data) - 1:
            legenda = [mpatches.Patch(facecolor=k, label=n, edgecolor="#aaaaaa", linewidth=0.5)
                       for n, _, _, k in CATEGORIEEN]
            ax.legend(handles=legenda, loc="lower center", ncol=5,
                      fontsize=8.5, framealpha=0.95, edgecolor="#cccccc",
                      bbox_to_anchor=(0.5, -0.16))

    fig.text(0.98, 0.01, f"© Ed Aldus | Data: ECMWF/ICON/GFS via Open-Meteo | {now_str}",
             fontsize=7, style="italic", ha="right", va="bottom", color="#555555")

    naam_clean = station.lower().replace(" ","_").replace(".","")
    fname = f"kaart_pluim_multi_bewolking_{naam_clean}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight", pad_inches=0.3)
    plt.close()
    print(f"  Opgeslagen: {fname}")

print("\nKlaar!")
