#!/usr/bin/env python3
"""
Temperatuurpluimen ECMWF ENS – Rhoon, Rotterdam, Barendrecht
Ed Aldus WM Nederland & België
"""

import requests
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime
from zoneinfo import ZoneInfo

# ── Instellingen ────────────────────────────────────────────────────────────

STATIONS = [
    {"naam": "Rhoon",        "lat": 51.858, "lon": 4.415},
    {"naam": "Rotterdam",    "lat": 51.923, "lon": 4.479},
    {"naam": "Barendrecht",  "lat": 51.856, "lon": 4.535},
]

FORECAST_DAYS = 16
MODEL         = "ecmwf_ifs04"
TIMEZONE      = "Europe/Amsterdam"
OUTPUT        = "pluim_temperatuur_rijnmond.png"

# ── Data ophalen ─────────────────────────────────────────────────────────────

def haal_data(lat, lon):
    url = "https://ensemble-api.open-meteo.com/v1/ensemble"
    params = {
        "latitude":      lat,
        "longitude":     lon,
        "models":        MODEL,
        "hourly":        "temperature_2m",
        "forecast_days": FORECAST_DAYS,
        "timezone":      TIMEZONE,
    }
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    return r.json()

def parse_data(data):
    """Geeft (tijden, members_array, hres_array) terug.
    members_array: shape (n_members, n_tijden) – alle ENS members
    hres_array:    shape (n_tijden,)             – member_0 = control/HRES
    """
    hourly = data["hourly"]
    tz     = ZoneInfo(TIMEZONE)
    tijden = [datetime.fromisoformat(t).replace(tzinfo=tz) for t in hourly["time"]]

    member_keys = sorted(
        [k for k in hourly if k.startswith("temperature_2m_member")],
        key=lambda k: int(k.split("member")[1])
    )
    # member_0 = control run (HRES-equivalent)
    hres    = np.array(hourly.get("temperature_2m_member00",
                                   hourly[member_keys[0]]), dtype=float)

    members = np.array([hourly[k] for k in member_keys], dtype=float)

    return tijden, members, hres

# ── Plotten ──────────────────────────────────────────────────────────────────

def bereken_runtime():
    """Schat ECMWF run-tijd (00Z of 12Z, ~9 uur vertraging)."""
    now  = datetime.now(ZoneInfo("UTC"))
    hour = now.hour
    if hour >= 21:
        run = now.replace(hour=12, minute=0, second=0, microsecond=0)
    elif hour >= 9:
        run = now.replace(hour=0,  minute=0, second=0, microsecond=0)
    else:
        from datetime import timedelta
        run = (now - timedelta(days=1)).replace(hour=12, minute=0, second=0, microsecond=0)
    return run.strftime("ECMWF ENS  run %d %b %H:%M UTC")

def maak_pluim():
    fig, axes = plt.subplots(
        len(STATIONS), 1,
        figsize=(14, 4.5 * len(STATIONS)),
        facecolor="#1a1a2e"
    )
    if len(STATIONS) == 1:
        axes = [axes]

    run_label = bereken_runtime()
    now_local = datetime.now(ZoneInfo(TIMEZONE))

    for ax, station in zip(axes, STATIONS):
        print(f"  Ophalen: {station['naam']} …", end=" ", flush=True)
        data = haal_data(station["lat"], station["lon"])
        tijden, members, hres = parse_data(data)
        print("OK")

        # Mediaan
        mediaan = np.nanmedian(members, axis=0)

        ax.set_facecolor("#0f0f23")

        # Alle ENS members (groen, dun, transparant)
        for i, member in enumerate(members):
            ax.plot(tijden, member,
                    color="#00cc44", linewidth=0.4, alpha=0.25,
                    label="ENS members" if i == 0 else "")

        # Mediaan (rood)
        ax.plot(tijden, mediaan,
                color="#ff4444", linewidth=1.8, zorder=4, label="Mediaan")

        # HRES / control (blauw)
        ax.plot(tijden, hres,
                color="#44aaff", linewidth=1.6, zorder=5, label="Control run")

        # Verticale lijn = nu
        ax.axvline(now_local, color="white", linewidth=1.0,
                   linestyle="--", alpha=0.6, zorder=6)

        # 0°C lijn
        ax.axhline(0, color="#aaaaaa", linewidth=0.7, linestyle=":", alpha=0.6)

        # Assen
        ax.set_xlim(tijden[0], tijden[-1])
        ax.xaxis.set_major_locator(mdates.DayLocator(interval=2, tz=ZoneInfo(TIMEZONE)))
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%-d %b", tz=ZoneInfo(TIMEZONE)))
        ax.tick_params(colors="white", labelsize=9)
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:.0f}°"))
        for spine in ax.spines.values():
            spine.set_edgecolor("#444466")

        # Titel station
        ax.set_title(station["naam"], color="white", fontsize=13,
                     fontweight="bold", loc="left", pad=6)

        # y-label
        ax.set_ylabel("Temperatuur (°C)", color="#aaaacc", fontsize=9)

        # Legenda (alleen eerste panel)
        if station is STATIONS[0]:
            leg = ax.legend(loc="upper right", fontsize=8,
                            facecolor="#1a1a2e", edgecolor="#444466",
                            labelcolor="white")

        ax.grid(axis="x", color="#333355", linewidth=0.5, linestyle="-")
        ax.grid(axis="y", color="#333355", linewidth=0.5, linestyle="-")

    # ── Header ────────────────────────────────────────────────────────────────
    fig.add_axes([0, 0.97, 1, 0.03])
    ax_hdr = fig.axes[-1]
    ax_hdr.set_facecolor("#16213e")
    ax_hdr.axis("off")
    ax_hdr.text(0.01, 0.5,
                f"Temperatuurpluim  ·  Rijnmond  ·  {run_label}",
                color="white", fontsize=10, fontweight="bold",
                va="center", ha="left", transform=ax_hdr.transAxes)
    ax_hdr.text(0.99, 0.5,
                "Ed Aldus WM Nederland & België  ·  kaarten.edaldus.nl",
                color="#aaaacc", fontsize=8,
                va="center", ha="right", transform=ax_hdr.transAxes)

    fig.subplots_adjust(top=0.96, bottom=0.04, hspace=0.35)

    fig.savefig(OUTPUT, dpi=150, bbox_inches="tight",
                facecolor=fig.get_facecolor())
    print(f"\n✓ Opgeslagen als: {OUTPUT}")
    plt.close(fig)

# ── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"Temperatuurpluimen genereren voor {len(STATIONS)} stations …\n")
    maak_pluim()
