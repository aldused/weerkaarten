"""
maak_pluim_multimodel.py — Multi-model ensemble pluim
3 panelen: ECMWF ENS / ICON-EPS / GEFS
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
    {"naam": "ECMWF ENS",  "model": "ecmwf_ifs025", "api": "ensemble", "kleur": "#27ae60", "days": 16},
    {"naam": "ICON-EPS",   "model": "icon_seamless", "api": "ensemble", "kleur": "#2980b9", "days": 7},
    {"naam": "GFS ENS",    "model": "gfs025",        "api": "ensemble", "kleur": "#e67e22", "days": 16},
]

def haal_ensemble(lat, lon, model, api, days):
    base = "https://ensemble-api.open-meteo.com/v1/ensemble" if api == "ensemble" else "https://api.open-meteo.com/v1/forecast"
    url = (f"{base}?latitude={lat}&longitude={lon}"
           f"&hourly=temperature_2m&models={model}"
           f"&timezone=Europe/Amsterdam&forecast_days={days}")
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

def haal_hres(lat, lon):
    url = (f"https://api.open-meteo.com/v1/forecast"
           f"?latitude={lat}&longitude={lon}"
           f"&hourly=temperature_2m&models=ecmwf_ifs"
           f"&timezone=Europe/Amsterdam&forecast_days=16")
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

def haal_leden(hourly):
    leden = []
    for key, vals in hourly.items():
        if key.startswith("temperature_2m_member") or key == "temperature_2m":
            leden.append(np.array(vals, dtype=float))
    return np.vstack(leden) if leden else None

def maak_paneel(ax):
    ax.set_facecolor("#f8f9fa")
    ax.grid(axis="y", color="#e0e0e0", linewidth=0.6, zorder=0)
    ax.grid(axis="x", color="#eeeeee", linewidth=0.4, zorder=0)
    for spine in ["top","right"]: ax.spines[spine].set_visible(False)

for station, (s_lon, s_lat) in STATIONS.items():
    print(f"\nMultimodel pluim: {station}...")

    # Data ophalen per model
    model_data = {}
    for m in MODELLEN:
        print(f"  {m['naam']}...")
        try:
            data = haal_ensemble(s_lat, s_lon, m["model"], m["api"], m["days"])
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

    # HRES
    hres_lijn = None
    try:
        hres = haal_hres(s_lat, s_lon)
        hres_dict = dict(zip(hres["hourly"]["time"], hres["hourly"]["temperature_2m"]))
    except:
        hres_dict = {}

    if not model_data:
        print("  Geen data beschikbaar"); continue

    # Gemeenschappelijke tijdas (ECMWF = langst)
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

    # HRES lijn op ref tijdas
    hres_lijn = np.array([hres_dict.get(t.strftime("%Y-%m-%dT%H:%M"), np.nan)
                          for t in ref_tijden])

    # Y-bereik bepalen (zelfde voor alle panelen)
    alle_vals = []
    for md in model_data.values():
        alle_vals.extend(md["alle"].flatten().tolist())
    alle_vals = [v for v in alle_vals if not np.isnan(v)]
    y_min = min(alle_vals) - 1
    y_max = max(alle_vals) + 1

    # ── Figuur: header + 3 panelen ──
    fig = plt.figure(figsize=(16, 18))
    gs  = gridspec.GridSpec(4, 1, figure=fig,
                            height_ratios=[0.08, 1, 1, 1],
                            hspace=0.14)

    # Header
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#003366",zorder=0,clip_on=False))
    ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=13,color="white",
              weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.18,f"ECMWF ENS · ICON-EPS · GFS ENS · {bereken_runtime()}",
              fontsize=8,color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.62,f"Multi-model ensemble pluim – {station}",
              fontsize=15,color="white",weight="bold",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.18,f"run: {now_str}",fontsize=8,color="#a8c8e8",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=2)

    # ── Panelen ──
    for pi, (model_naam, md) in enumerate(model_data.items()):
        ax = fig.add_subplot(gs[pi+1])
        maak_paneel(ax)

        tijden_m = md["tijden"]
        alle_m   = md["alle"]
        kleur    = md["kleur"]
        x_m      = np.arange(len(tijden_m))
        med_m    = np.median(alle_m, axis=0)

        # Alle leden
        for lid in alle_m:
            ax.plot(x_m, lid, color=kleur, linewidth=0.6, alpha=0.35, zorder=2)

        # Mediaan
        ax.plot(x_m, med_m, color=kleur, linewidth=2.5, zorder=5,
                path_effects=[__import__('matplotlib.patheffects', fromlist=['withStroke'])
                               .withStroke(linewidth=4, foreground='white')])

        # HRES altijd op ref tijdas
        if pi == 0 and hres_lijn is not None and not np.all(np.isnan(hres_lijn.astype(float))):
            ax.plot(x_ref, hres_lijn, color="#003366", linewidth=2.0,
                    zorder=6, label="HRES")

        ax.axhline(0, color="#444444", linewidth=0.7, linestyle=":", zorder=8)

        # X-as
        ax.set_xticks(tick_pos)
        if pi == len(model_data) - 1:
            ax.set_xticklabels(tick_lbl, fontsize=8.5, color="#444444")
        else:
            ax.set_xticklabels([])
        ax.set_xlim(0, len(x_ref)-1)
        for tp in tick_pos:
            ax.axvline(tp, color="#dddddd", linewidth=0.7, zorder=1)

        ax.set_ylim(y_min, y_max)
        ax.set_ylabel("Temperatuur (°C)", fontsize=9, color="#444444")
        ax.tick_params(axis="y", labelsize=8.5, colors="#444444")
        import matplotlib.ticker as ticker
        ax.yaxis.set_major_locator(ticker.MultipleLocator(2.5))

        # Titel paneel
        n_leden = alle_m.shape[0]
        dagen   = len(tijden_m) // 24
        ax.set_title(f"{model_naam} · {n_leden} leden · {dagen} dagen",
                     fontsize=10, color="#333333", loc="left",
                     pad=5, fontweight="bold")

        # Legenda
        leg = [Line2D([0],[0], color=kleur, lw=1.2, alpha=0.6,
                      label=f"Ensemble leden ({n_leden})"),
               Line2D([0],[0], color=kleur, lw=2.5, label="Mediaan")]
        if pi == 0:
            leg.append(Line2D([0],[0], color="#003366", lw=2.0, label="HRES"))
        ax.legend(handles=leg, loc="upper right", fontsize=8,
                  framealpha=0.9, edgecolor="#cccccc", ncol=3)

    # Copyright
    fig.text(0.98, 0.01, f"© Ed Aldus | Data: ECMWF/ICON/GFS via Open-Meteo | {now_str}",
             fontsize=7, style="italic", ha="right", va="bottom", color="#555555")

    naam_clean = station.lower().replace(" ","_").replace(".","")
    fname = f"kaart_pluim_multi_{naam_clean}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight", pad_inches=0.3)
    plt.close()
    print(f"  Opgeslagen: {fname}")

print("\nKlaar!")
