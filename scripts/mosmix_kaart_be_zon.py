import os, glob, math, requests, zipfile, io, xml.etree.ElementTree as ET, re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import matplotlib.pyplot as plt
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
EXTENT = [1.5, 6.6, 49.2, 51.7]
LOCAL_TZ   = ZoneInfo("Europe/Amsterdam")
nl_dagen   = ["Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag","Zondag"]
nl_maanden = ["","januari","februari","maart","april","mei","juni",
               "juli","augustus","september","oktober","november","december"]

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

def zon_kleur(sd):
    if sd >= 10: return "#FFD700", "black"
    if sd >= 7:  return "#FFC200", "black"
    if sd >= 4:  return "#FFB347", "black"
    if sd >= 2:  return "#C8C8C8", "black"
    return              "#888888", "white"

def max_daglengte(datum, lat=50.5):
    dag_nr = datum.timetuple().tm_yday
    decl = math.radians(-23.45 * math.cos(math.radians(360/365 * (dag_nr + 10))))
    lat  = math.radians(lat)
    cos_ha = max(-1.0, min(1.0, -math.tan(lat) * math.tan(decl)))
    return 2 * math.degrees(math.acos(cos_ha)) / 15.0

def sd_uit_neff(neff, datum):
    return round(max(0.0, max_daglengte(datum) * (1.0 - neff / 100.0) * 0.75), 1)

print("MOSMIX ophalen (zon België)...")
data_per_day = {}
for code, naam in stations:
    print(f"  {naam}...")
    root = download_kmz(code)
    if root is None: continue
    times = get_times(root)
    sd_raw = parse_values(root, 'SunD1')
    neff_raw = parse_values(root, 'Neff')
    daily = {}
    for i, dt in enumerate(times):
        loc = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d = loc.date()
        if d not in daily: daily[d] = {"sd": 0.0, "neff": [], "heeft_sd": False}
        if i < len(sd_raw) and sd_raw[i] is not None:
            daily[d]["sd"] += sd_raw[i] / 3600.0; daily[d]["heeft_sd"] = True
        if i < len(neff_raw) and neff_raw[i] is not None:
            daily[d]["neff"].append(neff_raw[i])
    vandaag = datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()
    for d in [d for d in sorted(daily.keys()) if d >= vandaag][:10]:
        if d not in data_per_day: data_per_day[d] = {}
        sd = round(daily[d]["sd"], 1)
        neff = round(sum(daily[d]["neff"])/len(daily[d]["neff"]), 0) if daily[d]["neff"] else 0
        if not daily[d]["heeft_sd"] and daily[d]["neff"]: sd = sd_uit_neff(neff, d)
        data_per_day[d][naam] = {"sd": sd, "neff": neff, "heeft_sd": daily[d]["heeft_sd"]}

if not data_per_day: print("Geen data!"); exit()
now_str = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

for day, dag_data in data_per_day.items():
    dag_nl = nl_dagen[day.weekday()]
    fig = plt.figure(figsize=(12, 9))
    gs = GridSpec(2, 1, figure=fig, height_ratios=[0.09, 1], hspace=0.01)
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,facecolor="#003366",zorder=0,clip_on=False))
    ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=13,color="white",weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.22,"Zonneschijn  ·  MOS ECMWF/ICON",fontsize=8,color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.65,f"Zon België – {dag_nl} {day.day} {nl_maanden[day.month]}",
              fontsize=15,color="white",weight="bold",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.20,f"DWD MOSMIX  ·  run: {now_str}",fontsize=8,color="#a8c8e8",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=2)

    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_aspect('auto'); ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),facecolor="#c8e0f0",zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),facecolor="#eaf3e8",zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),facecolor="#c8e0f0",zorder=2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"),edgecolor="#89b8d4",linewidth=0.6,zorder=3)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#333333",linewidth=0.8,zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),edgecolor="#666666",linewidth=0.7,linestyle="--",zorder=4)
    ax.axis("off")

    for naam, v in dag_data.items():
        if naam not in coords: continue
        if not v.get("heeft_sd") and v.get("neff", 0) == 0: continue
        lon, lat = coords[naam]
        sd = v["sd"]; neff = v["neff"]
        kl, tkl = zon_kleur(sd)
        ax.scatter(lon, lat, s=900+300*min(sd/10.0,1.0), c=kl, edgecolors="#888888",
                   linewidths=0.5, zorder=8, transform=ccrs.PlateCarree())
        ax.text(lon, lat+0.04, f"{sd:.0f}u", ha="center", va="center", fontsize=8.0,
                weight="bold", color=tkl, zorder=9, transform=ccrs.PlateCarree())
        ax.text(lon, lat-0.06, f"{neff:.0f}%", ha="center", va="center", fontsize=4.5,
                color=tkl, zorder=9, transform=ccrs.PlateCarree())

    leg = ax.inset_axes([0.01,0.72,0.18,0.25])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.text(0.5,0.94,"Zonuren",fontsize=5,weight="bold",ha="center",va="top",transform=leg.transAxes)
    for idx,(label,kl) in enumerate([("≥10u","#FFD700"),("≥7u","#FFC200"),("≥4u","#FFB347"),("≥2u","#C8C8C8"),("<2u","#888888")]):
        y = 0.80-idx*0.155
        leg.scatter([0.12],[y],s=120,c=kl,edgecolors="#888888",linewidths=0.4,zorder=1,transform=leg.transAxes)
        leg.text(0.25,y,label,fontsize=4.2,va="center",transform=leg.transAxes)

    ax.text(1.0,0.0,f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes,fontsize=7,style="italic",ha="right",va="bottom",color="#555555")

    fname = f"kaart_be_zon_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname,dpi=150,bbox_inches="tight"); plt.close()
    print(f"Kaart: {fname}")

for oud in sorted(glob.glob("kaart_be_zon_*.png"), key=os.path.getmtime)[:-10]:
    os.remove(oud); print(f"  Verwijderd: {oud}")
