import os, glob, requests, zipfile, io, xml.etree.ElementTree as ET, re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
from matplotlib.gridspec import GridSpec
import cartopy.crs as ccrs
import cartopy.feature as cfeature

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

stations = [
    ("06451","Brussel"),("06431","Gent"),("06450","Antwerpen"),("06479","Kleine Brogel"),
    ("06407","Oostende"),("06449","Charleroi"),("06478","Bierset"),("06490","Spa"),
    ("06476","St-Hubert"),("06456","Florennes"),("07015","Lille"),("F9600","Heinerschied"),
    ("06458","Beauvechain"),("H908","Monschau"),("P0155","Brugge"),("07075","Charleville"),
    ("07017","Cambrai"),("P0437","Calais"),("07061","Saint-Quentin"),
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
EXTENT    = [1.5, 6.6, 49.2, 51.7]
LOCAL_TZ  = ZoneInfo("Europe/Amsterdam")
nl_dagen  = ["Ma","Di","Wo","Do","Vr","Za","Zo"]
nl_mnd    = ["","jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"]
KLEUR_L   = "#2c3e50"
KLEUR_M   = "#95a5a6"
KLEUR_H   = "#dfe6e9"

def strip_ns(s):
    s = re.sub(r'<(/?)\w+:', r'<\1', s)
    s = re.sub(r'\b\w+:(\w+=)', r'\1', s)
    return re.sub(r'\s+xmlns(?::\w+)?="[^"]*"', '', s)

def download_kmz(station):
    url = (f"https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/"
           f"single_stations/{station}/kml/MOSMIX_L_LATEST_{station}.kmz")
    try:
        r = requests.get(url, timeout=30); r.raise_for_status()
        z = zipfile.ZipFile(io.BytesIO(r.content))
        return ET.fromstring(strip_ns(z.read(z.namelist()[0]).decode("utf-8")))
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

def dag_gem(times, values, doeldag):
    totaal, n = 0.0, 0
    for i, dt in enumerate(times):
        loc = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        if loc.date() == doeldag and i < len(values) and values[i] is not None:
            totaal += values[i]; n += 1
    return round(totaal/n, 1) if n > 0 else None

now_utc    = datetime.now(timezone.utc)
now_lokaal = now_utc.astimezone(LOCAL_TZ)
now_str    = now_lokaal.strftime("%d %b %Y  %H:%M")
now_str2   = now_lokaal.strftime("%d %b %Y %H:%M")

tr = ccrs.PlateCarree()
R_LON = 0.055; R_LAT = 0.038

def teken_cirkel(ax, lon, lat, waarde, kleur):
    ax.add_patch(mpatches.Ellipse((lon, lat), 2*R_LON, 2*R_LAT,
                 facecolor='white', edgecolor='none', zorder=8, transform=tr))
    if waarde is not None and waarde > 0:
        frac = min(waarde/100.0, 1.0)
        theta = np.linspace(np.pi/2, np.pi/2 - frac*2*np.pi, 80)
        xs = lon + R_LON * np.cos(theta)
        ys = lat + R_LAT * np.sin(theta)
        ax.fill(np.append([lon], xs), np.append([lat], ys), color=kleur, zorder=9, transform=tr)
    ax.add_patch(mpatches.Ellipse((lon, lat), 2*R_LON, 2*R_LAT,
                 facecolor='none', edgecolor='#333333', linewidth=0.8, zorder=10, transform=tr))

for dag_offset in range(0, 10):
    doeldag = (now_lokaal + timedelta(days=dag_offset+1)).date()
    dag_label = f"{nl_dagen[doeldag.weekday()]} {doeldag.day} {nl_mnd[doeldag.month]}"
    print(f"\nBewolking België {dag_label}...")
    station_data = {}
    for code, naam in stations:
        if naam not in coords: continue
        print(f"  {naam}...")
        root = download_kmz(code)
        if root is None: continue
        times = get_times(root)
        nl = dag_gem(times, parse_values(root,'Nl'), doeldag)
        nm = dag_gem(times, parse_values(root,'Nm'), doeldag)
        nh = dag_gem(times, parse_values(root,'Nh'), doeldag)
        if nl is not None or nm is not None or nh is not None:
            station_data[naam] = {"nl":nl,"nm":nm,"nh":nh}

    fig = plt.figure(figsize=(12, 9))
    gs  = GridSpec(2, 1, figure=fig, height_ratios=[0.09, 1], hspace=0.01)
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,facecolor="#003366",zorder=0,clip_on=False))
    ax_h.text(0.012,0.65,"Ed Aldus WM",fontsize=13,color="white",weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.22,"MOS ECMWF/ICON · DWD MOSMIX",fontsize=8,color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.65,f"Bewolking België – {dag_label}",
              fontsize=15,color="white",weight="bold",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.22,f"run: {now_str}",fontsize=8,color="#a8c8e8",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=2)

    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_extent(EXTENT, crs=ccrs.PlateCarree()); ax.set_aspect('auto')
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),  facecolor="#d8ecf8",zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),   facecolor="#f0f4ec",zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),  facecolor="#d8ecf8",zorder=2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"), edgecolor="#a8cce0",linewidth=0.5,zorder=3)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#555555",linewidth=0.8,zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),  edgecolor="#888888",linewidth=0.6,linestyle="--",zorder=4)
    ax.axis("off")

    for naam, v in station_data.items():
        lon, lat = coords[naam]
        teken_cirkel(ax, lon, lat,            v["nl"], KLEUR_L)
        teken_cirkel(ax, lon, lat+R_LAT*2.4,  v["nm"], KLEUR_M)
        teken_cirkel(ax, lon, lat+R_LAT*4.8,  v["nh"], KLEUR_H)

    leg = ax.inset_axes([0.01,0.80,0.32,0.18])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.text(0.5,0.96,"Bewolking per laag (daggemiddelde)",fontsize=4.5,weight="bold",ha="center",va="top",transform=leg.transAxes)
    for y,kl,nm_,omschr in [(0.72,KLEUR_H,"Hoog (Nh)","Cirrus/sluier"),(0.48,KLEUR_M,"Midden (Nm)","Altocumulus"),(0.24,KLEUR_L,"Laag (Nl)","Cumulus/stratus")]:
        c = mpatches.Ellipse((0.10,y),0.10,0.16,facecolor=kl,edgecolor='#444444',linewidth=0.6,zorder=1,transform=leg.transAxes)
        leg.add_patch(c)
        leg.text(0.20,y+0.05,nm_,fontsize=4.2,weight="bold",color="#222222",transform=leg.transAxes,va="center")
        leg.text(0.20,y-0.06,omschr,fontsize=3.5,color="#666666",transform=leg.transAxes,va="center")
    leg.text(0.5,0.05,"Vulling = bewolkingsgraad",fontsize=3.2,color="#888888",ha="center",transform=leg.transAxes)

    ax.text(1.0,0.0,f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes,fontsize=7,style="italic",ha="right",va="bottom",color="#555555")

    fname = f"kaart_be_bewolking_{doeldag.strftime('%Y-%m-%d')}.png"
    plt.savefig(fname,dpi=150,bbox_inches="tight"); plt.close()
    print(f"Kaart: {fname}")

for oud in sorted(glob.glob("kaart_be_bewolking_*.png"), key=os.path.getmtime)[:-10]:
    os.remove(oud); print(f"  Verwijderd: {oud}")
