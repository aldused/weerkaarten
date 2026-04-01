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
    ("06451", "Brussel"),
    ("06431", "Gent"),
    ("06450", "Antwerpen"),
    ("06479", "Kleine Brogel"),
    ("06407", "Oostende"),
    ("06449", "Charleroi"),
    ("06478", "Bierset"),
    ("06490", "Spa"),
    ("06476", "St-Hubert"),
    ("06456", "Florennes"),
    ("07015", "Lille"),
    ("F9600", "Heinerschied"),
    ("06458", "Beauvechain"),
    ("H908",  "Monschau"),
    ("P0155", "Brugge"),
    ("07075", "Charleville"),
    ("07017", "Cambrai"),
    ("P0437", "Calais"),
    ("07061", "Saint-Quentin"),
]

coords = {
    "Brussel":       (4.484, 50.901),
    "Gent":          (3.720, 51.054),
    "Antwerpen":     (4.405, 51.219),
    "Kleine Brogel": (5.470, 51.168),
    "Oostende":      (2.862, 51.199),
    "Charleroi":     (4.453, 50.460),
    "Bierset":       (5.453, 50.638),
    "Spa":           (5.910, 50.493),
    "St-Hubert":     (5.404, 50.035),
    "Florennes":     (4.648, 50.243),
    "Lille":         (3.106, 50.563),
    "Heinerschied":  (6.080, 50.030),
    "Beauvechain":   (4.768, 50.758),
    "Monschau":      (6.243, 50.560),
    "Brugge":        (3.217, 51.200),
    "Charleville":   (4.647, 49.783),
    "Cambrai":       (3.164, 50.222),
    "Calais":        (1.954, 50.819),
    "Saint-Quentin": (3.207, 49.843),
}

EXTENT = [1.5, 6.6, 49.2, 51.7]
LOCAL_TZ   = ZoneInfo("Europe/Amsterdam")
nl_dagen   = ["Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag","Zondag"]
nl_maanden = ["","Januari","Februari","Maart","April","Mei","Juni",
               "Juli","Augustus","September","Oktober","November","December"]

bft_kleuren    = {0:"#aaaaaa",1:"#aaaaaa",2:"#aaaaaa",3:"#4caf50",4:"#8bc34a",
                  5:"#ffeb3b",6:"#ff9800",7:"#f44336",8:"#b71c1c"}
bft_tekstkleur = {0:"white",1:"white",2:"white",3:"white",4:"white",
                  5:"black",6:"white",7:"white",8:"white"}

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
        z = zipfile.ZipFile(io.BytesIO(r.content))
        kml = strip_namespaces(z.read(z.namelist()[0]).decode("utf-8"))
        return ET.fromstring(kml)
    except Exception as e:
        print(f"  x {station}: {e}"); return None

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

def ms_to_bft(ms):
    if ms is None: return 0
    for b, v in [(0,0.3),(1,1.6),(2,3.4),(3,5.5),(4,8.0),(5,10.8),(6,13.9),(7,17.2),(8,20.8)]:
        if ms <= v: return b
    return 9

def bft_to_kmh(ms):
    return round(ms * 3.6) if ms else 0

def windpijl(graden):
    pijlen = ["↓","↙","←","↖","↑","↗","→","↘","↓"]
    if graden is None: return "·"
    return pijlen[round(graden / 45) % 8]

print("MOSMIX ophalen (wind dag 06-18u België)...")
data_per_day = {}

for code, naam in stations:
    print(f"  {naam} ({code})...")
    root = download_kmz(code)
    if root is None: continue
    times  = get_times(root)
    ff_raw = parse_values(root, 'FF')
    fx_raw = parse_values(root, 'FX1')
    dd_raw = parse_values(root, 'DD')
    daily  = {}
    for i, dt in enumerate(times):
        loc  = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d    = loc.date()
        hour = loc.hour
        if 6 <= hour < 18:
            if d not in daily: daily[d] = {"ff": [], "ff_dd": [], "fx": []}
            if i < len(ff_raw) and ff_raw[i] is not None:
                daily[d]["ff"].append(ff_raw[i])
                daily[d]["ff_dd"].append(dd_raw[i] if i < len(dd_raw) else None)
            if i < len(fx_raw) and fx_raw[i] is not None:
                daily[d]["fx"].append(fx_raw[i])

    vandaag = datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()
    days = [d for d in sorted(daily.keys()) if d >= vandaag][:10]
    for d in days:
        if d not in data_per_day: data_per_day[d] = {}
        ff_lijst = daily[d]["ff"]
        ff_gem   = sum(ff_lijst) / len(ff_lijst) if ff_lijst else 0
        fx_max   = max(daily[d]["fx"]) if daily[d]["fx"] else 0
        if ff_lijst:
            idx = ff_lijst.index(max(ff_lijst))
            dd_bij = daily[d]["ff_dd"][idx] if idx < len(daily[d]["ff_dd"]) else None
        else:
            dd_bij = None
        data_per_day[d][naam] = {"ff": ff_gem, "fx": fx_max, "dd": dd_bij}

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
    ax_h.set_xlim(0, 1); ax_h.set_ylim(0, 1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
                   facecolor="#003366", zorder=0, clip_on=False))
    ax_h.text(0.012, 0.62, "Ed Aldus WM", fontsize=13, color="white",
              weight="bold", va="center", transform=ax_h.transAxes)
    ax_h.text(0.012, 0.22, "Windkracht dag (06–18u)  ·  MOS ECMWF/ICON", fontsize=8,
              color="#a8c8e8", va="center", transform=ax_h.transAxes)
    ax_h.text(0.988, 0.65, f"Wind België – {dag_nl} {day.day} {maand_nl}",
              fontsize=15, color="white", weight="bold",
              ha="right", va="center", transform=ax_h.transAxes)
    ax_h.text(0.988, 0.20, f"DWD MOSMIX  ·  run: {now_str}",
              fontsize=8, color="#a8c8e8", ha="right", va="center",
              transform=ax_h.transAxes)
    ax_h.axhline(0, color="#4a90c4", linewidth=2)

    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_aspect('auto')
    ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),    facecolor="#c8e0f0", zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),     facecolor="#eaf3e8", zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),    facecolor="#c8e0f0", zorder=2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"),   edgecolor="#89b8d4", linewidth=0.6, zorder=3)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#333333", linewidth=0.8, zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),  edgecolor="#666666", linewidth=0.7,
                   linestyle="--", zorder=4)
    ax.axis("off")

    for naam, vals in dag_data.items():
        if naam not in coords: continue
        lon, lat = coords[naam]
        bft    = ms_to_bft(vals["ff"])
        fx_kmh = bft_to_kmh(vals["fx"])
        pijl   = windpijl(vals["dd"])
        kleur  = bft_kleuren.get(min(bft, 8), "#b71c1c")
        tkleur = bft_tekstkleur.get(min(bft, 8), "white")
        tekst  = f"{pijl} {bft}Bft\nmax {fx_kmh}km/u"
        ax.text(lon, lat, tekst, ha="center", va="center", fontsize=8.0, weight="bold",
                color=tkleur, zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.15", facecolor=kleur, edgecolor="none", zorder=7))

    # Legenda
    legenda_items = [(0,"0-2 Bft","#aaaaaa","white"),(3,"3 Bft","#4caf50","white"),
                     (4,"4 Bft","#8bc34a","white"),(5,"5 Bft","#ffeb3b","black"),
                     (6,"6 Bft","#ff9800","white"),(7,"7 Bft","#f44336","white"),
                     (8,"8+ Bft","#b71c1c","white")]
    item_h = 0.035
    leg_h  = len(legenda_items) * item_h + 0.04
    leg = ax.inset_axes([0.01, 0.98 - leg_h, 0.15, leg_h])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",
                  linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.text(0.5, 0.94, "Windkracht (06-18u)", fontsize=4.5, weight="bold",
             ha="center", va="top", transform=leg.transAxes)
    for idx, (b, label, kl, tk) in enumerate(legenda_items):
        y = 0.86 - idx * (1.0 / len(legenda_items)) * 0.88
        leg.add_patch(plt.Rectangle((0.04, y-0.04), 0.20, 0.09,
                      facecolor=kl, transform=leg.transAxes, zorder=1))
        leg.text(0.30, y+0.005, label, fontsize=4.0, va="center",
                 transform=leg.transAxes, color="#222222")

    ax.text(1.0, 0.0, f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes, fontsize=7, style="italic",
            ha="right", va="bottom", color="#555555")

    fname = f"kaart_be_wind_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Kaart: {fname}")

# Ruim oude kaarten op (max 7, op bestandsdatum)
for oud in sorted(glob.glob("kaart_be_wind_[!n]*.png"), key=os.path.getmtime)[:-10]:
    os.remove(oud); print(f"  Verwijderd: {oud}")
