"""
MOSMIX Kaart: Cumulusvorming / Triggertemperatuur
Toont per station:
  - Verwacht startuur van stapelwolken (eerste uur met Nl > 15%)
  - LCL-hoogte (condensatieniveau) berekend uit T en Td
  - CAPE als instabiliteitsindicator
  - Vergelijking triggertemperatuur vs verwachte maximum
"""
import os
import math
import requests
import zipfile
import io
import xml.etree.ElementTree as ET
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.patheffects as pe
import numpy as np

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
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

nl_dagen   = ["Ma","Di","Wo","Do","Vr","Za","Zo"]
nl_maanden = ["","jan","feb","mrt","apr","mei","jun",
               "jul","aug","sep","okt","nov","dec"]

# ── Kleuren voor cumulusverwachting ──────────────────────────────────────────
# Gebaseerd op verschil TX - T_trigger en CAPE
KLEUR_GEEN     = "#5dade2"   # blauw — geen cumulus verwacht
KLEUR_ONZEKER  = "#f9e79f"   # geel — marginaal / onzeker
KLEUR_WAARSCH  = "#f5b041"   # oranje — cumulus waarschijnlijk
KLEUR_ZEKER    = "#e74c3c"   # rood — zeker cumulus, krachtige thermiek

# ── MOSMIX helpers ───────────────────────────────────────────────────────────
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


def lcl_hoogte(t_celsius, td_celsius):
    """Bereken LCL-hoogte in meters (Espy-formule)."""
    return 125.0 * (t_celsius - td_celsius)


def bereken_trigger_temp(td_morning, lcl_m):
    """
    Schat de triggertemperatuur (convectietemperatuur).

    Concept: de oppervlaktetemperatuur die nodig is zodat een droog-adiabatisch
    stijgend luchtpakketje het condensatieniveau (LCL) bereikt en daar net
    warmer is dan de omgeving.

    Aanname: standaard omgevingslapserate van 6.5°C/km in de grenslaag.
    Droog-adiabatisch: 9.8°C/km.

    T_trigger = Td_ochtend + LCL × (γ_d / 1000)
    waar LCL berekend wordt met de ochtend-Td en de triggertemp zelf.

    Herschrijving: LCL = 125 × (T_trigger - Td)
    T_trigger - 9.8 × LCL/1000 = T_env_at_LCL
    T_env_at_LCL = T_surface - 6.5 × LCL/1000  (maar T_surface is onbekend)

    Simplificatie: T_trigger ≈ Td + LCL_morning / 100
    Dit geeft een goede eerste orde schatting.
    """
    if td_morning is None or lcl_m is None:
        return None
    # Eenvoudige benadering: triggertemp is de temperatuur
    # waarbij de grenslaag diep genoeg is om het LCL te bereiken.
    # Grenslaag groeit ~100m per 1°C opwarming boven het ochtendminimum.
    return td_morning + lcl_m / 100.0


def analyseer_station(times, ttt_raw, td_raw, nl_raw, cape_raw, doeldatum):
    """
    Analyseer cumulusvorming voor één station op de doeldag.

    Returns dict met:
        tx: verwachte maximumtemperatuur (°C)
        td_ochtend: gemiddeld dauwpunt ochtend (°C)
        lcl: LCL-hoogte ochtend (m)
        t_trigger: geschatte triggertemperatuur (°C)
        startuur: eerste uur (lokaal) met Nl > 15%, of None
        cape_max: maximale CAPE overdag (J/kg)
        uurdata: list van (uur_lokaal, T, Td, Nl) voor de doeldag
    """
    # Verzamel uurdata voor de doeldag (06-21 lokaal)
    uurdata = []
    ochtend_td = []
    dag_t = []
    dag_cape = []
    startuur = None

    for i, dt_utc in enumerate(times):
        dt_loc = dt_utc.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        if dt_loc.date() != doeldatum:
            continue
        uur = dt_loc.hour

        t = ttt_raw[i] - 273.15 if i < len(ttt_raw) and ttt_raw[i] is not None else None
        td = td_raw[i] - 273.15 if i < len(td_raw) and td_raw[i] is not None else None
        nl = nl_raw[i] if i < len(nl_raw) and nl_raw[i] is not None else None
        cape = cape_raw[i] if i < len(cape_raw) and cape_raw[i] is not None else None

        if 6 <= uur <= 21:
            uurdata.append((uur, t, td, nl, cape))

        # Ochtend dauwpunt (06-09 lokaal) voor LCL-berekening
        if 6 <= uur <= 9 and td is not None:
            ochtend_td.append(td)

        # Dagtemperaturen voor TX
        if 6 <= uur <= 21 and t is not None:
            dag_t.append(t)

        # CAPE overdag
        if 8 <= uur <= 18 and cape is not None:
            dag_cape.append(cape)

        # Eerste uur met significante lage bewolking (cumulus)
        if startuur is None and 8 <= uur <= 20 and nl is not None and nl > 15:
            startuur = uur

    if not dag_t or not ochtend_td:
        return None

    tx = max(dag_t)
    td_ochtend = sum(ochtend_td) / len(ochtend_td)
    lcl = lcl_hoogte(tx, td_ochtend)
    t_trigger = bereken_trigger_temp(td_ochtend, lcl)
    cape_max = max(dag_cape) if dag_cape else 0

    return {
        "tx": round(tx, 1),
        "td_ochtend": round(td_ochtend, 1),
        "lcl": round(lcl),
        "t_trigger": round(t_trigger, 1) if t_trigger else None,
        "startuur": startuur,
        "cape_max": round(cape_max),
        "uurdata": uurdata,
    }


def cumulus_categorie(data):
    """
    Bepaal cumuluscategorie op basis van analyse.
    Returns (categorie_nr, kleur, label)
    """
    if data is None:
        return (0, KLEUR_GEEN, "geen data")

    tx = data["tx"]
    t_trigger = data["t_trigger"]
    startuur = data["startuur"]
    cape = data["cape_max"]

    # Geen cumulus verwacht als:
    # - TX ruim onder triggertemp EN geen lage bewolking in model
    if t_trigger is not None and tx < t_trigger - 2 and startuur is None:
        return (0, KLEUR_GEEN, "geen cumulus")

    # Marginaal: TX net onder of rond triggertemp
    if t_trigger is not None and tx < t_trigger + 1 and (startuur is None or startuur >= 15):
        return (1, KLEUR_ONZEKER, "onzeker")

    # Waarschijnlijk: TX boven triggertemp OF model voorspelt lage bewolking
    if startuur is not None and startuur < 15:
        if cape > 300:
            return (3, KLEUR_ZEKER, "actieve thermiek")
        return (2, KLEUR_WAARSCH, "cumulus verwacht")

    if t_trigger is not None and tx >= t_trigger + 1:
        return (2, KLEUR_WAARSCH, "cumulus verwacht")

    # Laat op de dag
    if startuur is not None:
        return (1, KLEUR_ONZEKER, "laat / onzeker")

    return (0, KLEUR_GEEN, "geen cumulus")


# ── Data ophalen ─────────────────────────────────────────────────────────────
now_utc    = datetime.now(timezone.utc)
now_lokaal = now_utc.astimezone(LOCAL_TZ)
now_str    = now_lokaal.strftime("%d %b %Y  %H:%M")

DAGEN_VOORUIT = 4

for dag_offset in range(0, DAGEN_VOORUIT):
    doeldag = (now_lokaal + timedelta(days=dag_offset + 1)).date()
    dag_label = f"{nl_dagen[doeldag.weekday()]} {doeldag.day} {nl_maanden[doeldag.month]}"
    datum_str = doeldag.strftime("%Y-%m-%d")

    print(f"\nCumuluskaart voor {dag_label}...")

    station_data = {}
    for code, naam in stations:
        if naam not in coords:
            continue
        print(f"  {naam}...")
        root = download_kmz(code)
        if root is None:
            continue
        times = get_times(root)

        ttt_raw  = parse_values(root, 'TTT')
        td_raw   = parse_values(root, 'Td')
        nl_raw   = parse_values(root, 'Nl')
        cape_raw = parse_values(root, 'CAPE')

        result = analyseer_station(times, ttt_raw, td_raw, nl_raw, cape_raw, doeldag)
        if result is not None:
            station_data[naam] = result

    print(f"  Data voor {len(station_data)} stations")

    # ── Kaart tekenen ────────────────────────────────────────────────────────
    import cartopy.crs as ccrs
    import cartopy.feature as cfeature
    from matplotlib.gridspec import GridSpec

    fig = plt.figure(figsize=(10, 13))
    gs = GridSpec(2, 1, figure=fig, height_ratios=[0.07, 1], hspace=0.01)

    # Header
    ax_h = fig.add_subplot(gs[0])
    ax_h.set_xlim(0, 1); ax_h.set_ylim(0, 1); ax_h.axis("off")
    ax_h.add_patch(plt.Rectangle((0, 0), 1, 1, transform=ax_h.transAxes,
                   facecolor="#003366", zorder=0, clip_on=False))
    ax_h.text(0.012, 0.65, "Ed Aldus WM", fontsize=11, color="white",
              weight="bold", va="center", transform=ax_h.transAxes)
    ax_h.text(0.012, 0.22, "MOS ECMWF/ICON · DWD MOSMIX", fontsize=7.5,
              color="#a8c8e8", va="center", transform=ax_h.transAxes)
    ax_h.text(0.988, 0.65, f"Cumulusvorming – {dag_label}",
              fontsize=13, color="white", weight="bold",
              ha="right", va="center", transform=ax_h.transAxes)
    ax_h.text(0.988, 0.22, f"run: {now_str}",
              fontsize=7.5, color="#a8c8e8", ha="right", va="center",
              transform=ax_h.transAxes)
    ax_h.axhline(0, color="#4a90c4", linewidth=1.5)

    # Kaart
    ax = fig.add_subplot(gs[1], projection=ccrs.PlateCarree())
    ax.set_extent(EXTENT, crs=ccrs.PlateCarree())
    ax.set_aspect('auto')
    ax.add_feature(cfeature.OCEAN.with_scale("10m"),  facecolor="#d8ecf8", zorder=0)
    ax.add_feature(cfeature.LAND.with_scale("10m"),   facecolor="#f0f4ec", zorder=1)
    ax.add_feature(cfeature.LAKES.with_scale("10m"),  facecolor="#d8ecf8", zorder=2)
    ax.add_feature(cfeature.RIVERS.with_scale("10m"), edgecolor="#a8cce0", linewidth=0.5, zorder=3)
    ax.add_feature(cfeature.COASTLINE.with_scale("10m"), edgecolor="#555555", linewidth=0.8, zorder=4)
    ax.add_feature(cfeature.BORDERS.with_scale("10m"),   edgecolor="#888888", linewidth=0.6,
                   linestyle="--", zorder=4)
    ax.axis("off")

    tr = ccrs.PlateCarree()

    # Ellips-radii gecorrigeerd voor breedtegraad (zelfde aanpak als bewolkingskaart)
    R_LON = 0.075
    R_LAT = 0.050

    # Per station: gekleurd rondje + labels
    for naam, data in station_data.items():
        lon, lat = coords[naam]
        cat_nr, kleur, label = cumulus_categorie(data)

        # Ellips (rond op kaart)
        ax.add_patch(mpatches.Ellipse((lon, lat), 2 * R_LON, 2 * R_LAT,
                     facecolor=kleur, edgecolor='#333333', linewidth=0.8,
                     zorder=8, transform=tr))

        # Startuur in de ellips
        if data["startuur"] is not None:
            ax.text(lon, lat, f"{data['startuur']}u",
                    fontsize=5.5, weight="bold", color="white",
                    ha="center", va="center", zorder=9, transform=tr,
                    path_effects=[pe.withStroke(linewidth=2, foreground="#333333")])
        else:
            ax.text(lon, lat, "—",
                    fontsize=6.5, weight="bold", color="white",
                    ha="center", va="center", zorder=9, transform=tr,
                    path_effects=[pe.withStroke(linewidth=2, foreground="#333333")])

        # Stationsnaam boven de ellips
        ax.text(lon, lat + R_LAT + 0.02, naam,
                fontsize=4, color="#222222", weight="bold",
                ha="center", va="bottom", zorder=9, transform=tr,
                path_effects=[pe.withStroke(linewidth=1.5, foreground="white")])

        # Sublabel onder de ellips: TX / Ttrigger / LCL
        line1_parts = []
        if data["t_trigger"] is not None:
            line1_parts.append(f"Tmax {data['tx']:.0f}°  Trig {data['t_trigger']:.0f}°")
        if data["lcl"] is not None:
            line1_parts.append(f"LCL {data['lcl']}m")
        sublabel = "  ·  ".join(line1_parts)
        if data["cape_max"] > 50:
            sublabel += f"  ·  CAPE {data['cape_max']}"

        ax.text(lon, lat - R_LAT - 0.015, sublabel,
                fontsize=3.5, color="#444444", ha="center", va="top",
                zorder=9, transform=tr,
                path_effects=[pe.withStroke(linewidth=1.8, foreground="white")])

    # ── Legenda ──────────────────────────────────────────────────────────────
    leg = ax.inset_axes([0.01, 0.74, 0.34, 0.25])
    leg.set_xlim(0, 1); leg.set_ylim(0, 1); leg.axis("off")
    leg.add_patch(plt.Rectangle((0, 0), 1, 1, facecolor="white", edgecolor="#aaaaaa",
                  linewidth=0.7, transform=leg.transAxes, zorder=0, alpha=0.92))

    leg.text(0.5, 0.96, "Stapelwolken / Cumulusvorming",
             fontsize=5.5, weight="bold", ha="center", va="top", transform=leg.transAxes)

    categorieen = [
        (KLEUR_ZEKER,    "Actieve thermiek",  "TX >> Ttrigger, CAPE > 300 J/kg"),
        (KLEUR_WAARSCH,  "Cumulus verwacht",   "TX > Ttrigger of model voorspelt Cu"),
        (KLEUR_ONZEKER,  "Marginaal / laat",   "TX ≈ Ttrigger, onzeker of laat"),
        (KLEUR_GEEN,     "Geen cumulus",        "TX < Ttrigger, stabiel"),
    ]
    for i, (kleur, titel, omschr) in enumerate(categorieen):
        y = 0.80 - i * 0.17
        c = mpatches.Ellipse((0.06, y), 0.07, 0.08, facecolor=kleur, edgecolor="#444444",
                             linewidth=0.5, transform=leg.transAxes, zorder=1)
        leg.add_patch(c)
        leg.text(0.12, y + 0.025, titel, fontsize=4.5, weight="bold",
                 color="#222222", transform=leg.transAxes, va="center")
        leg.text(0.12, y - 0.035, omschr, fontsize=3.5,
                 color="#666666", transform=leg.transAxes, va="center")

    # Uitleg
    leg.text(0.5, 0.10, "Getal in cirkel = verwacht startuur cumulus (lokale tijd)",
             fontsize=3.5, color="#666666", ha="center", transform=leg.transAxes)
    leg.text(0.5, 0.03, "Tmax · Trig = triggertemp · LCL = condensatieniveau · CAPE",
             fontsize=3.3, color="#999999", ha="center", transform=leg.transAxes)

    ax.text(1.0, 0.0, f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str}",
            transform=ax.transAxes, fontsize=6.5, style="italic",
            ha="right", va="bottom", color="#555555")

    fname = f"kaart_cumulus_{datum_str}.png"
    plt.savefig(fname, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Kaart opgeslagen: {fname}")
