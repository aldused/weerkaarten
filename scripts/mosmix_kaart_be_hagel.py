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

HAGEL_KLEUREN    = {0:"#e8f4ff",1:"#ffe066",2:"#ff9900",3:"#cc3300",4:"#6c0000"}
HAGEL_TEKSTKLEUR = {0:"#336699",1:"#3a2000",2:"white",3:"white",4:"white"}

def hagel_cat(pct):
    if pct is None or pct < 5: return 0
    if pct < 20: return 1
    if pct < 40: return 2
    if pct < 60: return 3
    return 4

def cape_label(cape):
    if cape is None or cape < 100: return ""
    if cape < 500:  return "zwak"
    if cape < 1000: return "matig"
    if cape < 2500: return "sterk"
    return "extreem"

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

print("MOSMIX ophalen (hagelkans Belgie)...")
data_per_day = {}

for code, naam in stations:
    print(f"  {naam} ({code})...")
    root = download_kmz(code)
    if root is None: continue
    times    = get_times(root)
    wwz_raw  = parse_values(root, 'wwZ')
    wwzd_raw = parse_values(root, 'wwZd')
    cape_raw = parse_values(root, 'CAPE')
    cin_raw  = parse_values(root, 'CIN')

    daily = {}
    for i, dt in enumerate(times):
        loc = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d   = loc.date()
        if d not in daily: daily[d] = {"wwz":[],"wwzd":[],"cape":[],"cin":[]}
        if i < len(wwz_raw)  and wwz_raw[i]  is not None: daily[d]["wwz"].append(wwz_raw[i])
        if i < len(wwzd_raw) and wwzd_raw[i] is not None: daily[d]["wwzd"].append(wwzd_raw[i])
        if i < len(cape_raw) and cape_raw[i] is not None: daily[d]["cape"].append(cape_raw[i])
        if i < len(cin_raw)  and cin_raw[i]  is not None: daily[d]["cin"].append(cin_raw[i])

    vandaag = datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()
    for d in [d for d in sorted(daily.keys()) if d >= vandaag][:10]:
        if d not in data_per_day: data_per_day[d] = {}
        wwz_vals = daily[d]["wwz"]; wwzd_vals = daily[d]["wwzd"]
        cape_vals = daily[d]["cape"]; cin_vals = daily[d]["cin"]
        wwz_max  = round(max(wwz_vals))  if wwz_vals  else None
        wwzd_max = round(max(wwzd_vals)) if wwzd_vals else None
        cape_max = round(max(cape_vals)) if cape_vals else None
        cin_bij_cape = None
        if cape_vals and cin_vals:
            idx = cape_vals.index(max(cape_vals))
            if idx < len(cin_vals) and cin_vals[idx] is not None:
                cin_bij_cape = round(cin_vals[idx])
        data_per_day[d][naam] = {"wwz": wwz_max, "wwzd": wwzd_max,
                                  "cape": cape_max, "cin": cin_bij_cape}

print(f"Data voor {len(data_per_day)} dagen")
if not data_per_day: print("Geen data!"); exit()

now_str  = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

for day, dag_data in data_per_day.items():
    dag_nl   = nl_dagen[day.weekday()]
    maand_nl = nl_maanden[day.month]

    fig = plt.figure(figsize=(12, 9))
    gs  = GridSpec(2, 1, figure=fig, height_ratios=[0.09, 1], hspace=0.01)

    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#1a0a00",zorder=0,clip_on=False))
    ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=13,color="white",
              weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.22,"Hagelkans (wwZ) + CAPE/CIN  ·  MOS ECMWF/ICON",
              fontsize=8,color="#f0c080",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.65,f"Hagel België – {dag_nl} {day.day} {maand_nl}",
              fontsize=15,color="white",weight="bold",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.20,f"DWD MOSMIX  ·  run: {now_str}",
              fontsize=8,color="#f0c080",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#cc6600",linewidth=2)

    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_aspect('auto'); ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),    facecolor="#c8e0f0",zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),     facecolor="#eaf3e8",zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),    facecolor="#c8e0f0",zorder=2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"),   edgecolor="#89b8d4",linewidth=0.6,zorder=3)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#333333",linewidth=0.8,zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),  edgecolor="#666666",linewidth=0.7,
                   linestyle="--",zorder=4)
    ax.axis("off")

    for naam, v in dag_data.items():
        if naam not in coords: continue
        lon, lat = coords[naam]
        wwz = v["wwz"]; wwzd = v["wwzd"]; cape = v["cape"]; cin = v["cin"]
        cat  = hagel_cat(wwz)
        kans = wwz
        if wwzd is not None and wwz is not None and wwzd > wwz:
            kans = wwzd
        if kans is not None and kans >= 5:
            tekst = f"Hagel {kans}%"
        else:
            tekst = f"{kans}%" if kans is not None else "–"
        if kans is not None and kans >= 20 and cape is not None and cape >= 100:
            lbl = cape_label(cape)
            tekst += f"\nCAPE {cape}"
            if lbl: tekst += f" {lbl}"
            if cin is not None: tekst += f"\nCIN {cin}"
        ax.text(lon, lat, tekst, ha="center", va="center", fontsize=7.0, weight="bold",
                color=HAGEL_TEKSTKLEUR[cat], zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.18", facecolor=HAGEL_KLEUREN[cat],
                          edgecolor="none", zorder=7))

    leg = ax.inset_axes([0.01, 0.01, 0.32, 0.38])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",
                  linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.text(0.5,0.97,"Kans op hagel (max dag)",fontsize=4.5,weight="bold",
             ha="center",va="top",transform=leg.transAxes)
    leg.text(0.5,0.89,"Hagel = hagelkans  Bij ≥20%: CAPE + CIN",fontsize=3.6,
             ha="center",va="top",transform=leg.transAxes,color="#555555")
    leg.text(0.5,0.82,"CAPE: <500 zwak · 500-1000 matig · >1000 sterk · >2500 extreem",
             fontsize=3.2,ha="center",va="top",transform=leg.transAxes,color="#777777")
    leg.text(0.5,0.75,"CIN: remming op convectie (neg. = sterker)",
             fontsize=3.2,ha="center",va="top",transform=leg.transAxes,color="#777777")
    for idx,(label,kl,tk) in enumerate([
        ("<5%",    "#e8f4ff","#336699"),
        ("5–20%",  "#ffe066","#3a2000"),
        ("20–40%", "#ff9900","white"),
        ("40–60%", "#cc3300","white"),
        (">60%",   "#6c0000","white"),
    ]):
        y = 0.68 - idx*(1.0/5)*0.70
        leg.add_patch(plt.Rectangle((0.03,y-0.04),0.14,0.09,facecolor=kl,
                      transform=leg.transAxes,zorder=1))
        leg.text(0.21,y+0.005,label,fontsize=4.0,va="center",
                 transform=leg.transAxes,color="#222222")

    ax.text(1.0,0.0,f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes,fontsize=7,style="italic",
            ha="right",va="bottom",color="#555555")

    fname = f"kaart_be_hagel_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname,dpi=150,bbox_inches="tight"); plt.close()
    print(f"Kaart: {fname}")

for oud in sorted(glob.glob("kaart_be_hagel_*.png"), key=os.path.getmtime)[:-10]:
    os.remove(oud); print(f"  Verwijderd: {oud}")
