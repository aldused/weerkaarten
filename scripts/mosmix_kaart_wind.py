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
    "Rotterdam Airport":(4.550,51.880),"Gilze Rijen":(4.931,51.567),
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

from matplotlib.gridspec import GridSpec
import cartopy.crs as ccrs

bft_kleuren = {0:"#aaaaaa",1:"#aaaaaa",2:"#aaaaaa",3:"#4caf50",4:"#8bc34a",
               5:"#ffeb3b",6:"#ff9800",7:"#f44336",8:"#b71c1c"}
bft_tekstkleur = {0:"white",1:"white",2:"white",3:"white",4:"white",
                  5:"black",6:"white",7:"white",8:"white"}

def ms_to_bft(ms):
    if ms is None: return 0
    for b,v in [(0,0.3),(1,1.6),(2,3.4),(3,5.5),(4,8.0),(5,10.8),(6,13.9),(7,17.2),(8,20.8)]:
        if ms <= v: return b
    return 9

def bft_to_kmh(ms):
    return round(ms * 3.6) if ms else 0

def windpijl(graden):
    pijlen = ["↓","↙","←","↖","↑","↗","→","↘","↓"]
    if graden is None: return "·"
    return pijlen[round(graden/45) % 8]

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
print("MOSMIX ophalen (wind dag 06-18u)...")

data_per_day = {}
for code, name in stations:
    print(f"Ophalen: {name} ({code})...")
    root = download_kmz(code)
    if root is None: print("  x Geen data"); continue
    times = get_times(root)
    ff_raw = parse_values(root, 'FF')
    fx_raw = parse_values(root, 'FX1')
    dd_raw = parse_values(root, 'DD')
    LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
    daily = {}
    for i, dt in enumerate(times):
        loc = dt .replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ); d = loc.date()
        hour = loc.hour
        if 6 <= hour < 18:
            if d not in daily: daily[d] = {"ff":[], "ff_dd":[], "fx":[]}
            if i < len(ff_raw) and ff_raw[i] is not None:
                daily[d]["ff"].append(ff_raw[i])
                # sla dd op gesynchroniseerd met ff
                dd_val = dd_raw[i] if i < len(dd_raw) else None
                daily[d]["ff_dd"].append(dd_val)
            if i < len(fx_raw) and fx_raw[i] is not None:
                daily[d]["fx"].append(fx_raw[i])

    days = sorted(daily.keys())[:10]
    for d in days:
        if d not in data_per_day: data_per_day[d] = {}
        ff_lijst = daily[d]["ff"]
        ff_gem = sum(ff_lijst)/len(ff_lijst) if ff_lijst else 0
        fx_max = max(daily[d]["fx"]) if daily[d]["fx"] else 0
        # windrichting op moment van hoogste 10-min gemiddelde wind
        if ff_lijst:
            idx = ff_lijst.index(max(ff_lijst))
            dd_bij_ff_max = daily[d]["ff_dd"][idx] if idx < len(daily[d]["ff_dd"]) else None
        else:
            dd_bij_ff_max = None
        data_per_day[d][name] = {"ff":ff_gem, "fx":fx_max, "dd":dd_bij_ff_max}

print(f"Data voor {len(data_per_day)} dagen")
if not data_per_day: print("Geen data!"); exit()

now_str  = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

for day, dag_data in data_per_day.items():
    dag_nl = nl_dagen[day.weekday()]
    fig = plt.figure(figsize=(8,11))
    gs = GridSpec(2,1,figure=fig,height_ratios=[0.085,1],hspace=0.01)
    maak_header(fig, gs, dag_nl, day, now_str)
    ax = maak_kaart_ax(fig, gs)

    for name, vals in dag_data.items():
        if name not in coords: continue
        lon, lat = coords[name]
        bft = ms_to_bft(vals["ff"])
        fx_kmh = bft_to_kmh(vals["fx"])
        pijl = windpijl(vals["dd"])
        kleur = bft_kleuren.get(min(bft,8),"#b71c1c")
        tkleur = bft_tekstkleur.get(min(bft,8),"white")
        tekst = f"{pijl} {bft}Bft\nmax {fx_kmh}km/u"
        ax.text(lon, lat, tekst, ha="center", va="center", fontsize=7.0, weight="bold",
                color=tkleur, zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.15", facecolor=kleur, edgecolor="none", zorder=7))

    ax.text(1.0,0.0,f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes,fontsize=6.5,style="italic",ha="right",va="bottom",color="#555555")

    legenda_items = [(0,"0-2 Bft","#aaaaaa","white"),(3,"3 Bft","#4caf50","white"),
                     (4,"4 Bft","#8bc34a","white"),(5,"5 Bft","#ffeb3b","black"),
                     (6,"6 Bft","#ff9800","white"),(7,"7 Bft","#f44336","white"),(8,"8+ Bft","#b71c1c","white")]
    leg_x, leg_y = 0.01, 0.98
    item_h = 0.035
    leg_h = len(legenda_items)*item_h + 0.04
    leg = ax.inset_axes([leg_x, leg_y-leg_h, 0.18, leg_h])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.text(0.5,0.94,"Windkracht (06-18u)",fontsize=4.5,weight="bold",ha="center",va="top",transform=leg.transAxes)
    for idx,(b,label,kleur,tk) in enumerate(legenda_items):
        y = 0.86 - idx*(1.0/len(legenda_items))*0.88
        leg.add_patch(plt.Rectangle((0.04,y-0.04),0.20,0.09,facecolor=kleur,transform=leg.transAxes,zorder=1))
        leg.text(0.30,y+0.005,label,fontsize=4.0,va="center",transform=leg.transAxes,color="#222222")

    ax.set_extent(EXTENT, crs=ccrs.PlateCarree()); ax.axis("off")
    fname = f"kaart_wind_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname, dpi=300, bbox_inches="tight"); plt.close()
    print(f"Kaart: {fname}")

# Ruim oude kaarten op (dag en nacht apart, max 7 per reeks, gesorteerd op datum)
alle_wind = glob.glob("kaart_wind_*.png")
oude_dag   = sorted([f for f in alle_wind if not os.path.basename(f).startswith("kaart_wind_nacht_")],
                    key=os.path.getmtime)
oude_nacht = sorted([f for f in alle_wind if os.path.basename(f).startswith("kaart_wind_nacht_")],
                    key=os.path.getmtime)
for oud in oude_dag[:-10]:
    os.remove(oud)
    print(f"  Verwijderd: {oud}")
for oud in oude_nacht[:-10]:
    os.remove(oud)
    print(f"  Verwijderd: {oud}")

