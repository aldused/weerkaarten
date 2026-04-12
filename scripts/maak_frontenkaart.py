"""
maak_frontenkaart.py

Downloads ECMWF open data, computes weather fronts (Hewson Thermal Front Parameter),
isobars, pressure centres (H/L), and precipitation areas for Europe.

Exports GeoJSON files to the weerkaarten 2/ directory:
  - fronts.json
  - isobars.json
  - pressure_systems.json
  - precipitation.json
  - fronts_meta.json
"""

import os
import sys
import json
import tempfile
import warnings
from datetime import datetime, timezone

import numpy as np
from scipy.ndimage import gaussian_filter, minimum_filter, maximum_filter
from skimage.measure import find_contours
from scipy.interpolate import splprep, splev
import metpy.calc as mpcalc
from metpy.units import units
import xarray as xr
import cfgrib  # noqa: F401  (needed for xr.open_dataset engine='cfgrib')
from geojson import Feature, FeatureCollection, LineString, Point, Polygon, dump
from ecmwf.opendata import Client

warnings.filterwarnings("ignore")

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# ── Configuratie ──────────────────────────────────────────────────────────────

# Europa bounding box
LAT_MIN, LAT_MAX = 35.0, 72.0
LON_MIN, LON_MAX = -15.0, 45.0

# TFP drempelwaarde |∇θw| in K/m
TFP_GRADIENT_THRESHOLD = 4e-6

# Minimum aantal punten in een frontlijn
MIN_FRONT_POINTS = 5

# Gaussian smoothing sigma
SMOOTH_SIGMA = 3

# Isobaar interval (hPa)
ISOBAR_INTERVAL = 4

# Neerslag drempelwaarden (mm/6u)
PRECIP_THRESHOLDS = {
    "light":    0.5,
    "moderate": 2.0,
    "heavy":    5.0,
}

# Aardstraal in meters
EARTH_RADIUS = 6_371_000.0

OUTPUT_DIR = "."   # cwd = weerkaarten 2/


# ── Hulpfuncties ──────────────────────────────────────────────────────────────

def crop_to_europe(ds):
    """Snijdt dataset bij tot het Europese venster.
    ECMWF lat kan aflopend zijn (72→35), vandaar dat slice altijd min→max is."""
    lat = ds["latitude"].values
    lon = ds["longitude"].values

    lat_asc = float(lat[0]) < float(lat[-1])
    if lat_asc:
        lat_slice = slice(LAT_MIN, LAT_MAX)
    else:
        lat_slice = slice(LAT_MAX, LAT_MIN)  # aflopend

    lon_slice = slice(LON_MIN, LON_MAX)
    return ds.sel(latitude=lat_slice, longitude=lon_slice)


def ensure_lat_ascending(lats, field):
    """Zorg dat breedte-as oplopend is, draai array zonodig om."""
    if lats[0] > lats[-1]:
        return lats[::-1], field[::-1, :]
    return lats, field


def grid_spacing(lats, lons):
    """Geeft dx (m) en dy (m) voor elk roosterpunt.
    dx is gecorrigeerd voor cos(lat), dy is uniform."""
    dlat_deg = abs(float(lats[1]) - float(lats[0]))
    dlon_deg = abs(float(lons[1]) - float(lons[0]))

    dy = np.radians(dlat_deg) * EARTH_RADIUS          # uniform

    lat_rad = np.radians(lats.values)
    # dx per rij (shape: nlat)
    dx_row = np.radians(dlon_deg) * EARTH_RADIUS * np.cos(lat_rad)
    # Broadcast naar (nlat, nlon)
    dx = np.broadcast_to(dx_row[:, np.newaxis],
                         (len(lats), len(lons))).copy()
    return dx, dy


def gradient_2d(field, dx, dy):
    """Berekent ∂f/∂x en ∂f/∂y via numpy.gradient,
    corrigeert voor variabele dx per rij."""
    dfy, dfx_uniform = np.gradient(field)
    # numpy.gradient geeft de afgeleide t.o.v. array-index
    # dy en dx hebben eenheden van meter; dfy/dy en dfx/dx zijn dan K/m
    dfy_m = dfy / dy
    dfx_m = dfx_uniform / dx   # dx is 2D array
    return dfx_m, dfy_m


def smooth_line(coords, n_out=200):
    """Spline-interpolatie van een lijst (lon, lat) punten."""
    if len(coords) < 4:
        return coords
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    try:
        tck, _ = splprep([lons, lats], s=len(coords) * 0.5, k=3)
        u_new = np.linspace(0, 1, min(n_out, len(coords) * 4))
        lons_s, lats_s = splev(u_new, tck)
        return [[float(lo), float(la)] for lo, la in zip(lons_s, lats_s)]
    except Exception:
        return coords


def contour_to_lonlat(contour_ij, lats, lons):
    """Converteert skimage contour (row, col indices) naar (lon, lat) coördinaten."""
    coords = []
    for row, col in contour_ij:
        r0, r1 = int(row), min(int(row) + 1, len(lats) - 1)
        c0, c1 = int(col), min(int(col) + 1, len(lons) - 1)
        frac_r = row - int(row)
        frac_c = col - int(col)
        lat = float(lats[r0]) * (1 - frac_r) + float(lats[r1]) * frac_r
        lon = float(lons[c0]) * (1 - frac_c) + float(lons[c1]) * frac_c
        coords.append([round(lon, 4), round(lat, 4)])
    return coords


# ── Stap 1: Download ECMWF open data ─────────────────────────────────────────

def download_ecmwf(tmpdir):
    """Download ECMWF open data (0-uur analyse of meest recent beschikbare stap).
    Geeft pad naar GRIB-bestand terug."""
    print("Downloading ECMWF open data...")
    client = Client(source="ecmwf")

    path_pl = os.path.join(tmpdir, "ecmwf_pl.grib2")
    path_sfc = os.path.join(tmpdir, "ecmwf_sfc.grib2")

    # Pressure-level variabelen op 850 hPa
    client.retrieve(
        type="fc",
        step=0,
        levtype="pl",
        levelist=[850],
        param=["t", "q", "u", "v"],
        target=path_pl,
    )
    print("  Pressure-level data downloaded.")

    # Surface variabelen
    client.retrieve(
        type="fc",
        step=0,
        levtype="sfc",
        param=["msl", "tp"],
        target=path_sfc,
    )
    print("  Surface data downloaded.")

    return path_pl, path_sfc


# ── Stap 2: Inlezen en opzetten velden ────────────────────────────────────────

def load_fields(path_pl, path_sfc):
    """Leest GRIB-bestanden in als xarray Datasets, bijgesneden op Europa."""
    print("Loading fields from GRIB...")

    # Pressure-level dataset: een bestand met meerdere variabelen
    ds_pl_list = {}
    for var in ["t", "q", "u", "v"]:
        try:
            ds = xr.open_dataset(
                path_pl,
                engine="cfgrib",
                filter_by_keys={"shortName": var, "typeOfLevel": "isobaricInhPa"},
                indexpath=None,
            )
            ds_pl_list[var] = crop_to_europe(ds)
        except Exception as e:
            print(f"  Waarschuwing: kon {var} niet laden: {e}")

    # Surface dataset
    ds_sfc_list = {}
    for var, short in [("msl", "msl"), ("tp", "tp")]:
        try:
            ds = xr.open_dataset(
                path_sfc,
                engine="cfgrib",
                filter_by_keys={"shortName": short, "typeOfLevel": "surface"},
                indexpath=None,
            )
            ds_sfc_list[var] = crop_to_europe(ds)
        except Exception as e:
            # tp kan ook stepType=accum zijn
            try:
                ds = xr.open_dataset(
                    path_sfc,
                    engine="cfgrib",
                    filter_by_keys={"shortName": short},
                    indexpath=None,
                )
                ds_sfc_list[var] = crop_to_europe(ds)
            except Exception as e2:
                print(f"  Waarschuwing: kon {var} niet laden: {e2}")

    return ds_pl_list, ds_sfc_list


# ── Stap 3: θw berekenen ──────────────────────────────────────────────────────

def compute_theta_w(ds_pl_list):
    """Berekent nat-bol-potentiaaltemperatuur θw op 850 hPa."""
    print("Computing wet-bulb potential temperature...")

    t_da = ds_pl_list["t"]
    q_da = ds_pl_list["q"]

    lats = t_da["latitude"]
    lons = t_da["longitude"]

    # Haal waarden op als numpy arrays, squeezing extra dims
    t_vals = t_da["t"].squeeze().values          # K
    q_vals = q_da["q"].squeeze().values          # kg/kg

    # Lat oplopend maken
    lats_np = lats.values
    if lats_np[0] > lats_np[-1]:
        t_vals = t_vals[::-1, :]
        q_vals = q_vals[::-1, :]
        lats_np = lats_np[::-1]

    # MetPy: voeg eenheden toe
    pressure = 850 * units.hPa
    temp = t_vals * units.kelvin
    q = q_vals * units("kg/kg")

    # Dauwpunt uit specifieke vochtigheid
    dewpoint = mpcalc.dewpoint_from_specific_humidity(pressure, temp, q)

    # Nat-bol-potentiaaltemperatuur
    theta_w = mpcalc.wet_bulb_potential_temperature(pressure, temp, dewpoint)
    theta_w_K = theta_w.to("kelvin").magnitude

    return theta_w_K, lats_np, lons.values


# ── Stap 4: TFP berekenen en frontlijnen extraheren ───────────────────────────

def compute_tfp_fronts(theta_w, lats, lons):
    """Berekent TFP en extraheert frontlijnen als GeoJSON Features."""
    print("Computing TFP and extracting front lines...")

    # Smooth θw
    theta_smooth = gaussian_filter(theta_w, sigma=SMOOTH_SIGMA)

    # Dx, dy
    lats_xr = xr.DataArray(lats, dims=["latitude"])
    lons_xr = xr.DataArray(lons, dims=["longitude"])
    dx, dy = grid_spacing(lats_xr, lons_xr)

    # Gradient van θw
    dtheta_dx, dtheta_dy = gradient_2d(theta_smooth, dx, dy)
    grad_mag = np.sqrt(dtheta_dx**2 + dtheta_dy**2)

    # Vermijd deling door nul
    grad_mag_safe = np.where(grad_mag < 1e-12, 1e-12, grad_mag)

    # Eenheidsvector in richting van ∇θw
    nx = dtheta_dx / grad_mag_safe
    ny = dtheta_dy / grad_mag_safe

    # TFP = -∇|∇θw| · (∇θw / |∇θw|)
    d_gradmag_dx, d_gradmag_dy = gradient_2d(grad_mag, dx, dy)
    tfp = -(d_gradmag_dx * nx + d_gradmag_dy * ny)

    # Nulkruisingen van TFP
    contours = find_contours(tfp, level=0.0)

    features = []
    for contour in contours:
        if len(contour) < MIN_FRONT_POINTS:
            continue

        coords_ij = contour
        # Gemiddelde |∇θw| langs de contour
        rows = np.clip(contour[:, 0].astype(int), 0, grad_mag.shape[0] - 1)
        cols = np.clip(contour[:, 1].astype(int), 0, grad_mag.shape[1] - 1)
        mean_grad = float(grad_mag[rows, cols].mean())

        if mean_grad < TFP_GRADIENT_THRESHOLD:
            continue

        # Coördinaten omzetten naar lon/lat
        coords = contour_to_lonlat(coords_ij, lats, lons)
        if len(coords) < MIN_FRONT_POINTS:
            continue

        # Spline smoothing
        coords_smooth = smooth_line(coords)

        # Frontclassificatie
        front_type, warm_side = classify_front(
            contour, lats, lons, dtheta_dx, dtheta_dy, grad_mag_safe
        )

        feat = Feature(
            geometry=LineString(coords_smooth),
            properties={
                "type": front_type,
                "warm_side": warm_side,
                "mean_grad": round(mean_grad, 8),
            },
        )
        features.append(feat)

    print(f"  {len(features)} frontlijnen gevonden.")
    return FeatureCollection(features)


# ── Stap 5: Frontclassificatie ────────────────────────────────────────────────

def classify_front(contour, lats, lons, dtheta_dx, dtheta_dy, grad_mag):
    """Classificeert een front als warm/cold/occluded/stationary op basis van
    de dwars-front windcomponent bij 850 hPa.

    Geeft (front_type: str, warm_side: [dx, dy]) terug.
    warm_side is de richtingsvector die naar de warme kant wijst (richting
    hogere θw), genormaliseerd.
    """
    # Gemiddelde gradient-richting langs contour
    rows = np.clip(contour[:, 0].astype(int), 0, dtheta_dx.shape[0] - 1)
    cols = np.clip(contour[:, 1].astype(int), 0, dtheta_dx.shape[1] - 1)

    mean_dx = float(dtheta_dx[rows, cols].mean())
    mean_dy = float(dtheta_dy[rows, cols].mean())
    norm = max(np.sqrt(mean_dx**2 + mean_dy**2), 1e-12)
    warm_side = [round(mean_dx / norm, 4), round(mean_dy / norm, 4)]

    # Gebruik u, v wind om frontbeweging te bepalen
    # (wordt geïnjecteerd via globale variabelen bij de aanroep)
    u_vals = _u850
    v_vals = _v850

    if u_vals is None or v_vals is None:
        return "unknown", warm_side

    u_front = float(u_vals[rows, cols].mean())
    v_front = float(v_vals[rows, cols].mean())

    # Dwars-front windcomponent: projectie van wind op ∇θw-richting
    cross = u_front * (mean_dx / norm) + v_front * (mean_dy / norm)

    if abs(cross) < 2.0:
        front_type = "stationary"
    elif cross > 0:
        # Wind beweegt naar warme kant → koude lucht dringt voor
        front_type = "cold"
    else:
        # Wind beweegt weg van warme kant → warme lucht dringt voor
        front_type = "warm"

    return front_type, warm_side


# Globale variabelen voor wind bij 850 hPa (worden gevuld in main)
_u850 = None
_v850 = None


# ── Stap 6: Isobaren ─────────────────────────────────────────────────────────

def compute_isobars(ds_sfc_list):
    """Extraheert isobaren uit MSL-druk als GeoJSON Features."""
    print("Computing isobars...")

    if "msl" not in ds_sfc_list:
        print("  Geen MSL-data beschikbaar.")
        return FeatureCollection([])

    ds = ds_sfc_list["msl"]
    lats = ds["latitude"].values
    lons = ds["longitude"].values

    msl_vals = ds["msl"].squeeze().values / 100.0   # Pa → hPa

    lats, msl_vals = ensure_lat_ascending(lats, msl_vals)

    # Smooth MSL
    msl_smooth = gaussian_filter(msl_vals, sigma=2)

    p_min = int(np.floor(msl_smooth.min() / ISOBAR_INTERVAL)) * ISOBAR_INTERVAL
    p_max = int(np.ceil(msl_smooth.max() / ISOBAR_INTERVAL)) * ISOBAR_INTERVAL
    pressure_levels = range(p_min, p_max + ISOBAR_INTERVAL, ISOBAR_INTERVAL)

    features = []
    for p in pressure_levels:
        contours = find_contours(msl_smooth, level=float(p))
        for contour in contours:
            if len(contour) < 3:
                continue
            coords = contour_to_lonlat(contour, lats, lons)
            if len(coords) < 3:
                continue
            coords_s = smooth_line(coords, n_out=150)
            feat = Feature(
                geometry=LineString(coords_s),
                properties={"pressure": int(p)},
            )
            features.append(feat)

    print(f"  {len(features)} isobaarsegmenten gevonden.")
    return FeatureCollection(features)


# ── Stap 7: H/L drukmiddelpunten ──────────────────────────────────────────────

def find_pressure_centers(ds_sfc_list):
    """Vindt lokale minima (L) en maxima (H) in MSL-druk."""
    print("Finding pressure centers...")

    if "msl" not in ds_sfc_list:
        print("  Geen MSL-data beschikbaar.")
        return FeatureCollection([])

    ds = ds_sfc_list["msl"]
    lats = ds["latitude"].values
    lons = ds["longitude"].values

    msl_vals = ds["msl"].squeeze().values / 100.0

    lats, msl_vals = ensure_lat_ascending(lats, msl_vals)

    msl_smooth = gaussian_filter(msl_vals, sigma=5)

    # Zoekvenster ~500 km (afhankelijk van roosterresolutie)
    nlat, nlon = msl_smooth.shape
    window = max(5, int(10 / abs(float(lats[1]) - float(lats[0]))))

    local_min = minimum_filter(msl_smooth, size=window)
    local_max = maximum_filter(msl_smooth, size=window)

    features = []
    nlat, nlon = msl_smooth.shape

    min_mask = (msl_smooth == local_min)
    max_mask = (msl_smooth == local_max)

    # Filterdrempel: minimaal 2 hPa verschil t.o.v. omgeving
    for i, j in zip(*np.where(min_mask)):
        center_p = float(msl_smooth[i, j])
        neighborhood = msl_smooth[
            max(0, i - window // 2):i + window // 2 + 1,
            max(0, j - window // 2):j + window // 2 + 1,
        ]
        if neighborhood.max() - center_p < 2.0:
            continue
        lat = float(lats[i])
        lon = float(lons[j])
        features.append(Feature(
            geometry=Point([round(lon, 3), round(lat, 3)]),
            properties={"type": "L", "pressure": round(center_p, 1)},
        ))

    for i, j in zip(*np.where(max_mask)):
        center_p = float(msl_smooth[i, j])
        neighborhood = msl_smooth[
            max(0, i - window // 2):i + window // 2 + 1,
            max(0, j - window // 2):j + window // 2 + 1,
        ]
        if center_p - neighborhood.min() < 2.0:
            continue
        lat = float(lats[i])
        lon = float(lons[j])
        features.append(Feature(
            geometry=Point([round(lon, 3), round(lat, 3)]),
            properties={"type": "H", "pressure": round(center_p, 1)},
        ))

    print(f"  {len(features)} drukmiddelpunten gevonden.")
    return FeatureCollection(features)


# ── Stap 8: Neerslag gebieden ─────────────────────────────────────────────────

def compute_precipitation(ds_sfc_list):
    """Extraheert neerslaggebieden als GeoJSON Polygon Features."""
    print("Computing precipitation areas...")

    if "tp" not in ds_sfc_list:
        print("  Geen neerslag-data beschikbaar.")
        return FeatureCollection([])

    ds = ds_sfc_list["tp"]
    lats = ds["latitude"].values
    lons = ds["longitude"].values

    # tp kan in meters zijn (ECMWF): omrekenen naar mm
    tp_vals = ds["tp"].squeeze().values
    if tp_vals.max() < 0.5:          # waarschijnlijk in meters
        tp_vals = tp_vals * 1000.0   # m → mm

    lats, tp_vals = ensure_lat_ascending(lats, tp_vals)

    # Lichte smooth om ruis te verminderen
    tp_smooth = gaussian_filter(tp_vals, sigma=1)

    features = []
    # Volgorde: heavy → moderate → light (zodat heavy niet bedekt wordt)
    for intensity in ["heavy", "moderate", "light"]:
        threshold = PRECIP_THRESHOLDS[intensity]
        contours = find_contours(tp_smooth, level=threshold)
        for contour in contours:
            if len(contour) < 4:
                continue
            coords = contour_to_lonlat(contour, lats, lons)
            if len(coords) < 4:
                continue
            # Sluit polygoon
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            feat = Feature(
                geometry=Polygon([coords]),
                properties={"intensity": intensity},
            )
            features.append(feat)

    print(f"  {len(features)} neerslaggebieden gevonden.")
    return FeatureCollection(features)


# ── Stap 9: Metadata ──────────────────────────────────────────────────────────

def make_metadata(ds_pl_list):
    """Genereert metadata JSON."""
    valid_time = ""
    try:
        t_da = ds_pl_list.get("t")
        if t_da is not None:
            vt = t_da["valid_time"].values if "valid_time" in t_da.coords else None
            if vt is not None:
                import pandas as pd
                valid_time = str(pd.Timestamp(vt).isoformat())
    except Exception:
        pass

    return {
        "model": "ECMWF",
        "valid_time": valid_time,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "domain": {
            "lat_min": LAT_MIN, "lat_max": LAT_MAX,
            "lon_min": LON_MIN, "lon_max": LON_MAX,
        },
        "parameters": {
            "tfp_gradient_threshold": TFP_GRADIENT_THRESHOLD,
            "smooth_sigma": SMOOTH_SIGMA,
            "isobar_interval_hPa": ISOBAR_INTERVAL,
        },
    }


# ── Hoofd functie ─────────────────────────────────────────────────────────────

def main():
    global _u850, _v850

    print("=== maak_frontenkaart.py ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        # 1. Download
        path_pl, path_sfc = download_ecmwf(tmpdir)

        # 2. Inlezen
        ds_pl_list, ds_sfc_list = load_fields(path_pl, path_sfc)

        if not ds_pl_list:
            print("FOUT: geen pressure-level data geladen. Script stopt.")
            sys.exit(1)

        # 3. Wind opslaan in globale variabelen voor classificatie
        if "u" in ds_pl_list and "v" in ds_pl_list:
            u_da = ds_pl_list["u"]
            v_da = ds_pl_list["v"]
            u_raw = u_da["u"].squeeze().values
            v_raw = v_da["v"].squeeze().values

            u_lats = u_da["latitude"].values
            if u_lats[0] > u_lats[-1]:
                u_raw = u_raw[::-1, :]
                v_raw = v_raw[::-1, :]

            _u850 = u_raw
            _v850 = v_raw
            print("  Wind bij 850 hPa geladen.")

        # 4. θw en TFP
        theta_w, lats, lons = compute_theta_w(ds_pl_list)
        fronts_fc = compute_tfp_fronts(theta_w, lats, lons)

        # 5. Isobaren
        isobars_fc = compute_isobars(ds_sfc_list)

        # 6. H/L
        pressure_systems_fc = find_pressure_centers(ds_sfc_list)

        # 7. Neerslag
        precipitation_fc = compute_precipitation(ds_sfc_list)

        # 8. Metadata
        meta = make_metadata(ds_pl_list)

    # 9. Exporteren
    print("Exporting GeoJSON files...")

    for filename, fc in [
        ("fronts.json", fronts_fc),
        ("isobars.json", isobars_fc),
        ("pressure_systems.json", pressure_systems_fc),
        ("precipitation.json", precipitation_fc),
    ]:
        path = os.path.join(OUTPUT_DIR, filename)
        with open(path, "w") as f:
            dump(fc, f)
        size = os.path.getsize(path)
        print(f"  {filename}: {len(fc['features'])} features, {size:,} bytes")

    meta_path = os.path.join(OUTPUT_DIR, "fronts_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"  fronts_meta.json: {meta}")

    print("=== Klaar ===")


if __name__ == "__main__":
    main()
