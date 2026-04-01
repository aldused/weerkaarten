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

# Sneeuwkans categorieën
SNW_KLEUREN    = {
    0: "#d0e8ff",  # <5%   – vrijwel geen kans
    1: "#88ccff",  # 5-20% – kleine kans
    2: "#4499ee",  # 20-40% – matige kans
    3: "#1155cc",  # 40-60% – aanzienlijke kans
    4: "#ffffff",  # >60%  – grote kans (wit = sneeuw)
}
SNW_TEKSTKLEUR = {0:"#336699", 1:"white", 2:"white", 3:"white", 4:"#003366"}
SNW_RAND       = {0:"#aaccee", 1:"none", 2:"none", 3:"none", 4:"#336699"}

def sneeuw_cat(pct):
    if pct is None or pct < 5:  return 0
    if pct < 20:                return 1
    if pct < 40:                return 2
    if pct < 60:                return 3
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

print("MOSMIX ophalen (kans op sneeuw Belgie)...")
data_per_day = {}

for code, naam in stations:
    print(f"  {naam} ({code})...")
    root = download_kmz(code)
    if root is None: continue
    times    = get_times(root)
    wws_raw  = parse_values(root, 'wwS')    # kans op sneeuw %
    rrs_raw  = parse_values(root, 'RRS1c')  # sneeuwval mm/uur (waterequivalent)
    ttt_raw  = parse_values(root, 'TTT')    # temperatuur K (voor context)

    daily = {}
    for i, dt in enumerate(times):
        loc = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d   = loc.date()
        if d not in daily: daily[d] = {"wws": [], "rrs": 0.0, "ttt": []}
        if i < len(wws_raw) and wws_raw[i] is not None:
            daily[d]["wws"].append(wws_raw[i])
        if i < len(rrs_raw) and rrs_raw[i] is not None and rrs_raw[i] > 0:
            daily[d]["rrs"] += rrs_raw[i]
        if i < len(ttt_raw) and ttt_raw[i] is not None:
            daily[d]["ttt"].append(ttt_raw[i] - 273.15)

    vandaag = datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()
    for d in [d for d in sorted(daily.keys()) if d >= vandaag][:10]:
        if d not in data_per_day: data_per_day[d] = {}
        wws_vals = daily[d]["wws"]
        ttt_vals = daily[d]["ttt"]
        data_per_day[d][naam] = {
            "wws":  round(max(wws_vals))  if wws_vals else None,
            "rrs":  round(daily[d]["rrs"], 1),
            "tmin": round(min(ttt_vals), 1) if ttt_vals else None,
        }

print(f"Data voor {len(data_per_day)} dagen")
if not data_per_day: print("Geen data!"); exit()

now_str  = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

for day, dag_data in data_per_day.items():
    dag_nl   = nl_dagen[day.weekday()]
    maand_nl = nl_maanden[day.month]

    fig = plt.figure(figsize=(12, 9))
    gs  = GridSpec(2, 1, figure=fig, height_ratios=[0.09, 1], hspace=0.01)

    # Header — donkerblauwe winterkleur
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#001a33",zorder=0,clip_on=False))
    ax_h.text(0.012,0.62,"Ed Aldus WM",fontsize=13,color="white",
              weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.22,"Kans op sneeuw (max per dag)  ·  MOS ECMWF/ICON",
              fontsize=8,color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.65,f"Sneeuwkans België – {dag_nl} {day.day} {maand_nl}",
              fontsize=15,color="white",weight="bold",
              ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.20,f"DWD MOSMIX  ·  run: {now_str}",
              fontsize=8,color="#a8c8e8",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4488cc",linewidth=2)

    # Kaart — lichtblauwe winterachtergrond
    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_aspect('auto'); ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),    facecolor="#b8d4e8",zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),     facecolor="#e8eff8",zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),    facecolor="#b8d4e8",zorder=2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"),   edgecolor="#88aac8",linewidth=0.6,zorder=3)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#334466",linewidth=0.8,zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),  edgecolor="#556688",linewidth=0.7,
                   linestyle="--",zorder=4)
    ax.axis("off")

    for naam, v in dag_data.items():
        if naam not in coords: continue
        lon, lat = coords[naam]
        wws  = v["wws"]
        rrs  = v["rrs"]
        tmin = v["tmin"]
        cat  = sneeuw_cat(wws)

        # Droog/nat sneeuw indicator op basis van minimumtemperatuur
        if wws is not None and wws >= 5:
            if tmin is not None and tmin <= -2:
                soort = "❄"
            elif tmin is not None and tmin <= 2:
                soort = "🌨"
            else:
                soort = "🌧❄"
            tekst = f"{soort} {wws}%"
        else:
            tekst = f"{wws}%" if wws is not None else "–"

        if wws is not None and wws >= 20:
            if rrs > 0:
                tekst += f"\n{rrs:.1f}mm"
            if tmin is not None:
                tekst += f"\n{tmin:.1f}°"

        rand = SNW_RAND[cat]
        ax.text(lon, lat, tekst,
                ha="center", va="center", fontsize=8.0, weight="bold",
                color=SNW_TEKSTKLEUR[cat], zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.18",
                          facecolor=SNW_KLEUREN[cat],
                          edgecolor=rand,
                          linewidth=0.8 if rand != "none" else 0,
                          zorder=7))

    # Legenda
    leg = ax.inset_axes([0.01, 0.01, 0.28, 0.37])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",
                  linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.text(0.5,0.97,"Kans op sneeuw (max dag)",fontsize=4.5,weight="bold",
             ha="center",va="top",transform=leg.transAxes)
    leg.text(0.5,0.89,"Bij ≥20%: sneeuwval mm + Tmin °C",fontsize=3.6,
             ha="center",va="top",transform=leg.transAxes,color="#555555")
    leg.text(0.5,0.82,"❄ droog (<-2°)  🌨 nat (-2–2°)  🌧❄ ijzel (>2°)",fontsize=3.4,
             ha="center",va="top",transform=leg.transAxes,color="#555555")
    leg.text(0.5,0.75,"❄ = vlok (droge sneeuw)  🌨 = vierkant (natte sneeuw)",fontsize=3.2,
             ha="center",va="top",transform=leg.transAxes,color="#888888")
    legenda = [
        ("<5%",   "#d0e8ff", "#336699", "#336699"),
        ("5–20%", "#88ccff", "none",    "#003366"),
        ("20–40%","#4499ee", "none",    "white"),
        ("40–60%","#1155cc", "none",    "white"),
        (">60%",  "#ffffff", "#336699", "#003366"),
    ]
    for idx,(label,kl,rand,tk) in enumerate(legenda):
        y = 0.78 - idx*(1.0/5)*0.80
        leg.add_patch(plt.Rectangle((0.03,y-0.04),0.14,0.09,
                      facecolor=kl, edgecolor=rand if rand != "none" else kl,
                      linewidth=0.6, transform=leg.transAxes, zorder=1))
        leg.text(0.21,y+0.005,label,fontsize=4.0,va="center",
                 transform=leg.transAxes,color="#222222")

    ax.text(1.0,0.0,f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes,fontsize=7,style="italic",
            ha="right",va="bottom",color="#555555")

    fname = f"kaart_be_sneeuw_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname,dpi=150,bbox_inches="tight"); plt.close()
    print(f"Kaart: {fname}")

for oud in sorted(glob.glob("kaart_be_sneeuw_*.png"), key=os.path.getmtime)[:-10]:
    os.remove(oud); print(f"  Verwijderd: {oud}")
