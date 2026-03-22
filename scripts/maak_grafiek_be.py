import os, requests, zipfile, io, xml.etree.ElementTree as ET, re, json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import numpy as np

stations_temp = [
    ("06451", "Brussel"),
    ("06431", "Gent"),
    ("06450", "Antwerpen"),
    ("06407", "Oostende"),
    ("06478", "Bierset"),
    ("06449", "Charleroi"),
    ("06476", "Sint-Hubert"),
    ("06479", "Kleine Brogel"),
    ("06456", "Florennes"),
]

stations_wind = [
    ("06407", "Oostende"),
    ("06451", "Brussel"),
    ("06478", "Bierset"),
    ("06479", "Kleine Brogel"),
    ("06476", "Sint-Hubert"),
]

KLEUREN = {
    "Brussel":      "#E63946",
    "Gent":         "#457B9D",
    "Antwerpen":    "#2A9D8F",
    "Oostende":     "#E9C46A",
    "Bierset":      "#F4A261",
    "Charleroi":    "#9B5DE5",
    "Sint-Hubert":  "#06D6A0",
    "Kleine Brogel":"#FF6B6B",
    "Florennes":    "#B5179E",
}

nl_dagen   = ["Ma","Di","Wo","Do","Vr","Za","Zo"]
nl_maanden = ["","jan","feb","mrt","apr","mei","jun",
               "jul","aug","sep","okt","nov","dec"]

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
        return ET.fromstring(strip_namespaces(z.read(z.namelist()[0]).decode("utf-8")))
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

def ms_naar_bft(ms):
    for i, g in enumerate([0.3,1.6,3.4,5.5,8.0,10.8,13.9,17.2,20.8,24.5,28.5,32.7]):
        if ms < g: return i
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

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
print("MOSMIX ophalen (trend België)...")
LOCAL_TZ = ZoneInfo("Europe/Amsterdam")

temp_data = {}; rr_data = {}; cache_root = {}

for code, naam in stations_temp:
    print(f"  {naam} ({code})...")
    root = download_kmz(code)
    if root is None: continue
    cache_root[code] = root
    times   = get_times(root)
    tx_raw  = parse_values(root, 'TX')
    tn_raw  = parse_values(root, 'TN')
    ttt_raw = parse_values(root, 'TTT')
    rr_raw  = parse_values(root, 'RR1c')

    daily = {}
    for i, dt_utc in enumerate(times):
        dt_loc = dt_utc.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d = dt_loc.date()
        if d not in daily: daily[d] = {"tx":[], "tn":[], "ttt":[], "rr":[]}
        if i < len(tx_raw)  and tx_raw[i]  is not None: daily[d]["tx"].append(tx_raw[i] - 273.15)
        if i < len(tn_raw)  and tn_raw[i]  is not None: daily[d]["tn"].append(tn_raw[i] - 273.15)
        if i < len(ttt_raw) and ttt_raw[i] is not None: daily[d]["ttt"].append(ttt_raw[i] - 273.15)
        if i < len(rr_raw)  and rr_raw[i]  is not None and rr_raw[i] >= 0: daily[d]["rr"].append(rr_raw[i])

    vandaag = datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()
    td = {}; rd = {}
    for d in sorted(daily.keys()):
        if d < vandaag: continue
        if len(td) >= 10: break
        tx_v = daily[d]["tx"]; tn_v = daily[d]["tn"]; ttt_v = daily[d]["ttt"]
        tx = max(tx_v) if tx_v else (max(ttt_v) if ttt_v else None)
        tn = min(tn_v) if tn_v else (min(ttt_v) if ttt_v else None)
        if tx is not None:
            td[d] = {"tx": round(tx,1), "tn": round(tn,1) if tn is not None else None}
        rd[d] = round(sum(daily[d]["rr"]), 1) if daily[d]["rr"] else 0.0

    temp_data[naam] = td
    rr_data[naam]   = rd

wind_data = {}
for code, naam in stations_wind:
    print(f"  Wind {naam} ({code})...")
    root = cache_root.get(code) or download_kmz(code)
    if root is None: continue
    times  = get_times(root)
    ff_raw = parse_values(root, 'FF')
    daily  = {}
    vandaag = datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()
    for i, dt_utc in enumerate(times):
        dt_loc = dt_utc.replace(tzinfo=timezone.utc).astimezone(LOCAL_TZ)
        d = dt_loc.date()
        if d not in daily: daily[d] = []
        if i < len(ff_raw) and ff_raw[i] is not None: daily[d].append(ff_raw[i])
    wd = {}
    for d in sorted(daily.keys()):
        if d < vandaag: continue
        if len(wd) >= 10: break
        ff_max = max(daily[d]) if daily[d] else None
        if ff_max is not None: wd[d] = ms_naar_bft(ff_max)
    wind_data[naam] = wd

vandaag = datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()
alle_dagen = [d for d in sorted(set(d for sd in temp_data.values() for d in sd.keys())) if d >= vandaag][:7]
x = np.arange(len(alle_dagen))
dag_labels = [f"{nl_dagen[d.weekday()]}\n{d.day} {nl_maanden[d.month]}" for d in alle_dagen]

now_str  = datetime.now().strftime("%d %b %Y  %H:%M")
now_str2 = datetime.now().strftime("%d %b %Y %H:%M")

fig = plt.figure(figsize=(12, 22))
gs = gridspec.GridSpec(4, 1, figure=fig, height_ratios=[0.12, 1, 1, 1], hspace=0.4)

ax_h = fig.add_subplot(gs[0])
ax_h.set_xlim(0,1); ax_h.set_ylim(0,1); ax_h.axis("off")
ax_h.add_patch(plt.Rectangle((0,0),1,1,transform=ax_h.transAxes,facecolor="#003366",zorder=0,clip_on=False))
ax_h.text(0.012, 0.65, "Ed Aldus WM", fontsize=11, color="white", weight="bold", va="center", transform=ax_h.transAxes)
ax_h.text(0.012, 0.25, "MOS ECMWF/ICON", fontsize=7.5, color="#a8c8e8", va="center", transform=ax_h.transAxes)
ax_h.text(0.988, 0.65, "10-daagse verwachting België", fontsize=13, color="white", weight="bold", ha="right", va="center", transform=ax_h.transAxes)
ax_h.text(0.988, 0.25, f"DWD MOSMIX  ·  run: {now_str}", fontsize=7, color="#a8c8e8", ha="right", va="center", transform=ax_h.transAxes)
ax_h.axhline(0, color="#4a90c4", linewidth=1.5)

def smooth(y_list):
    xi = np.array([i for i, v in enumerate(y_list) if v is not None and not np.isnan(v)], dtype=float)
    yi = np.array([v for v in y_list if v is not None and not np.isnan(v)], dtype=float)
    if len(xi) < 3: return xi, yi
    x_smooth = np.linspace(xi[0], xi[-1], 300)
    yi_interp = np.interp(x_smooth, xi, yi)
    sigma = 12
    kernel = np.exp(-0.5 * (np.arange(-30, 31) / sigma)**2); kernel /= kernel.sum()
    return x_smooth, np.convolve(np.pad(yi_interp, 30, mode='edge'), kernel, mode='valid')

ax1 = fig.add_subplot(gs[1])
maak_panel(ax1, "Temperatuur (°C)")
ax1.set_title("Temperatuur", fontsize=9, color="#333333", loc="left", pad=4)
for naam, dag_data in temp_data.items():
    kleur = KLEUREN.get(naam, "#333333")
    tx_list = [dag_data[d]["tx"] if d in dag_data else np.nan for d in alle_dagen]
    tn_list = [dag_data[d]["tn"] if d in dag_data and dag_data[d]["tn"] is not None else np.nan for d in alle_dagen]
    xs, tx_s = smooth(tx_list); _, tn_s = smooth(tn_list)
    ax1.plot(xs, tx_s, color=kleur, linewidth=2.0, zorder=5, label=naam)
    ax1.plot(xs, tn_s, color=kleur, linewidth=1.4, linestyle="--", zorder=4, alpha=0.85)
    ax1.scatter([i for i,v in enumerate(tx_list) if not np.isnan(v)], [v for v in tx_list if not np.isnan(v)], color=kleur, s=18, zorder=6)
    ax1.scatter([i for i,v in enumerate(tn_list) if not np.isnan(v)], [v for v in tn_list if not np.isnan(v)], color=kleur, s=10, zorder=6, alpha=0.85)
ax1.axhline(0, color="#888888", linewidth=0.8, linestyle=":", zorder=3)
ax1.set_xticks(x); ax1.set_xticklabels(dag_labels, fontsize=8)
ax1.legend(fontsize=6.5, loc="lower right", framealpha=0.9, edgecolor="#cccccc", ncol=2, borderpad=0.5, labelspacing=0.3, handlelength=1.5)
ax1.text(0.01, 0.98, "— TX (max)   - - TN (min)", transform=ax1.transAxes, fontsize=7, va="top", color="#555555")

ax2 = fig.add_subplot(gs[2])
maak_panel(ax2, "Neerslag (mm)")
ax2.set_title("Neerslag (dagsom)", fontsize=9, color="#333333", loc="left", pad=4)
n = len(stations_temp); breedte = 0.10
offsets = np.linspace(-(n-1)*breedte/2, (n-1)*breedte/2, n)
for idx, (naam, rd) in enumerate(rr_data.items()):
    ax2.bar(x + offsets[idx], [rd.get(d, 0.0) for d in alle_dagen], width=breedte, color=KLEUREN.get(naam,"#333"), alpha=0.8, zorder=5, label=naam)
ax2.set_xticks(x); ax2.set_xticklabels(dag_labels, fontsize=8); ax2.set_ylim(bottom=0)
ax2.legend(fontsize=6.5, loc="upper right", framealpha=0.9, edgecolor="#cccccc", ncol=2, borderpad=0.5, labelspacing=0.3)

ax3 = fig.add_subplot(gs[3])
maak_panel(ax3, "Windkracht (Bft)")
ax3.set_title("Wind (max Bft)", fontsize=9, color="#333333", loc="left", pad=4)
for naam, wd in wind_data.items():
    kleur = KLEUREN.get(naam, "#333333")
    ff_list = [wd.get(d, np.nan) for d in alle_dagen]
    xs, ff_s = smooth(ff_list)
    ax3.plot(xs, ff_s, color=kleur, linewidth=2.0, zorder=5, label=naam)
    ax3.scatter([i for i,v in enumerate(ff_list) if not np.isnan(v)], [v for v in ff_list if not np.isnan(v)], color=kleur, s=18, zorder=6)
for bft in [6,7,8]:
    ax3.axhline(bft, color="#cccccc", linewidth=0.6, linestyle=":", zorder=2)
    ax3.text(len(alle_dagen)-0.1, bft+0.05, f"Bft {bft}", fontsize=6, color="#aaaaaa", va="bottom", ha="right")
ax3.set_ylim(0, 12.5); ax3.set_yticks(range(0,13))
ax3.set_yticklabels([f"Bft {i}" for i in range(0,13)], fontsize=7)
ax3.set_xticks(x); ax3.set_xticklabels(dag_labels, fontsize=8)
ax3.legend(fontsize=6.5, loc="upper left", framealpha=0.9, edgecolor="#cccccc", ncol=2, borderpad=0.5, labelspacing=0.3, handlelength=1.5)
ax3.text(1.0, -0.18, f"© Ed Aldus | Data: DWD (MOSMIX) | {now_str2}", transform=ax3.transAxes, fontsize=6.5, style="italic", ha="right", va="bottom", color="#555555")

# JSON
json_data = {"gegenereerd": now_str2, "dagen": [d.isoformat() for d in alle_dagen], "dag_labels": dag_labels, "temp": {}, "rr": {}, "wind": {}}
for naam, dag_data in temp_data.items():
    json_data["temp"][naam] = {"kleur": KLEUREN.get(naam,"#333"), "tx": [dag_data[d]["tx"] if d in dag_data else None for d in alle_dagen], "tn": [dag_data[d]["tn"] if d in dag_data and dag_data[d]["tn"] is not None else None for d in alle_dagen]}
for naam, rd in rr_data.items():
    json_data["rr"][naam] = {"kleur": KLEUREN.get(naam,"#333"), "rr": [rd.get(d,0.0) for d in alle_dagen]}
for naam, wd in wind_data.items():
    json_data["wind"][naam] = {"kleur": KLEUREN.get(naam,"#333"), "bft": [wd.get(d,None) for d in alle_dagen]}

with open("grafiek_trend_be.json", "w") as f:
    json.dump(json_data, f)
print("JSON: grafiek_trend_be.json")

plt.subplots_adjust(bottom=0.08)
plt.savefig("grafiek_trend_be.png", dpi=150, bbox_inches="tight")
plt.close()
print("Grafiek: grafiek_trend_be.png")
