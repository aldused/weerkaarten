import os
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
    "Dollart":(7.220,53.230),"Wielen":(6.450,52.320),"IJsselmeer":(5.433,52.618),
    "Valkenburg":(4.417,52.270),"Kleve":(6.140,51.790),"Weeze":(6.141,51.603),
    "Bocholt":(6.617,51.838),"Nettetal":(6.276,51.317),"Geilenkirchen":(6.043,50.960),
    "Borkum":(6.749,53.586),"Volkel":(5.707,51.657),
    "IJmuiden":(3.31,52.31),"E5405":(5.00,54.50),
}

EXTENT = [3.3, 7.4, 50.45, 53.8]

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

# ── NEERSLAGKAART ─────────────────────────────────────────────────────────────
from matplotlib.gridspec import GridSpec
import cartopy.crs as ccrs

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
print("MOSMIX ophalen (neerslag)...")

cmap_regen = mcolors.LinearSegmentedColormap.from_list("regen",["#ffffff","#c6dbef","#6baed6","#2171b5","#084594"])
norm_regen = mcolors.Normalize(vmin=0, vmax=15)
def rr_kleur(mm): return cmap_regen(norm_regen(min(mm,15)))
def rr_tekstkleur(mm): return "black" if mm < 6 else "white"

data_per_day = {}
for code, name in stations:
    print(f"Ophalen: {name} ({code})...")
    root = download_kmz(code)
    if root is None: print("  x Geen data"); continue
    times = get_times(root)
    rr_raw = parse_values(root, 'RR1c')
    LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
    daily_dag, daily_nacht = {}, {}
    for i, dt in enumerate(times):
        loc = dt .replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ); d = loc.date(); hour = loc.hour
        if i < len(rr_raw) and rr_raw[i] is not None:
            rr = rr_raw[i]
            if 6 <= hour < 18: daily_dag[d] = daily_dag.get(d,0.0) + rr
            else: daily_nacht[d] = daily_nacht.get(d,0.0) + rr
    days = sorted(set(list(daily_dag.keys())+list(daily_nacht.keys())))[:10]
    for d in days:
        if d not in data_per_day: data_per_day[d] = {}
        data_per_day[d][name] = {"rr_dag":round(daily_dag.get(d,0),1),"rr_nacht":round(daily_nacht.get(d,0),1)}

print(f"Data voor {len(data_per_day)} dagen")
if not data_per_day: print("Geen data!"); exit()

now_str = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

for day, dag_data in data_per_day.items():
    dag_nl = nl_dagen[day.weekday()]
    fig = plt.figure(figsize=(8,11))
    gs = GridSpec(2,1,figure=fig,height_ratios=[0.085,1],hspace=0.01)
    maak_header(fig, gs, dag_nl, day, now_str)
    ax = maak_kaart_ax(fig, gs)

    for name, rr in dag_data.items():
        if name not in coords: continue
        lon, lat = coords[name]
        rr_dag = rr["rr_dag"]; rr_nacht = rr["rr_nacht"]
        ax.text(lon, lat+0.035, f"\u2600 {rr_dag:.1f}", ha="center", va="bottom", fontsize=7.5, weight="bold",
                color=rr_tekstkleur(rr_dag), zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.10",facecolor=rr_kleur(rr_dag),edgecolor="#6baed6",linewidth=0.4,zorder=7))
        ax.text(lon, lat+0.018, f"\u263d {rr_nacht:.1f}", ha="center", va="top", fontsize=7.5, weight="bold",
                color=rr_tekstkleur(rr_nacht), zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.10",facecolor=rr_kleur(rr_nacht),edgecolor="#6baed6",linewidth=0.4,zorder=7))

    ax.text(1.0,0.0,f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes,fontsize=6.5,style="italic",ha="right",va="bottom",color="#555555")

    # Legenda
    leg = ax.inset_axes([0.01,0.75,0.22,0.22])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.text(0.50,0.91,"Neerslag (mm)",fontsize=4.5,weight="bold",ha="center",va="center",transform=leg.transAxes)
    mm_vals = np.linspace(0,15,100)
    for j in range(len(mm_vals)-1):
        x0=0.05+j*0.90/len(mm_vals); x1=0.05+(j+1)*0.90/len(mm_vals)
        leg.add_patch(plt.Rectangle((x0,0.60),x1-x0,0.18,facecolor=cmap_regen(norm_regen(mm_vals[j])),edgecolor="none",transform=leg.transAxes,zorder=1))
    for mm_label in [0,5,10,15]:
        x_pos=0.05+mm_label/15*0.90
        leg.text(x_pos,0.55,f"{mm_label}",fontsize=3.5,ha="center",va="top",transform=leg.transAxes,color="#333333")
    leg.text(0.10,0.38,"\u2600",fontsize=6,ha="center",va="center",transform=leg.transAxes,color="#cc8800")
    leg.text(0.22,0.38,"06\u201318u",fontsize=4.0,va="center",transform=leg.transAxes,color="#222222")
    leg.text(0.10,0.18,"\u263d",fontsize=6,ha="center",va="center",transform=leg.transAxes,color="#334466")
    leg.text(0.22,0.18,"18\u201306u",fontsize=4.0,va="center",transform=leg.transAxes,color="#222222")

    ax.set_extent(EXTENT, crs=ccrs.PlateCarree()); ax.axis("off")
    fname = f"kaart_regen_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname, dpi=300, bbox_inches="tight"); plt.close()
    print(f"Kaart: {fname}")
