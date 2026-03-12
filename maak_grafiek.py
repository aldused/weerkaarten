import os
import requests
import zipfile
import io
import xml.etree.ElementTree as ET
import re
from datetime import datetime, timedelta
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import matplotlib.dates as mdates
import numpy as np

# ── STATIONS ──────────────────────────────────────────────────────────────────
stations = [
    ("06260", "De Bilt"),
    ("06235", "De Kooy"),
    ("06280", "Eelde"),
    ("06310", "Vlissingen"),
    ("06380", "Beek"),
    ("06344", "Rotterdam"),
    ("06330", "Hoek v. Holland"),
]

KLEUREN = {
    "De Bilt":        "#E63946",
    "De Kooy":        "#457B9D",
    "Eelde":          "#2A9D8F",
    "Vlissingen":     "#E9C46A",
    "Beek":           "#F4A261",
    "Rotterdam":      "#9B5DE5",
    "Hoek v. Holland":"#06D6A0",
}

nl_dagen   = ["Ma","Di","Wo","Do","Vr","Za","Zo"]
nl_maanden = ["","jan","feb","mrt","apr","mei","jun",
               "jul","aug","sep","okt","nov","dec"]

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

# ── DATA OPHALEN ──────────────────────────────────────────────────────────────
os.chdir(os.path.dirname(os.path.abspath(__file__)))
print("MOSMIX ophalen (trend)...")

UTC_OFFSET = timedelta(hours=1)
alle_data = {}  # {naam: {date: {"tx": float, "tn": float}}}

for code, naam in stations:
    print(f"  {naam} ({code})...")
    root = download_kmz(code)
    if root is None: continue
    times  = get_times(root)
    tx_raw = parse_values(root, 'TX')
    tn_raw = parse_values(root, 'TN')
    ttt_raw = parse_values(root, 'TTT')  # uurtemperatuur als fallback

    daily = {}
    for i, dt_utc in enumerate(times):
        dt_loc = dt_utc + UTC_OFFSET
        d = dt_loc.date()
        if d not in daily:
            daily[d] = {"tx_vals": [], "tn_vals": [], "ttt_vals": []}
        if i < len(tx_raw)  and tx_raw[i]  is not None: daily[d]["tx_vals"].append(tx_raw[i] - 273.15)
        if i < len(tn_raw)  and tn_raw[i]  is not None: daily[d]["tn_vals"].append(tn_raw[i] - 273.15)
        if i < len(ttt_raw) and ttt_raw[i] is not None: daily[d]["ttt_vals"].append(ttt_raw[i] - 273.15)

    dag_data = {}
    for d in sorted(daily.keys())[:11]:
        tx_v = daily[d]["tx_vals"]
        tn_v = daily[d]["tn_vals"]
        ttt_v = daily[d]["ttt_vals"]
        tx = max(tx_v) if tx_v else (max(ttt_v) if ttt_v else None)
        tn = min(tn_v) if tn_v else (min(ttt_v) if ttt_v else None)
        if tx is not None and tn is not None:
            dag_data[d] = {"tx": round(tx, 1), "tn": round(tn, 1)}

    alle_data[naam] = dag_data

# ── GRAFIEK ───────────────────────────────────────────────────────────────────
# Gemeenschappelijke datums (aanwezig in minstens 1 station)
alle_dagen = sorted(set(d for sd in alle_data.values() for d in sd.keys()))[:10]

now_str = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

fig = plt.figure(figsize=(12, 7))
gs = gridspec.GridSpec(2, 1, figure=fig, height_ratios=[0.07, 1], hspace=0.01)

# ── Header ──
ax_h = fig.add_subplot(gs[0])
ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,
               facecolor="#003366",zorder=0,clip_on=False))
ax_h.text(0.012, 0.58, "Ed Aldus WM", fontsize=11, color="white",
          weight="bold", va="center", transform=ax_h.transAxes)
ax_h.text(0.012, 0.18, "MOS ECMWF/ICON", fontsize=7.5, color="#a8c8e8",
          va="center", transform=ax_h.transAxes)
ax_h.text(0.988, 0.62, "10-daagse temperatuurverwachting",
          fontsize=13, color="white", weight="bold",
          ha="right", va="center", transform=ax_h.transAxes)
ax_h.text(0.988, 0.18, f"DWD MOSMIX  ·  run: {now_str}",
          fontsize=7, color="#a8c8e8", ha="right", va="center",
          transform=ax_h.transAxes)
ax_h.axhline(0, color="#4a90c4", linewidth=1.5)

# ── Grafiekpaneel ──
ax = fig.add_subplot(gs[1])
ax.set_facecolor("#f8f8f8")
ax.grid(axis="y", color="#dddddd", linewidth=0.7, zorder=0)
ax.grid(axis="x", color="#eeeeee", linewidth=0.5, zorder=0)

x = np.arange(len(alle_dagen))

for naam, dag_data in alle_data.items():
    kleur = KLEUREN.get(naam, "#333333")
    tx_list = [dag_data[d]["tx"] if d in dag_data else np.nan for d in alle_dagen]
    tn_list = [dag_data[d]["tn"] if d in dag_data else np.nan for d in alle_dagen]

    ax.plot(x, tx_list, color=kleur, linewidth=2.0, marker="o",
            markersize=4, zorder=5, label=naam)
    ax.plot(x, tn_list, color=kleur, linewidth=1.4, marker="o",
            markersize=3, linestyle="--", zorder=4, alpha=0.85)

# Nullijn
ax.axhline(0, color="#888888", linewidth=0.8, linestyle=":", zorder=3)

# X-as labels: dag + datum
dag_labels = []
for d in alle_dagen:
    dag_labels.append(f"{nl_dagen[d.weekday()]}\n{d.day} {nl_maanden[d.month]}")
ax.set_xticks(x)
ax.set_xticklabels(dag_labels, fontsize=8.5)

ax.set_ylabel("Temperatuur (°C)", fontsize=9, color="#444444")
ax.tick_params(axis="y", labelsize=8.5, colors="#444444")
ax.tick_params(axis="x", colors="#444444")
for spine in ["top","right"]: ax.spines[spine].set_visible(False)
ax.spines["left"].set_color("#cccccc")
ax.spines["bottom"].set_color("#cccccc")

# Legenda (TX = vol, TN = gestippeld uitleg)
handles, labels = ax.get_legend_handles_labels()
leg = ax.legend(handles, labels, fontsize=6.5, loc="lower right",
                framealpha=0.9, edgecolor="#cccccc", ncol=2,
                borderpad=0.5, labelspacing=0.3, handlelength=1.5)
# Extra uitleg TX/TN
ax.text(0.01, 0.98, "— TX (max)   - - TN (min)",
        transform=ax.transAxes, fontsize=7, va="top", color="#555555")

ax.text(1.0, -0.10, f"Bron: Ed Aldus / DWD Deutscher Wetterdienst | {now_str2}",
        transform=ax.transAxes, fontsize=6.5, style="italic",
        ha="right", va="bottom", color="#555555")

plt.tight_layout(rect=[0, 0, 1, 1])
fname = "grafiek_trend.png"
plt.savefig(fname, dpi=150, bbox_inches="tight")
plt.close()
print(f"Grafiek: {fname}")
