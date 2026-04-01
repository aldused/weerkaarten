import os, glob, requests, zipfile, io, xml.etree.ElementTree as ET, re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import matplotlib.pyplot as plt
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

OW_KLEUREN     = {0:"#2c3e50",1:"#f39c12",2:"#e67e22",3:"#c0392b",4:"#6c3483"}
OW_TEKSTKLEUR  = {0:"#aaaaaa",1:"white",2:"white",3:"white",4:"white"}

def onweer_cat(wwt):
    if wwt is None or wwt == 0: return 0
    if wwt < 20: return 1
    if wwt < 40: return 2
    if wwt < 60: return 3
    return 4

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

print("MOSMIX ophalen (onweer België)...")
data_per_day = {}
for code, naam in stations:
    print(f"  {naam}...")
    root = download_kmz(code)
    if root is None: continue
    times    = get_times(root)
    wwt_raw  = parse_values(root, 'wwT')
    cape_raw = parse_values(root, 'CAPE')
    cin_raw  = parse_values(root, 'CIN')
    daily = {}
    for i, dt in enumerate(times):
        loc = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d = loc.date()
        if d not in daily: daily[d] = {"wwt":[],"cape":[],"cin":[]}
        if i < len(wwt_raw)  and wwt_raw[i]  is not None: daily[d]["wwt"].append(wwt_raw[i])
        if i < len(cape_raw) and cape_raw[i] is not None: daily[d]["cape"].append(cape_raw[i])
        if i < len(cin_raw)  and cin_raw[i]  is not None: daily[d]["cin"].append(cin_raw[i])
    vandaag = datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()
    for d in [d for d in sorted(daily.keys()) if d >= vandaag][:10]:
        if d not in data_per_day: data_per_day[d] = {}
        wwt_vals  = daily[d]["wwt"]
        cape_vals = daily[d]["cape"]
        cin_vals  = daily[d]["cin"]
        wwt_max  = round(max(wwt_vals))  if wwt_vals  else None
        cape_max = round(max(cape_vals)) if cape_vals else None
        cin_op_cape = None
        if cape_vals and cin_vals:
            idx_cape = cape_vals.index(max(cape_vals))
            if idx_cape < len(cin_vals) and cin_vals[idx_cape] is not None:
                cin_op_cape = round(cin_vals[idx_cape])
        data_per_day[d][naam] = {"wwt": wwt_max, "cape": cape_max, "cin": cin_op_cape}

if not data_per_day: print("Geen data!"); exit()
now_str = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

for day, dag_data in data_per_day.items():
    dag_nl = nl_dagen[day.weekday()]
    fig = plt.figure(figsize=(12, 9))
    gs = GridSpec(2, 1, figure=fig, height_ratios=[0.09, 1], hspace=0.01)
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,facecolor="#1a0033",zorder=0,clip_on=False))
    ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=13,color="white",weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.22,"Onweer: wwT + CAPE/CIN  ·  MOS ECMWF/ICON",fontsize=8,color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.65,f"Onweer België – {dag_nl} {day.day} {nl_maanden[day.month]}",
              fontsize=15,color="white",weight="bold",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.20,f"DWD MOSMIX  ·  run: {now_str}",fontsize=8,color="#a8c8e8",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#aa44cc",linewidth=2)

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
        lon, lat = coords[naam]
        wwt = v["wwt"]; cape = v["cape"]; cin = v["cin"]
        cat = onweer_cat(wwt)
        tekst = f"Onweer {wwt}%" if wwt and wwt > 0 else "–"
        if cape is not None and cape >= 100:
            cape_lbl = f"CAPE {cape}"
            if cin is not None: cape_lbl += f" CIN {cin}"
            tekst += f"\n{cape_lbl}"
        ax.text(lon, lat, tekst, ha="center", va="center", fontsize=7.0, weight="bold",
                color=OW_TEKSTKLEUR[cat], zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.18",facecolor=OW_KLEUREN[cat],edgecolor="none",zorder=7))

    leg = ax.inset_axes([0.01,0.62,0.30,0.36])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.text(0.5,0.97,"Kans op onweer (hele dag)",fontsize=4.5,weight="bold",ha="center",va="top",transform=leg.transAxes)
    leg.text(0.5,0.89,"CAPE: <500 zwak  500-1000 matig  >1000 sterk",fontsize=3.4,ha="center",va="top",transform=leg.transAxes,color="#777777")
    leg.text(0.5,0.81,"CIN: remming op convectie (neg = sterker)",fontsize=3.4,ha="center",va="top",transform=leg.transAxes,color="#777777")
    for idx,(label,kl,tk) in enumerate([("Geen kans","#2c3e50","#aaaaaa"),("Kleine kans <20%","#f39c12","white"),("Matige kans 20–40%","#e67e22","white"),("Aanzienlijk 40–60%","#c0392b","white"),("Grote kans >60%","#6c3483","white")]):
        y = 0.70 - idx*(1.0/5)*0.72
        leg.add_patch(plt.Rectangle((0.03,y-0.04),0.14,0.09,facecolor=kl,transform=leg.transAxes,zorder=1))
        leg.text(0.21,y+0.005,label,fontsize=3.8,va="center",transform=leg.transAxes,color="#222222")

    ax.text(1.0,0.0,f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes,fontsize=7,style="italic",ha="right",va="bottom",color="#555555")

    fname = f"kaart_be_onweer_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname,dpi=150,bbox_inches="tight"); plt.close()
    print(f"Kaart: {fname}")

for oud in sorted(glob.glob("kaart_be_onweer_*.png"), key=os.path.getmtime)[:-10]:
    os.remove(oud); print(f"  Verwijderd: {oud}")
