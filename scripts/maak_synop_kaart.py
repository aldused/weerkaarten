"""
maak_synop_kaart.py

Actuele synoptische waarnemingskaart voor Nederland:
- Bewolkingscirkel (oktas)
- Temperatuur
- Windrichting (pijl) + Beaufort
Data: KNMI EDR API (10-minuten waarnemingen)
"""

import os, requests, time, math
from datetime import datetime, timedelta, timezone
from math import isnan, isfinite
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.patheffects as pe
import numpy as np
from matplotlib.gridspec import GridSpec

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# ── Configuratie ──────────────────────────────────────────────────────────────
BASE_URL = "https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations"
from knmi_api import knmi_get
EXTENT   = [3.3, 7.4, 50.45, 53.8]

nl_maanden = ["","jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"]

# Stations: wigos_id → (naam, lon, lat)
STATIONS = {
    "0-20000-0-06235": ("Den Helder",    4.789, 52.928),
    "0-20000-0-06240": ("Schiphol",      4.781, 52.309),
    "0-20000-0-06242": ("Vlieland",      4.920, 53.250),
    "0-20000-0-06251": ("Terschelling",  5.350, 53.392),
    "0-20000-0-06257": ("Wijk aan Zee",  4.600, 52.490),
    "0-20000-0-06260": ("De Bilt",       5.278, 52.201),
    "0-20000-0-06267": ("Stavoren",      5.380, 52.890),
    "0-20000-0-06269": ("Lelystad",      5.530, 52.458),
    "0-20000-0-06270": ("Leeuwarden",    5.774, 53.224),
    "0-20000-0-06273": ("Marknesse",     5.880, 52.703),
    "0-20000-0-06275": ("Deelen",        5.885, 52.060),
    "0-20000-0-06277": ("Lauwersoog",    6.200, 53.410),
    "0-20000-0-06279": ("Hoogeveen",     6.520, 52.730),
    "0-20000-0-06280": ("Eelde",         6.586, 53.123),
    "0-20000-0-06283": ("Hupsel",        6.657, 52.069),
    "0-20000-0-06286": ("Nieuw Beerta",  7.150, 53.195),
    "0-20000-0-06290": ("Twenthe",       6.889, 52.275),
    "0-20000-0-06310": ("Vlissingen",    3.596, 51.442),
    "0-20000-0-06319": ("Westdorpe",     3.862, 51.226),
    "0-20000-0-06323": ("Wilhelminadorp",3.884, 51.527),
    "0-20000-0-06330": ("Hoek v. Holland",4.131,51.978),
    "0-20000-0-06340": ("Woensdrecht",   4.342, 51.450),
    "0-20000-0-06344": ("Rotterdam",     4.437, 51.957),
    "0-20000-0-06348": ("Cabauw",        4.926, 51.971),
    "0-20000-0-06350": ("Gilze-Rijen",   4.931, 51.567),
    "0-20000-0-06356": ("Herwijnen",     5.140, 51.859),
    "0-20000-0-06370": ("Eindhoven",     5.377, 51.451),
    "0-20000-0-06375": ("Volkel",        5.707, 51.657),
    "0-20000-0-06377": ("Ell",           5.763, 51.198),
    "0-20000-0-06380": ("Maastricht",    5.770, 50.911),
}

# ── Helpers ───────────────────────────────────────────────────────────────────
def to_float(v):
    try:
        x = float(v)
        return x if isfinite(x) and not isnan(x) else None
    except:
        return None

def ms_naar_bft(ms):
    if ms is None: return None
    schaal = [0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5,28.5,32.7]
    for i, g in enumerate(schaal):
        if ms < g: return i
    return 12

# ── Data ophalen ───────────────────────────────────────────────────────────────
def haal_obs(wigos_id):
    """Haal meest recente ta, ff, dd, n op."""
    now_utc = datetime.now(timezone.utc)
    # Haal laatste 90 minuten op (bewolking wordt niet elke 10 min gerapporteerd)
    s = (now_utc - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    e = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    params = {"datetime": f"{s}/{e}", "parameter-name": "ta,ff,dd,n,td,rh,qg,h,ww"}
    try:
        r = knmi_get(f"{BASE_URL}/locations/{wigos_id}", params=params, timeout=15)
        if r.status_code in (400, 404): return None
        r.raise_for_status()
        js = r.json()
        if not js.get("coverages"): return None
        ranges = js["coverages"][0].get("ranges", {})

        def laatste(key):
            vals = [to_float(v) for v in (ranges.get(key, {}).get("values") or [])
                    if v is not None]
            vals = [v for v in vals if v is not None]
            return vals[-1] if vals else None

        n   = laatste("n")
        qg  = laatste("qg")

        # Corrigeer bewolkingssensor met globale straling (overdag)
        # Als qg hoog is maar n ook hoog → sensor klopt niet (sluierbewolking)
        if n is not None and qg is not None and qg > 0:
            if qg >= 400:   n = min(n, 1)   # veel straling → max 1 okta
            elif qg >= 250: n = min(n, 2)   # flinke straling → max 2 oktas
            elif qg >= 150: n = min(n, 4)   # redelijke straling → max 4 oktas
            elif qg >= 80:  n = min(n, 6)   # weinig straling → max 6 oktas

        return {
            "ta": laatste("ta"),
            "ff": laatste("ff"),
            "dd": laatste("dd"),
            "n":  n,
            "td": laatste("td"),
            "rh": laatste("rh"),
            "qg": qg,
            "h":  laatste("h"),
            "ww": laatste("ww"),
        }
    except Exception as e:
        return None

# ── Teken bewolkingscirkel ─────────────────────────────────────────────────────
def teken_station(ax, fig, lon, lat, ta, ff, dd, n, td=None, rh=None, h=None, ww=None):
    """Teken bewolkingscirkel, temp en wind voor één station."""
    # Zet lon/lat om naar display-coördinaten (pixels)
    tr = ccrs.PlateCarree()
    x_disp, y_disp = ax.transData.transform(
        tr.transform_point(lon, lat, tr))

    # Cirkelstraal in display-coördinaten (pixels) — altijd rond
    RADIUS_PX = 9

    # ── Bewolkingscirkel ──
    # Teken als Ellipse in display coords via transData inverse
    def disp_to_data(x, y):
        return ax.transData.inverted().transform((x, y))

    # Bepaal aspect correctie (graden lon/lat per pixel)
    p1 = disp_to_data(x_disp, y_disp)
    p2 = disp_to_data(x_disp + RADIUS_PX, y_disp)
    p3 = disp_to_data(x_disp, y_disp + RADIUS_PX)
    dlon = p2[0] - p1[0]
    dlat = p3[1] - p1[1]

    # Witte achtergrond
    cir_bg = mpatches.Ellipse((lon, lat), 2*dlon, 2*dlat,
                               facecolor='white', edgecolor='none',
                               zorder=9, transform=tr)
    ax.add_patch(cir_bg)

    # Bewolking vulling
    if n is None or n == 9:
        # Geen bewolkingsdata — grijze cirkel met streepje
        cir_grijs = mpatches.Ellipse((lon, lat), 2*dlon, 2*dlat,
                                      facecolor='#cccccc', edgecolor='#888888',
                                      linewidth=1.0, zorder=10, transform=tr)
        ax.add_patch(cir_grijs)
        ax.text(lon, lat, chr(8211), ha='center', va='center', fontsize=6,
                color='#666666', zorder=12, transform=tr)
    elif n > 0:
        frac = min(n / 8.0, 1.0)
        theta = np.linspace(np.pi/2, np.pi/2 - frac*2*np.pi, 80)
        xs = lon + dlon * np.cos(theta)
        ys = lat + dlat * np.sin(theta)
        xs = np.append([lon], xs)
        ys = np.append([lat], ys)
        ax.fill(xs, ys, color='#1a2b40', zorder=10, transform=tr)

    # Cirkelrand (alleen als n bekend is)
    if n is not None and n != 9:
        cir_rand = mpatches.Ellipse((lon, lat), 2*dlon, 2*dlat,
                                     facecolor='none', edgecolor='#1a2b40',
                                     linewidth=1.3, zorder=11, transform=tr)
        ax.add_patch(cir_rand)

    # ── ww code ── links boven de cirkel
    if ww is not None:
        ax.text(lon - dlon * 1.3, lat + dlat * 1.1, f"ww{int(ww)}",
                fontsize=5.5, fontweight="normal", color="#666600",
                ha="right", va="center", transform=tr, zorder=15,
                path_effects=[pe.withStroke(linewidth=2, foreground="white")])

    # ── Windpijl ── pijlpunt aan rand cirkel, staart wijst naar herkomst wind
    bft = ms_naar_bft(ff)
    if dd is not None and ff is not None and ff >= 0.5:
        rad = math.radians(dd)
        pijl_len = dlon * 2.5
        # dd = richting van waar wind komt (270 = uit west)
        # sin(dd) positief = component naar oost, cos(dd) positief = component naar noord
        # Pijlpunt aan rand van cirkel, aan de kant waar wind vandaan komt
        ex = lon + math.sin(rad) * dlon
        ey = lat + math.cos(rad) * dlat
        # Staart verder weg in dezelfde richting
        sx = lon + math.sin(rad) * (dlon + pijl_len)
        sy = lat + math.cos(rad) * (dlat + pijl_len * abs(dlat/dlon))
        ax.annotate("",
            xy=(ex, ey), xytext=(sx, sy),
            xycoords=tr._as_mpl_transform(ax),
            textcoords=tr._as_mpl_transform(ax),
            arrowprops=dict(arrowstyle="-|>", color="#003366",
                            lw=1.5, mutation_scale=9),
            zorder=12)

    # ── Temperatuur ── altijd rechts naast cirkel, nooit overlap pijl
    if ta is not None:
        ta_str = f"{ta:.1f}°"
        ax.text(lon + dlon * 1.3, lat - dlat * 0.3, ta_str,
                fontsize=7.5, fontweight="bold", color="#cc2200",
                ha="left", va="center", transform=tr, zorder=15,
                path_effects=[pe.withStroke(linewidth=2.5, foreground="white")])

    # ── Dauwpunt ── onder temperatuur, kleiner, blauw
    if td is not None:
        td_str = f"{td:.1f}°"
        ax.text(lon + dlon * 1.3, lat - dlat * 1.5, td_str,
                fontsize=6.5, fontweight="bold", color="#1a5fb4",
                ha="left", va="center", transform=tr, zorder=15,
                path_effects=[pe.withStroke(linewidth=2, foreground="white")])

    # ── Relatieve vochtigheid ── onder dauwpunt, grijs
    if rh is not None:
        rh_str = f"{int(round(rh))}%"
        ax.text(lon + dlon * 1.3, lat - dlat * 2.7, rh_str,
                fontsize=6.0, fontweight="normal", color="#555555",
                ha="left", va="center", transform=tr, zorder=15,
                path_effects=[pe.withStroke(linewidth=2, foreground="white")])

    # ── Beaufort ── onder de cirkel
    if bft is not None:
        ax.text(lon, lat - dlat * 1.6, f"Bft {bft}",
                fontsize=6.5, fontweight="bold", color="#003366",
                ha="center", va="top", transform=tr, zorder=15,
                path_effects=[pe.withStroke(linewidth=2, foreground="white")])

    # ── Wolkenhoogte ── onder Bft, groen (API geeft feet, omrekenen naar meters)
    if h is not None and n is not None and n > 0:
        h_m = int(round(h * 0.3048 / 50) * 50)  # afronden op 50m
        ax.text(lon, lat - dlat * 3.2, f"{h_m}m",
                fontsize=6.0, fontweight="normal", color="#1a6b1a",
                ha="center", va="top", transform=tr, zorder=15,
                path_effects=[pe.withStroke(linewidth=2, foreground="white")])

# ── Hoofdprogramma ────────────────────────────────────────────────────────────
print("Synop kaart: data ophalen...")
now_utc  = datetime.now(timezone.utc)
now_lokaal = now_utc.astimezone(__import__('zoneinfo').ZoneInfo("Europe/Amsterdam"))
now_str  = now_lokaal.strftime("%H:%M")
now_str2 = now_lokaal.strftime("%d %b %Y %H:%M")
dag_str  = f"{now_lokaal.day} {nl_maanden[now_lokaal.month]} {now_lokaal.year}"

obs_data = {}
for wigos, (naam, lon, lat) in STATIONS.items():
    print(f"  {naam}...")
    obs = haal_obs(wigos)
    if obs:
        obs_data[naam] = {"lon": lon, "lat": lat, **obs}
    time.sleep(0.08)

print(f"Data voor {len(obs_data)} stations")

# ── Kaart tekenen ─────────────────────────────────────────────────────────────
import cartopy.crs as ccrs
import cartopy.feature as cfeature

nl_dagen = ["Ma","Di","Wo","Do","Vr","Za","Zo"]

fig = plt.figure(figsize=(8, 11))
gs = GridSpec(2, 1, figure=fig, height_ratios=[0.085, 1], hspace=0.01)

# Header
ax_h = fig.add_subplot(gs[0])
ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
               facecolor="#003366", zorder=0, clip_on=False))
ax_h.text(0.012, 0.62, "Ed Aldus WM", fontsize=11, color="white",
          weight="bold", va="center", transform=ax_h.transAxes)
ax_h.text(0.012, 0.22, "Actuele waarnemingen · KNMI", fontsize=7.5,
          color="#a8c8e8", va="center", transform=ax_h.transAxes)
ax_h.text(0.988, 0.62, f"Synoptische kaart · {now_str}",
          fontsize=13, color="white", weight="bold",
          ha="right", va="center", transform=ax_h.transAxes)
ax_h.text(0.988, 0.22, f"{dag_str}",
          fontsize=8, color="#a8c8e8", ha="right", va="center",
          transform=ax_h.transAxes)
ax_h.axhline(0, color="#4a90c4", linewidth=1.5)

# Kaart
ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
ax.set_aspect('auto')
ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
ax.add_feature(cfeature.OCEAN.with_scale("10m"),  facecolor="#d8ecf8", zorder=0)
ax.add_feature(cfeature.LAND.with_scale("10m"),   facecolor="#f0f4ec", zorder=1)
ax.add_feature(cfeature.LAKES.with_scale("10m"),  facecolor="#d8ecf8", zorder=2)
ax.add_feature(cfeature.RIVERS.with_scale("10m"), edgecolor="#a8cce0", linewidth=0.5, zorder=3)
ax.add_feature(cfeature.COASTLINE.with_scale("10m"), edgecolor="#555555", linewidth=0.8, zorder=4)
ax.add_feature(cfeature.BORDERS.with_scale("10m"),   edgecolor="#888888", linewidth=0.6,
               linestyle="--", zorder=4)

tr = ccrs.PlateCarree()

for naam, v in obs_data.items():
    lon, lat = v["lon"], v["lat"]
    teken_station(ax, fig, lon, lat,
                  ta=v.get("ta"), ff=v.get("ff"),
                  dd=v.get("dd"), n=v.get("n"),
                  td=v.get("td"), rh=v.get("rh"),
                  h=v.get("h"), ww=v.get("ww"))

# Legenda bewolking
leg = ax.inset_axes([0.01, 0.87, 0.30, 0.12])
leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",
              linewidth=0.7,transform=leg.transAxes,zorder=0))
leg.text(0.5, 0.97, "Bewolking (oktas)",
         fontsize=4.5, weight="bold", ha="center", va="top", transform=leg.transAxes)

# Bepaal aspect-ratio van de legenda-as voor ronde cirkels
leg_bbox = leg.get_window_extent(fig.canvas.get_renderer())
leg_w = leg_bbox.width
leg_h = leg_bbox.height
# Straal in data-coördinaten, gecorrigeerd voor aspect
r_x = 0.075
r_y = r_x * (leg_w / leg_h)

okta_voorbeelden = [0, 2, 4, 6, 8]
for i, ok in enumerate(okta_voorbeelden):
    cx = 0.08 + i * 0.20
    cy = 0.42
    # Witte ellipse (gecorrigeerd voor aspect)
    c_bg = mpatches.Ellipse((cx, cy), 2*r_x, 2*r_y,
                             facecolor='white', edgecolor='none',
                             zorder=1, transform=leg.transAxes)
    leg.add_patch(c_bg)
    if ok > 0:
        frac = ok / 8.0
        theta = np.linspace(np.pi/2, np.pi/2 - frac*2*np.pi, 60)
        xs = cx + r_x * np.cos(theta)
        ys = cy + r_y * np.sin(theta)
        xs = np.append([cx], xs)
        ys = np.append([cy], ys)
        leg.fill(xs, ys, color='#1a2b40', zorder=2, transform=leg.transAxes)
    c_rand = mpatches.Ellipse((cx, cy), 2*r_x, 2*r_y,
                               facecolor='none', edgecolor='#1a2b40',
                               linewidth=0.8, zorder=3, transform=leg.transAxes)
    leg.add_patch(c_rand)
    leg.text(cx, 0.08, f"{ok}/8", fontsize=3.8, ha="center",
             va="bottom", transform=leg.transAxes, color="#333")

ax.text(1.0, 0.0, f"© Ed Aldus | Data: KNMI | {now_str2}",
        transform=ax.transAxes, fontsize=6.5, style="italic",
        ha="right", va="bottom", color="#555555")

# Symbolen legenda rechtsonder
sym = ax.inset_axes([0.01, 0.01, 0.41, 0.14])
sym.set_xlim(0,1); sym.set_ylim(0,1); sym.axis("off")
sym.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",
              linewidth=0.7,transform=sym.transAxes,zorder=0))
sym.text(0.5, 0.97, "Stationssymbolen", fontsize=4.5, weight="bold",
         ha="center", va="top", transform=sym.transAxes)
# Bewolkingscirkel
sym.add_patch(mpatches.Ellipse((0.10, 0.52), 0.10, 0.26,
              facecolor='#aaaaaa', edgecolor='#1a2b40', linewidth=0.8,
              zorder=1, transform=sym.transAxes))
# Windpijl
sym.annotate("", xy=(0.10, 0.65), xytext=(0.10, 0.87),
             xycoords=sym.transAxes, textcoords=sym.transAxes,
             arrowprops=dict(arrowstyle="-|>", color="#003366", lw=1.0, mutation_scale=5))
# Bft onder cirkel
sym.text(0.10, 0.22, "Bft 4", fontsize=3.5, color="#003366", weight="bold",
         ha="center", va="center", transform=sym.transAxes)
# Wolkenhoogte onder Bft
sym.text(0.10, 0.08, "850m", fontsize=3.5, color="#1a6b1a",
         ha="center", va="center", transform=sym.transAxes)
# Waarden rechts van cirkel
sym.text(0.24, 0.82, "7.4°",  fontsize=4.2, color="#cc2200", weight="bold", transform=sym.transAxes, va="center")
sym.text(0.24, 0.60, "5.1°",  fontsize=3.5, color="#1a5fb4", weight="bold", transform=sym.transAxes, va="center")
sym.text(0.24, 0.40, "82%",   fontsize=3.2, color="#555555",               transform=sym.transAxes, va="center")
# Uitleg labels
sym.text(0.42, 0.82, "Temperatuur",       fontsize=3.5, color="#cc2200", transform=sym.transAxes, va="center")
sym.text(0.42, 0.60, "Dauwpunt",          fontsize=3.5, color="#1a5fb4", transform=sym.transAxes, va="center")
sym.text(0.42, 0.40, "Vochtigheid",       fontsize=3.5, color="#555555", transform=sym.transAxes, va="center")
sym.text(0.42, 0.22, "Windkracht Bft",    fontsize=3.5, color="#003366", transform=sym.transAxes, va="center")
sym.text(0.42, 0.08, "Wolkenhoogte (m)",  fontsize=3.5, color="#1a6b1a", transform=sym.transAxes, va="center")

ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
ax.axis("off")

import glob, os as _os

fname = f"kaart_synop_{now_lokaal.strftime('%Y%m%d_%H%M')}.png"
if len(obs_data) >= 10:
    plt.savefig(fname, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Kaart opgeslagen: {fname} ({len(obs_data)} stations)")
else:
    plt.close()
    print(f"Te weinig stations ({len(obs_data)}), synop NIET opgeslagen (fallback actief)")
bestanden = sorted(glob.glob("kaart_synop_*.png"))
if len(bestanden) > 10:
    for oud in bestanden[:-10]:
        _os.remove(oud)

# Bewaar laatste 10 synop kaarten, verwijder de rest
synop_bestanden = sorted(glob.glob("kaart_synop_*.png"))
if len(synop_bestanden) > 10:
    for oud in synop_bestanden[:-10]:
        _os.remove(oud)
        print(f"Verwijderd: {oud}")
