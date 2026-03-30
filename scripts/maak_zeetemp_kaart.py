"""
maak_zeetemp_kaart.py
Zeewatertemperaturen Europa + ingezoomde Noordzee
Data: Open-Meteo Marine API (CMEMS)
"""
import os, glob, requests
from datetime import datetime
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import matplotlib.cm as cm
import matplotlib.patches as mpatches
import numpy as np
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from matplotlib.gridspec import GridSpec

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

STATIONS = [
    # Noordzee & Kanaal
    ("Terschelling",    53.35,  5.20),
    ("IJmuiden",        52.46,  4.55),
    ("Hoek v Holland",  51.98,  4.10),
    ("Vlissingen",      51.44,  3.60),
    ("Zeebrugge",       51.35,  3.18),
    ("Calais",          50.95,  1.85),
    ("Dunkerque",       51.03,  2.37),
    ("Cherbourg",       49.65, -1.62),
    ("Brest",           48.38, -4.49),
    ("Texel",           53.05,  4.75),
    ("Den Helder",      52.93,  4.75),
    ("Dover",           51.11,  1.32),
    ("Brighton",        50.82, -0.14),
    ("Felixstowe",      51.96,  1.35),
    ("Aberdeen",        57.14, -2.08),
    ("Bergen (NO)",     60.39,  5.33),
    ("Stavanger",       58.97,  5.73),
    ("Kristiansand",    58.15,  8.00),
    ("Göteborg",        57.70, 11.97),
    ("Esbjerg",         55.47,  8.45),
    ("Thyborøn",        56.70,  8.22),
    ("Skagen",          57.72, 10.58),
    # Baltische Zee
    ("Kopenhagen",      55.68, 12.57),
    ("Malmö",           55.60, 13.00),
    ("Kiel",            54.32, 10.13),
    ("Rostock",         54.15, 12.10),
    ("Gdańsk",          54.35, 18.65),
    ("Tallinn",         59.44, 24.75),
    ("Helsinki",        60.17, 24.94),
    ("Stockholm",       59.33, 18.07),
    ("Riga",            56.95, 24.11),
    ("Kaliningrad",     54.71, 20.51),
    # Atlantische kust
    ("Cork",            51.90, -8.47),
    ("Dublin",          53.33, -6.25),
    ("Galway",          53.27, -9.06),
    ("Blackpool",       53.82, -3.05),
    ("Bordeaux",        45.55, -1.07),
    ("Biarritz",        43.48, -1.56),
    ("San Sebastián",   43.32, -1.98),
    ("Santander",       43.46, -3.80),
    ("A Coruña",        43.37, -8.40),
    ("Vigo",            42.24, -8.72),
    ("Porto",           41.15, -8.67),
    ("Lissabon",        38.71, -9.14),
    ("Faro",            37.02, -7.93),
    ("Cádiz",           36.53, -6.30),
    # Middellandse Zee
    ("Gibraltar",       36.14, -5.35),
    ("Málaga",          36.72, -4.42),
    ("Alicante",        38.34, -0.48),
    ("Barcelona",       41.38,  2.18),
    ("Marseille",       43.30,  5.37),
    ("Genua",           44.41,  8.93),
    ("Napels",          40.84, 14.25),
    ("Palermo",         38.12, 13.36),
    ("Athene",          37.98, 23.73),
    ("Izmir",           38.42, 27.14),
    ("Istanbul",        41.01, 28.98),
    ("Venetië",         45.44, 12.32),
    ("Split",           43.51, 16.44),
    ("Dubrovnik",       42.65, 18.09),
    ("Valletta",        35.90, 14.51),
]

# Extra punten voor de Noordzee-inset (meer detail)
NOORDZEE_EXTRA = [
    ("Harlingen",       53.18,  5.41),
    ("Schiermonnikoog", 53.48,  6.19),
    ("Ameland",         53.45,  5.79),
    ("Katwijk",         52.20,  4.40),
    ("Cadzand",         51.37,  3.37),
    ("Oostende",        51.23,  2.92),
    ("Breskens",        51.40,  3.57),
    ("Boulogne",        50.72,  1.60),
    ("Le Havre",        49.49,  0.10),
    ("Dieppe",          49.93,  1.08),
    ("Lowestoft",       52.47,  1.75),
    ("Great Yarmouth",  52.61,  1.73),
    ("Humber",          53.65, -0.18),
    ("Newcastle",       55.00, -1.43),
    ("Edinburgh",       55.95, -3.19),
]

ALLE_STATIONS = STATIONS + NOORDZEE_EXTRA

nl_maanden = ["","Jan","Feb","Mrt","Apr","Mei","Jun",
               "Juli","Aug","Sep","Okt","Nov","Dec"]

# ── Data ophalen ──────────────────────────────────────────────────────────────
def haal_zeetemp(lat, lon):
    url = (f"https://marine-api.open-meteo.com/v1/marine"
           f"?latitude={lat}&longitude={lon}"
           f"&current=sea_surface_temperature"
           f"&timezone=Europe%2FAmsterdam")
    try:
        r = requests.get(url, timeout=15)
        r.raise_for_status()
        return r.json()["current"]["sea_surface_temperature"]
    except Exception as e:
        print(f"  x Fout ({lat},{lon}): {e}")
        return None

print(f"Zeewatertemperaturen ophalen voor {len(ALLE_STATIONS)} locaties...")
resultaten = {}
for naam, lat, lon in ALLE_STATIONS:
    print(f"  {naam}...", end=' ', flush=True)
    t = haal_zeetemp(lat, lon)
    print(f"{t:.1f}°C" if t is not None else "geen data")
    if t is not None:
        resultaten[(naam, lat, lon)] = t

print(f"\n{len(resultaten)}/{len(ALLE_STATIONS)} locaties opgehaald")
if not resultaten:
    print("Geen data!"); exit(1)

# ── Kaart opmaak helpers ──────────────────────────────────────────────────────
NORM = mcolors.Normalize(vmin=0, vmax=28)
CMAP = plt.cm.RdYlBu_r

def temp_kleur(t):
    return CMAP(NORM(t))

def tekst_kleur(t):
    return 'white' if t < 10 or t > 22 else '#111'

def teken_kaart(ax, extent, stations_data, fontsize=7.5, dot=False):
    ax.set_extent(extent, crs=ccrs.PlateCarree())
    ax.add_feature(cfeature.OCEAN.with_scale("50m"),     facecolor="#1a3a5a", zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("50m"),      facecolor="#2d3b4a", zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("50m"),     facecolor="#1a3a5a", zorder=2)
    ax.add_feature(cfeature.COASTLINE.with_scale("50m"), edgecolor="#6090b0", linewidth=0.7, zorder=3)
    ax.add_feature(cfeature.BORDERS.with_scale("50m"),   edgecolor="#445566", linewidth=0.4,
                   linestyle="--", zorder=3)
    for (naam, lat, lon), t in stations_data.items():
        if not (extent[0] <= lon <= extent[1] and extent[2] <= lat <= extent[3]):
            continue
        kleur = temp_kleur(t)
        tkleur = tekst_kleur(t)
        ax.text(lon, lat, f"{t:.1f}°", ha="center", va="center",
                fontsize=fontsize, weight="bold", color=tkleur, zorder=6,
                transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.25", facecolor=kleur,
                          edgecolor="none", alpha=0.93))
    ax.axis("off")

# ── Figuur: 2 kolommen ───────────────────────────────────────────────────────
now = datetime.now()
datumstr = now.strftime(f"%d {nl_maanden[now.month]} %Y  %H:%M")

fig = plt.figure(figsize=(20, 13))
fig.patch.set_facecolor("#0d1520")

# Header
ax_hdr = fig.add_axes([0, 0.95, 1, 0.05])
ax_hdr.set_xlim(0,1); ax_hdr.set_ylim(0,1); ax_hdr.axis("off")
ax_hdr.add_patch(plt.Rectangle((0,0),1,1, facecolor="#001a33",
                                transform=ax_hdr.transAxes, clip_on=False))
ax_hdr.text(0.012, 0.58, "Ed Aldus WM", fontsize=13, color="white",
            weight="bold", va="center")
ax_hdr.text(0.012, 0.15, "Data: Open-Meteo Marine API (CMEMS)",
            fontsize=8, color="#a8c8e8", va="center")
ax_hdr.text(0.5, 0.62, "Zeewatertemperatuur Europa",
            fontsize=16, color="white", weight="bold", ha="center", va="center")
ax_hdr.text(0.988, 0.65, f"Actueel: {datumstr}", fontsize=9, color="#a8c8e8",
            ha="right", va="center")
ax_hdr.text(0.988, 0.18, "© Ed Aldus WM | weerlab.nl", fontsize=8,
            color="#667788", ha="right", va="center")
ax_hdr.axhline(0, color="#4a90c4", linewidth=1.5)

# Hoofdkaart: Europa (links)
ax1 = fig.add_axes([0.01, 0.02, 0.54, 0.92],
                   projection=ccrs.PlateCarree())
teken_kaart(ax1, [-12, 42, 33, 73], resultaten, fontsize=7.5)

# Rechtervak: twee kaarten gestapeld
# Boven: Noordzee ingezoomd
ax2 = fig.add_axes([0.56, 0.50, 0.42, 0.44],
                   projection=ccrs.PlateCarree())
teken_kaart(ax2, [-3, 10, 50, 58], resultaten, fontsize=9.5)

# Titel Noordzee-paneel
fig.text(0.77, 0.955, "Noordzee", fontsize=11, color="white",
         weight="bold", ha="center", va="center")
fig.text(0.77, 0.935, "detail", fontsize=8.5, color="#a8c8e8",
         ha="center", va="center")

# Referentiebox op hoofdkaart (stippelrand rondom Noordzee-detail)
rect = mpatches.FancyBboxPatch(
    (-3, 50), 13, 8,
    boxstyle="square,pad=0", fill=False,
    edgecolor="white", linewidth=1.0, linestyle="--",
    transform=ccrs.PlateCarree(), zorder=10
)
ax1.add_patch(rect)

# Onder: Middellandse Zee ingezoomd
ax3 = fig.add_axes([0.56, 0.04, 0.42, 0.44],
                   projection=ccrs.PlateCarree())
teken_kaart(ax3, [-6, 36, 30, 48], resultaten, fontsize=9.0)

fig.text(0.77, 0.505, "Middellandse Zee", fontsize=11, color="white",
         weight="bold", ha="center", va="center")
fig.text(0.77, 0.485, "detail", fontsize=8.5, color="#a8c8e8",
         ha="center", va="center")

# Referentiebox Middellandse Zee op hoofdkaart
rect2 = mpatches.FancyBboxPatch(
    (-6, 30), 42, 18,
    boxstyle="square,pad=0", fill=False,
    edgecolor="white", linewidth=1.0, linestyle="--",
    transform=ccrs.PlateCarree(), zorder=10
)
ax1.add_patch(rect2)

# Kleurenbalk onderaan rechts
cax = fig.add_axes([0.57, 0.01, 0.40, 0.018])
sm = cm.ScalarMappable(cmap=CMAP, norm=NORM)
sm.set_array([])
cbar = plt.colorbar(sm, cax=cax, orientation='horizontal')
cbar.set_label('Zeewatertemperatuur (°C)', color='white', fontsize=9)
cbar.ax.xaxis.set_tick_params(color='white')
plt.setp(plt.getp(cbar.ax.axes, 'xticklabels'), color='white', fontsize=8)
cbar.outline.set_edgecolor('#445566')

# Opslaan
fname = f"kaart_zeetemp_{now.strftime('%Y%m%d_%H%M')}.png"
plt.savefig(fname, dpi=180, bbox_inches="tight",
            facecolor="#0d1520", edgecolor="none")
plt.close()
print(f"\nKaart opgeslagen: {fname}")

# Max 3 kaarten bewaren
for oud in sorted(glob.glob("kaart_zeetemp_*.png"))[:-3]:
    os.remove(oud)
    print(f"  Verwijderd: {oud}")
