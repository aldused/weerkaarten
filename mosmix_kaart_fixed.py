import os
import math
import requests
import zipfile
import io
import xml.etree.ElementTree as ET
import re
from datetime import datetime, timedelta
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import numpy as np

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
    ("10500","Geilenkirchen"),("E5204","IJmuiden"),("E5405","E5405"),
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
    "Bocholt":(6.617,51.838),"Nettetal":(6.276,51.317),"Geilenkirchen":(6.043,50.960),
    "Borkum":(6.749,53.586),"Volkel":(5.707,51.657),
    "IJmuiden":(3.31,52.31),"E5405":(5.00,54.50),
}

EXTENT = [3.3, 7.4, 50.7, 54.7]

nl_dagen   = ["Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag","Zondag"]
nl_maanden = ["","Januari","Februari","Maart","April","Mei","Juni",
               "Juli","Augustus","September","Oktober","November","December"]

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
    except Exception as e:
        print(f"  x Download fout {station}: {e}"); return None
    try:
        z = zipfile.ZipFile(io.BytesIO(r.content))
        kml = strip_namespaces(z.read(z.namelist()[0]).decode("utf-8"))
        return ET.fromstring(kml)
    except Exception as e:
        print(f"  x Parse fout {station}: {e}"); return None

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

def maak_header(fig, gs, dag_nl, day, now_str):
    ax = fig.add_subplot(gs[0])
    ax.set_xlim(0,1); ax.set_ylim(0,1); ax.axis("off")
    ax.add_patch(plt.Rectangle((0,0),1,1,transform=ax.transAxes,facecolor="#003366",zorder=0,clip_on=False))
    maand_nl = nl_maanden[day.month]
    ax.text(0.012,0.58,"Ed Aldus WM",fontsize=11,color="white",weight="bold",va="center",transform=ax.transAxes)
    ax.text(0.012,0.18,"MOS ECMWF/ICON",fontsize=7.5,color="#a8c8e8",va="center",transform=ax.transAxes)
    ax.text(0.988,0.62,f"{dag_nl} {day.day} {maand_nl}",fontsize=13,color="white",weight="bold",ha="right",va="center",transform=ax.transAxes)
    ax.text(0.988,0.18,f"DWD MOSMIX  \u00b7  run: {now_str}",fontsize=7,color="#a8c8e8",ha="right",va="center",transform=ax.transAxes)
    ax.axhline(0,color="#4a90c4",linewidth=1.5)
    return ax

def maak_kaart_ax(fig, gs):
    import cartopy.crs as ccrs
    import cartopy.feature as cfeature
    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_aspect('auto')
    ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),facecolor="#c8e0f0",zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),facecolor="#eaf3e8",zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),facecolor="#c8e0f0",zorder=2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"),edgecolor="#89b8d4",linewidth=0.5,zorder=3)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#333333",linewidth=0.7,zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),edgecolor="#666666",linewidth=0.6,linestyle="--",zorder=4)
    return ax

# ── TEMPERATUURKAART ─────────────────────────────────────────────────────────
from matplotlib.gridspec import GridSpec
import cartopy.crs as ccrs

os.chdir(os.path.dirname(os.path.abspath(__file__)))
print("MOSMIX ophalen (temperatuur)...")

data_per_day = {}
for code, name in stations:
    print(f"Ophalen: {name} ({code})...")
    root = download_kmz(code)
    if root is None: print("  x Geen data"); continue
    times = get_times(root)
    tx_raw = parse_values(root, 'TX')
    tn_raw = parse_values(root, 'TN')
    tx = [v-273.15 if v and v>200 else None for v in tx_raw]
    tn = [v-273.15 if v and v>200 else None for v in tn_raw]
    UTC_OFFSET = timedelta(hours=1)
    daily_tx, daily_tn = {}, {}
    for i, dt in enumerate(times):
        loc = dt + UTC_OFFSET; d = loc.date()
        if i < len(tx) and tx[i] is not None:
            if d not in daily_tx or tx[i] > daily_tx[d]: daily_tx[d] = tx[i]
        if i < len(tn) and tn[i] is not None:
            if d not in daily_tn or tn[i] < daily_tn[d]: daily_tn[d] = tn[i]
    days = sorted(set(list(daily_tx.keys())+list(daily_tn.keys())))[:10]
    for d in days:
        if d not in data_per_day: data_per_day[d] = {}
        data_per_day[d][name] = {"tx": round(daily_tx.get(d,0),1), "tn": round(daily_tn.get(d,0),1)}

print(f"Data voor {len(data_per_day)} dagen")
if not data_per_day: print("Geen data!"); exit()

cmap_tx = mcolors.LinearSegmentedColormap.from_list("tx",["#084594","#4292c6","#9ecae1","#c6dbef","#ffffcc","#fed976","#fd8d3c","#e31a1c","#800026"])
norm_tx = mcolors.Normalize(vmin=-5, vmax=25)

now_str = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

for day, dag_data in data_per_day.items():
    dag_nl = nl_dagen[day.weekday()]
    fig = plt.figure(figsize=(8,11))
    gs = GridSpec(2,1,figure=fig,height_ratios=[0.085,1],hspace=0.01)
    maak_header(fig, gs, dag_nl, day, now_str)
    ax = maak_kaart_ax(fig, gs)

    # Kleurenbalk
    sm = plt.cm.ScalarMappable(cmap=cmap_tx, norm=norm_tx)
    sm.set_array([])
    cbar_ax = fig.add_axes([0.08, 0.915, 0.84, 0.012])
    cb = fig.colorbar(sm, cax=cbar_ax, orientation='horizontal')
    cb.ax.tick_params(labelsize=6)
    for label in ['-5°','0°','5°','10°','15°','20°','25°']:
        pass
    cb.set_ticks([-5,0,5,10,15,20,25])
    cb.set_ticklabels([f'{v}°' for v in [-5,0,5,10,15,20,25]])

    for name, vals in dag_data.items():
        if name not in coords: continue
        lon, lat = coords[name]
        tx_v = vals["tx"]; tn_v = vals["tn"]
        kleur_tx = cmap_tx(norm_tx(tx_v))
        ax.text(lon, lat+0.035, f"{tx_v:.1f}", ha="center", va="bottom", fontsize=7.0, weight="bold",
                color="white", zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.10", facecolor="#cc2200", edgecolor="none", linewidth=0, zorder=7))
        ax.text(lon, lat+0.018, f"{tn_v:.1f}", ha="center", va="top", fontsize=7.0, weight="bold",
                color="white", zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.10", facecolor="#1a5fb4", edgecolor="none", linewidth=0, zorder=7))

    ax.text(1.0,0.0,f"Bron: Ed Aldus / DWD Deutscher Wetterdienst | {now_str2}",
            transform=ax.transAxes,fontsize=6.5,style="italic",ha="right",va="bottom",color="#555555")

    # Legenda
    leg = ax.inset_axes([0.01,0.01,0.18,0.10])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.add_patch(plt.Rectangle((0.05,0.55),0.18,0.30,facecolor="#cc2200",transform=leg.transAxes,zorder=1))
    leg.text(0.28,0.70,"Maximumtemperatuur",fontsize=4,va="center",transform=leg.transAxes)
    leg.add_patch(plt.Rectangle((0.05,0.10),0.18,0.30,facecolor="#1a5fb4",transform=leg.transAxes,zorder=1))
    leg.text(0.28,0.25,"Minimumtemperatuur",fontsize=4,va="center",transform=leg.transAxes)

    ax.set_extent(EXTENT, crs=ccrs.PlateCarree()); ax.axis("off")
    fname = f"kaart_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname, dpi=300, bbox_inches="tight"); plt.close()
    print(f"Kaart: {fname}")
