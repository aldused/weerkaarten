import os
import requests
import zipfile
import io
import xml.etree.ElementTree as ET
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import matplotlib.pyplot as plt
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
    "Bocholt":(6.617,51.838),"Nettetal":(6.276,51.317),"Geilenkirchen":(6.030,50.580),
    "Borkum":(6.749,53.586),"Volkel":(5.707,51.657),
}

EXTENT = [3.3, 7.4, 50.45, 53.8]
nl_dagen   = ["Maandag","Dinsdag","Woensdag","Donderdag","Vrijdag","Zaterdag","Zondag"]
nl_maanden = ["","Januari","Februari","Maart","April","Mei","Juni",
               "Juli","Augustus","September","Oktober","November","december"]

# ── Onweer categorieën op basis van wwT (kans %) ──────────────────────────
def onweer_categorie(wwt):
    if wwt is None or wwt == 0: return 0   # geen kans
    if wwt < 20:                return 1   # klein
    if wwt < 40:                return 2   # matig
    if wwt < 60:                return 3   # aanzienlijk
    return 4                               # groot

OW_KLEUREN = {
    0: "#2c3e50",   # donkerblauw – geen kans
    1: "#f39c12",   # geel – kleine kans
    2: "#e67e22",   # oranje – matige kans
    3: "#c0392b",   # rood – aanzienlijke kans
    4: "#6c3483",   # paars – grote kans
}
OW_TEKSTKLEUR = {0:"#aaaaaa", 1:"white", 2:"white", 3:"white", 4:"white"}

# ── CAPE categorieën ───────────────────────────────────────────────────────
def cape_klasse(cape):
    """Geeft beschrijving van instabiliteit."""
    if cape is None or cape < 100: return ""
    if cape < 500:  return "zwak"
    if cape < 1000: return "matig"
    if cape < 2500: return "sterk"
    return "extreem"

# ── Helpers ────────────────────────────────────────────────────────────────
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

# ── Data ophalen ───────────────────────────────────────────────────────────
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
print("MOSMIX ophalen (onweer: wwT, wwTd, CAPE, CIN)...")

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
data_per_day = {}

for code, name in stations:
    print(f"Ophalen: {name} ({code})...")
    root = download_kmz(code)
    if root is None: continue

    times    = get_times(root)
    wwt_raw  = parse_values(root, 'wwT')    # kans op onweer %
    cape_raw = parse_values(root, 'CAPE')   # J/kg
    cin_raw  = parse_values(root, 'CIN')    # J/kg

    daily = {}
    for i, dt in enumerate(times):
        loc  = dt.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d    = loc.date()
        hour = loc.hour
        # Hele dag meenemen voor onweer (ook 's middags)
        if d not in daily:
            daily[d] = {"wwt": [], "cape": [], "cin": []}
        if i < len(wwt_raw)  and wwt_raw[i]  is not None: daily[d]["wwt"].append(wwt_raw[i])
        if i < len(cape_raw) and cape_raw[i] is not None: daily[d]["cape"].append(cape_raw[i])
        if i < len(cin_raw)  and cin_raw[i]  is not None: daily[d]["cin"].append(cin_raw[i])

    days = sorted(daily.keys())[:10]
    for d in days:
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

        data_per_day[d][name] = {
            "wwt":  wwt_max,
            "cape": cape_max,
            "cin":  cin_op_cape,
        }

print(f"Data voor {len(data_per_day)} dagen")
if not data_per_day: print("Geen data!"); exit()

now_str  = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

# ── Kaarten maken ──────────────────────────────────────────────────────────
for day, dag_data in data_per_day.items():
    dag_nl = nl_dagen[day.weekday()]
    fig = plt.figure(figsize=(8,11))
    gs = GridSpec(2,1,figure=fig,height_ratios=[0.085,1],hspace=0.01)
    maak_header(fig, gs, dag_nl, day, now_str)
    ax = maak_kaart_ax(fig, gs)

    for name, vals in dag_data.items():
        if name not in coords: continue
        lon, lat = coords[name]
        wwt  = vals["wwt"]
        cape = vals["cape"]
        cin  = vals["cin"]

        cat    = onweer_categorie(wwt)
        kleur  = OW_KLEUREN[cat]
        tkleur = OW_TEKSTKLEUR[cat]

        if wwt is not None and wwt > 0:
            tekst = f"Onweer {wwt}%"
        else:
            tekst = "–"

        # Regel 3: CAPE / CIN
        cape_lbl = ""
        if cape is not None and cape >= 100:
            cape_lbl = f"CAPE {cape}"
            if cin is not None:
                cape_lbl += f" CIN {cin}"
        if cape_lbl:
            tekst += f"\n{cape_lbl}"

        ax.text(lon, lat, tekst, ha="center", va="center", fontsize=7.0, weight="bold",
                color=tkleur, zorder=8, transform=ccrs.PlateCarree(),
                bbox=dict(boxstyle="round,pad=0.18", facecolor=kleur, edgecolor="none", zorder=7))

    ax.text(1.0,0.0,f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes,fontsize=6.5,style="italic",ha="right",va="bottom",color="#555555")

    # ── Legenda ────────────────────────────────────────────────────────────
    legenda_items = [
        (0, "Geen kans",           "#2c3e50", "#aaaaaa"),
        (1, "Kleine kans  <20%",   "#f39c12", "white"),
        (2, "Matige kans  20–40%", "#e67e22", "white"),
        (3, "Aanzienlijk  40–60%", "#c0392b", "white"),
        (4, "Grote kans  >60%",    "#6c3483", "white"),
    ]
    leg_x, leg_y = 0.01, 0.98
    item_h = 0.035
    leg_h = len(legenda_items)*item_h + 0.20
    leg = ax.inset_axes([leg_x, leg_y-leg_h, 0.30, leg_h])
    leg.set_xlim(0,1); leg.set_ylim(0,1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.text(0.5,0.97,"Kans op onweer (hele dag)",fontsize=4.5,weight="bold",ha="center",va="top",transform=leg.transAxes)
    leg.text(0.5,0.89,"Onweer % = kans op onweer",fontsize=3.8,ha="center",va="top",transform=leg.transAxes,color="#333333")
    leg.text(0.5,0.81,"Bij hoge instabiliteit: CAPE J/kg / CIN J/kg",fontsize=3.6,ha="center",va="top",transform=leg.transAxes,color="#555555")
    leg.text(0.5,0.73,"CAPE: <500 zwak  500-1000 matig  >1000 sterk",fontsize=3.4,ha="center",va="top",transform=leg.transAxes,color="#777777")
    leg.text(0.5,0.65,"CIN: remming op convectie (neg. = sterker)",fontsize=3.4,ha="center",va="top",transform=leg.transAxes,color="#777777")
    for idx,(cat,label,kleur,tk) in enumerate(legenda_items):
        y = 0.55 - idx*(1.0/len(legenda_items))*0.58
        leg.add_patch(plt.Rectangle((0.03,y-0.04),0.14,0.09,facecolor=kleur,transform=leg.transAxes,zorder=1))
        leg.text(0.21,y+0.005,label,fontsize=3.8,va="center",transform=leg.transAxes,color="#222222")

    ax.set_extent(EXTENT, crs=ccrs.PlateCarree()); ax.axis("off")
    fname = f"kaart_onweer_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname, dpi=300, bbox_inches="tight"); plt.close()
    print(f"Kaart: {fname}")
