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
                        fontsize=7.5, ha="center", va="center", color=tkleur,
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


def render_bewolking_kaart(lats, lons, hoog, midden, laag, tijdstip_str, uur_idx,
                            run_str, output_dir="."):
    """Render bewolkingskaart — 3 lagen in verschillende kleuren.
    Renderorde: hoog eerst (onder), midden erover, laag bovenop.
    Zo zie je altijd alle lagen.
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

    # Lichtblauwe lucht als achtergrond
    ax.set_facecolor("#c8e8ff")

    lon_grid, lat_grid = np.meshgrid(lons, lats)

    # Laag 1 (onderaan): Hoge bewolking — wit/lichtblauw, ijl
    hoog_data = np.nan_to_num(hoog.copy(), nan=0.0)
    hoog_masked = np.ma.masked_less(hoog_data, 0.05)
    ax.pcolormesh(lon_grid, lat_grid, hoog_masked,
                  cmap=CLOUD_HIGH_CMAP, norm=CLOUD_NORM,
                  transform=ccrs.PlateCarree(), zorder=2, shading="auto")

    # Laag 2 (midden): Middelhoge bewolking — blauw/paars
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

    # Legenda: handmatige kleurvakjes
    ax_leg.set_xlim(0, 1); ax_leg.set_ylim(0, 1); ax_leg.axis("off")

    # Drie blokjes met labels
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

    # Transparantie schaal
    ax_leg.text(0.0, 0.05, "0%", fontsize=7, va="center",
                transform=ax_leg.transAxes, color="#888")
    ax_leg.text(0.95, 0.05, "100% bedekking", fontsize=7, va="center",
                ha="right", transform=ax_leg.transAxes, color="#888")

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

def main():
    print("=" * 60)
    print("Harmonie 43 neerslagkaarten genereren")
    print("=" * 60)

    # Probeer eerst KNMI GRIB, anders fallback naar Open-Meteo
    if KNMI_OPEN_DATA_KEY:
        print(f"\nDatabron: KNMI Open Data API (GRIB, 2km)")
        try:
            lats, lons, grid_data, times, run_str = haal_data_knmi_grib(MAX_HOURS)
        except Exception as e:
            print(f"\nKNMI GRIB fout: {e}")
            print("Fallback naar Open-Meteo...")
            lats, lons, grid_data, times, run_str = haal_data_openmeteo(MAX_HOURS)
    else:
        print(f"\nGeen KNMI_OPEN_DATA_KEY — gebruik Open-Meteo (lagere resolutie)")
        print("Tip: stel KNMI_OPEN_DATA_KEY in voor 2km GRIB data")
        lats, lons, grid_data, times, run_str = haal_data_openmeteo(MAX_HOURS)

    if grid_data is None:
        print("FOUT: Kon geen data ophalen!")
        sys.exit(1)

    n_hours = grid_data.shape[0]
    print(f"\nOntvangen: {n_hours} uur, grid {grid_data.shape[1]}x{grid_data.shape[2]}")

    # Kaarten renderen
    print(f"\nKaarten renderen ({n_hours} stuks)...")
    for h in range(n_hours):
        precip = grid_data[h]
        max_val = np.nanmax(precip) if not np.all(np.isnan(precip)) else 0
        tijdstip = times[h] if h < len(times) else ""
        fname = render_kaart(lats, lons, precip, tijdstip, h, run_str)
        print(f"  +{h:02d}h: max {max_val:.1f} mm \u2192 {fname}")

    schrijf_metadata(times, run_str)
    print(f"\nKlaar! {n_hours} kaarten gegenereerd.")


if __name__ == "__main__":
    main()
