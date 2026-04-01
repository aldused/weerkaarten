import os, glob, requests, zipfile, io, xml.etree.ElementTree as ET, re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec
import cartopy.crs as ccrs
import cartopy.feature as cfeature

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# ── Noordzee + kust stations ─────────────────────────────────────────────────
stations = [
    # Noordzee offshore NL
    ("E5203", "Europlatform"),
    ("E5204", "K13"),
    ("E5405", "F3"),
    # Noordzee offshore overig
    ("E5303", "Meetpost NWK"),
    ("E5403", "Lt.eil. Goeree"),
    ("E5404", "Noordzee NO"),  # 54.00, 4.00
    ("P0645", "Duitse Bocht"),  # 54.50, 6.00
    ("P0648", "Duitse Bocht N"),  # 54.80, 6.00
    # NL kust
    ("06235", "Den Helder"),
    ("06242", "Vlieland"),
    ("06250", "Terschelling"),
    ("06310", "Vlissingen"),
    ("06330", "Hoek van Holland"),
    # Duits
    ("K1083", "Borkum"),
    ("10015", "Helgoland"),
    ("10018", "Cuxhaven"),
    ("10020", "Buesum"),
    ("10046", "Norderney"),
    ("10035", "Westerland"),
]

# Bekende coördinaten (worden overschreven als ze uit de KMZ komen)
coords = {
    "Europlatform":      (3.27,  52.00),
    "K13":               (3.22,  53.22),
    "F3":                (4.70,  54.85),
    "Meetpost NWK":      (4.298, 52.275),
    "Lt.eil. Goeree":   (3.667, 51.933),
    "AWG-1":             (4.420, 54.330),
    "Schouwenbank":      (3.234, 51.745),
    "Eierlandsche Gat":  (4.557, 53.250),
    "Den Helder":        (4.789, 52.928),
    "Vlieland":          (4.920, 53.250),
    "Terschelling":      (5.350, 53.392),
    "Vlissingen":        (3.596, 51.442),
    "Hoek van Holland":  (4.131, 51.978),
    "Borkum":            (6.69,  53.58),
    "Helgoland":         (7.53,  54.10),
    "Cuxhaven":          (8.70,  53.87),
    "Buesum":            (8.86,  54.13),
    "Norderney":         (7.15,  53.71),
    "Westerland":        (8.21,  54.55),
}

# Noordzee extent
EXTENT = [1.5, 7.5, 51.0, 55.5]

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
        kml = strip_namespaces(z.read(z.namelist()[0]).decode("utf-8"))
        root = ET.fromstring(kml)
        # Haal naam en coördinaten op uit KMZ
        for pm in root.iter("Placemark"):
            coords_el = pm.find(".//coordinates")
            if coords_el is not None and coords_el.text:
                parts = coords_el.text.strip().split(",")
                if len(parts) >= 2:
                    return root, float(parts[0]), float(parts[1])
        return root, None, None
    except Exception as e:
        print(f"  x {station}: {e}"); return None, None, None

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

bft_kleuren = {0:"#aaaaaa",1:"#aaaaaa",2:"#aaaaaa",3:"#4caf50",4:"#8bc34a",
               5:"#ffeb3b",6:"#ff9800",7:"#f44336",8:"#b71c1c",9:"#7b0000"}
bft_tekstkleur = {0:"white",1:"white",2:"white",3:"white",4:"white",
                  5:"black",6:"white",7:"white",8:"white",9:"white"}

def ms_to_bft(ms):
    if ms is None: return 0
    for b,v in [(0,0.3),(1,1.6),(2,3.4),(3,5.5),(4,8.0),(5,10.8),(6,13.9),(7,17.2),(8,20.8),(9,24.5)]:
        if ms <= v: return b
    return 10

def windpijl(graden):
    if graden is None: return "·"
    pijlen = ["↓","↙","←","↖","↑","↗","→","↘","↓"]
    return pijlen[round(graden/45) % 8]

print("MOSMIX ophalen (Noordzee wind)...")
data_per_day = {}
station_coords = {}

for code, naam in stations:
    print(f"  {naam} ({code})...")
    root, lon_kmz, lat_kmz = download_kmz(code)
    if root is None: continue

    # Gebruik KMZ coördinaten als beschikbaar
    if lon_kmz is not None and lat_kmz is not None:
        station_coords[naam] = (lon_kmz, lat_kmz)
    elif naam in coords:
        station_coords[naam] = coords[naam]

    times  = get_times(root)
    ff_raw = parse_values(root, 'FF')
    fx_raw = parse_values(root, 'FX1')
    dd_raw = parse_values(root, 'DD')

    daily = {}
    for i, dt in enumerate(times):
        loc = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d, hour = loc.date(), loc.hour
        if 6 <= hour < 18:
            if d not in daily: daily[d] = {"ff":[], "ff_dd":[], "fx":[]}
            if i < len(ff_raw) and ff_raw[i] is not None:
                daily[d]["ff"].append(ff_raw[i])
                daily[d]["ff_dd"].append(dd_raw[i] if i < len(dd_raw) else None)
            if i < len(fx_raw) and fx_raw[i] is not None:
                daily[d]["fx"].append(fx_raw[i])

    for d in sorted(daily.keys())[:10]:
        if d not in data_per_day: data_per_day[d] = {}
        ff_lijst = daily[d]["ff"]
        ff_gem   = sum(ff_lijst)/len(ff_lijst) if ff_lijst else 0
        fx_max   = max(daily[d]["fx"]) if daily[d]["fx"] else 0
        if ff_lijst:
            idx = ff_lijst.index(max(ff_lijst))
            dd_bij_max = daily[d]["ff_dd"][idx] if idx < len(daily[d]["ff_dd"]) else None
        else:
            dd_bij_max = None
        data_per_day[d][naam] = {"ff": ff_gem, "fx": fx_max, "dd": dd_bij_max}

print(f"Data voor {len(data_per_day)} dagen")
if not data_per_day: exit()

now_str  = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

for day, dag_data in data_per_day.items():
    dag_nl   = nl_dagen[day.weekday()]
    maand_nl = nl_maanden[day.month]

    fig = plt.figure(figsize=(10, 8))
    gs  = GridSpec(2, 1, figure=fig, height_ratios=[0.085, 1], hspace=0.01)

    # Header
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,facecolor="#003366",zorder=0,clip_on=False))
    ax_h.text(0.012,0.58,"Ed Aldus WM",fontsize=11,color="white",weight="bold",va="center",transform=ax_h.transAxes)
    ax_h.text(0.012,0.18,"MOS ECMWF/ICON · Noordzee",fontsize=7.5,color="#a8c8e8",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.62,f"Wind Noordzee – {dag_nl} {day.day} {maand_nl}",fontsize=13,color="white",weight="bold",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.text(0.988,0.18,f"DWD MOSMIX  ·  run: {now_str}",fontsize=7,color="#a8c8e8",ha="right",va="center",transform=ax_h.transAxes)
    ax_h.axhline(0,color="#4a90c4",linewidth=1.5)

    # Kaart
    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_aspect('auto'); ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),    facecolor="#b8d4e8",zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),     facecolor="#eaf3e8",zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),    facecolor="#b8d4e8",zorder=2)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"),edgecolor="#333333",linewidth=0.8,zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),  edgecolor="#666666",linewidth=0.6,linestyle="--",zorder=4)
    ax.axis("off")

    for naam, vals in dag_data.items():
        if naam not in station_coords: continue
        lon, lat = station_coords[naam]
        bft  = ms_to_bft(vals["ff"])
        fx_kmh = round(vals["fx"] * 3.6)
        pijl = windpijl(vals["dd"])
        kleur  = bft_kleuren.get(min(bft,9), "#7b0000")
        tkleur = bft_tekstkleur.get(min(bft,9), "white")
        tekst  = f"{pijl} {bft}Bft\n{fx_kmh}km/u"
        ax.text(lon, lat, tekst, ha="center", va="center", fontsize=7.5, weight="bold",
                color=tkleur, zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.18", facecolor=kleur, edgecolor="none", zorder=7))
        # Stationsnaam klein eronder
        ax.text(lon, lat-0.12, naam, ha="center", va="top", fontsize=5.5,
                color="#333333", zorder=9, transform=ccrs.PlateCarree())

    ax.text(1.0,0.0,f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes,fontsize=6.5,style="italic",ha="right",va="bottom",color="#555555")

    # Legenda
    legenda_items = [(0,"0-2 Bft","#aaaaaa","white"),(3,"3 Bft","#4caf50","white"),
                     (4,"4 Bft","#8bc34a","white"),(5,"5 Bft","#ffeb3b","black"),
                     (6,"6 Bft","#ff9800","white"),(7,"7 Bft","#f44336","white"),
                     (8,"8 Bft","#b71c1c","white"),(9,"9+ Bft","#7b0000","white")]
    leg = ax.inset_axes([0.01, 0.01, 0.14, 0.40])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.text(0.5,0.95,"Wind 06-18u",fontsize=4.5,weight="bold",ha="center",va="top",transform=leg.transAxes)
    n = len(legenda_items)
    for idx,(b,label,kleur,tk) in enumerate(legenda_items):
        y = 0.88 - idx*(0.88/n)
        leg.add_patch(plt.Rectangle((0.05,y-0.04),0.22,0.09,facecolor=kleur,transform=leg.transAxes,zorder=1))
        leg.text(0.33,y+0.005,label,fontsize=4.0,va="center",transform=leg.transAxes)

    fname = f"kaart_wind_noordzee_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight"); plt.close()
    print(f"Kaart: {fname}")

# Opruimen
for oud in sorted(glob.glob("kaart_wind_noordzee_*.png"), key=os.path.getmtime)[:-10]:
    os.remove(oud)

print("Klaar!")
