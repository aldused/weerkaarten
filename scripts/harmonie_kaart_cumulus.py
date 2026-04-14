"""
Harmonie Kleurenkaart: Cumulusvorming
Leest bestaande Harmonie .bin bestanden (temp, dauwpunt, bewolking, CAPE)
en genereert kleurenkaarten die het LCL-niveau en cumulusontwikkeling tonen.

Twee panelen per kaart:
  Links:  LCL-hoogte (condensatieniveau) — lager = eerder cumulus
  Rechts: Lage bewolking (%) — directe modeloutput

Per uur een PNG, voor de daguren (08-20 LT).
"""
import os
import struct
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from matplotlib.gridspec import GridSpec
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
EXTENT = [2.5, 7.5, 49.3, 53.9]

nl_dagen   = ["Ma","Di","Wo","Do","Vr","Za","Zo"]
nl_maanden = ["","jan","feb","mrt","apr","mei","jun",
               "jul","aug","sep","okt","nov","dec"]


def lees_bin(pad):
    """Lees een Harmonie .bin bestand. Returns (n_lat, n_lon, n_steps, n_comp, data)."""
    with open(pad, "rb") as f:
        header = f.read(16)
        n_lat, n_lon, n_steps, n_comp = struct.unpack("<HHHH", header[:8])
        data = np.frombuffer(f.read(), dtype=np.float32)
    return n_lat, n_lon, n_steps, n_comp, data


def haal_stap(data, n_lat, n_lon, n_comp, step, comp=0):
    """Haal een 2D-array (lat, lon) op voor een specifiek tijdstap en component."""
    offset = (step * n_comp + comp) * n_lat * n_lon
    return data[offset:offset + n_lat * n_lon].reshape(n_lat, n_lon)


# ── Metadata laden ───────────────────────────────────────────────────────────
with open("harmonie_canvas_meta.json") as f:
    meta = json.load(f)

grid = meta["grid"]
n_lat_grid = grid["n_lat"]
n_lon_grid = grid["n_lon"]
lat_min, lat_max = grid["lat_min"], grid["lat_max"]
lon_min, lon_max = grid["lon_min"], grid["lon_max"]

lats = np.linspace(lat_max, lat_min, n_lat_grid)   # N → Z
lons = np.linspace(lon_min, lon_max, n_lon_grid)    # W → E
lon2d, lat2d = np.meshgrid(lons, lats)

tijden = meta["tijden"]
run_str = meta.get("run", "")

# ── Data laden ───────────────────────────────────────────────────────────────
print("Laden: temperatuur...")
tl, to, ts, tc, temp_data = lees_bin("harmonie_data_temp.bin")
print(f"  Grid: {tl}×{to}, {ts} stappen")

print("Laden: dauwpunt...")
_, _, _, _, dauw_data = lees_bin("harmonie_data_dauwpunt.bin")

print("Laden: bewolking (3 componenten: hoog/mid/laag)...")
bl, bo, bs, bc, bew_data = lees_bin("harmonie_data_bewolking.bin")
print(f"  Bewolking componenten: {bc}")

print("Laden: CAPE...")
_, _, _, _, cape_data = lees_bin("harmonie_data_cape.bin")

# ── Kleurenschalen ───────────────────────────────────────────────────────────
# LCL-hoogte: laag (groen, vroege cumulus) → hoog (blauw, droog/geen cumulus)
LCL_LEVELS = [0, 200, 400, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000]
LCL_COLORS = [
    "#1a5276",  # <200m: mist/stratus — donkerblauw
    "#2e86c1",  # 200-400: zeer laag
    "#48c9b0",  # 400-600: laag
    "#27ae60",  # 600-800: matig laag — goed Cu-weer
    "#82e0aa",  # 800-1000: ideaal Cu
    "#f9e79f",  # 1000-1200: matig
    "#f5b041",  # 1200-1500: hoog
    "#eb984e",  # 1500-2000: hoog
    "#e74c3c",  # 2000-2500: zeer hoog
    "#c0392b",  # 2500-3000: droog
    "#7b241c",  # >3000: extreem droog
]
CMAP_LCL = mcolors.ListedColormap(LCL_COLORS)
NORM_LCL = mcolors.BoundaryNorm(LCL_LEVELS, CMAP_LCL.N)

# Lage bewolking: transparant (0%) → grijs/donker (100%)
BEW_LEVELS = [0, 5, 15, 30, 50, 70, 85, 100]
BEW_COLORS = [
    "#f0f4ec",  # 0-5: helder
    "#d5dbd0",  # 5-15: nauwelijks
    "#b0b8aa",  # 15-30: licht
    "#8a9585",  # 30-50: half
    "#667062",  # 50-70: overwegend
    "#4a524a",  # 70-85: sterk
    "#2c3e2c",  # 85-100: dicht
]
CMAP_BEW = mcolors.ListedColormap(BEW_COLORS)
NORM_BEW = mcolors.BoundaryNorm(BEW_LEVELS, CMAP_BEW.N)

# CAPE overlay levels
CAPE_CONTOURS = [100, 300, 500, 1000, 2000]

# ── Kaarten genereren per uur ────────────────────────────────────────────────
print(f"\nKaarten genereren ({len(tijden)} tijdstappen)...\n")

for step_idx, tijdstip in enumerate(tijden):
    dt = datetime.strptime(tijdstip, "%Y-%m-%dT%H:%M").replace(tzinfo=LOCAL_TZ)
    uur = dt.hour

    # Alleen daguren (08-20 lokaal)
    if uur < 8 or uur > 20:
        continue

    dag_label = f"{nl_dagen[dt.weekday()]} {dt.day} {nl_maanden[dt.month]}"
    uur_label = f"{uur:02d}:00"

    print(f"  {dag_label} {uur_label}...")

    # Data ophalen
    temp = haal_stap(temp_data, tl, to, tc, step_idx, comp=0)
    dauw = haal_stap(dauw_data, tl, to, tc, step_idx, comp=0)
    bew_laag = haal_stap(bew_data, bl, bo, bc, step_idx, comp=2) * 100  # comp 2 = laag, fractie→%
    cape = haal_stap(cape_data, tl, to, tc, step_idx, comp=0)

    # LCL berekenen (Espy-formule)
    lcl = 125.0 * (temp - dauw)
    lcl = np.clip(lcl, 0, 5000)

    # ── Figuur met twee panelen ──────────────────────────────────────────────
    fig = plt.figure(figsize=(16, 10))
    gs = GridSpec(2, 2, figure=fig, height_ratios=[0.06, 1],
                  width_ratios=[1, 1], hspace=0.02, wspace=0.05)

    # Header
    ax_h = fig.add_subplot(gs[0, :])
    ax_h.set_xlim(0, 1); ax_h.set_ylim(0, 1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0, 0), 1, 1, transform=ax_h.transAxes,
                   facecolor="#003366", zorder=0, clip_on=False))
    ax_h.text(0.008, 0.65, "Ed Aldus WM", fontsize=12, color="white",
              weight="bold", va="center", transform=ax_h.transAxes)
    ax_h.text(0.008, 0.22, f"HARMONIE 43  ·  {run_str}", fontsize=8,
              color="#a8c8e8", va="center", transform=ax_h.transAxes)
    ax_h.text(0.992, 0.65, f"Cumulusvorming – {dag_label}  {uur_label} LT",
              fontsize=14, color="white", weight="bold",
              ha="right", va="center", transform=ax_h.transAxes)
    ax_h.text(0.992, 0.22, f"T+{step_idx}",
              fontsize=8, color="#a8c8e8", ha="right", va="center",
              transform=ax_h.transAxes)
    ax_h.axhline(0, color="#4a90c4", linewidth=1.5)

    # ── Linker paneel: LCL-hoogte ────────────────────────────────────────────
    ax1 = fig.add_subplot(gs[1, 0], projection=ccrs.PlateCarree())
    ax1.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax1.set_aspect('auto')
    ax1.add_feature(cfeature.OCEAN.with_scale("10m"),  facecolor="#d8ecf8", zorder=0)
    ax1.add_feature(cfeature.LAND.with_scale("10m"),   facecolor="#f0f4ec", zorder=1)

    cf1 = ax1.pcolormesh(lon2d, lat2d, lcl, cmap=CMAP_LCL, norm=NORM_LCL,
                          transform=ccrs.PlateCarree(), zorder=2, alpha=0.85)

    # CAPE contouren (als overlay)
    cape_smooth = cape.copy()
    cape_smooth[cape_smooth < 50] = 0
    if cape_smooth.max() > 100:
        ax1.contour(lon2d, lat2d, cape_smooth, levels=CAPE_CONTOURS,
                    colors="#e74c3c", linewidths=0.6, linestyles="--",
                    transform=ccrs.PlateCarree(), zorder=5)

    ax1.add_feature(cfeature.COASTLINE.with_scale("10m"), edgecolor="#333", linewidth=0.8, zorder=6)
    ax1.add_feature(cfeature.BORDERS.with_scale("10m"), edgecolor="#666", linewidth=0.5,
                    linestyle="--", zorder=6)
    ax1.axis("off")

    ax1.set_title("Condensatieniveau (LCL)\nlager = eerder cumulus",
                  fontsize=9, weight="bold", pad=4)

    cb1 = fig.colorbar(cf1, ax=ax1, orientation="horizontal", shrink=0.85,
                       pad=0.02, aspect=30)
    cb1.set_label("LCL-hoogte (m)", fontsize=7)
    cb1.ax.tick_params(labelsize=6)

    # ── Rechter paneel: Lage bewolking ───────────────────────────────────────
    ax2 = fig.add_subplot(gs[1, 1], projection=ccrs.PlateCarree())
    ax2.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax2.set_aspect('auto')
    ax2.add_feature(cfeature.OCEAN.with_scale("10m"),  facecolor="#d8ecf8", zorder=0)
    ax2.add_feature(cfeature.LAND.with_scale("10m"),   facecolor="#f0f4ec", zorder=1)

    cf2 = ax2.pcolormesh(lon2d, lat2d, bew_laag, cmap=CMAP_BEW, norm=NORM_BEW,
                          transform=ccrs.PlateCarree(), zorder=2, alpha=0.85)

    ax2.add_feature(cfeature.COASTLINE.with_scale("10m"), edgecolor="#333", linewidth=0.8, zorder=6)
    ax2.add_feature(cfeature.BORDERS.with_scale("10m"), edgecolor="#666", linewidth=0.5,
                    linestyle="--", zorder=6)
    ax2.axis("off")

    ax2.set_title("Lage bewolking (cumulus/stratus)\nmodeloutput Nl",
                  fontsize=9, weight="bold", pad=4)

    cb2 = fig.colorbar(cf2, ax=ax2, orientation="horizontal", shrink=0.85,
                       pad=0.02, aspect=30)
    cb2.set_label("Bewolkingsgraad (%)", fontsize=7)
    cb2.ax.tick_params(labelsize=6)

    # Footer
    fig.text(0.99, 0.005,
             f"© Ed Aldus | Harmonie 43 | LCL = 125×(T−Td) | {run_str}",
             fontsize=6.5, style="italic", ha="right", va="bottom", color="#555555")

    fname = f"kaart_harmonie_cumulus_{tijdstip.replace(':','')}.png"
    plt.savefig(fname, dpi=130, bbox_inches="tight")
    plt.close()
    print(f"    → {fname}")

print("\nKlaar!")
