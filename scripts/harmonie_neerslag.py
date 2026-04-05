"""
harmonie_neerslag.py

Maakt Harmonie 43 neerslagkaarten (gevulde contour/heatmap) voor NL+BE.
Databron: KNMI Open Data API → GRIB bestanden (2 km resolutie).
Fallback: Open-Meteo API (lagere resolutie, rate-limit gevoelig).
Output: harmonie_neerslag_XX.png per forecast-uur (0-48).
"""

import os
import sys
import json
import time
import tarfile
import tempfile
import glob as globmod
import numpy as np
import requests
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# ── Configuratie ─────────────────────────────────────────────────────────────
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

# KNMI Open Data API key
KNMI_OPEN_DATA_KEY = os.environ.get("KNMI_OPEN_DATA_KEY",
    "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6Ijk5YjZhMzkwMTlkYzQxYzlhMzJjNmNmY2MyNDgxNGRkIiwiaCI6Im11cm11cjEyOCJ9"
)

# Dataset info
DATASET_NAME = "harmonie_arome_cy43_p1"
DATASET_VERSION = "1.0"
KNMI_API_BASE = "https://api.dataplatform.knmi.nl/open-data/v1"

# Kaart-weergave extent (Benelux)
EXTENT = [2.5, 7.5, 49.3, 53.9]

# Forecast uren
MAX_HOURS = 48

nl_dagen   = ["Ma","Di","Wo","Do","Vr","Za","Zo"]
nl_maanden = ["","jan","feb","mrt","apr","mei","jun",
               "jul","aug","sep","okt","nov","dec"]

# ── Kleurenschaal neerslag (radar-stijl) ─────────────────────────────────────
# Radar-stijl: sneller naar groen/geel/oranje/rood (vergelijkbaar met dBZ-schaal)
NEERSLAG_LEVELS = [0.1, 0.2, 0.5, 1, 1.5, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50]
NEERSLAG_COLORS = [
    "#c8c8c8",  # 0.1  lichtgrijs
    "#a0a0a0",  # 0.2  grijs
    "#80d080",  # 0.5  lichtgroen
    "#30b830",  # 1    groen
    "#00a000",  # 1.5  heldergroen
    "#008800",  # 2    donkergroen
    "#ffff00",  # 3    geel
    "#ffd000",  # 4    donkergeel
    "#ffa000",  # 5    oranje
    "#ff6000",  # 7    donkeroranje
    "#ff0000",  # 10   rood
    "#cc0000",  # 15   donkerrood
    "#990066",  # 20   bordeaux
    "#cc00cc",  # 30   paars
    "#ff44ff",  # 50   magenta
]

CMAP_NEERSLAG = mcolors.ListedColormap(NEERSLAG_COLORS)
NORM_NEERSLAG = mcolors.BoundaryNorm(NEERSLAG_LEVELS, CMAP_NEERSLAG.N)


# ══════════════════════════════════════════════════════════════════════════════
# DATA OPHALEN — KNMI GRIB (primair)
# ══════════════════════════════════════════════════════════════════════════════

def knmi_api_headers():
    return {"Authorization": KNMI_OPEN_DATA_KEY}


def knmi_laatste_bestand():
    """Vind het meest recente Harmonie tar-bestand op KNMI Open Data."""
    url = f"{KNMI_API_BASE}/datasets/{DATASET_NAME}/versions/{DATASET_VERSION}/files"
    params = {"maxKeys": 1, "orderBy": "created", "sorting": "desc"}
    r = requests.get(url, headers=knmi_api_headers(), params=params, timeout=30)
    r.raise_for_status()
    data = r.json()
    files = data.get("files", [])
    if not files:
        raise RuntimeError("Geen bestanden gevonden in KNMI dataset")
    return files[0]["filename"]


def knmi_download_url(filename):
    """Haal de tijdelijke download-URL op voor een KNMI bestand."""
    url = f"{KNMI_API_BASE}/datasets/{DATASET_NAME}/versions/{DATASET_VERSION}/files/{filename}/url"
    r = requests.get(url, headers=knmi_api_headers(), timeout=30)
    r.raise_for_status()
    return r.json()["temporaryDownloadUrl"]


def knmi_download_grib(filename, output_dir):
    """Download en extract een Harmonie tar-bestand."""
    print(f"  Download URL ophalen voor {filename}...")
    download_url = knmi_download_url(filename)

    print(f"  Downloaden...", end=" ", flush=True)
    r = requests.get(download_url, timeout=120, stream=True)
    r.raise_for_status()

    # Opslaan als tar
    tar_path = os.path.join(output_dir, filename)
    with open(tar_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)
    size_mb = os.path.getsize(tar_path) / (1024 * 1024)
    print(f"{size_mb:.1f} MB")

    # Extract
    print(f"  Extracten...", end=" ", flush=True)
    grib_files = []
    with tarfile.open(tar_path, "r") as tar:
        tar.extractall(path=output_dir)
        grib_files = [os.path.join(output_dir, m.name) for m in tar.getmembers()]
    print(f"{len(grib_files)} bestanden")

    return grib_files


def haal_data_knmi_grib(max_hours=MAX_HOURS):
    """
    Download het laatste Harmonie GRIB bestand en extraheer neerslagdata.
    Gebruikt eccodes direct (KNMI GRIB1 tabel 253, indicator=61 = neerslag).
    Returns: (lats, lons, grid_data[uur,lat,lon], times_str, run_str)
    """
    import eccodes

    print("KNMI Open Data API — laatste Harmonie bestand zoeken...")
    filename = knmi_laatste_bestand()
    print(f"  Bestand: {filename}")

    # Parse run-tijd uit bestandsnaam: HARM43_V1_P1_2026040505.tar
    parts = filename.replace(".tar", "").split("_")
    run_str_raw = parts[-1] if parts else ""
    try:
        run_dt = datetime.strptime(run_str_raw[:10], "%Y%m%d%H").replace(tzinfo=timezone.utc)
        run_str = run_dt.astimezone(LOCAL_TZ).strftime("%d %b %Y %H:%M")
    except:
        run_dt = datetime.now(tz=LOCAL_TZ)
        run_str = run_dt.strftime("%d %b %Y %H:%M")

    # Download naar tijdelijke directory
    with tempfile.TemporaryDirectory(prefix="harmonie_") as tmpdir:
        grib_files = knmi_download_grib(filename, tmpdir)

        print("  GRIB data lezen (neerslag, indicator=61)...")
        all_data = []
        lats_grib = None
        lons_grib = None

        for gf in sorted(grib_files):
            try:
                with open(gf, "rb") as fh:
                    while True:
                        msgid = eccodes.codes_grib_new_from_file(fh)
                        if msgid is None:
                            break
                        indicator = eccodes.codes_get(msgid, "indicatorOfParameter")
                        if indicator == 61:  # Neerslag
                            ni = eccodes.codes_get(msgid, "Ni")
                            nj = eccodes.codes_get(msgid, "Nj")
                            values = eccodes.codes_get_values(msgid)
                            data = values.reshape(nj, ni)
                            all_data.append(data)

                            if lats_grib is None:
                                lat1 = eccodes.codes_get(msgid, "latitudeOfFirstGridPointInDegrees")
                                lat2 = eccodes.codes_get(msgid, "latitudeOfLastGridPointInDegrees")
                                lon1 = eccodes.codes_get(msgid, "longitudeOfFirstGridPointInDegrees")
                                lon2 = eccodes.codes_get(msgid, "longitudeOfLastGridPointInDegrees")
                                lats_grib = np.linspace(lat1, lat2, nj)
                                lons_grib = np.linspace(lon1, lon2, ni)

                        eccodes.codes_release(msgid)
            except Exception as e:
                print(f"    Fout bij {os.path.basename(gf)}: {e}")
                continue

        if not all_data:
            raise RuntimeError("Geen neerslag (indicator=61) gevonden in GRIB bestanden")

        print(f"  Gevonden: {len(all_data)} tijdstappen, grid {all_data[0].shape}")

        # Beperk tot max_hours (sla timestep 0 over als die leeg is)
        start_idx = 1 if len(all_data) > 1 and np.max(all_data[0]) == 0 else 0
        n_hours = min(max_hours, len(all_data) - start_idx)
        grid_data = np.stack(all_data[start_idx:start_idx + n_hours], axis=0)

        # Zorg dat lats van zuid naar noord gaan
        if lats_grib[0] > lats_grib[-1]:
            lats_grib = lats_grib[::-1]
            grid_data = grid_data[:, ::-1, :]

        # Tijden genereren (elk uur vanaf run + start_idx)
        times_str = []
        for h in range(n_hours):
            dt_valid = run_dt + timedelta(hours=start_idx + h)
            dt_local = dt_valid.astimezone(LOCAL_TZ)
            times_str.append(dt_local.strftime("%Y-%m-%dT%H:%M"))

    return lats_grib, lons_grib, grid_data, times_str, run_str


# ══════════════════════════════════════════════════════════════════════════════
# DATA OPHALEN — OPEN-METEO (fallback)
# ══════════════════════════════════════════════════════════════════════════════

# Open-Meteo grid configuratie
OM_LAT_MIN, OM_LAT_MAX = 49.3, 54.0
OM_LON_MIN, OM_LON_MAX = 2.3, 7.7
OM_GRID_STEP = 0.12


def maak_grid_openmeteo():
    """Maak een regelmatig lat/lon grid voor Open-Meteo."""
    lats = np.arange(OM_LAT_MIN, OM_LAT_MAX + OM_GRID_STEP/2, OM_GRID_STEP)
    lons = np.arange(OM_LON_MIN, OM_LON_MAX + OM_GRID_STEP/2, OM_GRID_STEP)
    return lats, lons


def haal_data_openmeteo(max_hours=MAX_HOURS):
    """
    Haal neerslag-griddata op via Open-Meteo API (fallback).
    Returns: (lats, lons, grid_data[uur,lat,lon], times_str, run_str)
    """
    lats, lons = maak_grid_openmeteo()
    n_lon = len(lons)

    print(f"Open-Meteo grid: {len(lats)} lat x {n_lon} lon = {len(lats)*n_lon} punten")

    all_precip = {}
    times = []
    lon_str = ",".join(str(round(lon, 3)) for lon in lons)

    for lat_idx, lat in enumerate(lats):
        lat_str = ",".join([str(round(lat, 3))] * n_lon)
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat_str}&longitude={lon_str}"
            f"&hourly=precipitation&models=knmi_seamless"
            f"&timezone=Europe/Amsterdam&forecast_hours={max_hours}"
        )

        print(f"  Rij {lat_idx+1}/{len(lats)} (lat={lat:.2f})...", end=" ", flush=True)

        for poging in range(5):
            try:
                r = requests.get(url, timeout=60)
                if r.status_code == 429:
                    wacht = min(60, 5 * (poging + 1))
                    print(f"rate-limit ({wacht}s)...", end=" ", flush=True)
                    time.sleep(wacht)
                    continue
                r.raise_for_status()
                data = r.json()
                break
            except Exception as e:
                if poging < 4:
                    time.sleep(3 * (poging + 1))
                else:
                    print(f"FOUT: {e}")
                    return None, None, None, None, None
        else:
            print("overgeslagen")
            continue

        results = data if isinstance(data, list) else [data]
        for lon_idx, result in enumerate(results):
            hourly = result.get("hourly", {})
            if not times:
                times = hourly.get("time", [])
            all_precip[lat_idx * n_lon + lon_idx] = hourly.get("precipitation", [])[:max_hours]

        print("OK")
        time.sleep(3)  # Ruime pauze om rate limits te voorkomen

    times_str = times[:max_hours] if times else []
    n_hours = min(max_hours, len(times_str))
    grid_data = np.full((n_hours, len(lats), n_lon), np.nan)

    for punt_idx, precip_values in all_precip.items():
        lat_i = punt_idx // n_lon
        lon_i = punt_idx % n_lon
        for h in range(min(n_hours, len(precip_values))):
            val = precip_values[h]
            if val is not None:
                grid_data[h, lat_i, lon_i] = val

    run_str = datetime.now(tz=LOCAL_TZ).strftime("%d %b %Y %H:%M")
    return lats, lons, grid_data, times_str, run_str


# ── Kleurenschaal temperatuur (noodweer.be stijl) ────────────────────────────
# Fijne schaal per 1°C: paars→blauw→cyaan→groen→geel→oranje→rood→donkerrood
TEMP_LEVELS = list(range(-20, 51))  # -20 tot +50, elke 1°C
# Noodweer.be stijl: paars→blauw→cyaan→groen→geelgroen→geel→oranje→rood→magenta
TEMP_COLORS_DEF = [
    (-30, "#cc00ff"),  # magenta
    (-25, "#8800cc"),  # donkerpaars
    (-20, "#5500aa"),  # paars
    (-15, "#2200aa"),  # donkerblauw/paars
    (-10, "#0044cc"),  # blauw
    (-5,  "#0088ee"),  # middenblauw
    (-2,  "#00bbdd"),  # cyaan
    (0,   "#00ccaa"),  # turquoise
    (2,   "#00cc66"),  # groen-cyaan
    (4,   "#00bb33"),  # helder groen
    (6,   "#22aa22"),  # groen
    (8,   "#44aa00"),  # groen (noodweer 8°C)
    (10,  "#66aa00"),  # donker geelgroen
    (12,  "#88aa00"),  # olijfgroen
    (14,  "#aaaa00"),  # geelgroen
    (16,  "#ccbb00"),  # donkergeel
    (18,  "#ddcc00"),  # geel
    (20,  "#eedd00"),  # lichtgeel
    (22,  "#ffdd00"),  # goud
    (24,  "#ffbb00"),  # donkergeel/oranje
    (26,  "#ff9900"),  # oranje
    (28,  "#ff6600"),  # donkeroranje
    (30,  "#ff3300"),  # rood-oranje
    (32,  "#ee0000"),  # rood
    (34,  "#cc0000"),  # donkerrood
    (36,  "#aa0000"),  # zeer donkerrood
    (38,  "#880044"),  # bordeaux
    (40,  "#aa0066"),  # donker magenta
    (45,  "#cc00aa"),  # magenta
    (50,  "#ee00cc"),  # roze
]

def _maak_temp_cmap():
    """Maak een vloeiende temperatuur-kleurenschaal."""
    # Interpoleer kleuren voor elke graad
    import matplotlib.colors as mc
    ref_vals = [v for v, _ in TEMP_COLORS_DEF]
    ref_colors = [mc.to_rgb(c) for _, c in TEMP_COLORS_DEF]
    colors = []
    for t in TEMP_LEVELS[:-1]:
        # Zoek interpolatie positie
        for i in range(len(ref_vals) - 1):
            if ref_vals[i] <= t <= ref_vals[i + 1]:
                frac = (t - ref_vals[i]) / (ref_vals[i + 1] - ref_vals[i])
                r = ref_colors[i][0] + frac * (ref_colors[i + 1][0] - ref_colors[i][0])
                g = ref_colors[i][1] + frac * (ref_colors[i + 1][1] - ref_colors[i][1])
                b = ref_colors[i][2] + frac * (ref_colors[i + 1][2] - ref_colors[i][2])
                colors.append((r, g, b))
                break
        else:
            if t < ref_vals[0]:
                colors.append(ref_colors[0])
            else:
                colors.append(ref_colors[-1])
    return mcolors.ListedColormap(colors), mcolors.BoundaryNorm(TEMP_LEVELS, len(colors))

CMAP_TEMP, NORM_TEMP = _maak_temp_cmap()

# Grid-stap voor het tonen van numerieke waarden (elke Nde punt)
TEMP_LABEL_STEP = 10  # toon waarde elke ~20 km


# ══════════════════════════════════════════════════════════════════════════════
# KAART RENDEREN
# ══════════════════════════════════════════════════════════════════════════════

DPI = 200
FIGSIZE = (10, 13)  # 3:4 verhouding (breed:hoog)

# Gridpunt-label stap
LABEL_STEP = 8  # toon waarde elke 8e gridpunt (~16 km)


def _maak_kaart_basis(titel_links, titel_rechts_boven, titel_rechts_onder):
    """Maak basis figuur met titel en cartopy axes. Wetterzentrale-stijl."""
    fig = plt.figure(figsize=FIGSIZE, facecolor="white")

    # Layout: titel boven, kaart groot, legenda horizontal onder
    ax_titel = fig.add_axes([0.01, 0.955, 0.98, 0.04])
    ax = fig.add_axes([0.01, 0.06, 0.98, 0.89], projection=ccrs.PlateCarree())
    ax_leg = fig.add_axes([0.15, 0.02, 0.70, 0.018])  # horizontaal onderaan

    # Titel
    ax_titel.set_xlim(0, 1); ax_titel.set_ylim(0, 1); ax_titel.axis("off")
    ax_titel.text(0.0, 0.55, titel_links, fontsize=14, weight="bold",
                  va="center", transform=ax_titel.transAxes, color="#1a1a1a")
    ax_titel.text(0.5, 0.55, titel_rechts_boven, fontsize=11, weight="bold",
                  ha="center", va="center", transform=ax_titel.transAxes, color="#333333")
    ax_titel.text(1.0, 0.55, titel_rechts_onder, fontsize=10,
                  ha="right", va="center", transform=ax_titel.transAxes, color="#555555")

    # Kaart
    ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.set_aspect("auto")
    ax.set_facecolor("white")

    # Water: meren (IJsselmeer, Markermeer, etc.)
    ax.add_feature(cfeature.LAKES.with_scale("10m"), facecolor="#d4e9f7",
                   edgecolor="#444444", linewidth=0.5, zorder=3)
    # Rivieren
    ax.add_feature(cfeature.RIVERS.with_scale("10m"), edgecolor="#7fbbdb",
                   linewidth=0.4, zorder=3)

    # Kustlijnen (incl. Afsluitdijk, Houtribdijk)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"), edgecolor="black",
                   linewidth=1.0, zorder=10)
    # Landsgrenzen
    ax.add_feature(cfeature.BORDERS.with_scale("10m"), edgecolor="#222222",
                   linewidth=0.6, linestyle="-", zorder=10)
    # Provinciegrenzen (dunnere lijn)
    ax.add_feature(cfeature.NaturalEarthFeature(
        "cultural", "admin_1_states_provinces_lines", "10m",
        edgecolor="#666666", linewidth=0.35, facecolor="none"), zorder=9)

    # Bronvermelding
    ax.text(0.005, 0.005, "Data: HARMONIE43 OPER 0.029\u00b0",
            transform=ax.transAxes, fontsize=7, weight="bold",
            ha="left", va="bottom", color="#333333", zorder=20)
    # Copyright rechtsonder in wit gebied onder de kaart
    fig.text(0.98, 0.045, "\u00a9 Ed Aldus / KNMI",
             fontsize=8, ha="right", va="top", color="#333333", weight="bold")

    return fig, ax, ax_leg


def _teken_gridwaarden(ax, lats, lons, data, fmt="{:.0f}", stap=LABEL_STEP,
                        cmap=None, norm=None, altijd_zwart=False):
    """Teken numerieke waarden op gridpunten — Wetterzentrale-stijl."""
    lon_min, lon_max = EXTENT[0], EXTENT[1]
    lat_min, lat_max = EXTENT[2], EXTENT[3]
    for i in range(0, len(lats), stap):
        for j in range(0, len(lons), stap):
            lat_v, lon_v = lats[i], lons[j]
            if lat_min <= lat_v <= lat_max and lon_min <= lon_v <= lon_max:
                val = data[i, j]
                if np.isnan(val):
                    continue
                txt = fmt.format(val)
                if altijd_zwart:
                    tkleur = "black"
                elif cmap is not None and norm is not None:
                    rgba = cmap(norm(val))
                    lum = 0.299 * rgba[0] + 0.587 * rgba[1] + 0.114 * rgba[2]
                    tkleur = "white" if lum < 0.4 else "black"
                else:
                    tkleur = "black"
                ax.text(lon_v, lat_v, txt, transform=ccrs.PlateCarree(),
                        fontsize=9, ha="center", va="center", color=tkleur,
                        weight="bold", zorder=12)


def render_kaart(lats, lons, precip_2d, tijdstip_str, uur_idx, run_str, output_dir="."):
    """Render neerslagkaart — Wetterzentrale-stijl met gridwaarden."""
    try:
        dt = datetime.fromisoformat(tijdstip_str).replace(tzinfo=LOCAL_TZ)
    except:
        dt = datetime.now(tz=LOCAL_TZ)

    dag_nl = nl_dagen[dt.weekday()]
    maand_nl = nl_maanden[dt.month]

    fig, ax, ax_leg = _maak_kaart_basis(
        "1h-Neerslag (mm)",
        f"Run: {run_str}",
        f"Geldig: {dag_nl} {dt.day} {maand_nl} {dt.strftime('%H:%M')} LT (+{uur_idx}h)"
    )

    data = np.nan_to_num(precip_2d.copy(), nan=0.0)
    lon_grid, lat_grid = np.meshgrid(lons, lats)

    # contourf voor vloeiende vulling
    cf = ax.contourf(
        lon_grid, lat_grid, data,
        levels=NEERSLAG_LEVELS,
        cmap=CMAP_NEERSLAG, norm=NORM_NEERSLAG,
        transform=ccrs.PlateCarree(),
        zorder=2, extend="max"
    )

    # Gridwaarden — afgeronde mm op elke Nde gridpunt
    _teken_gridwaarden(ax, lats, lons, data, fmt="{:.0f}", stap=LABEL_STEP,
                       altijd_zwart=True)

    ax.axis("off")

    # Legenda horizontaal onderaan
    cb = plt.colorbar(cf, cax=ax_leg, orientation="horizontal", spacing="uniform",
                      extend="max")
    cb.set_ticks(NEERSLAG_LEVELS)
    cb.ax.tick_params(labelsize=7)
    cb.set_label("Neerslagintensiteit (mm/u)", fontsize=8, labelpad=2)

    fname = os.path.join(output_dir, f"harmonie_neerslag_{uur_idx:02d}.png")
    plt.savefig(fname, dpi=DPI, bbox_inches="tight", facecolor="white",
                edgecolor="none", pad_inches=0.03)
    plt.close()
    return fname


def render_temp_kaart(lats, lons, temp_2d, tijdstip_str, uur_idx, run_str, output_dir="."):
    """Render temperatuurkaart — noodweer.be stijl met numerieke waarden."""
    try:
        dt = datetime.fromisoformat(tijdstip_str).replace(tzinfo=LOCAL_TZ)
    except:
        dt = datetime.now(tz=LOCAL_TZ)

    dag_nl = nl_dagen[dt.weekday()]
    maand_nl = nl_maanden[dt.month]

    fig, ax, ax_leg = _maak_kaart_basis(
        "Temperatuur 2m (\u00b0C)",
        f"Run: {run_str}",
        f"Geldig: {dag_nl} {dt.day} {maand_nl} {dt.strftime('%H:%M')} LT (+{uur_idx}h)"
    )

    data = np.nan_to_num(temp_2d.copy(), nan=0.0)
    lon_grid, lat_grid = np.meshgrid(lons, lats)

    # contourf vulling — fijne stappen per 1°C
    t_min = max(-20, int(np.floor(np.nanmin(data))) - 2)
    t_max = min(50, int(np.ceil(np.nanmax(data))) + 2)
    fine_levels = list(range(t_min, t_max + 1))

    cf = ax.contourf(
        lon_grid, lat_grid, data,
        levels=fine_levels,
        cmap=CMAP_TEMP, norm=NORM_TEMP,
        transform=ccrs.PlateCarree(),
        zorder=2, extend="both"
    )

    # Numerieke waarden op gridpunten (Wetterzentrale-stijl)
    _teken_gridwaarden(ax, lats, lons, data, fmt="{:.0f}", stap=LABEL_STEP,
                       cmap=CMAP_TEMP, norm=NORM_TEMP)

    ax.axis("off")

    # Legenda horizontaal onderaan
    cb = plt.colorbar(cf, cax=ax_leg, orientation="horizontal", spacing="uniform",
                      extend="both")
    cb.set_ticks(list(range(t_min, t_max + 1, 3)))
    cb.ax.tick_params(labelsize=7)
    cb.set_label("Temperatuur 2m (\u00b0C)", fontsize=8, labelpad=2)

    fname = os.path.join(output_dir, f"harmonie_temp_{uur_idx:02d}.png")
    plt.savefig(fname, dpi=DPI, bbox_inches="tight", facecolor="white",
                edgecolor="none", pad_inches=0.03)
    plt.close()
    return fname


# ── Wind kleurenschaal — Beaufort (bft) ──────────────────────────────────────
# Beaufort grenzen in m/s: 0,1,2,3,4,5,6,7,8,9,10,11,12
BFT_GRENZEN_MS = [0, 0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7]
WIND_LEVELS_BFT = list(range(13))  # 0-12 Beaufort
WIND_COLORS = [
    "#f0f0f0",  # 0  windstil
    "#d4eaf7",  # 1  zwak
    "#a8d5f0",  # 2  zwak
    "#6cb8e0",  # 3  matig
    "#3a9fd0",  # 4  matig
    "#28b463",  # 5  vrij krachtig
    "#7dcea0",  # 6  krachtig
    "#f7dc6f",  # 7  hard
    "#f5b041",  # 8  stormachtig
    "#e74c3c",  # 9  storm
    "#c0392b",  # 10 zware storm
    "#8e44ad",  # 11 zeer zware storm
]
CMAP_WIND = mcolors.ListedColormap(WIND_COLORS)
NORM_WIND = mcolors.BoundaryNorm(WIND_LEVELS_BFT, CMAP_WIND.N)

def ms_naar_bft(ms):
    """Converteer m/s naar Beaufort."""
    for bft in range(12, -1, -1):
        if ms >= BFT_GRENZEN_MS[bft]:
            return bft
    return 0

# Windstoten kleurenschaal — km/u
GUST_LEVELS = [0, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 140]  # km/u
GUST_COLORS = [
    "#f0f0f0",  # 0
    "#d4eaf7",  # 20
    "#a8d5f0",  # 30
    "#6cb8e0",  # 40
    "#28b463",  # 50
    "#f7dc6f",  # 60
    "#f5b041",  # 70
    "#eb984e",  # 80
    "#e74c3c",  # 90
    "#c0392b",  # 100
    "#8e44ad",  # 110
    "#6c3483",  # 120
]
CMAP_GUST = mcolors.ListedColormap(GUST_COLORS)
NORM_GUST = mcolors.BoundaryNorm(GUST_LEVELS, CMAP_GUST.N)

# Pijltjes stap (elke Nde gridpunt)
BARB_STEP = 12


def _render_wind_kaart(lats, lons, u, v, tijdstip_str, uur_idx, run_str,
                        is_stoten=False, output_dir="."):
    """Render wind (Bft) of windstoten (km/u) kaart met kleur + pijltjes."""
    try:
        dt = datetime.fromisoformat(tijdstip_str).replace(tzinfo=LOCAL_TZ)
    except:
        dt = datetime.now(tz=LOCAL_TZ)

    dag_nl = nl_dagen[dt.weekday()]
    maand_nl = nl_maanden[dt.month]

    # Windsnelheid berekenen (m/s)
    u_data = np.nan_to_num(u.copy(), nan=0.0)
    v_data = np.nan_to_num(v.copy(), nan=0.0)
    snelheid_ms = np.sqrt(u_data**2 + v_data**2)

    if is_stoten:
        titel = "Windstoten 10m (km/u)"
        prefix = "harmonie_windstoten"
        cmap, norm, levels = CMAP_GUST, NORM_GUST, GUST_LEVELS
        # Converteer naar km/u voor weergave
        display_data = snelheid_ms * 3.6
        label_fmt = "{:.0f}"
        eenheid = "Windstoten (km/u)"
    else:
        titel = "Wind 10m (Bft)"
        prefix = "harmonie_wind"
        cmap, norm, levels = CMAP_WIND, NORM_WIND, WIND_LEVELS_BFT
        # Converteer naar Beaufort voor weergave
        bft_vectorized = np.vectorize(ms_naar_bft)
        display_data = bft_vectorized(snelheid_ms).astype(float)
        label_fmt = "{:.0f}"
        eenheid = "Windkracht (Bft)"

    fig, ax, ax_leg = _maak_kaart_basis(
        titel,
        f"Run: {run_str}",
        f"Geldig: {dag_nl} {dt.day} {maand_nl} {dt.strftime('%H:%M')} LT (+{uur_idx}h)"
    )

    lon_grid, lat_grid = np.meshgrid(lons, lats)

    # Kleurvulling
    cf = ax.contourf(
        lon_grid, lat_grid, display_data,
        levels=levels, cmap=cmap, norm=norm,
        transform=ccrs.PlateCarree(),
        zorder=2, extend="max"
    )

    # Gridwaarden
    _teken_gridwaarden(ax, lats, lons, display_data, fmt=label_fmt, stap=LABEL_STEP,
                       cmap=cmap, norm=norm)

    # Windpijltjes (barbs) — alleen bij gemiddelde wind, niet bij stoten
    if not is_stoten:
        step = BARB_STEP
        lat_mask = (lats >= EXTENT[2]) & (lats <= EXTENT[3])
        lon_mask = (lons >= EXTENT[0]) & (lons <= EXTENT[1])
        lat_idx = np.where(lat_mask)[0][::step]
        lon_idx = np.where(lon_mask)[0][::step]

        barb_lons = lons[lon_idx]
        barb_lats = lats[lat_idx]
        barb_lon_grid, barb_lat_grid = np.meshgrid(barb_lons, barb_lats)
        barb_u = u_data[np.ix_(lat_idx, lon_idx)] * 1.94384
        barb_v = v_data[np.ix_(lat_idx, lon_idx)] * 1.94384

        ax.barbs(barb_lon_grid, barb_lat_grid, barb_u, barb_v,
                 transform=ccrs.PlateCarree(), length=5.5, linewidth=0.5,
                 barb_increments=dict(half=2.5, full=5, flag=25),
                 zorder=11, color="black", sizes=dict(emptybarb=0.05))

    ax.axis("off")

    # Legenda
    cb = plt.colorbar(cf, cax=ax_leg, orientation="horizontal", spacing="uniform",
                      extend="max")
    cb.set_ticks(levels)
    cb.ax.tick_params(labelsize=7)
    cb.set_label(eenheid, fontsize=8, labelpad=2)

    fname = os.path.join(output_dir, f"{prefix}_{uur_idx:02d}.png")
    plt.savefig(fname, dpi=DPI, bbox_inches="tight", facecolor="white",
                edgecolor="none", pad_inches=0.03)
    plt.close()
    return fname


def render_wind_kaart(lats, lons, u, v, tijdstip_str, uur_idx, run_str, output_dir="."):
    """Render gemiddelde wind 10m kaart."""
    return _render_wind_kaart(lats, lons, u, v, tijdstip_str, uur_idx, run_str,
                               is_stoten=False, output_dir=output_dir)


def render_windstoten_kaart(lats, lons, u, v, tijdstip_str, uur_idx, run_str, output_dir="."):
    """Render windstoten 10m kaart."""
    return _render_wind_kaart(lats, lons, u, v, tijdstip_str, uur_idx, run_str,
                               is_stoten=True, output_dir=output_dir)


# ── Bewolking kleuren per laag ────────────────────────────────────────────────
# Hoog (cirrus): wit/lichtblauw — ijl, transparant
CLOUD_HIGH_CMAP = mcolors.LinearSegmentedColormap.from_list(
    "cloud_high", ["#ffffff00", "#b0c4de88", "#8fafc8cc", "#7090a8ee"], N=256)
# Midden (alto): geel/oker — dichter
CLOUD_MID_CMAP = mcolors.LinearSegmentedColormap.from_list(
    "cloud_mid", ["#ffffff00", "#ddcc6688", "#ccaa33cc", "#aa8800ee"], N=256)
# Laag (stratus/cumulus): grijs/donker — meest opaque
CLOUD_LOW_CMAP = mcolors.LinearSegmentedColormap.from_list(
    "cloud_low", ["#ffffff00", "#aaaaaa88", "#777777cc", "#444444ee"], N=256)

CLOUD_NORM = mcolors.Normalize(vmin=0, vmax=1)

# ── CAPE kleurenschaal ───────────────────────────────────────────────────────
CAPE_LEVELS = [0, 50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000]  # J/kg
CAPE_COLORS = [
    "#f0f0f0",  # 0     geen
    "#d4eaf7",  # 50    minimaal
    "#a8d5f0",  # 100   zwak
    "#6cb8e0",  # 250   matig
    "#28b463",  # 500   aanzienlijk
    "#f7dc6f",  # 750   sterk
    "#f5b041",  # 1000  zeer sterk
    "#e74c3c",  # 1500  extreem
    "#c0392b",  # 2000  gevaarlijk
    "#8e44ad",  # 3000  zeer gevaarlijk
    "#6c3483",  # 4000  extreem gevaarlijk
]
CMAP_CAPE = mcolors.ListedColormap(CAPE_COLORS)
NORM_CAPE = mcolors.BoundaryNorm(CAPE_LEVELS, CMAP_CAPE.N)


def render_cape_kaart(lats, lons, cape, onweer, tijdstip_str, uur_idx, run_str, output_dir="."):
    """Render CAPE kaart met onweervlag-arcering."""
    try:
        dt = datetime.fromisoformat(tijdstip_str).replace(tzinfo=LOCAL_TZ)
    except:
        dt = datetime.now(tz=LOCAL_TZ)

    dag_nl = nl_dagen[dt.weekday()]
    maand_nl = nl_maanden[dt.month]

    fig, ax, ax_leg = _maak_kaart_basis(
        "CAPE (J/kg) + Onweer",
        f"Run: {run_str}",
        f"Geldig: {dag_nl} {dt.day} {maand_nl} {dt.strftime('%H:%M')} LT (+{uur_idx}h)"
    )

    data = np.nan_to_num(cape.copy(), nan=0.0)
    lon_grid, lat_grid = np.meshgrid(lons, lats)

    # CAPE kleurvulling
    cf = ax.contourf(
        lon_grid, lat_grid, data,
        levels=CAPE_LEVELS, cmap=CMAP_CAPE, norm=NORM_CAPE,
        transform=ccrs.PlateCarree(),
        zorder=2, extend="max"
    )

    # Onweervlag als arcering (waar onweer > 0)
    onweer_data = np.nan_to_num(onweer.copy(), nan=0.0)
    if np.max(onweer_data) > 0:
        ax.contourf(
            lon_grid, lat_grid, onweer_data,
            levels=[0.5, 2], colors="none",
            hatches=["///"], transform=ccrs.PlateCarree(),
            zorder=6, alpha=0.0
        )
        # Contour rond onweergebieden
        ax.contour(
            lon_grid, lat_grid, onweer_data,
            levels=[0.5], colors="red", linewidths=1.5,
            transform=ccrs.PlateCarree(), zorder=7
        )

    # Gridwaarden
    _teken_gridwaarden(ax, lats, lons, data, fmt="{:.0f}", stap=LABEL_STEP,
                       cmap=CMAP_CAPE, norm=NORM_CAPE)

    ax.axis("off")

    # Legenda
    cb = plt.colorbar(cf, cax=ax_leg, orientation="horizontal", spacing="uniform",
                      extend="max")
    cb.set_ticks(CAPE_LEVELS)
    cb.ax.tick_params(labelsize=6)
    cb.set_label("CAPE (J/kg) — gearceerd = onweersvlag actief", fontsize=7, labelpad=2)

    fname = os.path.join(output_dir, f"harmonie_cape_{uur_idx:02d}.png")
    plt.savefig(fname, dpi=DPI, bbox_inches="tight", facecolor="white",
                edgecolor="none", pad_inches=0.03)
    plt.close()
    return fname


# ── Luchtdruk kleurenschaal ───────────────────────────────────────────────────
DRUK_LEVELS = list(range(970, 1055, 2))  # hPa, elke 2 hPa
DRUK_COLORS_DEF = [
    (970, "#4a0082"),  # zeer laag — diep paars
    (980, "#6a3d9a"),  # laag — paars
    (990, "#1f78b4"),  # onder normaal — blauw
    (1000, "#33a02c"), # normaal laag — groen
    (1010, "#b2df8a"), # normaal — lichtgroen
    (1015, "#ffffb3"), # normaal — lichtgeel
    (1020, "#fdbf6f"), # boven normaal — geel/oranje
    (1030, "#ff7f00"), # hoog — oranje
    (1040, "#e31a1c"), # zeer hoog — rood
    (1050, "#800026"), # extreem — donkerrood
]

def _maak_druk_cmap():
    import matplotlib.colors as mc
    ref_vals = [v for v, _ in DRUK_COLORS_DEF]
    ref_colors = [mc.to_rgb(c) for _, c in DRUK_COLORS_DEF]
    colors = []
    for hpa in DRUK_LEVELS[:-1]:
        for i in range(len(ref_vals) - 1):
            if ref_vals[i] <= hpa <= ref_vals[i + 1]:
                frac = (hpa - ref_vals[i]) / (ref_vals[i + 1] - ref_vals[i])
                r = ref_colors[i][0] + frac * (ref_colors[i + 1][0] - ref_colors[i][0])
                g = ref_colors[i][1] + frac * (ref_colors[i + 1][1] - ref_colors[i][1])
                b = ref_colors[i][2] + frac * (ref_colors[i + 1][2] - ref_colors[i][2])
                colors.append((r, g, b))
                break
        else:
            colors.append(ref_colors[-1] if hpa > ref_vals[-1] else ref_colors[0])
    return mcolors.ListedColormap(colors), mcolors.BoundaryNorm(DRUK_LEVELS, len(colors))

CMAP_DRUK, NORM_DRUK = _maak_druk_cmap()


def render_druk_kaart(lats, lons, druk_pa, tijdstip_str, uur_idx, run_str, output_dir="."):
    """Render luchtdruk (MSLP) kaart met isobaren."""
    try:
        dt = datetime.fromisoformat(tijdstip_str).replace(tzinfo=LOCAL_TZ)
    except:
        dt = datetime.now(tz=LOCAL_TZ)

    dag_nl = nl_dagen[dt.weekday()]
    maand_nl = nl_maanden[dt.month]

    fig, ax, ax_leg = _maak_kaart_basis(
        "Luchtdruk zeeniveau (hPa)",
        f"Run: {run_str}",
        f"Geldig: {dag_nl} {dt.day} {maand_nl} {dt.strftime('%H:%M')} LT (+{uur_idx}h)"
    )

    # Pa naar hPa
    data = np.nan_to_num(druk_pa.copy(), nan=101325.0) / 100.0
    lon_grid, lat_grid = np.meshgrid(lons, lats)

    # Kleurvulling
    cf = ax.contourf(
        lon_grid, lat_grid, data,
        levels=DRUK_LEVELS, cmap=CMAP_DRUK, norm=NORM_DRUK,
        transform=ccrs.PlateCarree(),
        zorder=2, extend="both"
    )

    # Isobaren (elke 4 hPa, dikker)
    isobar_levels = list(range(970, 1055, 4))
    cs = ax.contour(
        lon_grid, lat_grid, data,
        levels=isobar_levels, colors="black", linewidths=0.8,
        transform=ccrs.PlateCarree(), zorder=6
    )
    ax.clabel(cs, inline=True, fontsize=7, fmt="%d")

    # Gridwaarden (afgerond op geheel)
    _teken_gridwaarden(ax, lats, lons, data, fmt="{:.0f}", stap=LABEL_STEP,
                       cmap=CMAP_DRUK, norm=NORM_DRUK)

    ax.axis("off")

    # Legenda
    cb = plt.colorbar(cf, cax=ax_leg, orientation="horizontal", spacing="uniform",
                      extend="both")
    cb.set_ticks(list(range(970, 1055, 5)))
    cb.ax.tick_params(labelsize=6)
    cb.set_label("Luchtdruk zeeniveau (hPa)", fontsize=8, labelpad=2)

    fname = os.path.join(output_dir, f"harmonie_druk_{uur_idx:02d}.png")
    plt.savefig(fname, dpi=DPI, bbox_inches="tight", facecolor="white",
                edgecolor="none", pad_inches=0.03)
    plt.close()
    return fname


# ── Zicht kleurenschaal ──────────────────────────────────────────────────────
# Omgekeerd: slecht zicht = rood/oranje, goed zicht = groen/blauw
ZICHT_LEVELS = [0, 200, 500, 1000, 2000, 4000, 7000, 10000, 20000, 35000, 50000]  # meters
ZICHT_COLORS = [
    "#990033",  # <200m   dichte mist, donkerrood
    "#cc0000",  # 200m    mist, rood
    "#ff4400",  # 500m    dichte nevel, oranje
    "#ff8800",  # 1km     nevel, licht oranje
    "#ffcc00",  # 2km     slecht zicht, geel
    "#dddd44",  # 4km     matig zicht, geelgroen
    "#88cc44",  # 7km     redelijk zicht, lichtgroen
    "#44aa44",  # 10km    goed zicht, groen
    "#88ccee",  # 20km    zeer goed zicht, lichtblauw
    "#cceeff",  # 35km    uitstekend zicht, heel lichtblauw
]
CMAP_ZICHT = mcolors.ListedColormap(ZICHT_COLORS)
NORM_ZICHT = mcolors.BoundaryNorm(ZICHT_LEVELS, CMAP_ZICHT.N)


def render_zicht_kaart(lats, lons, zicht_m, tijdstip_str, uur_idx, run_str, output_dir="."):
    """Render zichtkaart — slecht zicht rood, goed zicht blauw/groen."""
    try:
        dt = datetime.fromisoformat(tijdstip_str).replace(tzinfo=LOCAL_TZ)
    except:
        dt = datetime.now(tz=LOCAL_TZ)

    dag_nl = nl_dagen[dt.weekday()]
    maand_nl = nl_maanden[dt.month]

    fig, ax, ax_leg = _maak_kaart_basis(
        "Zicht (km)",
        f"Run: {run_str}",
        f"Geldig: {dag_nl} {dt.day} {maand_nl} {dt.strftime('%H:%M')} LT (+{uur_idx}h)"
    )

    data = np.nan_to_num(zicht_m.copy(), nan=50000.0)
    lon_grid, lat_grid = np.meshgrid(lons, lats)

    # Kleurvulling
    cf = ax.contourf(
        lon_grid, lat_grid, data,
        levels=ZICHT_LEVELS, cmap=CMAP_ZICHT, norm=NORM_ZICHT,
        transform=ccrs.PlateCarree(),
        zorder=2, extend="both"
    )

    # Gridwaarden: <5 km in meters, >=5 km in km
    def fmt_zicht(val_m):
        if val_m < 5000:
            return f"{val_m:.0f}"
        return f"{val_m/1000:.0f}"
    fmt_vec = np.vectorize(fmt_zicht)
    data_fmt = fmt_vec(data)

    # Teken waarden
    lon_min, lon_max = EXTENT[0], EXTENT[1]
    lat_min, lat_max = EXTENT[2], EXTENT[3]
    for i in range(0, len(lats), LABEL_STEP):
        for j in range(0, len(lons), LABEL_STEP):
            lat_v, lon_v = lats[i], lons[j]
            if lat_min <= lat_v <= lat_max and lon_min <= lon_v <= lon_max:
                val_m = data[i, j]
                rgba = CMAP_ZICHT(NORM_ZICHT(val_m))
                lum = 0.299 * rgba[0] + 0.587 * rgba[1] + 0.114 * rgba[2]
                tkleur = "white" if lum < 0.4 else "black"
                ax.text(lon_v, lat_v, data_fmt[i, j], transform=ccrs.PlateCarree(),
                        fontsize=7.5, ha="center", va="center", color=tkleur,
                        weight="bold", zorder=12)

    ax.axis("off")

    # Legenda
    cb = plt.colorbar(cf, cax=ax_leg, orientation="horizontal", spacing="uniform",
                      extend="both")
    # Labels in km
    cb.set_ticks(ZICHT_LEVELS)
    cb.set_ticklabels([f"{v}m" if v < 5000 else f"{v//1000}km" for v in ZICHT_LEVELS])
    cb.ax.tick_params(labelsize=7)
    cb.set_label("Zicht (km)", fontsize=8, labelpad=2)

    fname = os.path.join(output_dir, f"harmonie_zicht_{uur_idx:02d}.png")
    plt.savefig(fname, dpi=DPI, bbox_inches="tight", facecolor="white",
                edgecolor="none", pad_inches=0.03)
    plt.close()
    return fname


def render_bewolking_kaart(lats, lons, hoog, midden, laag, tijdstip_str, uur_idx,
                            run_str, output_dir="."):
    """Render bewolkingskaart — 3 lagen met eigen kleur.
    Renderorde: hoog eerst (onder), midden erover, laag bovenop.
    Hoog = wit/lichtblauw, Midden = geel/oker, Laag = grijs/donker.
    """
    try:
        dt = datetime.fromisoformat(tijdstip_str).replace(tzinfo=LOCAL_TZ)
    except:
        dt = datetime.now(tz=LOCAL_TZ)

    dag_nl = nl_dagen[dt.weekday()]
    maand_nl = nl_maanden[dt.month]

    fig, ax, ax_leg = _maak_kaart_basis(
        "Bewolking (hoog/midden/laag)",
        f"Run: {run_str}",
        f"Geldig: {dag_nl} {dt.day} {maand_nl} {dt.strftime('%H:%M')} LT (+{uur_idx}h)"
    )

    ax.set_facecolor("#c8e8ff")
    lon_grid, lat_grid = np.meshgrid(lons, lats)

    # Laag 1 (onderaan): Hoge bewolking — wit/lichtblauw
    hoog_data = np.nan_to_num(hoog.copy(), nan=0.0)
    hoog_masked = np.ma.masked_less(hoog_data, 0.05)
    ax.pcolormesh(lon_grid, lat_grid, hoog_masked,
                  cmap=CLOUD_HIGH_CMAP, norm=CLOUD_NORM,
                  transform=ccrs.PlateCarree(), zorder=2, shading="auto")

    # Laag 2 (midden): Middelhoge bewolking — geel/oker
    mid_data = np.nan_to_num(midden.copy(), nan=0.0)
    mid_masked = np.ma.masked_less(mid_data, 0.05)
    ax.pcolormesh(lon_grid, lat_grid, mid_masked,
                  cmap=CLOUD_MID_CMAP, norm=CLOUD_NORM,
                  transform=ccrs.PlateCarree(), zorder=3, shading="auto")

    # Laag 3 (bovenop): Lage bewolking — grijs/donker
    laag_data = np.nan_to_num(laag.copy(), nan=0.0)
    laag_masked = np.ma.masked_less(laag_data, 0.05)
    ax.pcolormesh(lon_grid, lat_grid, laag_masked,
                  cmap=CLOUD_LOW_CMAP, norm=CLOUD_NORM,
                  transform=ccrs.PlateCarree(), zorder=4, shading="auto")

    ax.axis("off")

    # Legenda: drie kleurvakjes
    ax_leg.set_xlim(0, 1); ax_leg.set_ylim(0, 1); ax_leg.axis("off")
    labels = [
        ("Hoog (cirrus)", "#8fafc8", 0.05),
        ("Midden (alto)", "#ccaa33", 0.40),
        ("Laag (stratus)", "#666666", 0.75),
    ]
    for tekst, kleur, x_pos in labels:
        ax_leg.add_patch(plt.Rectangle((x_pos, 0.3), 0.06, 0.5,
                         facecolor=kleur, edgecolor="#333", linewidth=0.5,
                         transform=ax_leg.transAxes))
        ax_leg.text(x_pos + 0.075, 0.55, tekst, fontsize=8, va="center",
                    transform=ax_leg.transAxes, color="#333333")

    fname = os.path.join(output_dir, f"harmonie_bewolking_{uur_idx:02d}.png")
    plt.savefig(fname, dpi=DPI, bbox_inches="tight", facecolor="white",
                edgecolor="none", pad_inches=0.03)
    plt.close()
    return fname


# ══════════════════════════════════════════════════════════════════════════════
# METADATA
# ══════════════════════════════════════════════════════════════════════════════

def schrijf_metadata(times_str, run_str, output_dir="."):
    meta = {
        "model": "Harmonie 43",
        "parameter": "neerslag",
        "run": run_str,
        "bijgewerkt": datetime.now(tz=LOCAL_TZ).strftime("%d %b %Y %H:%M"),
        "uren": len(times_str),
        "tijden": times_str,
    }
    path = os.path.join(output_dir, "harmonie_meta.json")
    with open(path, "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print(f"Metadata: {path}")


# ══════════════════════════════════════════════════════════════════════════════
# HOOFDPROGRAMMA
# ══════════════════════════════════════════════════════════════════════════════

def opruimen_oude_kaarten(output_dir="."):
    """Verwijder alle vorige harmonie kaarten en metadata."""
    import glob as g
    patronen = [
        "harmonie_neerslag_*.png", "harmonie_temp_*.png", "harmonie_bewolking_*.png",
        "harmonie_wind_*.png", "harmonie_windstoten_*.png", "harmonie_zicht_*.png",
        "harmonie_cape_*.png", "harmonie_druk_*.png", "harmonie_*_meta.json",
        "harmonie_meta.json",
    ]
    totaal = 0
    for patroon in patronen:
        for f in g.glob(os.path.join(output_dir, patroon)):
            os.remove(f)
            totaal += 1
    if totaal:
        print(f"  {totaal} oude bestanden verwijderd")


def main():
    import eccodes
    t_start = time.time()

    print("=" * 60)
    print("Harmonie 43 weerkaarten — alle parameters")
    print("=" * 60)

    if not KNMI_OPEN_DATA_KEY:
        print("FOUT: Geen KNMI_OPEN_DATA_KEY!")
        sys.exit(1)

    # ── Stap 1: Laatste run vinden en downloaden ─────────────────────────────
    print("\n1. KNMI Open Data API — laatste run zoeken...")
    filename = knmi_laatste_bestand()
    print(f"   Bestand: {filename}")

    # Parse run-tijd
    parts = filename.replace(".tar", "").split("_")
    run_str_raw = parts[-1] if parts else ""
    try:
        run_dt = datetime.strptime(run_str_raw[:10], "%Y%m%d%H").replace(tzinfo=timezone.utc)
    except:
        run_dt = datetime.now(tz=timezone.utc)
    run_str = run_dt.astimezone(LOCAL_TZ).strftime("%a %d.%m.%Y %Hz").lower()

    # Download
    print("\n2. Downloaden + extracten...")
    with tempfile.TemporaryDirectory(prefix="harmonie_") as tmpdir:
        grib_files = knmi_download_grib(filename, tmpdir)
        grib_files = sorted(grib_files)
        print(f"   {len(grib_files)} GRIB bestanden")

        # ── Stap 2: Alle data lezen ──────────────────────────────────────────
        print("\n3. GRIB data lezen (alle parameters)...")
        all_temp = []; all_cum = []; all_hoog = []; all_mid = []; all_laag = []
        all_uw = []; all_vw = []; all_ug = []; all_vg = []
        all_zicht = []; all_cape = []; all_onweer = []; all_druk = []
        lats = lons = None

        for gf in grib_files:
            temp = cum = hoog = mid = laag = uw = vw = ug = vg = zicht = druk = None
            cape_list = []; onweer = None; druk_n = 0

            with open(gf, "rb") as fh:
                while True:
                    msgid = eccodes.codes_grib_new_from_file(fh)
                    if msgid is None:
                        break
                    ind = eccodes.codes_get(msgid, "indicatorOfParameter")
                    lvl = eccodes.codes_get(msgid, "level")
                    ni = eccodes.codes_get(msgid, "Ni")
                    nj = eccodes.codes_get(msgid, "Nj")
                    vals = eccodes.codes_get_values(msgid).reshape(nj, ni)

                    if ind == 11 and lvl == 2: temp = vals - 273.15
                    elif ind == 61: cum = vals
                    elif ind == 75: hoog = vals
                    elif ind == 74: mid = vals
                    elif ind == 73: laag = vals
                    elif ind == 33 and lvl == 10: uw = vals
                    elif ind == 34 and lvl == 10: vw = vals
                    elif ind == 162 and lvl == 10: ug = vals
                    elif ind == 163 and lvl == 10: vg = vals
                    elif ind == 20 and zicht is None: zicht = vals
                    elif ind == 201: cape_list.append(vals)
                    elif ind == 184 and onweer is None: onweer = vals
                    elif ind == 1 and lvl == 0:
                        druk_n += 1
                        if druk_n == 1: druk = vals

                    if lats is None:
                        lat1 = eccodes.codes_get(msgid, "latitudeOfFirstGridPointInDegrees")
                        lat2 = eccodes.codes_get(msgid, "latitudeOfLastGridPointInDegrees")
                        lon1 = eccodes.codes_get(msgid, "longitudeOfFirstGridPointInDegrees")
                        lon2 = eccodes.codes_get(msgid, "longitudeOfLastGridPointInDegrees")
                        lats = np.linspace(lat1, lat2, nj)
                        lons = np.linspace(lon1, lon2, ni)
                    eccodes.codes_release(msgid)

            z = np.zeros((nj, ni))
            all_temp.append(temp); all_cum.append(cum)
            all_hoog.append(hoog); all_mid.append(mid); all_laag.append(laag)
            all_uw.append(uw); all_vw.append(vw)
            all_ug.append(ug); all_vg.append(vg)
            all_zicht.append(zicht)
            all_cape.append(cape_list[-1] if cape_list else z)
            all_onweer.append(onweer if onweer is not None else z)
            all_druk.append(druk)

        # Lats zuid->noord
        if lats[0] > lats[-1]:
            lats = lats[::-1]
            for lst in [all_temp, all_cum, all_hoog, all_mid, all_laag,
                        all_uw, all_vw, all_ug, all_vg,
                        all_zicht, all_cape, all_onweer, all_druk]:
                for i in range(len(lst)):
                    if lst[i] is not None:
                        lst[i] = lst[i][::-1, :]

        # Uurlijkse neerslag
        hourly = [np.maximum(all_cum[i] - all_cum[i - 1], 0) for i in range(1, len(all_cum))]

        # Tijden
        times_str = []
        for h in range(1, len(grib_files)):
            dt_valid = run_dt + timedelta(hours=h)
            dt_local = dt_valid.astimezone(LOCAL_TZ)
            times_str.append(dt_local.strftime("%Y-%m-%dT%H:%M"))

        print(f"   {len(grib_files)} tijdstappen, grid {lats.shape[0]}x{lons.shape[0]}")

    # ── Stap 3: Oude kaarten opruimen ────────────────────────────────────────
    print("\n4. Oude kaarten opruimen...")
    opruimen_oude_kaarten()

    # ── Stap 4: Alle kaarten renderen ────────────────────────────────────────
    def meta(param, prefix):
        m = {"model": "Harmonie 43", "parameter": param, "run": run_str,
             "bijgewerkt": datetime.now(tz=LOCAL_TZ).strftime("%d %b %Y %H:%M"),
             "uren": len(times_str), "tijden": times_str}
        with open(f"harmonie_{prefix}_meta.json", "w") as f:
            json.dump(m, f, indent=2, ensure_ascii=False)

    n = len(times_str)

    print(f"\n5. Kaarten renderen (8 x {n} = {8*n} stuks)...")

    print(f"   Neerslag...", end=" ", flush=True)
    t0 = time.time()
    for h in range(n):
        render_kaart(lats, lons, hourly[h], times_str[h], h + 1, run_str)
    # Ook harmonie_meta.json voor backwards compat
    meta("neerslag", "meta")
    print(f"{time.time()-t0:.0f}s")

    print(f"   Temperatuur...", end=" ", flush=True)
    t0 = time.time()
    for h in range(1, len(all_temp)):
        render_temp_kaart(lats, lons, all_temp[h], times_str[h - 1], h, run_str)
    meta("temperatuur", "temp_meta")
    print(f"{time.time()-t0:.0f}s")

    print(f"   Bewolking...", end=" ", flush=True)
    t0 = time.time()
    for h in range(1, len(all_hoog)):
        render_bewolking_kaart(lats, lons, all_hoog[h], all_mid[h], all_laag[h],
                               times_str[h - 1], h, run_str)
    meta("bewolking", "bewolking_meta")
    print(f"{time.time()-t0:.0f}s")

    print(f"   Wind...", end=" ", flush=True)
    t0 = time.time()
    for h in range(1, len(all_uw)):
        render_wind_kaart(lats, lons, all_uw[h], all_vw[h], times_str[h - 1], h, run_str)
    meta("wind", "wind_meta")
    print(f"{time.time()-t0:.0f}s")

    print(f"   Windstoten...", end=" ", flush=True)
    t0 = time.time()
    for h in range(1, len(all_ug)):
        render_windstoten_kaart(lats, lons, all_ug[h], all_vg[h], times_str[h - 1], h, run_str)
    meta("windstoten", "windstoten_meta")
    print(f"{time.time()-t0:.0f}s")

    print(f"   Zicht...", end=" ", flush=True)
    t0 = time.time()
    for h in range(1, len(all_zicht)):
        render_zicht_kaart(lats, lons, all_zicht[h], times_str[h - 1], h, run_str)
    meta("zicht", "zicht_meta")
    print(f"{time.time()-t0:.0f}s")

    print(f"   CAPE...", end=" ", flush=True)
    t0 = time.time()
    for h in range(1, len(all_cape)):
        render_cape_kaart(lats, lons, all_cape[h], all_onweer[h],
                          times_str[h - 1], h, run_str)
    meta("cape", "cape_meta")
    print(f"{time.time()-t0:.0f}s")

    print(f"   Luchtdruk...", end=" ", flush=True)
    t0 = time.time()
    for h in range(1, len(all_druk)):
        render_druk_kaart(lats, lons, all_druk[h], times_str[h - 1], h, run_str)
    meta("druk", "druk_meta")
    print(f"{time.time()-t0:.0f}s")

    totaal = time.time() - t_start
    print(f"\n{'='*60}")
    print(f"KLAAR! {8*n} kaarten in {totaal/60:.1f} minuten")
    print(f"Run: {run_str}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
