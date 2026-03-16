import os
import math
import requests
import zipfile
import io
import xml.etree.ElementTree as ET
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.patheffects as pe
import numpy as np

os.chdir(os.path.dirname(os.path.abspath(__file__)))

stations = [
    ("06280","Eelde"),("06250","Terschelling"),("06242","Vlieland"),
    ("06270","Leeuwarden"),("06235","Den Helder"),("06240","Amsterdam"),
    ("06260","De Bilt"),("06275","Deelen"),("06279","Hoogeveen"),
    ("06290","Enschede"),("06310","Vlissingen"),("06330","Hoek van Holland"),
    ("06344","Rotterdam Airport"),("06350","Gilze Rijen"),("06370","Eindhoven"),
    ("06380","Maastricht"),("06431","Gent"),("06450","Antwerpen"),
    ("K1176","Kleve"),("06451","Brussel"),("06479","Kleine Brogel"),
    ("E207","Dollart"),("P0122","Wielen"),("10405","Weeze"),
    ("06210","Valkenburg"),("06375","Volkel"),("10406","Bocholt"),
    ("H512","Nettetal"),("E5305","IJsselmeer"),("K1083","Borkum"),
    ("10500","Geilenkirchen"),
]

coords = {
    "Eelde":(6.586,53.123),"Terschelling":(5.350,53.392),"Vlieland":(4.920,53.250),
    "Leeuwarden":(5.774,53.224),"Den Helder":(4.789,52.928),"Amsterdam":(4.781,52.309),
    "De Bilt":(5.178,52.101),"Deelen":(5.885,52.060),"Hoogeveen":(6.520,52.730),
    "Enschede":(6.889,52.275),"Vlissingen":(3.596,51.442),"Hoek van Holland":(4.131,51.978),
    "Rotterdam Airport":(4.437,51.957),"Gilze Rijen":(4.931,51.567),
    "Eindhoven":(5.377,51.451),"Maastricht":(5.770,50.911),"Gent":(3.720,51.054),
    "Antwerpen":(4.405,51.219),"Brussel":(4.484,50.901),"Kleine Brogel":(5.470,51.168),
    "Dollart":(7.220,53.230),"Wielen":(6.450,52.320),"IJsselmeer":(5.280,52.750),
    "Valkenburg":(4.417,52.270),"Kleve":(6.140,51.790),"Weeze":(6.141,51.603),
    "Bocholt":(6.617,51.838),"Nettetal":(6.276,51.317),"Geilenkirchen":(6.030,50.580),
    "Borkum":(6.749,53.586),"Volkel":(5.707,51.657),
}

EXTENT = [3.3, 7.4, 50.45, 53.8]
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

nl_dagen   = ["Ma","Di","Wo","Do","Vr","Za","Zo"]
nl_maanden = ["","jan","feb","mrt","apr","mei","jun",
               "jul","aug","sep","okt","nov","dec"]

# Bewolkingskleuren per laag — lichter voor hoog en midden
KLEUR_L = "#2c3e50"   # laag — donkerblauwgrijs
KLEUR_M = "#95a5a6"   # midden — middegrijs (lichter)
KLEUR_H = "#dfe6e9"   # hoog — zeer lichtgrijs

# ── MOSMIX helpers ────────────────────────────────────────────────────────────
def strip_namespaces(xml_string):
    xml_string = re.sub(r'<(/?)\w+:', r'<\1', xml_string)
    xml_string = re.sub(r'\b\w+:(\w+=)', r'\1', xml_string)
    xml_string = re.sub(r'\s+xmlns(?::\w+)?="[^"]*"', '', xml_string)
    return xml_string

def download_kmz(station):
    url = (f"https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/"
           f"single_stations/{station}/kml/MOSMIX_L_LATEST_{station}.kmz")
    try:
        r = requests.get(url, timeout=30); r.raise_for_status()
        z = zipfile.ZipFile(io.BytesIO(r.content))
        kml = strip_namespaces(z.read(z.namelist()[0]).decode("utf-8"))
        return ET.fromstring(kml)
    except Exception as e:
        print(f"  x {station}: {e}"); return None

def get_times(root):
    times = []
    for ts in root.findall('.//ForecastTimeSteps/TimeStep'):
        try: times.append(datetime.strptime((ts.text or '').strip()[:19], "%Y-%m-%dT%H:%M:%S"))
        except: pass
    return times

def parse_values(root, element_name):
    for fc in root.findall('.//Forecast'):
        if fc.get('elementName') == element_name:
            val = fc.find('value')
            if val is not None and val.text:
                res = []
                for t in val.text.strip().split():
                    if t == '-': res.append(None)
                    else:
                        try: res.append(float(t))
                        except: res.append(None)
                return res
    return []

def dag_gemiddelde(times, values, doeldatum):
    """Gemiddelde bewolking over de gehele doeldag (lokaal)."""
    totaal, n = 0.0, 0
    for i, dt_utc in enumerate(times):
        dt_loc = dt_utc.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        if dt_loc.date() == doeldatum and i < len(values) and values[i] is not None:
            totaal += values[i]
            n += 1
    return round(totaal / n, 1) if n > 0 else None

# ── Data ophalen ───────────────────────────────────────────────────────────────
now_utc   = datetime.now(timezone.utc)
now_lokaal = now_utc.astimezone(LOCAL_TZ)
now_str    = now_lokaal.strftime("%d %b %Y  %H:%M")

# Genereer voor de komende 4 dagen
DAGEN_VOORUIT = 4

for dag_offset in range(1, DAGEN_VOORUIT + 1):
    doeldag = (now_lokaal + timedelta(days=dag_offset)).date()
    dag_label = f"{nl_dagen[doeldag.weekday()]} {doeldag.day} {nl_maanden[doeldag.month]}"
    datum_str = doeldag.strftime("%Y-%m-%d")

    print(f"\nBewolkingskaart voor {dag_label}...")

    station_data = {}
    for code, naam in stations:
        if naam not in coords: continue
        print(f"  {naam}...")
        root = download_kmz(code)
        if root is None: continue
        times = get_times(root)

        nl_raw = parse_values(root, 'Nl')
        nm_raw = parse_values(root, 'Nm')
        nh_raw = parse_values(root, 'Nh')

        nl = dag_gemiddelde(times, nl_raw, doeldag)
        nm = dag_gemiddelde(times, nm_raw, doeldag)
        nh = dag_gemiddelde(times, nh_raw, doeldag)

        if nl is not None or nm is not None or nh is not None:
            station_data[naam] = {
                "nl": round(nl, 1) if nl is not None else None,
                "nm": round(nm, 1) if nm is not None else None,
                "nh": round(nh, 1) if nh is not None else None,
            }

    print(f"  Data voor {len(station_data)} stations")

    # ── Kaart tekenen ────────────────────────────────────────────
    import cartopy.crs as ccrs
    import cartopy.feature as cfeature
    from matplotlib.gridspec import GridSpec

    fig = plt.figure(figsize=(10, 13))
    gs = GridSpec(2, 1, figure=fig, height_ratios=[0.07, 1], hspace=0.01)

    # Header
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#003366", zorder=0, clip_on=False))
    ax_h.text(0.012, 0.65, "Ed Aldus WM", fontsize=11, color="white",
              weight="bold", va="center", transform=ax_h.transAxes)
    ax_h.text(0.012, 0.22, "MOS ECMWF/ICON · DWD MOSMIX", fontsize=7.5,
              color="#a8c8e8", va="center", transform=ax_h.transAxes)
    ax_h.text(0.988, 0.65, f"Bewolking – {dag_label}",
              fontsize=13, color="white", weight="bold",
              ha="right", va="center", transform=ax_h.transAxes)
    ax_h.text(0.988, 0.22, f"run: {now_str}",
              fontsize=7.5, color="#a8c8e8", ha="right", va="center",
              transform=ax_h.transAxes)
    ax_h.axhline(0, color="#4a90c4", linewidth=1.5)

    # Kaart
    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.set_aspect('auto')
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),  facecolor="#d8ecf8", zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),   facecolor="#f0f4ec", zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),  facecolor="#d8ecf8", zorder=2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"), edgecolor="#a8cce0", linewidth=0.5, zorder=3)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"), edgecolor="#555555", linewidth=0.8, zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),   edgecolor="#888888", linewidth=0.6,
                   linestyle="--", zorder=4)
    ax.axis("off")

    tr = ccrs.PlateCarree()

    # Vaste cirkelgrootte in graden (eenvoudiger en betrouwbaarder)
    R_LON = 0.065
    R_LAT = 0.045

    def teken_cirkel(ax, lon, lat, waarde, kleur):
        """Teken een gevulde cirkel op (lon, lat) met vulling naar waarde (0-100%)."""
        # Witte achtergrond
        ax.add_patch(mpatches.Ellipse((lon, lat), 2*R_LON, 2*R_LAT,
                     facecolor='white', edgecolor='none', zorder=8, transform=tr))
        # Vulling
        if waarde is not None and waarde > 0:
            frac = min(waarde / 100.0, 1.0)
            theta = np.linspace(np.pi/2, np.pi/2 - frac*2*np.pi, 80)
            xs = lon + R_LON * np.cos(theta)
            ys = lat + R_LAT * np.sin(theta)
            ax.fill(np.append([lon], xs), np.append([lat], ys),
                    color=kleur, zorder=9, transform=tr)
        # Rand
        ax.add_patch(mpatches.Ellipse((lon, lat), 2*R_LON, 2*R_LAT,
                     facecolor='none', edgecolor='#333333',
                     linewidth=0.8, zorder=10, transform=tr))
        # Percentage weglaten — vulling spreekt voor zich

    for naam, v in station_data.items():
        lon, lat = coords[naam]
        nl, nm, nh = v["nl"], v["nm"], v["nh"]
        # Drie cirkels gestapeld: laag onderin, hoog bovenin
        teken_cirkel(ax, lon, lat,                    nl, KLEUR_L)  # laag
        teken_cirkel(ax, lon, lat + R_LAT*2.4,        nm, KLEUR_M)  # midden
        teken_cirkel(ax, lon, lat + R_LAT*4.8,        nh, KLEUR_H)  # hoog

    # ── Legenda ───────────────────────────────────────────────────────────────────
    leg = ax.inset_axes([0.01, 0.82, 0.28, 0.17])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",
                  linewidth=0.7, transform=leg.transAxes, zorder=0))
    leg.text(0.5, 0.96, "Bewolking per laag (daggemiddelde)",
             fontsize=4.5, weight="bold", ha="center", va="top", transform=leg.transAxes)

    # Drie lagen tonen
    lagen = [
        (0.75, KLEUR_H, "Hoog (Nh)", "Cirrus / sluierbewolking"),
        (0.50, KLEUR_M, "Midden (Nm)", "Altocumulus / altostratus"),
        (0.25, KLEUR_L, "Laag (Nl)",  "Cumulus / stratus"),
    ]
    for y, kleur, naam_l, omschr in lagen:
        # Gevulde cirkel
        c = mpatches.Ellipse((0.10, y), 0.10, 0.14,
                              facecolor=kleur, edgecolor='#444444',
                              linewidth=0.6, zorder=1, transform=leg.transAxes)
        leg.add_patch(c)
        leg.text(0.20, y+0.04, naam_l, fontsize=4.2, weight="bold",
                 color="#222222", transform=leg.transAxes, va="center")
        leg.text(0.20, y-0.06, omschr, fontsize=3.5,
                 color="#666666", transform=leg.transAxes, va="center")

    # Vulling uitleg
    leg.text(0.5, 0.05, "Vulling = bewolkingsgraad (0% = helder, 100% = bedekt)",
             fontsize=3.2, color="#888888", ha="center", transform=leg.transAxes)

    ax.text(1.0, 0.0, f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str}",
            transform=ax.transAxes, fontsize=6.5, style="italic",
            ha="right", va="bottom", color="#555555")

    fname = f"kaart_bewolking_{datum_str}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Kaart opgeslagen: {fname}")
