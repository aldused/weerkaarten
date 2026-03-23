"""
maak_toplijst_kaarten.py
Maakt 4 kaarten op basis van toplijst.json:
- vandaag:   kaart_top_tx_vandaag.png, kaart_top_tn_vandaag.png, kaart_top_rr_vandaag.png, kaart_top_fx_vandaag.png
- gisteren:  kaart_top_tx_gisteren.png, etc.
"""
import os, json
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import matplotlib.gridspec as gridspec
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from datetime import datetime, date, timedelta

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

COORDS = {
    "Voorschoten":         (4.447, 52.125), "IJmuiden":            (4.555, 52.458),
    "Texelhors":           (4.862, 52.982), "Den Helder":          (4.789, 52.928),
    "Schiphol":            (4.781, 52.309), "Vlieland":            (4.920, 53.250),
    "Wijdenes":            (5.166, 52.632), "Berkhout":            (4.979, 52.644),
    "Terschelling":        (5.350, 53.392), "Wijk aan Zee":        (4.601, 52.504),
    "Houtribdijk":         (5.385, 52.649), "De Bilt":             (5.178, 52.101),
    "Soesterberg":         (5.276, 52.128), "Stavoren":            (5.362, 52.882),
    "Lelystad":            (5.521, 52.458), "Leeuwarden":          (5.774, 53.224),
    "Marknesse":           (5.888, 52.703), "Deelen":              (5.885, 52.060),
    "Lauwersoog":          (6.201, 53.413), "Heino":               (6.261, 52.439),
    "Hoogeveen":           (6.520, 52.730), "Eelde":               (6.586, 53.123),
    "Hupsel":              (6.657, 52.069), "Nieuw Beerta":        (7.150, 53.197),
    "Twenthe":             (6.889, 52.275), "Vlissingen":          (3.596, 51.442),
    "Westdorpe":           (3.861, 51.226), "Wilhelminadorp":      (3.884, 51.527),
    "Stavenisse":          (4.001, 51.594), "Hoek van Holland":    (4.131, 51.978),
    "Tholen":              (4.219, 51.531), "Woensdrecht":         (4.342, 51.449),
    "Rotterdam Geulhaven": (4.320, 51.893), "Rotterdam Airport":   (4.437, 51.957),
    "Cabauw":              (4.926, 51.971), "Gilze-Rijen":         (4.931, 51.567),
    "Herwijnen":           (5.146, 51.859), "Eindhoven":           (5.377, 51.451),
    "Volkel":              (5.707, 51.657), "Ell":                 (5.763, 51.198),
    "Maastricht":          (5.770, 50.911), "Arcen":               (6.196, 51.500),
    "Horst":               (6.029, 51.449),
}

EXTENT = [3.3, 7.4, 50.45, 53.8]
NL_DAGEN   = ["Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag","Zondag"]
NL_MAANDEN = ["","jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"]

cmap_tx = mcolors.LinearSegmentedColormap.from_list("tx", ["#084594","#4292c6","#9ecae1","#ffffcc","#fed976","#fd8d3c","#e31a1c","#800026"])
cmap_tn = mcolors.LinearSegmentedColormap.from_list("tn", ["#1a3a6b","#2980b9","#a8d8ea","#e8f4f8","#ffffcc","#fed976","#fd8d3c"])
cmap_rr = mcolors.LinearSegmentedColormap.from_list("rr", ["#ffffff","#c6dbef","#6baed6","#2171b5","#084594"])
cmap_fx = mcolors.LinearSegmentedColormap.from_list("fx", ["#ffffb2","#fecc5c","#fd8d3c","#f03b20","#bd0026"])

norm_tx = mcolors.Normalize(vmin=-5, vmax=30)
norm_tn = mcolors.Normalize(vmin=-15, vmax=20)
norm_rr = mcolors.Normalize(vmin=0, vmax=30)
norm_fx = mcolors.Normalize(vmin=0, vmax=40)
cmap_sq = mcolors.LinearSegmentedColormap.from_list("sq", ["#ffffff","#fffacd","#ffe066","#ffa500","#ff6600"])
norm_sq = mcolors.Normalize(vmin=0, vmax=12)

def tekstkleur(rgba):
    r,g,b = rgba[:3]
    return "white" if 0.299*r + 0.587*g + 0.114*b < 0.55 else "black"

def maak_base(dag_label, subtitel, now_str):
    fig = plt.figure(figsize=(8, 11))
    gs  = gridspec.GridSpec(2, 1, figure=fig, height_ratios=[0.085, 1], hspace=0.01)
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,facecolor="#003366",zorder=0,clip_on=False))
    ax_h.text(0.012,0.58,"Ed Aldus WM",fontsize=11,color="white",weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.18,"Waarnemingen KNMI",fontsize=7.5,color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.62,dag_label,fontsize=13,color="white",weight="bold",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.18,f"{subtitel}  ·  {now_str}",fontsize=7,color="#a8c8e8",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=1.5)
    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_aspect('auto'); ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),    facecolor="#c8e0f0",zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),     facecolor="#eaf3e8",zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),    facecolor="#c8e0f0",zorder=2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"),   edgecolor="#89b8d4",linewidth=0.5,zorder=3)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#333333",linewidth=0.7,zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),  edgecolor="#666666",linewidth=0.6,linestyle="--",zorder=4)
    ax.axis("off")
    return fig, ax

def teken_station(ax, lon, lat, tekst, kleur, tijdstip=None):
    tk = tekstkleur(kleur)
    hoogte_offset = 0.025 if tijdstip else 0
    ax.text(lon, lat + hoogte_offset, tekst, ha="center", va="center",
            fontsize=9.5, weight="bold", color=tk, zorder=8,
            transform=ccrs.PlateCarree(),
            bbox=dict(boxstyle="round,pad=0.14", facecolor=kleur, edgecolor="none", zorder=7))
    if tijdstip:
        ax.text(lon, lat - 0.05, f"om {tijdstip}", ha="center", va="center",
                fontsize=6.5, color="#444", zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.08", facecolor="white", edgecolor="#cccccc", linewidth=0.5, zorder=7))

def bronvermelding(ax, now_str2):
    ax.text(1.0, 0.0, f"© Ed Aldus | Data: KNMI | {now_str2}",
            transform=ax.transAxes, fontsize=6.5, style="italic",
            ha="right", va="bottom", color="#555555")

def maak_kaarten_voor_dag(datum_str, fname_suffix, dag_label, dag_data, now_str, now_str2):
    print(f"Kaarten voor {datum_str} ({dag_label})...")

    # TX kaart
    fig, ax = maak_base(dag_label, "Maximum temperatuur (°C)", now_str)
    for item in dag_data.get("max", []):
        naam = item[1]; v = item[0]; tijdstip = item[2] if len(item) > 2 else None
        if naam in COORDS:
            lon, lat = COORDS[naam]
            kleur = cmap_tx(norm_tx(v))
            teken_station(ax, lon, lat, f"{v:.1f}°", kleur, tijdstip)
    bronvermelding(ax, now_str2)
    plt.savefig(f"kaart_top_tx_{fname_suffix}.png", dpi=150, bbox_inches="tight"); plt.close()

    # TN kaart
    fig, ax = maak_base(dag_label, "Minimum temperatuur (°C)", now_str)
    for item in dag_data.get("min", []):
        naam = item[1]; v = item[0]; tijdstip = item[2] if len(item) > 2 else None
        if naam in COORDS:
            lon, lat = COORDS[naam]
            kleur = cmap_tn(norm_tn(v))
            teken_station(ax, lon, lat, f"{v:.1f}°", kleur, tijdstip)
    bronvermelding(ax, now_str2)
    plt.savefig(f"kaart_top_tn_{fname_suffix}.png", dpi=150, bbox_inches="tight"); plt.close()

    # RR kaart
    fig, ax = maak_base(dag_label, "Neerslag (mm)", now_str)
    for item in dag_data.get("rr", []):
        naam = item[1]; v = item[0]
        if naam in COORDS and v > 0:
            lon, lat = COORDS[naam]
            kleur = cmap_rr(norm_rr(v))
            teken_station(ax, lon, lat, f"{v:.1f}", kleur)
    bronvermelding(ax, now_str2)
    plt.savefig(f"kaart_top_rr_{fname_suffix}.png", dpi=150, bbox_inches="tight"); plt.close()

    # FX kaart
    fig, ax = maak_base(dag_label, "Max windstoot (km/h)", now_str)
    for item in dag_data.get("fx", []):
        naam = item[1]; v = item[0]; tijdstip = item[2] if len(item) > 2 else None
        if naam in COORDS:
            lon, lat = COORDS[naam]
            v_kmh = v * 3.6
            kleur = cmap_fx(norm_fx(v))
            teken_station(ax, lon, lat, f"{v_kmh:.0f}", kleur, tijdstip)
    bronvermelding(ax, now_str2)
    plt.savefig(f"kaart_top_fx_{fname_suffix}.png", dpi=150, bbox_inches="tight"); plt.close()

    # SQ kaart (zonuren)
    fig, ax = maak_base(dag_label, "Zonneschijnduur (uur)", now_str)
    for item in dag_data.get("sq", []):
        naam = item[1]; v = item[0]
        if naam in COORDS and v > 0:
            lon, lat = COORDS[naam]
            kleur = cmap_sq(norm_sq(v))
            teken_station(ax, lon, lat, f"{v:.1f}", kleur)
    bronvermelding(ax, now_str2)
    plt.savefig(f"kaart_top_sq_{fname_suffix}.png", dpi=150, bbox_inches="tight"); plt.close()

    print(f"  → 5 kaarten klaar voor {datum_str}")

# Laden
with open("toplijst.json") as f:
    data = json.load(f)

now_str  = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

vandaag   = date.today()
gisteren  = vandaag - timedelta(days=1)

def dag_label(d):
    return f"{NL_DAGEN[d.weekday()]} {d.day} {NL_MAANDEN[d.month]}"

for d, suffix in [(vandaag, "vandaag"), (gisteren, "gisteren")]:
    key = d.isoformat()
    if key in data:
        maak_kaarten_voor_dag(key, suffix, dag_label(d), data[key], now_str, now_str2)
    else:
        print(f"Geen data voor {key}, overgeslagen")

print("Klaar!")
