import os
import math
import requests
import zipfile
import io
import xml.etree.ElementTree as ET
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

stations = [
    ("06280","Eelde"),("06250","Terschelling"),("06242","Vlieland"),
    ("06270","Leeuwarden"),("06235","Den Helder"),("06240","Amsterdam"),
    ("06260","De Bilt"),("06275","Deelen"),("06279","Hoogeveen"),
    ("06290","Enschede"),("06330","Hoek van Holland"),
    ("06344","Rotterdam Airport"),("06350","Gilze Rijen"),("06370","Eindhoven"),
    ("06380","Maastricht"),
    ("K1176","Kleve"),("06479","Kleine Brogel"),
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
    ax.text(0.988,0.18,f"DWD MOSMIX  ·  run: {now_str}",fontsize=7,color="#a8c8e8",ha="right",va="center",transform=ax.transAxes)
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

def zon_cirkel_kleur(sd_uren):
    """Kleur van de cirkel op basis van zonuren."""
    if sd_uren >= 10: return "#FFD700", "black"
    if sd_uren >= 7:  return "#FFC200", "black"
    if sd_uren >= 4:  return "#FFB347", "black"
    if sd_uren >= 2:  return "#C8C8C8", "black"
    return "#888888", "white"

def max_daglengte(datum, lat_deg=52.0):
    """Astronomische daglengte in uren voor gegeven datum en breedte."""
    import math
    dag_nr = datum.timetuple().tm_yday
    decl = math.radians(-23.45 * math.cos(math.radians(360/365 * (dag_nr + 10))))
    lat  = math.radians(lat_deg)
    cos_ha = -math.tan(lat) * math.tan(decl)
    cos_ha = max(-1.0, min(1.0, cos_ha))
    return 2 * math.degrees(math.acos(cos_ha)) / 15.0

def sd_uit_neff(neff_gem, datum):
    """Schat zonuren uit gemiddelde bewolking% via lineaire benadering."""
    dl = max_daglengte(datum)
    return round(max(0.0, dl * (1.0 - neff_gem / 100.0) * 0.75), 1)

# ── DATA OPHALEN ──────────────────────────────────────────────────────────────
from matplotlib.gridspec import GridSpec
import cartopy.crs as ccrs

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
print("MOSMIX ophalen (zon/bewolking)...")

LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

data_per_day = {}
for code, name in stations:
    print(f"Ophalen: {name} ({code})...")
    root = download_kmz(code)
    if root is None: print("  x Geen data"); continue
    times = get_times(root)
    sd_raw   = parse_values(root, 'SunD1')   # zonschijnduur afgelopen uur [seconden]
    neff_raw = parse_values(root, 'Neff')    # effectieve bewolking [%]

    daily = {}
    prev_hour = None
    for i, dt_utc in enumerate(times):
        dt_loc = dt_utc .replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d = dt_loc.date()
        if d not in daily:
            daily[d] = {"sd": 0.0, "neff": [], "heeft_sd": False, "prev_dt": None}

        # SunD1: alleen uurlijkse stappen meenemen (verschil = 1 uur)
        # Bij 3-uurs stappen is de waarde de zonuren van het laatste uur vóór de stap,
        # niet de som over 3 uur — we tellen ze gewoon mee als losse uurwaarden.
        if i < len(sd_raw) and sd_raw[i] is not None:
            # check tijdstap-interval
            if i > 0:
                dt_prev = times[i-1] .replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
                interval_h = (dt_loc - dt_prev).total_seconds() / 3600
            else:
                interval_h = 1.0
            # SunD1 is altijd "afgelopen uur" in seconden → omrekenen naar uren
            # Bij 3-uurs stap: de waarde beslaat alleen het laatste uur van de 3 → niet vermenigvuldigen
            daily[d]["sd"] += sd_raw[i] / 3600.0
            daily[d]["heeft_sd"] = True

        if i < len(neff_raw) and neff_raw[i] is not None:
            daily[d]["neff"].append(neff_raw[i])

    days = sorted(daily.keys())[:7]
    for d in days:
        if d not in data_per_day:
            data_per_day[d] = {}
        sd_tot   = round(daily[d]["sd"], 1)
        neff_gem = round(sum(daily[d]["neff"]) / len(daily[d]["neff"]), 0) if daily[d]["neff"] else 0
        # Fallback: schat zonuren uit Neff als geen SunD1 beschikbaar
        if not daily[d]["heeft_sd"] and daily[d]["neff"]:
            sd_tot = sd_uit_neff(neff_gem, d)
        data_per_day[d][name] = {"sd": sd_tot, "neff": neff_gem, "heeft_sd": daily[d]["heeft_sd"]}

print(f"Data voor {len(data_per_day)} dagen")
if not data_per_day:
    print("Geen data!"); exit()

# ── KAARTEN GENEREREN ─────────────────────────────────────────────────────────
now_str  = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

# Kaartbreedte in graden (voor cirkelgrootte schaalbepaling)
LON_RANGE = EXTENT[1] - EXTENT[0]  # 4.1 graden

for day, dag_data in data_per_day.items():
    dag_nl = nl_dagen[day.weekday()]
    fig = plt.figure(figsize=(8, 11))
    gs = GridSpec(2, 1, figure=fig, height_ratios=[0.085, 1], hspace=0.01)
    maak_header(fig, gs, dag_nl, day, now_str)
    ax = maak_kaart_ax(fig, gs)

    for name, vals in dag_data.items():
        if name not in coords:
            continue
        if not vals.get("heeft_sd") and vals.get("neff", 0) == 0:
            continue  # geen data beschikbaar
        lon, lat = coords[name]
        sd   = vals["sd"]
        neff = vals["neff"]
        kleur, tkleur = zon_cirkel_kleur(sd)

        # ── Cirkel via scatter (altijd rond in schermcoördinaten) ──
        markersize = 900 + 300 * min(sd / 10.0, 1.0)
        ax.scatter(lon, lat, s=markersize, c=kleur, edgecolors="#888888",
                   linewidths=0.5, zorder=8, transform=ccrs.PlateCarree())

        # Zonuren in de cirkel (vet)
        ax.text(lon, lat + 0.04, f"{sd:.0f}u",
                ha="center", va="center", fontsize=8.0, weight="bold",
                color=tkleur, zorder=9, transform=ccrs.PlateCarree())

        # Bewolking % klein eronder
        ax.text(lon, lat - 0.06, f"{neff:.0f}%",
                ha="center", va="center", fontsize=4.5,
                color=tkleur, zorder=9, transform=ccrs.PlateCarree())

    # ── Legenda ──
    leg = ax.inset_axes([0.01, 0.72, 0.22, 0.25])
    leg.set_xlim(0, 1); leg.set_ylim(0, 1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0,0),1,1,facecolor="white",edgecolor="#aaaaaa",
                                 linewidth=0.7,transform=leg.transAxes,zorder=0))
    leg.text(0.5, 0.94, "Zonuren", fontsize=5, weight="bold",
             ha="center", va="top", transform=leg.transAxes)
    items = [("≥10u","#FFD700"),("≥7u","#FFC200"),("≥4u","#FFB347"),("≥2u","#C8C8C8"),("<2u","#888888")]
    for idx, (label, kleur) in enumerate(items):
        y = 0.80 - idx * 0.155
        leg.scatter([0.12], [y], s=120, c=kleur, edgecolors="#888888",
                    linewidths=0.4, zorder=1, transform=leg.transAxes)
        leg.text(0.25, y, label, fontsize=4.2, va="center", transform=leg.transAxes)
    leg.text(0.5, 0.04, "getal = zonuren (~schatting via bewolking%)",
             fontsize=3.5, ha="center", va="center", transform=leg.transAxes)

    ax.text(1.0, 0.0, f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
            transform=ax.transAxes, fontsize=6.5, style="italic",
            ha="right", va="bottom", color="#555555")

    ax.set_extent(EXTENT, crs=ccrs.PlateCarree()); ax.axis("off")
    fname = f"kaart_zon_{dag_nl.lower()}_{day.strftime('%d%b%Y').lower()}.png"
    plt.savefig(fname, dpi=300, bbox_inches="tight"); plt.close()
    print(f"Kaart: {fname}")
