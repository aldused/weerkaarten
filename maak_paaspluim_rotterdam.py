#!/usr/local/bin/python3
import requests, numpy as np, matplotlib, matplotlib.ticker
matplotlib.use("Agg")
import matplotlib.pyplot as plt, matplotlib.dates as mdates
from datetime import datetime, timedelta
import pytz, warnings
warnings.filterwarnings("ignore")

LAT, LON, STATION = 51.96, 4.44, "Rotterdam"
AMS = pytz.timezone("Europe/Amsterdam")
START_NAIVE = datetime(2025, 4, 3,  0, 0)
END_NAIVE   = datetime(2025, 4, 6, 23, 59)
OUTFILE = "/tmp/pluim_rotterdam_pasen.png"

print("Ophalen ECMWF ENS...")
r = requests.get("https://ensemble-api.open-meteo.com/v1/ensemble", params={
    "latitude": LAT, "longitude": LON, "hourly": "temperature_2m",
    "models": "ecmwf_ifs025", "timezone": "Europe/Amsterdam", "forecast_days": 16,
}, timeout=30)
r.raise_for_status()
hourly = r.json()["hourly"]
times_naive = [datetime.fromisoformat(t) for t in hourly["time"]]
mask = [START_NAIVE <= t <= END_NAIVE for t in times_naive]
times = [AMS.localize(t) for t, m in zip(times_naive, mask) if m]
member_keys = sorted([k for k in hourly if k.startswith("temperature_2m_member")])
if not member_keys: member_keys = ["temperature_2m"]
members = []
for k in member_keys:
    vals = np.array([hourly[k][i] if hourly[k][i] is not None else np.nan for i,m in enumerate(mask) if m])
    if not np.all(np.isnan(vals)): members.append(vals)
print(f"  {len(members)} leden, {len(times)} tijdstappen")

print("Ophalen HRES...")
r2 = requests.get("https://api.open-meteo.com/v1/forecast", params={
    "latitude": LAT, "longitude": LON, "hourly": "temperature_2m",
    "models": "ecmwf_ifs", "timezone": "Europe/Amsterdam", "forecast_days": 16,
}, timeout=30)
r2.raise_for_status()
h2 = r2.json()["hourly"]
hn = [datetime.fromisoformat(t) for t in h2["time"]]
mh = [START_NAIVE <= t <= END_NAIVE for t in hn]
hres_times = [AMS.localize(t) for t,m in zip(hn, mh) if m]
hres_temp  = np.array([h2["temperature_2m"][i] if h2["temperature_2m"][i] is not None else np.nan for i,m in enumerate(mh) if m])
print(f"  {len(hres_times)} HRES tijdstappen")

arr = np.array(members)
median = np.nanmedian(arr, axis=0)
p25    = np.nanpercentile(arr, 25, axis=0)
p75    = np.nanpercentile(arr, 75, axis=0)
ymin   = np.nanmin(arr) - 1.5
ymax   = np.nanmax(arr) + 2.5

fig = plt.figure(figsize=(16, 7), facecolor="#1a1a2e")
hax = fig.add_axes([0, 0.94, 1, 0.06])
hax.set_facecolor("#0f3460"); hax.axis("off")
now_str = datetime.now(AMS).strftime("%d %b %Y %H:%M")
hax.text(0.015, 0.5, f"Temperatuurpluim {STATION}  \u2014  Pasen 2025", color="white", fontsize=13, fontweight="bold", va="center", transform=hax.transAxes)
hax.text(0.5,   0.5, "Goede Vrijdag 3 apr  \u2192  2e Paasdag 6 apr", color="#c8d8f0", fontsize=11, va="center", ha="center", transform=hax.transAxes)
hax.text(0.985, 0.5, f"Ed Aldus WM  |  {now_str}", color="#9090aa", fontsize=9, va="center", ha="right", transform=hax.transAxes)

fig.subplots_adjust(top=0.93, bottom=0.11, left=0.06, right=0.98)
ax = fig.add_subplot(111)
ax.set_facecolor("#0d0d1a")
ax.grid(axis="y", color="#2a2a45", lw=0.6, ls="--", zorder=0)
ax.grid(axis="x", color="#252535", lw=0.4, ls=":",  zorder=0)
ax.axhline(0,  color="#7788aa", lw=0.8, zorder=1, alpha=0.7)
ax.axhline(10, color="#cc3333", lw=0.8, ls="--",  zorder=1, alpha=0.6)
ax.text(times[-1], 10.15, "10\u00b0C", color="#cc4444", fontsize=7.5, va="bottom", ha="right", alpha=0.8)

for dag_dt, dag_naam in [
    (AMS.localize(datetime(2025,4,3)), "Goede Vrijdag"),
    (AMS.localize(datetime(2025,4,4)), "Stille Zaterdag"),
    (AMS.localize(datetime(2025,4,5)), "1e Paasdag"),
    (AMS.localize(datetime(2025,4,6)), "2e Paasdag"),
]:
    ax.axvline(dag_dt, color="#445577", lw=1.1, ls="-", zorder=1, alpha=0.7)
    ax.text(dag_dt + timedelta(minutes=30), ymax - 0.2, dag_naam, color="#aabbdd", fontsize=8.5, va="top", ha="left", fontweight="bold")

ax.fill_between(times, p25, p75, color="#33bb33", alpha=0.15, zorder=2, label="IQR (p25\u2013p75)")
for i, member in enumerate(arr):
    ax.plot(times, member, color="#44dd44", lw=0.45, alpha=0.22, zorder=3, label="Ensembleleden" if i==0 else "_")
ax.plot(times, median, color="#ee2222", lw=2.5, zorder=5, label=f"Mediaan  ({len(members)} leden)")
if len(hres_times) > 0:
    ax.plot(hres_times, hres_temp, color="#2299ff", lw=2.0, zorder=6, label="HRES (operationeel)")

ax.set_xlim(times[0], times[-1]); ax.set_ylim(ymin, ymax)
ax.set_ylabel("Temperatuur (\u00b0C)", color="#bbbbcc", fontsize=10, labelpad=8)
ax.tick_params(axis="both", colors="#aaaacc", labelsize=8.5)
for spine in ax.spines.values(): spine.set_edgecolor("#334466")
ax.xaxis.set_major_locator(mdates.HourLocator(byhour=[0,6,12,18], tz=AMS))
ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M\n%a %d %b", tz=AMS))
ax.xaxis.set_minor_locator(mdates.HourLocator(interval=3, tz=AMS))
plt.setp(ax.get_xticklabels(), ha="center", color="#aaaacc", fontsize=8)
ax.yaxis.set_major_locator(matplotlib.ticker.MultipleLocator(2))
ax.yaxis.set_minor_locator(matplotlib.ticker.MultipleLocator(1))
ax.legend(loc="upper right", facecolor="#111126", edgecolor="#334466", labelcolor="#ddddee", fontsize=9, framealpha=0.90)
fig.text(0.5, 0.005, "\u00a9 Ed Aldus Weer en Media  |  kaarten.edaldus.nl", ha="center", color="#555566", fontsize=8)

plt.savefig(OUTFILE, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
plt.close()
print(f"\n  Opgeslagen: {OUTFILE}")
