"""
maak_pluim_bewolking_stapel.py — Gestapeld ensemble bewolkingsdiagram
Per tijdstap: % leden per bewolkingscategorie (zoals KNMI/Weerplaza)
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

# Bewolkingscategorieën (grenzen in %)
CATEGORIEEN = [
    ("Onbewolkt",      0,  10,  "#FFFAAA"),  # geel
    ("Licht bewolkt", 10,  30,  "#FFD080"),  # licht oranje
    ("Half bewolkt",  30,  70,  "#C8C8C8"),  # lichtgrijs
    ("Zwaar bewolkt", 70,  90,  "#909090"),  # grijs
    ("Geheel bewolkt",90, 101,  "#505050"),  # donkergrijs
]

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
    print(f"Bewolking stapel: {station}...")
    try:
        data = haal_ensemble(s_lat, s_lon)
    except Exception as e:
        print(f"  FOUT: {e}"); continue

    hourly = data["hourly"]
    tijden = [datetime.fromisoformat(t) for t in hourly["time"]]

    # Alle ensemble leden
    leden = []
    for key, vals in hourly.items():
        if key.startswith("cloudcover_member") or key == "cloudcover":
            leden.append(np.array(vals, dtype=float))

    if not leden:
        print("  Geen data"); continue

    alle = np.vstack(leden)  # shape: (n_leden, n_tijden)
    n_leden = alle.shape[0]
    x = np.arange(len(tijden))

    # Per tijdstap: % leden per categorie
    stapels = []
    for _, low, high, _ in CATEGORIEEN:
        pct = np.sum((alle >= low) & (alle < high), axis=0) / n_leden * 100
        stapels.append(pct)

    # X-as daglabels
    tick_pos, tick_lbl, vorige_dag = [], [], None
    for i, t in enumerate(tijden):
        dag = t.date()
        if dag != vorige_dag:
            tick_pos.append(i)
            tick_lbl.append(f"{nl_dagen[dag.weekday()]}\n{dag.day} {nl_maanden[dag.month]}")
            vorige_dag = dag

    # Figuur
    fig = plt.figure(figsize=(16, 7))
    gs  = gridspec.GridSpec(2, 1, figure=fig, height_ratios=[0.10, 1], hspace=0.02)

    # Header
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#003366",zorder=0,clip_on=False))
    ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=11,color="white",
              weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.22,f"ECMWF ENS · {n_leden} leden · {bereken_runtime()}",
              fontsize=7.5,color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.62,f"Ensemble bewolking – {station}",
              fontsize=12,color="white",weight="bold",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.22,f"run: {now_str}",fontsize=7.5,color="#a8c8e8",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=1.5)

    # Gestapeld staafdiagram
    ax = fig.add_subplot(gs[1])
    ax.set_facecolor("#f8f9fa")

    onderkant = np.zeros(len(tijden))
    for (naam, low, high, kleur), pct in zip(CATEGORIEEN, stapels):
        ax.bar(x, pct, bottom=onderkant, color=kleur, width=1.0,
               linewidth=0, zorder=3)
        onderkant += pct

    # Verticale daglijnen
    for tp in tick_pos:
        ax.axvline(tp, color="white", linewidth=0.8, zorder=4)

    ax.set_xlim(0, len(x))
    ax.set_ylim(0, 100)
    ax.set_xticks(tick_pos)
    ax.set_xticklabels(tick_lbl, fontsize=8.5, color="#444444")
    ax.set_ylabel("Kans per categorie (%)", fontsize=9, color="#444444")
    ax.tick_params(axis="y", labelsize=8.5, colors="#444444")

    # Y-as rechts ook
    ax2 = ax.twinx()
    ax2.set_ylim(0, 100)
    ax2.tick_params(axis="y", labelsize=8.5, colors="#444444")

    for spine in ["top"]: ax.spines[spine].set_visible(False)

    # Legenda
    legenda = [mpatches.Patch(facecolor=k, label=n, edgecolor="#aaaaaa", linewidth=0.5)
               for n, _, _, k in CATEGORIEEN]
    ax.legend(handles=legenda, loc="lower center", ncol=5,
              fontsize=8.5, framealpha=0.95, edgecolor="#cccccc",
              bbox_to_anchor=(0.5, -0.14))

    ax.text(1.0, -0.18,
            f"© Ed Aldus | Data: ECMWF ENS via Open-Meteo | {now_str}",
            transform=ax.transAxes, fontsize=6.5, style="italic",
            ha="right", va="top", color="#555555")

    naam_clean = station.lower().replace(" ","_").replace(".","")
    fname = f"kaart_pluim_bewolking_stapel_{naam_clean}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight", pad_inches=0.2)
    plt.close()
    print(f"  Opgeslagen: {fname}")

print("\nKlaar!")
