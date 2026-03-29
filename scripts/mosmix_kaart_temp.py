import os, glob, requests, zipfile, io, xml.etree.ElementTree as ET, re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.gridspec import GridSpec
import cartopy.crs as ccrs
import cartopy.feature as cfeature

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

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
    "Bocholt":(6.617,51.838),"Nettetal":(6.276,51.317),"Geilenkirchen":(6.030,50.580),
    "Borkum":(6.749,53.586),"Volkel":(5.707,51.657),
}

EXTENT = [3.3, 7.4, 50.45, 53.8]
LOCAL_TZ   = ZoneInfo("Europe/Amsterdam")
nl_dagen   = ["Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag","Zondag"]
nl_maanden = ["","Januari","Februari","Maart","April","Mei","Juni",
               "Juli","Augustus","September","Oktober","November","December"]

def strip_namespaces(s):
    s = re.sub(r'<(/?)\w+:', r'<\1', s)
    s = re.sub(r'\b\w+:(\w+=)', r'\1', s)
    return re.sub(r'\s+xmlns(?::\w+)?="[^"]*"', '', s)

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

print("MOSMIX ophalen (temperatuur Nederland TX/TN)...")
data_per_day = {}

for code, naam in stations:
    print(f"  {naam} ({code})...")
    root = download_kmz(code)
    if root is None: continue
    times  = get_times(root)
    ttt_raw = parse_values(root, 'TTT')
    ttt = [v - 273.15 if v and v > 200 else None for v in ttt_raw]

    daily_tx, daily_tn = {}, {}
    for i, dt in enumerate(times):
        loc = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        h   = loc.hour
        # TX: max TTT tussen 06-18u (zelfde als dagkaart)
        d = loc.date()
        if 6 <= h < 18:
            v = ttt[i] if i < len(ttt) and ttt[i] is not None else None
            if v is not None:
                if d not in daily_tx or v > daily_tx[d]: daily_tx[d] = v
        # TN: min TTT tussen 18-06u (zelfde als nachtkaart)
        if h >= 18:
            d_tn = loc.date()
        elif h < 6:
            d_tn = loc.date() - timedelta(days=1)
        else:
            d_tn = None
        if d_tn is not None:
            v = ttt[i] if i < len(ttt) and ttt[i] is not None else None
            if v is not None:
                if d_tn not in daily_tn or v < daily_tn[d_tn]: daily_tn[d_tn] = v

    vandaag = datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()
    days = [d for d in sorted(set(list(daily_tx.keys()) + list(daily_tn.keys()))) if d >= vandaag][:7]
    for d in days:
        if d not in data_per_day: data_per_day[d] = {}
        data_per_day[d][naam] = {
            "tx": round(daily_tx.get(d, 0), 1),
            "tn": round(daily_tn.get(d, 0), 1),
        }

print(f"Data voor {len(data_per_day)} dagen")
if not data_per_day: print("Geen data!"); exit()

now_str  = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

for day, dag_data in data_per_day.items():
    dag_nl   = nl_dagen[day.weekday()]
    maand_nl = nl_maanden[day.month]

    fig = plt.figure(figsize=(8, 11))
    gs  = GridSpec(2, 1, figure=fig, height_ratios=[0.085, 1], hspace=0.01)

    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#003366",zorder=0,clip_on=False))
    ax_h.text(0.012,0.58,"Ed Aldus WM",fontsize=11,color="white",
              weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.18,"MOS ECMWF/ICON",fontsize=7.5,color="#a8c8e8",
              va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.62,f"{dag_nl} {day.day} {maand_nl}",fontsize=13,color="white",
              weight="bold",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.18,f"DWD MOSMIX  ·  run: {now_str}",fontsize=7,color="#a8c8e8",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=1.5)

    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_aspect('auto'); ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),    facecolor="#c8e0f0",zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),     facecolor="#eaf3e8",zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),    facecolor="#c8e0f0",zorder=2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"),   edgecolor="#89b8d4",linewidth=0.5,zorder=3)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#333333",linewidth=0.7,zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),  edgecolor="#666666",linewidth=0.6,
                   linestyle="--",zorder=4)
    ax.axis("off")

    for naam, vals in dag_data.items():
        if naam not in coords: continue
        lon, lat = coords[naam]
        ax.text(lon, lat + 0.06, f"{vals['tx']:.1f}",
                ha="center", va="bottom", fontsize=8.5, weight="bold",
                color="white", zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.12", facecolor="#cc2200", edgecolor="none", zorder=7))
        ax.text(lon, lat + 0.03, f"{vals['tn']:.1f}",
                ha="center", va="top", fontsize=8.5, weight="bold",
                color="white", zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.12", facecolor="#1a5fb4", edgecolor="none", zorder=7))

    leg = ax.inset_axes([0.01, 0.63, 0.14, 0.14])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",
                  linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.add_patch(plt.Rectangle((0.05,0.55),0.20,0.32,facecolor="#cc2200",transform=leg.transAxes,zorder=1))
    leg.text(0.32,0.71,"Max temperatuur",fontsize=5,va="center",transform=leg.transAxes)
    leg.add_patch(plt.Rectangle((0.05,0.10),0.20,0.32,facecolor="#1a5fb4",transform=leg.transAxes,zorder=1))
    leg.text(0.32,0.26,"Min temperatuur",fontsize=5,va="center",transform=leg.transAxes)

    ax.text(1.0,0.0,f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes,fontsize=6.5,style="italic",
            ha="right",va="bottom",color="#555555")

    fname = f"kaart_temp_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname, dpi=300, bbox_inches="tight"); plt.close()
    print(f"Kaart: {fname}")

for oud in sorted(glob.glob("kaart_temp_*.png"), key=os.path.getmtime)[:-7]:
    os.remove(oud); print(f"  Verwijderd: {oud}")
