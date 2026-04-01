import os
import glob
import requests
import zipfile
import io
import xml.etree.ElementTree as ET
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec
import cartopy.crs as ccrs
import cartopy.feature as cfeature

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

stations = [
    ("06451", "Brussel"), ("06431", "Gent"), ("06450", "Antwerpen"),
    ("06479", "Kleine Brogel"), ("06407", "Oostende"), ("06449", "Charleroi"),
    ("06478", "Bierset"), ("06490", "Spa"), ("06476", "St-Hubert"),
    ("06456", "Florennes"), ("07015", "Lille"), ("F9600", "Heinerschied"),
    ("06458", "Beauvechain"), ("H908", "Monschau"), ("P0155", "Brugge"),
    ("07075", "Charleville"), ("07017", "Cambrai"), ("P0437", "Calais"),
    ("07061", "Saint-Quentin"),
]
coords = {
    "Brussel":(4.484,50.901),"Gent":(3.720,51.054),"Antwerpen":(4.405,51.219),
    "Kleine Brogel":(5.470,51.168),"Oostende":(2.862,51.199),"Charleroi":(4.453,50.460),
    "Bierset":(5.453,50.638),"Spa":(5.910,50.493),"St-Hubert":(5.404,50.035),
    "Florennes":(4.648,50.243),"Lille":(3.106,50.563),"Heinerschied":(6.080,50.030),
    "Beauvechain":(4.768,50.758),"Monschau":(6.243,50.560),"Brugge":(3.217,51.200),
    "Charleville":(4.647,49.783),"Cambrai":(3.164,50.222),"Calais":(1.954,50.819),
    "Saint-Quentin":(3.207,49.843),
}
EXTENT = [1.5, 6.6, 49.2, 51.7]
LOCAL_TZ   = ZoneInfo("Europe/Amsterdam")
nl_dagen   = ["Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag","Zondag"]
nl_maanden = ["","januari","februari","maart","april","mei","juni",
               "juli","augustus","september","oktober","november","december"]

def t5cm_kleur(t):
    if t <= -10: return "#1a0050", "white"
    if t <= -5:  return "#0055cc", "white"
    if t <= -2:  return "#4499ee", "white"
    if t <= 0:   return "#aaddff", "#003366"
    if t <= 2:   return "#cceecc", "#003300"
    if t <= 5:   return "#88cc44", "#003300"
    if t <= 10:  return "#ffcc00", "#3a2000"
    return                "#ff8800", "white"

def strip_namespaces(s):
    s = re.sub(r'<(/?)\w+:', r'<\1', s)
    s = re.sub(r'\b\w+:(\w+=)', r'\1', s)
    s = re.sub(r'\s+xmlns(?::\w+)?="[^"]*"', '', s)
    return s

def download_kmz(station):
    url = (f"https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/"
           f"single_stations/{station}/kml/MOSMIX_L_LATEST_{station}.kmz")
    try:
        r = requests.get(url, timeout=30); r.raise_for_status()
        z = zipfile.ZipFile(io.BytesIO(r.content))
        return ET.fromstring(strip_namespaces(z.read(z.namelist()[0]).decode("utf-8")))
    except Exception as e:
        print(f"  x {station}: {e}"); return None

def get_times(root):
    times = []
    for ts in root.findall('.//ForecastTimeSteps/TimeStep'):
        try: times.append(datetime.strptime((ts.text or '').strip()[:19], "%Y-%m-%dT%H:%M:%S"))
        except: pass
    return times

def parse_values(root, name):
    for fc in root.findall('.//Forecast'):
        if fc.get('elementName') == name:
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

print("MOSMIX ophalen (grondtemperatuur 5cm België)...")
data_per_day = {}

for code, naam in stations:
    print(f"  {naam} ({code})...")
    root = download_kmz(code)
    if root is None: continue
    times    = get_times(root)
    t5_raw   = parse_values(root, 'T5cm')
    ttt_raw  = parse_values(root, 'TTT')  # fallback
    t5  = [v - 273.15 if v and v > 100 else None for v in t5_raw]
    ttt = [v - 273.15 if v and v > 100 else None for v in ttt_raw]

    daily_min = {}
    for i, dt in enumerate(times):
        loc  = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d    = loc.date()
        hour = loc.hour
        # Minimum in de nacht: 18u-06u volgende dag
        if hour >= 18:
            d_key = d
        elif hour < 6:
            d_key = (loc - timedelta(days=1)).date()
        else:
            continue
        v = t5[i] if i < len(t5) and t5[i] is not None else \
            (ttt[i] if i < len(ttt) and ttt[i] is not None else None)
        if v is not None:
            if d_key not in daily_min or v < daily_min[d_key]:
                daily_min[d_key] = v

    vandaag = datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()
    days = [d for d in sorted(daily_min.keys()) if d >= vandaag][:10]
    for d in days:
        if d not in data_per_day: data_per_day[d] = {}
        data_per_day[d][naam] = round(daily_min[d], 1)

print(f"Data voor {len(data_per_day)} dagen")
if not data_per_day: print("Geen data!"); exit()

now_str  = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

for day, dag_data in data_per_day.items():
    dag_nl   = nl_dagen[day.weekday()]
    maand_nl = nl_maanden[day.month]
    next_day = day + timedelta(days=1)
    next_dag_nl = nl_dagen[next_day.weekday()]

    fig = plt.figure(figsize=(12, 9))
    gs  = GridSpec(2, 1, figure=fig, height_ratios=[0.09, 1], hspace=0.01)

    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#001a33",zorder=0,clip_on=False))
    ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=13,color="white",weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.22,"Grondtemperatuur 5cm min nacht  ·  MOS ECMWF/ICON",fontsize=8,color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.65,
              f"Grondvorst België – Nacht naar {next_dag_nl} {next_day.day} {nl_maanden[next_day.month]}",
              fontsize=14,color="white",weight="bold",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.20,f"DWD MOSMIX  ·  run: {now_str}",
              fontsize=8,color="#a8c8e8",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=2)

    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_aspect('auto'); ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),    facecolor="#9ab8d0",zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),     facecolor="#c8d8e8",zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),    facecolor="#9ab8d0",zorder=2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"),   edgecolor="#6090b0",linewidth=0.6,zorder=3)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#333333",linewidth=0.8,zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),  edgecolor="#666666",linewidth=0.7,linestyle="--",zorder=4)
    ax.axis("off")

    for naam, t5_v in dag_data.items():
        if naam not in coords: continue
        lon, lat = coords[naam]
        bg, fg = t5cm_kleur(t5_v)
        # Markeer grondvorst met *
        label = f"❄ {t5_v:.1f}°" if t5_v <= 0 else f"{t5_v:.1f}°"
        ax.text(lon, lat, label,
                ha="center", va="center", fontsize=9.0, weight="bold",
                color=fg, zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.15", facecolor=bg, edgecolor="none", zorder=7))

    ax.text(1.0,0.0,f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes,fontsize=7,style="italic",ha="right",va="bottom",color="#555555")

    fname = f"kaart_be_t5cm_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight"); plt.close()
    print(f"Kaart: {fname}")

for oud in sorted(glob.glob("kaart_be_t5cm_*.png"), key=os.path.getmtime)[:-10]:
    os.remove(oud); print(f"  Verwijderd: {oud}")
