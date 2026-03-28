"""
maak_waarnemingen_kaarten.py

Maakt 5 kaarten per dag op basis van de toplijst.json (werkelijke KNMI-metingen):
- kaart_obs_tx_*.png  → maximumtemperatuur
- kaart_obs_tn_*.png  → minimumtemperatuur
- kaart_obs_rr_*.png  → neerslag
- kaart_obs_fx_*.png  → max windstoot
- kaart_obs_ff_*.png  → hoogste uurgemiddelde wind
"""

import os, json, sys
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import matplotlib.gridspec as gridspec
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import numpy as np
from datetime import datetime, date

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# ── Coördinaten 43 KNMI stations ─────────────────────────────────────────────
COORDS = {
    "Voorschoten":         (4.447, 52.125),
    "IJmuiden":            (4.555, 52.458),
    "Texelhors":           (4.862, 52.982),
    "Den Helder":          (4.789, 52.928),
    "Schiphol":            (4.781, 52.309),
    "Vlieland":            (4.920, 53.250),
    "Wijdenes":            (5.166, 52.632),
    "Berkhout":            (4.979, 52.644),
    "Terschelling":        (5.350, 53.392),
    "Wijk aan Zee":        (4.601, 52.504),
    "Houtribdijk":         (5.385, 52.649),
    "De Bilt":             (5.178, 52.101),
    "Soesterberg":         (5.276, 52.128),
    "Stavoren":            (5.362, 52.882),
    "Lelystad":            (5.521, 52.458),
    "Leeuwarden":          (5.774, 53.224),
    "Marknesse":           (5.888, 52.703),
    "Deelen":              (5.885, 52.060),
    "Lauwersoog":          (6.201, 53.413),
    "Heino":               (6.261, 52.439),
    "Hoogeveen":           (6.520, 52.730),
    "Eelde":               (6.586, 53.123),
    "Hupsel":              (6.657, 52.069),
    "Nieuw Beerta":        (7.150, 53.197),
    "Twenthe":             (6.889, 52.275),
    "Vlissingen":          (3.596, 51.442),
    "Westdorpe":           (3.861, 51.226),
    "Wilhelminadorp":      (3.804, 51.490),  # display offset
    "Stavenisse":          (4.001, 51.634),  # display offset
    "Hoek van Holland":    (4.131, 51.978),
    "Tholen":              (4.169, 51.571),  # display offset
    "Woensdrecht":         (4.382, 51.409),  # display offset
    "Rotterdam Geulhaven": (4.255, 51.863),  # display offset
    "Rotterdam Airport":   (4.467, 51.987),  # display offset
    "Cabauw":              (4.926, 51.971),
    "Gilze-Rijen":         (4.931, 51.567),
    "Herwijnen":           (5.146, 51.859),
    "Eindhoven":           (5.377, 51.451),
    "Volkel":              (5.707, 51.657),
    "Ell":                 (5.763, 51.198),
    "Maastricht":          (5.770, 50.911),
    "Arcen":               (6.196, 51.500),
    "Horst":               (6.029, 51.449),
}

EXTENT = [3.3, 7.4, 50.45, 53.8]

nl_dagen   = ["Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag","Zondag"]
nl_maanden = ["","Januari","Februari","Maart","April","Mei","Juni",
               "Juli","Augustus","September","Oktober","November","December"]

# ── Kleurenschalen ────────────────────────────────────────────────────────────
cmap_tx   = mcolors.LinearSegmentedColormap.from_list("tx",   ["#084594","#4292c6","#9ecae1","#ffffcc","#fed976","#fd8d3c","#e31a1c","#800026"])
cmap_tn   = mcolors.LinearSegmentedColormap.from_list("tn",   ["#1a3a6b","#2980b9","#a8d8ea","#e8f4f8","#ffffcc","#fed976","#fd8d3c"])
cmap_t10n = mcolors.LinearSegmentedColormap.from_list("t10n", ["#1a3a6b","#2980b9","#a8d8ea","#e8f4f8","#c8e6c9","#81c784","#388e3c"])
cmap_rr   = mcolors.LinearSegmentedColormap.from_list("rr",   ["#ffffff","#c6dbef","#6baed6","#2171b5","#084594"])
cmap_fx   = mcolors.LinearSegmentedColormap.from_list("fx",   ["#ffffb2","#fecc5c","#fd8d3c","#f03b20","#bd0026"])
cmap_ff   = mcolors.LinearSegmentedColormap.from_list("ff",   ["#ffffb2","#fecc5c","#fd8d3c","#f03b20","#bd0026"])

norm_tx   = mcolors.Normalize(vmin=-5,  vmax=30)
norm_tn   = mcolors.Normalize(vmin=-15, vmax=20)
norm_t10n = mcolors.Normalize(vmin=-15, vmax=15)
norm_rr   = mcolors.Normalize(vmin=0,   vmax=30)
norm_fx   = mcolors.Normalize(vmin=0,   vmax=40)
norm_ff   = mcolors.Normalize(vmin=0,   vmax=20)



# ── Helpers ───────────────────────────────────────────────────────────────────
def maak_kaart_base(fig, gs, dag_nl, day, now_str, titel):
    # Header
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,facecolor="#003366",zorder=0,clip_on=False))
    maand_nl = nl_maanden[day.month]
    ax_h.text(0.012,0.58,"Ed Aldus WM",fontsize=11,color="white",weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.18,"Waarnemingen KNMI",fontsize=7.5,color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.62,f"{dag_nl} {day.day} {maand_nl}",fontsize=13,color="white",weight="bold",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.18,f"{titel}  ·  {now_str}",fontsize=7,color="#a8c8e8",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=1.5)

    # Kaart
    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_aspect('auto')
    ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),facecolor="#c8e0f0",zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),facecolor="#eaf3e8",zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),facecolor="#c8e0f0",zorder=2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"),edgecolor="#89b8d4",linewidth=0.5,zorder=3)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#333333",linewidth=0.7,zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),edgecolor="#666666",linewidth=0.6,linestyle="--",zorder=4)
    return ax

def teken_station(ax, lon, lat, tekst, kleur, tekstkleur="white", fontsize=9.5):
    ax.text(lon, lat, tekst, ha="center", va="center",
            fontsize=fontsize, weight="bold", color=tekstkleur, zorder=8,
            transform=ccrs.PlateCarree(),
            bbox=dict(boxstyle="round,pad=0.14", facecolor=kleur, edgecolor="none", zorder=7))

def teken_logo(ax):
    if logo_img is not None:
        newax = ax.inset_axes([0.01, 0.01, 0.14, 0.14])
        newax.imshow(logo_img)
        newax.axis("off")

def tekstkleur(kleur_rgba):
    r, g, b = kleur_rgba[:3]
    lum = 0.299*r + 0.587*g + 0.114*b
    return "white" if lum < 0.55 else "black"

def bronvermelding(ax, now_str2):
    ax.text(1.0, 0.0, f"© Ed Aldus | Data: KNMI | {now_str2}",
            transform=ax.transAxes, fontsize=6.5, style="italic",
            ha="right", va="bottom", color="#555555")

# ── Data laden ────────────────────────────────────────────────────────────────
with open("toplijst.json") as f:
    toplijst = json.load(f)

now_str  = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

# Verwerk alleen de laatste 10 dagen
# Argumenten: python3 maak_waarnemingen_kaarten.py [datum] [params]
# Bijv: python3 maak_waarnemingen_kaarten.py 2026-03-15 tx,tn
if len(sys.argv) > 1:
    alle_datums = [sys.argv[1]]
    print(f"Handmatige run voor: {sys.argv[1]}")
else:
    alle_datums = sorted(toplijst.keys())[-10:]

# Welke parameters maken
if len(sys.argv) > 2:
    MAAK_PARAMS = set(sys.argv[2].lower().split(","))
else:
    MAAK_PARAMS = {"tx","tn","t10n","rr","fx","ff"}

for datum_str in alle_datums:
    dag_data = toplijst[datum_str]
    try:
        d = date.fromisoformat(datum_str)
    except:
        continue
    dag_nl = nl_dagen[d.weekday()]
    fname_suffix = f"{dag_nl.lower()}_{d.strftime('%d%b%Y').lower()}"

    # Bouw lookup: naam → waarde
    tx_map   = {item[1]: item[0] for item in dag_data.get("max",  [])}
    tn_map   = {item[1]: item[0] for item in dag_data.get("min",  [])}
    t10n_map = {item[1]: item[0] for item in dag_data.get("t10n", [])}
    rr_map   = {item[1]: item[0] for item in dag_data.get("rr",   [])}
    fx_map   = {item[1]: item[0] for item in dag_data.get("fx",   [])}
    ff_map   = {item[1]: item[0] for item in dag_data.get("ff",   [])}

    print(f"Kaarten maken voor {datum_str}...")

    # ── TX kaart ──────────────────────────────────────────────────────────────
    if "tx" in MAAK_PARAMS:
        fig = plt.figure(figsize=(8,11))
        gs  = gridspec.GridSpec(2,1,figure=fig,height_ratios=[0.085,1],hspace=0.01)
        maak_kaart_base(fig, gs, dag_nl, d, now_str, "Maximumtemperatuur (°C)")
        ax  = fig.get_axes()[1]
        for naam, (lon, lat) in COORDS.items():
            if naam in tx_map:
                v = tx_map[naam]
                kleur = cmap_tx(norm_tx(v))
                teken_station(ax, lon, lat, f"{v:.1f}°", kleur, tekstkleur(kleur))
        bronvermelding(ax, now_str2)
        ax.set_extent(EXTENT, crs=ccrs.PlateCarree()); ax.axis("off")
        plt.savefig(f"kaart_obs_tx_{fname_suffix}.png", dpi=150, bbox_inches="tight"); plt.close()

    # ── TN kaart ──────────────────────────────────────────────────────────────
    if "tn" in MAAK_PARAMS:
        fig = plt.figure(figsize=(8,11))
        gs  = gridspec.GridSpec(2,1,figure=fig,height_ratios=[0.085,1],hspace=0.01)
        maak_kaart_base(fig, gs, dag_nl, d, now_str, "Minimumtemperatuur (°C)")
        ax  = fig.get_axes()[1]
        for naam, (lon, lat) in COORDS.items():
            if naam in tn_map:
                v = tn_map[naam]
                kleur = cmap_tn(norm_tn(v))
                teken_station(ax, lon, lat, f"{v:.1f}°", kleur, tekstkleur(kleur))
        bronvermelding(ax, now_str2)
        ax.set_extent(EXTENT, crs=ccrs.PlateCarree()); ax.axis("off")
        plt.savefig(f"kaart_obs_tn_{fname_suffix}.png", dpi=150, bbox_inches="tight"); plt.close()

    # ── T10N kaart ────────────────────────────────────────────────────────────
    if "t10n" in MAAK_PARAMS:
        fig = plt.figure(figsize=(8,11))
        gs  = gridspec.GridSpec(2,1,figure=fig,height_ratios=[0.085,1],hspace=0.01)
        maak_kaart_base(fig, gs, dag_nl, d, now_str, "Min temperatuur 10 cm (°C)")
        ax  = fig.get_axes()[1]
        for naam, (lon, lat) in COORDS.items():
            if naam in t10n_map:
                v = t10n_map[naam]
                kleur = cmap_t10n(norm_t10n(v))
                teken_station(ax, lon, lat, f"{v:.1f}°", kleur, tekstkleur(kleur))
        bronvermelding(ax, now_str2)
        ax.set_extent(EXTENT, crs=ccrs.PlateCarree()); ax.axis("off")
        plt.savefig(f"kaart_obs_t10n_{fname_suffix}.png", dpi=150, bbox_inches="tight"); plt.close()

    # ── RR kaart ──────────────────────────────────────────────────────────────
    if "rr" in MAAK_PARAMS:
        fig = plt.figure(figsize=(8,11))
        gs  = gridspec.GridSpec(2,1,figure=fig,height_ratios=[0.085,1],hspace=0.01)
        maak_kaart_base(fig, gs, dag_nl, d, now_str, "Neerslag (mm)")
        ax  = fig.get_axes()[1]
        for naam, (lon, lat) in COORDS.items():
            if naam in rr_map:
                v = rr_map[naam]
                kleur = cmap_rr(norm_rr(v))
                teken_station(ax, lon, lat, f"{v:.1f}", kleur, tekstkleur(kleur))
        bronvermelding(ax, now_str2)
        ax.set_extent(EXTENT, crs=ccrs.PlateCarree()); ax.axis("off")
        plt.savefig(f"kaart_obs_rr_{fname_suffix}.png", dpi=150, bbox_inches="tight"); plt.close()

    # ── FX kaart ──────────────────────────────────────────────────────────────
    if "fx" in MAAK_PARAMS:
        fig = plt.figure(figsize=(8,11))
        gs  = gridspec.GridSpec(2,1,figure=fig,height_ratios=[0.085,1],hspace=0.01)
        maak_kaart_base(fig, gs, dag_nl, d, now_str, "Max windstoot (m/s)")
        ax  = fig.get_axes()[1]
        for naam, (lon, lat) in COORDS.items():
            if naam in fx_map:
                v = fx_map[naam]
                kleur = cmap_fx(norm_fx(v))
                teken_station(ax, lon, lat, f"{v:.1f}", kleur, tekstkleur(kleur))
        bronvermelding(ax, now_str2)
        ax.set_extent(EXTENT, crs=ccrs.PlateCarree()); ax.axis("off")
        plt.savefig(f"kaart_obs_fx_{fname_suffix}.png", dpi=150, bbox_inches="tight"); plt.close()

    # ── FF kaart ──────────────────────────────────────────────────────────────
    if "ff" in MAAK_PARAMS:
        fig = plt.figure(figsize=(8,11))
        gs  = gridspec.GridSpec(2,1,figure=fig,height_ratios=[0.085,1],hspace=0.01)
        maak_kaart_base(fig, gs, dag_nl, d, now_str, "Hoogste uurgemiddelde wind (m/s)")
        ax  = fig.get_axes()[1]
        for naam, (lon, lat) in COORDS.items():
            if naam in ff_map:
                v = ff_map[naam]
                kleur = cmap_ff(norm_ff(v))
                teken_station(ax, lon, lat, f"{v:.1f}", kleur, tekstkleur(kleur))
        bronvermelding(ax, now_str2)
        ax.set_extent(EXTENT, crs=ccrs.PlateCarree()); ax.axis("off")
        plt.savefig(f"kaart_obs_ff_{fname_suffix}.png", dpi=150, bbox_inches="tight"); plt.close()

    print(f"  → klaar voor {datum_str}")

print("Alle waarnemingskaarten klaar!")
