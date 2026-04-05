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
NEERSLAG_LEVELS = [0.1, 0.2, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 75, 100]
NEERSLAG_COLORS = [
    "#b8e2f8",  # 0.1  heel lichtblauw
    "#82ccee",  # 0.2  lichtblauw
    "#4ab4e6",  # 0.5  blauw
    "#2196d3",  # 1    middenblauw
    "#0d7fc4",  # 2    donkerblauw
    "#30b86e",  # 3    lichtgroen
    "#1fa349",  # 5    groen
    "#0e8c30",  # 7    donkergroen
    "#f5e636",  # 10   geel
    "#f5b800",  # 15   donkergeel
    "#f57600",  # 20   oranje
    "#e63e00",  # 30   rood
    "#c40000",  # 50   donkerrood
    "#aa00aa",  # 75   paars
    "#ff55ff",  # 100  roze/magenta
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
    Returns: (lats, lons, grid_data[uur,lat,lon], times_str, run_str)
    """
    import xarray as xr
    import cfgrib

    print("KNMI Open Data API — laatste Harmonie bestand zoeken...")
    filename = knmi_laatste_bestand()
    print(f"  Bestand: {filename}")

    # Parse run-tijd uit bestandsnaam: HA43_N20_YYYYMMDDhhmm_...
    # Formaat: HA43_N20_202604050300_00048_GB
    parts = filename.replace(".tar", "").split("_")
    run_str_raw = parts[2] if len(parts) > 2 else ""
    try:
        run_dt = datetime.strptime(run_str_raw[:12], "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
        run_str = run_dt.astimezone(LOCAL_TZ).strftime("%d %b %Y %H:%M")
    except:
        run_dt = datetime.now(tz=LOCAL_TZ)
        run_str = run_dt.strftime("%d %b %Y %H:%M")

    # Download naar tijdelijke directory
    with tempfile.TemporaryDirectory(prefix="harmonie_") as tmpdir:
        grib_files = knmi_download_grib(filename, tmpdir)

        print("  GRIB data lezen...")
        # Open alle GRIB bestanden en zoek neerslag-parameter
        # KNMI Harmonie P1: parameterName = "Total precipitation" of shortName = "tp"
        all_data = []
        all_times = []

        for gf in sorted(grib_files):
            try:
                ds = xr.open_dataset(gf, engine="cfgrib",
                                     backend_kwargs={"filter_by_keys": {"shortName": "tp"}})
                if "tp" in ds:
                    precip = ds["tp"].values  # shape: (lat, lon)
                    lats_grib = ds["latitude"].values
                    lons_grib = ds["longitude"].values
                    valid_time = ds["valid_time"].values
                    all_data.append(precip)
                    all_times.append(valid_time)
                ds.close()
            except Exception:
                # Probeer alternatieve parameter namen
                try:
                    ds = xr.open_dataset(gf, engine="cfgrib",
                                         backend_kwargs={"filter_by_keys": {"shortName": "prate"}})
                    if "prate" in ds:
                        precip = ds["prate"].values
                        lats_grib = ds["latitude"].values
                        lons_grib = ds["longitude"].values
                        valid_time = ds["valid_time"].values
                        all_data.append(precip)
                        all_times.append(valid_time)
                    ds.close()
                except Exception:
                    continue

        if not all_data:
            print("  WAARSCHUWING: Geen neerslagdata gevonden in GRIB bestanden")
            print("  Beschikbare variabelen zoeken...")
            # Toon wat er wel beschikbaar is
            for gf in grib_files[:3]:
                try:
                    ds = xr.open_dataset(gf, engine="cfgrib")
                    print(f"    {os.path.basename(gf)}: {list(ds.data_vars)}")
                    ds.close()
                except Exception as e:
                    print(f"    {os.path.basename(gf)}: kon niet lezen ({e})")
            raise RuntimeError("Geen neerslag in GRIB data gevonden")

        # Sorteer op tijd
        sort_idx = np.argsort([t for t in all_times])
        all_data = [all_data[i] for i in sort_idx]
        all_times = [all_times[i] for i in sort_idx]

        # Beperk tot max_hours
        n_hours = min(max_hours, len(all_data))
        grid_data = np.stack(all_data[:n_hours], axis=0)

        # Zorg dat lats van zuid naar noord gaan
        if lats_grib[0] > lats_grib[-1]:
            lats_grib = lats_grib[::-1]
            grid_data = grid_data[:, ::-1, :]

        # Tijden als strings
        times_str = []
        for t in all_times[:n_hours]:
            dt_val = np.datetime64(t, "s").astype("datetime64[s]").item()
            dt_local = dt_val.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
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


# ══════════════════════════════════════════════════════════════════════════════
# KAART RENDEREN
# ══════════════════════════════════════════════════════════════════════════════

def render_kaart(lats, lons, precip_2d, tijdstip_str, uur_idx, run_str, output_dir="."):
    """Render een enkele neerslagkaart als PNG — radar-stijl."""
    try:
        dt = datetime.fromisoformat(tijdstip_str).replace(tzinfo=LOCAL_TZ)
    except:
        dt = datetime.now(tz=LOCAL_TZ)

    dag_nl = nl_dagen[dt.weekday()]
    maand_nl = nl_maanden[dt.month]
    run_label = f"Run: {run_str}"
    valid_label = f"Geldig: {dag_nl} {dt.day} {maand_nl} {dt.strftime('%H:%M')} (+{uur_idx}h)"

    # Data voorbereiden
    data = precip_2d.copy()
    data = np.nan_to_num(data, nan=0.0)

    # Maskeer droog (< 0.1 mm)
    data_masked = np.ma.masked_less(data, 0.1)

    # ── Figuur aanmaken ──────────────────────────────────────────────────────
    fig = plt.figure(figsize=(10, 11.5), facecolor="white")

    ax_titel = fig.add_axes([0.02, 0.935, 0.96, 0.05])
    ax = fig.add_axes([0.02, 0.08, 0.88, 0.85], projection=ccrs.PlateCarree())
    ax_leg = fig.add_axes([0.91, 0.12, 0.025, 0.75])

    # ── Titel ────────────────────────────────────────────────────────────────
    ax_titel.set_xlim(0, 1); ax_titel.set_ylim(0, 1); ax_titel.axis("off")
    ax_titel.text(0.0, 0.7, "Neerslag (mm/uur)", fontsize=14, weight="bold",
                  va="center", transform=ax_titel.transAxes, color="#222222")
    ax_titel.text(0.0, 0.15, "Model: HARMONIE Cy43 (KNMI)",
                  fontsize=9, va="center", transform=ax_titel.transAxes, color="#555555")
    ax_titel.text(1.0, 0.7, run_label, fontsize=10, weight="bold",
                  ha="right", va="center", transform=ax_titel.transAxes, color="#333333")
    ax_titel.text(1.0, 0.15, valid_label, fontsize=9,
                  ha="right", va="center", transform=ax_titel.transAxes, color="#555555")

    # ── Kaart ────────────────────────────────────────────────────────────────
    ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.set_aspect("auto")
    ax.set_facecolor("white")

    # Neerslag overlay
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    mesh = ax.pcolormesh(
        lon_grid, lat_grid, data_masked,
        cmap=CMAP_NEERSLAG, norm=NORM_NEERSLAG,
        transform=ccrs.PlateCarree(),
        zorder=2, shading="auto"
    )

    # Kustlijnen en grenzen bovenop
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"), edgecolor="black",
                   linewidth=0.8, zorder=5)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"), edgecolor="#333333",
                   linewidth=0.5, linestyle="-", zorder=5)
    try:
        ax.add_feature(cfeature.NaturalEarthFeature(
            "cultural", "admin_1_states_provinces_lines", "50m",
            edgecolor="#888888", linewidth=0.3, facecolor="none"), zorder=4)
    except:
        pass

    ax.axis("off")

    # Bronvermelding
    ax.text(1.0, -0.005, "\u00a9 Ed Aldus  |  Data: KNMI Harmonie 43",
            transform=ax.transAxes, fontsize=7, style="italic",
            ha="right", va="top", color="#777777")

    # ── Legenda ──────────────────────────────────────────────────────────────
    cb = plt.colorbar(mesh, cax=ax_leg, orientation="vertical", extend="max",
                      spacing="uniform")
    cb.set_label("mm/uur", fontsize=9, labelpad=8)
    cb.set_ticks(NEERSLAG_LEVELS)
    cb.ax.tick_params(labelsize=7.5)
    cb.ax.yaxis.set_ticks_position("right")
    cb.ax.yaxis.set_label_position("right")

    # Opslaan
    fname = os.path.join(output_dir, f"harmonie_neerslag_{uur_idx:02d}.png")
    plt.savefig(fname, dpi=150, bbox_inches="tight", facecolor="white",
                edgecolor="none", pad_inches=0.05)
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
