import os
import glob
import math
import requests
import zipfile
import io
import xml.etree.ElementTree as ET
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import numpy as np
from matplotlib.gridspec import GridSpec
import cartopy.crs as ccrs
import cartopy.feature as cfeature

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# ── Stations België ───────────────────────────────────────────────────────────
stations = [
    ("06451", "Brussel"),
    ("06431", "Gent"),
    ("06450", "Antwerpen"),
    ("06479", "Kleine Brogel"),
    ("06407", "Oostende"),
    ("06449", "Charleroi"),
    ("06478", "Bierset"),
    ("06490", "Spa"),
    ("06476", "St-Hubert"),
    ("06456", "Florennes"),
    ("07015", "Lille"),
    ("F9600", "Heinerschied"),
    ("06458", "Beauvechain"),
    ("H908",  "Monschau"),
    ("P0155", "Brugge"),
    ("07075", "Charleville"),
    ("07017", "Cambrai"),
    ("P0437", "Calais"),
    ("07061", "Saint-Quentin"),
]

coords = {
    "Brussel":       (4.484, 50.901),
    "Gent":          (3.720, 51.054),
    "Antwerpen":     (4.405, 51.219),
    "Kleine Brogel": (5.470, 51.168),
    "Oostende":      (2.862, 51.199),
    "Charleroi":     (4.453, 50.460),
    "Bierset":       (5.453, 50.638),
    "Spa":           (5.910, 50.493),
    "St-Hubert":     (5.404, 50.035),
    "Florennes":     (4.648, 50.243),
    "Lille":         (3.106, 50.563),
    "Heinerschied":  (6.080, 50.030),
    "Beauvechain":   (4.768, 50.758),
    "Monschau":      (6.243, 50.560),
    "Brugge":        (3.217, 51.200),
    "Charleville":   (4.647, 49.783),
    "Cambrai":       (3.164, 50.222),
    "Calais":        (1.954, 50.819),
    "Saint-Quentin": (3.207, 49.843),
}

# België + beetje omgeving
EXTENT = [1.5, 6.6, 49.2, 51.7]

LOCAL_TZ   = ZoneInfo("Europe/Amsterdam")
nl_dagen   = ["Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag","Zondag"]
nl_maanden = ["","januari","februari","maart","april","mei","juni",
               "juli","augustus","september","oktober","november","december"]

# ── MOSMIX helpers ─────────────────────────────────────────────────────────────
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

# ── Data ophalen ───────────────────────────────────────────────────────────────
print("MOSMIX ophalen (temperatuur België)...")
data_per_day = {}

for code, naam in stations:
    print(f"  {naam} ({code})...")
    root = download_kmz(code)
    if root is None: continue
    times  = get_times(root)
    tx_raw = parse_values(root, 'TX')
    tn_raw = parse_values(root, 'TN')
    tx = [v - 273.15 if v and v > 200 else None for v in tx_raw]
    tn = [v - 273.15 if v and v > 200 else None for v in tn_raw]

    daily_tx, daily_tn = {}, {}
    for i, dt in enumerate(times):
        loc = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d   = loc.date()
        if i < len(tx) and tx[i] is not None:
            if d not in daily_tx or tx[i] > daily_tx[d]: daily_tx[d] = tx[i]
        if i < len(tn) and tn[i] is not None:
            if d not in daily_tn or tn[i] < daily_tn[d]: daily_tn[d] = tn[i]

    vandaag = datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()
    days = [d for d in sorted(set(list(daily_tx.keys()) + list(daily_tn.keys()))) if d >= vandaag][:10]
    for d in days:
        if d not in data_per_day: data_per_day[d] = {}
        data_per_day[d][naam] = {
            "tx": round(daily_tx.get(d, 0), 1),
            "tn": round(daily_tn.get(d, 0), 1),
        }

print(f"Data voor {len(data_per_day)} dagen")
if not data_per_day:
    print("Geen data!"); exit()

now_str  = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

# ── Kaarten tekenen ────────────────────────────────────────────────────────────
for day, dag_data in data_per_day.items():
    dag_nl = nl_dagen[day.weekday()]
    maand_nl = nl_maanden[day.month]

    # Smaller 4:3-achtig formaat voor België
    fig = plt.figure(figsize=(12, 9))
    gs  = GridSpec(2, 1, figure=fig, height_ratios=[0.09, 1], hspace=0.01)

    # ── Header ──
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#003366", zorder=0, clip_on=False))
    ax_h.text(0.012, 0.62, "Ed Aldus WM", fontsize=13, color="white",
              weight="bold", va="center", transform=ax_h.transAxes)
    ax_h.text(0.012, 0.22, "MOS ECMWF/ICON · DWD MOSMIX", fontsize=8,
              color="#a8c8e8", va="center", transform=ax_h.transAxes)
    ax_h.text(0.988, 0.65, f"Temperatuur België – {dag_nl} {day.day} {maand_nl}",
              fontsize=15, color="white", weight="bold",
              ha="right", va="center", transform=ax_h.transAxes)
    ax_h.text(0.988, 0.20, f"DWD MOSMIX  ·  run: {now_str}",
              fontsize=8, color="#a8c8e8", ha="right", va="center",
              transform=ax_h.transAxes)
    ax_h.axhline(0, color="#4a90c4", linewidth=2)

    # ── Kaart ──
    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_aspect('auto')
    ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),    facecolor="#c8e0f0", zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),     facecolor="#eaf3e8", zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),    facecolor="#c8e0f0", zorder=2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"),   edgecolor="#89b8d4", linewidth=0.6, zorder=3)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#333333", linewidth=0.8, zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),  edgecolor="#666666", linewidth=0.7,
                   linestyle="--", zorder=4)
    ax.axis("off")

    # ── Temperatuurwaarden ──
    for naam, vals in dag_data.items():
        if naam not in coords: continue
        lon, lat = coords[naam]
        tx_v = vals["tx"]
        tn_v = vals["tn"]

        # TX rood boven
        ax.text(lon, lat + 0.045, f"{tx_v:.1f}",
                ha="center", va="bottom", fontsize=9.0, weight="bold",
                color="white", zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.12", facecolor="#cc2200",
                          edgecolor="none", zorder=7))
        # TN blauw onder
        ax.text(lon, lat + 0.025, f"{tn_v:.1f}",
                ha="center", va="top", fontsize=9.0, weight="bold",
                color="white", zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.12", facecolor="#1a5fb4",
                          edgecolor="none", zorder=7))

    # ── Legenda ──
    leg = ax.inset_axes([0.01, 0.02, 0.13, 0.13])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",
                  linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.add_patch(plt.Rectangle((0.05,0.55),0.20,0.32,facecolor="#cc2200",
                  transform=leg.transAxes,zorder=1))
    leg.text(0.32, 0.71, "Max temperatuur", fontsize=5, va="center", transform=leg.transAxes)
    leg.add_patch(plt.Rectangle((0.05,0.10),0.20,0.32,facecolor="#1a5fb4",
                  transform=leg.transAxes,zorder=1))
    leg.text(0.32, 0.26, "Min temperatuur", fontsize=5, va="center", transform=leg.transAxes)

    # Copyright
    ax.text(1.0, 0.0, f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes, fontsize=7, style="italic",
            ha="right", va="bottom", color="#555555")

    fname = f"kaart_be_temp_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Kaart: {fname}")

# Ruim oude kaarten op (elk type apart, max 7 per reeks, gesorteerd op bestandsdatum)
import glob as _glob
alle = _glob.glob("kaart_be_temp_*.png")
oude_temp = sorted([f for f in alle if not os.path.basename(f).startswith("kaart_be_temp_dag_")
                                    and not os.path.basename(f).startswith("kaart_be_temp_nacht_")],
                   key=os.path.getmtime)
for oud in oude_temp[:-10]:
    os.remove(oud); print(f"  Verwijderd: {oud}")

