"""
Genereert grafiek_trend.json (en grafiek_trend.png) op basis van DWD MOSMIX_L.
- 16 NL-stations
- 10 dagen vooruit
- Per station: TX, TN, dagsom RR, max wind (Bft), gemiddelde windrichting (DD) op moment van de max
- JSON-structuur bevat stations-array met kleur/hoofd/regio metadata zodat de
  frontend de UI compleet kan aansturen.
"""
import os
import requests
import zipfile
import io
import xml.etree.ElementTree as ET
import re
import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import numpy as np

# ── STATION-LIJST ─────────────────────────────────────────────────────────────
# (code, naam, kleur, hoofd, regio)
# hoofd=True: standaard zichtbaar in alle grafieken (7 belangrijkste)
# regio: "kust" of "binnen"
STATIONS = [
    # Hoofdstations (7)
    ("06260", "De Bilt",         "#E63946", True,  "binnen"),
    ("06280", "Eelde",           "#2A9D8F", True,  "binnen"),
    ("06290", "Twenthe",         "#F4A261", True,  "binnen"),
    ("06380", "Maastricht",      "#9B5DE5", True,  "binnen"),
    ("06235", "De Kooy",         "#457B9D", True,  "kust"),
    ("06310", "Vlissingen",      "#E9C46A", True,  "kust"),
    ("06344", "Rotterdam",       "#06D6A0", True,  "kust"),
    # Overig (9)
    ("06242", "Vlieland",        "#118ab2", False, "kust"),
    ("06250", "Terschelling",    "#073b4c", False, "kust"),
    ("06270", "Leeuwarden",      "#ef476f", False, "binnen"),
    ("06279", "Hoogeveen",       "#8338ec", False, "binnen"),
    ("06275", "Deelen",          "#fb5607", False, "binnen"),
    ("06240", "Schiphol",        "#3a86ff", False, "kust"),
    ("06330", "Hoek v. Holland", "#52796f", False, "kust"),
    ("06350", "Gilze-Rijen",     "#bc6c25", False, "binnen"),
    ("06370", "Eindhoven",       "#5a189a", False, "binnen"),
]

nl_dagen = ["Ma","Di","Wo","Do","Vr","Za","Zo"]
nl_maanden = ["","jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"]
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")
DAGEN_VOORUIT = 10  # incl. vandaag

# ── HELPERS ───────────────────────────────────────────────────────────────────
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
        except Exception: pass
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
                        except Exception: res.append(None)
                return res
    return []

def ms_naar_bft(ms):
    schaal = [0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5,28.5,32.7]
    for i, grens in enumerate(schaal):
        if ms < grens: return i
    return 12

def maak_panel(ax, ylabel):
    ax.set_facecolor("#f8f8f8")
    ax.grid(axis="y", color="#dddddd", linewidth=0.7, zorder=0)
    ax.grid(axis="x", color="#eeeeee", linewidth=0.5, zorder=0)
    ax.set_ylabel(ylabel, fontsize=8, color="#444444")
    ax.tick_params(axis="y", labelsize=7.5, colors="#444444")
    ax.tick_params(axis="x", colors="#444444")
    for spine in ["top","right"]: ax.spines[spine].set_visible(False)
    ax.spines["left"].set_color("#cccccc")
    ax.spines["bottom"].set_color("#cccccc")

# ── DATA OPHALEN ──────────────────────────────────────────────────────────────
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
print("MOSMIX ophalen (trend, 16 stations × 10 dagen)...")

vandaag_lokaal = datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()

# Per station: { dag_iso: {tx, tn, rr, bft, wdir} }
per_station = {}

for code, naam, _kleur, _hoofd, _regio in STATIONS:
    print(f"  {naam} ({code})...")
    root = download_kmz(code)
    if root is None:
        per_station[naam] = {}
        continue
    times   = get_times(root)
    tx_raw  = parse_values(root, 'TX')
    tn_raw  = parse_values(root, 'TN')
    ttt_raw = parse_values(root, 'TTT')
    rr_raw  = parse_values(root, 'RR1c')
    ff_raw  = parse_values(root, 'FF')
    dd_raw  = parse_values(root, 'DD')

    daily = {}
    for i, dt_utc in enumerate(times):
        dt_loc = dt_utc.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d = dt_loc.date()
        if d not in daily:
            daily[d] = {"tx":[], "tn":[], "ttt":[], "rr":[], "ff":[], "ff_dd":[]}
        if i < len(tx_raw)  and tx_raw[i]  is not None: daily[d]["tx"].append(tx_raw[i] - 273.15)
        if i < len(tn_raw)  and tn_raw[i]  is not None: daily[d]["tn"].append(tn_raw[i] - 273.15)
        if i < len(ttt_raw) and ttt_raw[i] is not None: daily[d]["ttt"].append(ttt_raw[i] - 273.15)
        if i < len(rr_raw)  and rr_raw[i]  is not None and rr_raw[i] >= 0: daily[d]["rr"].append(rr_raw[i])
        if i < len(ff_raw)  and ff_raw[i]  is not None:
            ddv = dd_raw[i] if (i < len(dd_raw) and dd_raw[i] is not None) else None
            daily[d]["ff"].append(ff_raw[i])
            daily[d]["ff_dd"].append((ff_raw[i], ddv))

    geaggreggeerd = {}
    for d in sorted(daily.keys()):
        if d < vandaag_lokaal: continue
        if len(geaggreggeerd) >= DAGEN_VOORUIT: break
        tx_v = daily[d]["tx"]; tn_v = daily[d]["tn"]; ttt_v = daily[d]["ttt"]
        tx = max(tx_v) if tx_v else (max(ttt_v) if ttt_v else None)
        tn = min(tn_v) if tn_v else (min(ttt_v) if ttt_v else None)
        rr = round(sum(daily[d]["rr"]), 1) if daily[d]["rr"] else 0.0
        # max wind + bijbehorende richting
        bft = None; wdir = None
        if daily[d]["ff_dd"]:
            ff_max, dd_at_max = max(daily[d]["ff_dd"], key=lambda x: x[0])
            bft = ms_naar_bft(ff_max)
            wdir = dd_at_max
        geaggreggeerd[d.isoformat()] = {
            "tx": round(tx, 1) if tx is not None else None,
            "tn": round(tn, 1) if tn is not None else None,
            "rr": rr,
            "bft": bft,
            "wdir": round(wdir) if wdir is not None else None,
        }
    per_station[naam] = geaggreggeerd

# Gemeenschappelijke dagen — eerste 10 vanaf vandaag waar ten minste één station data heeft
alle_dagen_iso = sorted({d for sd in per_station.values() for d in sd.keys()})
alle_dagen_iso = [d for d in alle_dagen_iso if d >= vandaag_lokaal.isoformat()][:DAGEN_VOORUIT]
alle_dagen = [datetime.fromisoformat(d).date() for d in alle_dagen_iso]
dag_labels = [f"{nl_dagen[d.weekday()]}\n{d.day} {nl_maanden[d.month]}" for d in alle_dagen]

now_str  = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

# ── JSON exporteren ───────────────────────────────────────────────────────────
def waarden(naam, key):
    sd = per_station.get(naam, {})
    return [sd.get(d, {}).get(key) for d in alle_dagen_iso]

stations_meta = [
    {"naam": naam, "kleur": kleur, "hoofd": hoofd, "regio": regio}
    for _code, naam, kleur, hoofd, regio in STATIONS
]

json_data = {
    "gegenereerd": now_str2,
    "dagen": alle_dagen_iso,
    "dag_labels": dag_labels,
    "stations": stations_meta,
    "temp": {},
    "rr": {},
    "wind": {},
}
for _code, naam, kleur, _hoofd, _regio in STATIONS:
    json_data["temp"][naam] = {
        "kleur": kleur,
        "tx": waarden(naam, "tx"),
        "tn": waarden(naam, "tn"),
    }
    json_data["rr"][naam] = {
        "kleur": kleur,
        "rr": [v if v is not None else 0.0 for v in waarden(naam, "rr")],
    }
    json_data["wind"][naam] = {
        "kleur": kleur,
        "bft":  waarden(naam, "bft"),
        "wdir": waarden(naam, "wdir"),
    }

with open("grafiek_trend.json", "w") as f:
    json.dump(json_data, f)
print(f"JSON opgeslagen: grafiek_trend.json ({len(STATIONS)} stations × {len(alle_dagen)} dagen)")

# ── PNG (statisch) ────────────────────────────────────────────────────────────
# Alleen hoofdstations in de PNG-versie om 'm leesbaar te houden.
HOOFD = [(naam, kleur) for _c, naam, kleur, hoofd, _r in STATIONS if hoofd]

def smooth_serie(y_list):
    xi = np.array([i for i, v in enumerate(y_list) if v is not None and not np.isnan(v)], dtype=float)
    yi = np.array([v for v in y_list if v is not None and not np.isnan(v)], dtype=float)
    if len(xi) < 3: return xi, yi
    x_smooth = np.linspace(xi[0], xi[-1], 300)
    yi_interp = np.interp(x_smooth, xi, yi)
    sigma = 12
    kernel = np.exp(-0.5 * (np.arange(-30, 31) / sigma)**2)
    kernel /= kernel.sum()
    padded = np.pad(yi_interp, 30, mode='edge')
    return x_smooth, np.convolve(padded, kernel, mode='valid')

x = np.arange(len(alle_dagen))
fig = plt.figure(figsize=(14, 22))
gs = gridspec.GridSpec(4, 1, figure=fig, height_ratios=[0.10, 1, 1, 1], hspace=0.4)

ax_h = fig.add_subplot(gs[0])
ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
               facecolor="#1e293b",zorder=0,clip_on=False))
ax_h.text(0.012, 0.65, "Ed Aldus WM", fontsize=11, color="white", weight="bold",
          va="center", transform=ax_h.transAxes)
ax_h.text(0.012, 0.25, "MOS ECMWF/ICON", fontsize=7.5, color="#94a3b8",
          va="center", transform=ax_h.transAxes)
ax_h.text(0.988, 0.65, f"Trend {DAGEN_VOORUIT}-daagse", fontsize=13, color="white", weight="bold",
          ha="right", va="center", transform=ax_h.transAxes)
ax_h.text(0.988, 0.25, f"DWD MOSMIX  ·  run: {now_str}", fontsize=7, color="#94a3b8",
          ha="right", va="center", transform=ax_h.transAxes)
ax_h.axhline(0, color="#2ec4e8", linewidth=1.5)

# Temperatuur
ax1 = fig.add_subplot(gs[1])
maak_panel(ax1, "Temperatuur (°C)")
ax1.set_title("Temperatuur (hoofdstations)", fontsize=9, color="#333333", loc="left", pad=4)
for naam, kleur in HOOFD:
    sd = per_station.get(naam, {})
    tx_list = [sd.get(d, {}).get("tx") for d in alle_dagen_iso]
    tn_list = [sd.get(d, {}).get("tn") for d in alle_dagen_iso]
    xs, tx_s = smooth_serie([np.nan if v is None else v for v in tx_list])
    _,  tn_s = smooth_serie([np.nan if v is None else v for v in tn_list])
    ax1.plot(xs, tx_s, color=kleur, linewidth=2.0, zorder=5, label=naam)
    ax1.plot(xs, tn_s, color=kleur, linewidth=1.4, linestyle="--", zorder=4, alpha=0.85)
    pts = [i for i, v in enumerate(tx_list) if v is not None]
    ax1.scatter(pts, [tx_list[i] for i in pts], color=kleur, s=18, zorder=6)
ax1.axhline(0, color="#888888", linewidth=0.8, linestyle=":", zorder=3)
ax1.set_xticks(x); ax1.set_xticklabels(dag_labels, fontsize=8)
ax1.legend(fontsize=6.5, loc="lower right", framealpha=0.9, edgecolor="#cccccc",
           ncol=2, borderpad=0.5, labelspacing=0.3, handlelength=1.5)
ax1.text(0.01, 0.98, "— TX (max)   - - TN (min)", transform=ax1.transAxes,
         fontsize=7, va="top", color="#555555")

# Neerslag
ax2 = fig.add_subplot(gs[2])
maak_panel(ax2, "Neerslag (mm)")
ax2.set_title("Neerslag (dagsom, hoofdstations)", fontsize=9, color="#333333", loc="left", pad=4)
n = len(HOOFD); breedte = 0.11
offsets = np.linspace(-(n-1)*breedte/2, (n-1)*breedte/2, n)
for idx, (naam, kleur) in enumerate(HOOFD):
    sd = per_station.get(naam, {})
    rr_list = [sd.get(d, {}).get("rr") or 0.0 for d in alle_dagen_iso]
    ax2.bar(x + offsets[idx], rr_list, width=breedte, color=kleur, alpha=0.85, zorder=5, label=naam)
ax2.set_xticks(x); ax2.set_xticklabels(dag_labels, fontsize=8)
ax2.set_ylim(bottom=0)
ax2.legend(fontsize=6.5, loc="upper right", framealpha=0.9, edgecolor="#cccccc",
           ncol=2, borderpad=0.5, labelspacing=0.3)

# Wind
ax3 = fig.add_subplot(gs[3])
maak_panel(ax3, "Windkracht (Bft)")
ax3.set_title("Wind (max Bft, hoofdstations)", fontsize=9, color="#333333", loc="left", pad=4)
for naam, kleur in HOOFD:
    sd = per_station.get(naam, {})
    bft_list = [sd.get(d, {}).get("bft") for d in alle_dagen_iso]
    xs, bf_s = smooth_serie([np.nan if v is None else v for v in bft_list])
    ax3.plot(xs, bf_s, color=kleur, linewidth=2.0, zorder=5, label=naam)
    pts = [i for i, v in enumerate(bft_list) if v is not None]
    ax3.scatter(pts, [bft_list[i] for i in pts], color=kleur, s=18, zorder=6)
for bft in [6, 7, 8]:
    ax3.axhline(bft, color="#cccccc", linewidth=0.6, linestyle=":", zorder=2)
    ax3.text(len(alle_dagen)-0.1, bft+0.05, f"Bft {bft}", fontsize=6, color="#aaaaaa",
             va="bottom", ha="right")
ax3.set_ylim(0, 12.5); ax3.set_yticks(range(0, 13))
ax3.set_yticklabels([f"Bft {i}" for i in range(0, 13)], fontsize=7)
ax3.set_xticks(x); ax3.set_xticklabels(dag_labels, fontsize=8)
ax3.legend(fontsize=6.5, loc="upper left", framealpha=0.9, edgecolor="#cccccc",
           ncol=2, borderpad=0.5, labelspacing=0.3, handlelength=1.5)
ax3.text(1.0, -0.18, f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}",
         transform=ax3.transAxes, fontsize=6.5, style="italic",
         ha="right", va="bottom", color="#555555")

plt.subplots_adjust(bottom=0.08)
plt.savefig("grafiek_trend.png", dpi=150, bbox_inches="tight")
plt.close()
print("Grafiek opgeslagen: grafiek_trend.png")
