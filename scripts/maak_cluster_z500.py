"""
Z500 Clusterkaarten — ECMWF IFS ENS via Open-Meteo
EOF-decompositie + k-means clustering, representatief lid per scenario.

Gebruik:
    python3 scripts/maak_cluster_z500.py

Output (naast dit script, in weerlab/):
    cluster_z500_int1.png   (72–96h  · dag 3–4)
    cluster_z500_int2.png   (120–168h · dag 5–7)
    cluster_z500_int3.png   (192–240h · dag 8–10)
    cluster_z500_meta.json
Upload → R2 (data.weerlab.nl) via shell/r2_publish.sh
"""

import json, urllib.request, urllib.error, datetime, os, gzip, subprocess, time
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import matplotlib.ticker as mticker
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from scipy.interpolate import RegularGridInterpolator
from scipy.ndimage import gaussian_filter
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score

# ── Configuratie ─────────────────────────────────────────────────────────────
OUT_DIR    = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
R2_SCRIPT  = os.path.normpath(os.path.join(OUT_DIR, 'shell', 'r2_publish.sh'))
SEED       = 42

# Grid 2.5° → 400 punten
LATS = np.arange(35.0, 73.0, 2.5)   # 16 punten
LONS = np.arange(-20.0, 42.5, 2.5)  # 25 punten

# Tijdsintervallen (ECMWF methodologie)
INTERVALS = [
    {'naam': 'int1', 'h_start':  72, 'h_end':  96, 'stap': 6, 'min_k': 2,
     'label': 'Interval 1 · 72–96h · dag 3–4'},
    {'naam': 'int2', 'h_start': 120, 'h_end': 168, 'stap': 6, 'min_k': 3,
     'label': 'Interval 2 · 120–168h · dag 5–7'},
    {'naam': 'int3', 'h_start': 192, 'h_end': 240, 'stap': 6, 'min_k': 3,
     'label': 'Interval 3 · 192–240h · dag 8–10'},
]

EXTENT = [-25, 45, 32, 73]

# Kleurenpalet: blauw (trog) → wit → rood (rug)
CMAP = mcolors.LinearSegmentedColormap.from_list(
    'z500_anom',
    ['#053061','#2166ac','#4393c3','#92c5de','#d1e5f0',
     '#f7f7f7',
     '#fddbc7','#f4a582','#d6604d','#b2182b','#67001f'],
    N=256
)

SCENARIO_KLEUREN = ['#1d4ed8', '#16a34a', '#dc2626', '#7c3aed', '#ea580c', '#0891b2']

# ── Data ophalen ─────────────────────────────────────────────────────────────

def haal_data():
    """Haal z500 ENS op voor heel Europa in één (multi-punt) request."""
    max_uur = max(iv['h_end'] for iv in INTERVALS)
    forecast_days = max_uur // 24 + 2

    lat_list = ','.join(f'{la:.1f}' for la in LATS for _ in LONS)
    lon_list = ','.join(f'{lo:.1f}' for _ in LATS for lo in LONS)
    n_pts = len(LATS) * len(LONS)

    # Lid 0 = controle-run (zonder suffix), lid 1-50 = perturbed members.
    # ECMWF clustert alle 51 leden.
    members = (['geopotential_height_500hPa'] +
               [f'geopotential_height_500hPa_member{m:02d}' for m in range(1, 51)])

    url = (
        'https://ensemble-api.open-meteo.com/v1/ensemble'
        f'?latitude={lat_list}&longitude={lon_list}'
        '&models=ecmwf_ifs025'
        '&hourly=geopotential_height_500hPa'
        f'&forecast_days={forecast_days}'
    )
    print(f'Data ophalen: {n_pts} gridpunten × {len(members)} leden × {forecast_days} dagen...')
    raw = None
    for poging in range(3):
        try:
            req = urllib.request.Request(url, headers={'Accept-Encoding': 'gzip'})
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 and poging < 2:
                print(f'  Rate limit (429), wacht 90s... (poging {poging+1}/3)')
                time.sleep(90)
            else:
                raise
    try:
        data = json.loads(gzip.decompress(raw))
    except Exception:
        data = json.loads(raw)
    if isinstance(data, dict):
        data = [data]
    print(f'  Ontvangen: {len(data)} gridpunten')
    return data, members


def interval_matrix(data, members, t0_utc, h_start, h_end, stap):
    """
    Berekent per ENS-lid het gemiddelde z500 over het interval.
    Geeft matrix (n_leden, n_pts) terug.
    """
    tijden_interval = list(range(h_start, h_end + 1, stap))
    n_pts = len(data)
    mat = np.full((len(members), n_pts), np.nan)

    for pt_idx, pt in enumerate(data):
        tijden = pt['hourly']['time']
        # indices voor dit interval
        idx_list = []
        for h in tijden_interval:
            dt = t0_utc + datetime.timedelta(hours=h)
            ts = dt.strftime('%Y-%m-%dT%H:%M')
            try:
                idx_list.append(tijden.index(ts))
            except ValueError:
                pass
        if not idx_list:
            continue
        for m_i, mkey in enumerate(members):
            vals = pt['hourly'].get(mkey)
            if vals is None:
                continue
            sub = [vals[i] for i in idx_list if i < len(vals) and vals[i] is not None]
            if sub:
                mat[m_i, pt_idx] = float(np.mean(sub))
    return mat


# ── EOF + k-means ─────────────────────────────────────────────────────────────

def eof_cluster(mat_ok, min_k=2):
    """
    EOF-decompositie → k-means, silhouette-optimum.
    min_k = minimumdrempel voor dit interval.
    """
    n = mat_ok.shape[0]

    # EOF: leading componenten die ≥80% variantie verklaren
    pca = PCA(n_components=min(n - 1, mat_ok.shape[1]))
    scores = pca.fit_transform(mat_ok)
    cum_var = np.cumsum(pca.explained_variance_ratio_)
    n_eof = max(2, int(np.searchsorted(cum_var, 0.80)) + 1)
    n_eof = min(n_eof, scores.shape[1])
    scores_r = scores[:, :n_eof]
    print(f'    EOF: {n_eof} componenten → {cum_var[n_eof-1]*100:.1f}% variantie')

    sil_scores = {}
    for k in range(min_k, 7):
        if k >= n:
            break
        km = KMeans(n_clusters=k, random_state=SEED, n_init=20)
        lbl = km.fit_predict(scores_r)
        if len(set(lbl)) < 2:
            continue
        sil_scores[k] = silhouette_score(scores_r, lbl)
        print(f'    k={k}: silhouette={sil_scores[k]:.3f}')

    if not sil_scores:
        k_best = min_k
    else:
        k_best = max(sil_scores, key=sil_scores.get)
        # Marge-check: voorkom te weinig clusters
        if k_best == min_k and (min_k + 1) in sil_scores:
            marge = sil_scores[min_k] - sil_scores[min_k + 1]
            if marge < 0.025:
                k_best = min_k + 1

    print(f'    → {k_best} clusters (silhouette={sil_scores.get(k_best, 0):.3f})')

    km_best = KMeans(n_clusters=k_best, random_state=SEED, n_init=20)
    labels = km_best.fit_predict(scores_r)
    return labels, k_best


# ── Kaart maken ───────────────────────────────────────────────────────────────

def maak_kaart(mat, interval, t0_utc, run_str):
    """Maakt PNG voor één interval."""
    naam  = interval['naam']
    label = interval['label']
    min_k = interval['min_k']
    h_s   = interval['h_start']
    h_e   = interval['h_end']

    n_la, n_lo = len(LATS), len(LONS)
    n_totaal = mat.shape[0]

    # Leden met >10% missende punten vervallen; losse gaten worden geïmputeerd
    # met het gridpunt-gemiddelde, zodat één kapot gridpunt niet alles nekt.
    frac_ok  = 1.0 - np.isnan(mat).mean(axis=1)
    mat_ok   = mat[frac_ok >= 0.9].copy()
    n_geldig = mat_ok.shape[0]
    print(f'  {n_geldig}/{n_totaal} leden geldig')
    if n_geldig < min_k + 1:
        print(f'  Onvoldoende leden, overgeslagen.')
        return None
    if np.isnan(mat_ok).any():
        n_gaten  = int(np.isnan(mat_ok).sum())
        col_mean = np.nanmean(mat_ok, axis=0)
        col_mean = np.where(np.isnan(col_mean), np.nanmean(col_mean), col_mean)
        r_i, c_i = np.where(np.isnan(mat_ok))
        mat_ok[r_i, c_i] = col_mean[c_i]
        print(f'  {n_gaten} ontbrekende waarden geïmputeerd')

    # Breedtegraad-weging (ECMWF): gridpunten op hoge breedte vertegenwoordigen
    # minder oppervlak → gewicht sqrt(cos φ) in EOF/k-means/repr-afstand.
    W = np.sqrt(np.cos(np.deg2rad(np.repeat(LATS, n_lo))))
    mat_w = mat_ok * W[None, :]

    labels, k = eof_cluster(mat_w, min_k=min_k)

    # Fijn grid (3° buiten extent zodat randen gevuld zijn)
    lats_fijn = np.linspace(EXTENT[2] - 3, EXTENT[3] + 3, 140)
    lons_fijn = np.linspace(EXTENT[0] - 3, EXTENT[1] + 3, 200)
    LON_F, LAT_F = np.meshgrid(lons_fijn, lats_fijn)

    def interpoleer(grid2d, sigma=1.0):
        interp = RegularGridInterpolator(
            (LATS, LONS), grid2d, method='linear',
            bounds_error=False, fill_value=None)
        fijn = interp(np.column_stack([LAT_F.ravel(), LON_F.ravel()])).reshape(LAT_F.shape)
        return gaussian_filter(fijn, sigma=sigma)

    # Ensemble gemiddelde
    z_mean_fijn = interpoleer(mat_ok.mean(axis=0).reshape(n_la, n_lo))

    # Sorteer clusters op gemiddeld z500 (laag → hoog)
    cluster_ids = sorted(range(k), key=lambda c: mat_ok[labels == c].mean())

    # Scenario-index per origineel lid (0-based, kaartvolgorde); -1 = ongeldig.
    # Voor het Sankey-verloopdiagram op de pagina.
    scenario_pos   = {c: i for i, c in enumerate(cluster_ids)}
    leden_scenario = np.full(n_totaal, -1, dtype=int)
    orig_idx       = np.where(frac_ok >= 0.9)[0]
    for rij, oi in enumerate(orig_idx):
        leden_scenario[oi] = scenario_pos[labels[rij]]

    # Representatief lid = min RMS afstand tot clustercentroïde (gewogen ruimte)
    def repr_lid(c):
        leden_idx = np.where(labels == c)[0]
        centroid  = mat_w[leden_idx].mean(axis=0)
        rms       = np.sqrt(((mat_w[leden_idx] - centroid) ** 2).mean(axis=1))
        return leden_idx[np.argmin(rms)]

    # Layout: 1–3 kolommen per rij
    ncols = min(k, 3)
    nrows = (k + ncols - 1) // ncols
    fig_w = 7.5 * ncols
    fig_h = 5.8 * nrows + 0.9
    proj  = ccrs.LambertConformal(
        central_longitude=10, central_latitude=52,
        standard_parallels=(35, 65))

    fig, axes = plt.subplots(nrows, ncols,
                              figsize=(fig_w, fig_h),
                              subplot_kw={'projection': proj},
                              gridspec_kw={'hspace': 0.06, 'wspace': 0.03})
    axes = np.array(axes).ravel()

    iso_m   = np.arange(4680, 6080, 40)    # 468–604 dam, elke 4 dam (in m)
    iso_dik = iso_m[::2]                   # elke 8 dam dik
    vlvls   = np.linspace(-180, 180, 37)

    for plot_i, c in enumerate(cluster_ids):
        ax = axes[plot_i]
        n_leden = int((labels == c).sum())
        pct     = 100 * n_leden / n_geldig
        kleur   = SCENARIO_KLEUREN[plot_i % len(SCENARIO_KLEUREN)]

        # Representatief lid z500
        rl_idx  = repr_lid(c)
        z_repr  = mat_ok[rl_idx].reshape(n_la, n_lo)
        z_fijn  = interpoleer(z_repr)
        anom    = z_fijn - z_mean_fijn

        ax.set_extent(EXTENT, crs=ccrs.PlateCarree())

        # Achtergrond
        ax.add_feature(cfeature.OCEAN.with_scale('50m'),     facecolor='#c8dff0', zorder=0)
        ax.add_feature(cfeature.LAND.with_scale('50m'),      facecolor='#f0ece3', zorder=0)
        ax.add_feature(cfeature.LAKES.with_scale('50m'),     facecolor='#c8dff0', zorder=1)
        ax.add_feature(cfeature.RIVERS.with_scale('50m'),    edgecolor='#7aabcf', linewidth=0.3, zorder=1)
        ax.add_feature(cfeature.COASTLINE.with_scale('50m'), linewidth=0.55, edgecolor='#444', zorder=3)
        ax.add_feature(cfeature.BORDERS.with_scale('50m'),   linewidth=0.28, edgecolor='#777', zorder=3)

        # Graticule
        gl = ax.gridlines(draw_labels=False, linewidth=0.25,
                          color='#aaaaaa', alpha=0.6, linestyle='--',
                          x_inline=False, y_inline=False)
        gl.xlocator = mticker.FixedLocator(range(-20, 46, 10))
        gl.ylocator = mticker.FixedLocator(range(35, 75, 10))

        # Anomalie kleurvlak
        ax.contourf(LON_F, LAT_F, anom,
                    levels=vlvls, cmap=CMAP, alpha=0.72,
                    transform=ccrs.PlateCarree(), zorder=2, extend='both')

        # Dunne isopletenlijnen (4 dam)
        cs = ax.contour(LON_F, LAT_F, z_fijn / 10,
                        levels=iso_m / 10, colors='#111122',
                        linewidths=0.55, transform=ccrs.PlateCarree(), zorder=4)
        ax.clabel(cs, levels=iso_dik / 10, fmt='%d', fontsize=6,
                  inline=True, inline_spacing=2,
                  manual=False)

        # Dikke lijnen (8 dam)
        ax.contour(LON_F, LAT_F, z_fijn / 10,
                   levels=iso_dik / 10, colors='#111122',
                   linewidths=1.4, transform=ccrs.PlateCarree(), zorder=4)

        # Percentage badge
        ax.text(0.015, 0.968, f'{pct:.0f}%',
                transform=ax.transAxes, fontsize=22, fontweight='bold',
                color='white', va='top', ha='left', zorder=10,
                bbox=dict(boxstyle='round,pad=0.25', facecolor=kleur,
                          alpha=0.88, edgecolor='none'))
        ax.text(0.015, 0.858, f'{n_leden} / {n_geldig} leden',
                transform=ax.transAxes, fontsize=7.5, color=kleur,
                fontweight='600', va='top', ha='left', zorder=10,
                bbox=dict(boxstyle='round,pad=0.2', facecolor='white',
                          alpha=0.75, edgecolor='none'))

        ax.set_title(f'Scenario {plot_i + 1}',
                     fontsize=10, fontweight='bold', color=kleur, pad=4)

    # Verberg lege assen
    for i in range(k, len(axes)):
        axes[i].set_visible(False)

    # Kleurenbalk
    cbar_ax = fig.add_axes([0.12, 0.035, 0.76, 0.016])
    sm = plt.cm.ScalarMappable(
        cmap=CMAP,
        norm=mcolors.TwoSlopeNorm(vcenter=0, vmin=-180, vmax=180))
    sm.set_array([])
    cb = fig.colorbar(sm, cax=cbar_ax, orientation='horizontal')
    cb.set_label('Z500-afwijking t.o.v. ensemble-gemiddelde (m)', fontsize=8.5)
    cb.ax.tick_params(labelsize=7.5)

    # Geldigheidsdatums (Nederlandse maandnamen, platformonafhankelijk)
    MND = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']
    def fmt_nl(dt):
        return f'{dt.day} {MND[dt.month-1]} {dt.year} {dt.hour:02d} UTC'
    dt_s = fmt_nl(t0_utc + datetime.timedelta(hours=h_s))
    dt_e = fmt_nl(t0_utc + datetime.timedelta(hours=h_e))
    titel = (f"Z500 ensemble-scenario's  ·  {label}\n"
             f"Geldig {dt_s} – {dt_e}  ·  ECMWF IFS ENS via Open-Meteo  ·  run {run_str}")
    fig.suptitle(titel, fontsize=11.5, fontweight='bold',
                 y=0.995, color='#0f172a', va='top')

    out_path = os.path.join(OUT_DIR, f'cluster_z500_{naam}.png')
    fig.savefig(out_path, dpi=140, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    plt.close(fig)
    print(f'  → {out_path}')
    return out_path, leden_scenario.tolist()


# ── R2 upload ─────────────────────────────────────────────────────────────────

def upload_r2(bestanden):
    basenames = [os.path.basename(b) for b in bestanden]
    print(f'  R2 upload: {basenames}')
    if not os.path.isfile(R2_SCRIPT):
        print(f'  R2-script niet gevonden: {R2_SCRIPT}')
        return
    result = subprocess.run(
        ['bash', R2_SCRIPT] + bestanden,
        capture_output=True, text=True)
    if result.returncode == 0:
        print('  R2 upload geslaagd.')
    else:
        print(f'  R2 fout: {result.stderr.strip()}')


# ── Hoofdprogramma ────────────────────────────────────────────────────────────

def main():
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)

    # T0 = nieuwste ECMWF-run die Open-Meteo al verwerkt heeft:
    # 00Z beschikbaar ~07:05 UTC, 12Z ~19:05 UTC.
    if now.hour >= 20:
        t0 = now.replace(hour=12, minute=0, second=0, microsecond=0)
    elif now.hour >= 8:
        t0 = now.replace(hour=0,  minute=0, second=0, microsecond=0)
    else:
        t0 = (now - datetime.timedelta(days=1)).replace(
            hour=12, minute=0, second=0, microsecond=0)
    run_str = t0.strftime('%Y-%m-%d %H UTC')

    print('=== Z500 Clusterkaarten (EOF + k-means) ===')
    print(f'T0 = {t0.strftime("%Y-%m-%d %H")} UTC  ·  run: {now.strftime("%Y-%m-%d %H")} UTC')
    print(f'Grid: {len(LATS)}×{len(LONS)} = {len(LATS)*len(LONS)} punten @ 2.5°')

    data, members = haal_data()

    meta = {
        'bijgewerkt': now.strftime('%Y-%m-%dT%H:%M'),
        'run': run_str,
        'bestanden': {},
        'leden': {}
    }
    gegenereerd = []

    for iv in INTERVALS:
        naam = iv['naam']
        print(f'\n{"─"*55}')
        print(f'Interval {naam}: {iv["h_start"]}–{iv["h_end"]}h')
        mat = interval_matrix(data, members, t0, iv['h_start'], iv['h_end'], iv['stap'])
        res = maak_kaart(mat, iv, t0, run_str)
        if res:
            pad, leden = res
            meta['bestanden'][naam] = os.path.basename(pad)
            meta['leden'][naam] = leden
            gegenereerd.append(pad)

    meta_path = os.path.join(OUT_DIR, 'cluster_z500_meta.json')
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print(f'\nMeta: {meta_path}')

    if gegenereerd:
        print('\nUploaden naar R2...')
        upload_r2(gegenereerd + [meta_path])
    else:
        print('\nGeen kaarten gegenereerd — R2 niet bijgewerkt (oude blijven staan).')
    print('Klaar.')


if __name__ == '__main__':
    main()
