"""
kaartarchief.py — Vaste, terug te halen PNG-kaarten per dag, etmaal, week en maand.

  lokdag  Nederlandse kalenderdag 00–24 (23/25 uur rond de klokwissel)
  etmaal  KNMI-neerslagetmaal 08 UTC (d-1) → 08 UTC d, label = einddatum
  week    ISO-week, maandag 00:00 → maandag 00:00 Nederlandse tijd
  maand   kalendermaand in Nederlandse tijd

Elke kaart krijgt een revisie = hash van de dagrevisies die erin zitten. Komt
er later beter gecorrigeerde data (RFCOR vervangt RTCOR), dan verandert die
revisie en wordt de kaart automatisch opnieuw gemaakt — met de bron erop.

Uitvoer: pub/archief/<soort>/<label>.png (1350×1500), …_t.png (360×360) en
pub/archief/index.json. Weergave gelijk aan de website: Mercator, zelfde
kleurenschaal (accumulatie_core.js PALET), bilineair tussen celcentra.

  python3 -m accumulatie.kaartarchief            # alles bijwerken
"""
from __future__ import annotations

import hashlib
import io
import json
import math
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import periode, raster
from .opslag import Archief, VERSIE
from .periode import NL, UTC, umin, van_umin

REPO = Path(__file__).resolve().parent.parent
FONT = "/System/Library/Fonts/Helvetica.ttc"
B, H = 1350, 1800                       # staand; boven en onder vaste banden voor titel en legenda
BAND_BOVEN, BAND_ONDER = 330, 250       # px (bij B=1350); de kaart zelf valt daar nooit onder
SS = 2   # supersampling voor gladde lijnen

PALET = [  # gelijk aan accumulatie_core.js
    (0.00, (205, 232, 255)), (0.035, (140, 200, 250)), (0.09, (56, 140, 235)),
    (0.17, (25, 190, 200)), (0.26, (45, 190, 85)), (0.35, (160, 215, 40)),
    (0.44, (255, 225, 30)), (0.53, (255, 160, 25)), (0.62, (240, 70, 30)),
    (0.71, (215, 30, 110)), (0.80, (190, 45, 210)), (0.90, (120, 45, 195)),
    (1.00, (60, 20, 105)),
]
NETTE_MAXIMA = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000]
DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"]
MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus",
           "september", "oktober", "november", "december"]


def lut(n=1024):
    f = np.linspace(0, 1, n)
    xs = [p[0] for p in PALET]
    return np.stack([np.interp(f, xs, [p[1][c] for p in PALET]) for c in range(3)], 1).round().astype(np.uint8)


LUT = lut()


def auto_schaal(som, tel, masker):
    w = som[(tel > 0) & masker]
    if not w.size:
        return 10
    w = np.sort(w)
    p = w[min(w.size - 1, int(w.size * 0.999))] / 100
    return next((m for m in NETTE_MAXIMA if m >= p), NETTE_MAXIMA[-1])


def schaal_ticks(mx):
    stap = 2 if mx <= 10 else 5 if mx <= 30 else 10 if mx <= 60 else 25 if mx <= 150 else 50 if mx <= 300 else 100
    return list(range(0, int(mx) + 1, stap))


# ── projectie van de kaart ──────────────────────────────────────────────────
def _my(lat):
    return np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))


class View:
    """Mercator-view die 2,9–7,6°O × 50,62–53,72°N in het kader past (als de site)."""

    def __init__(self, w, h, kader=None):
        kx, ky, kw, kh = kader or (0, 0, w, h)
        x0, x1 = math.radians(2.9), math.radians(7.6)
        y0, y1 = float(_my(50.62)), float(_my(53.72))
        self.s = min(kw / (x1 - x0), kh / (y1 - y0))
        self.cx, self.cy = (x0 + x1) / 2, (y0 + y1) / 2
        self.ox, self.oy = kx + kw / 2, ky + kh / 2

    def px(self, lon, lat):
        return (self.ox + (np.radians(lon) - self.cx) * self.s,
                self.oy - (_my(lat) - self.cy) * self.s)

    def lon(self, x):
        return np.degrees((x - self.ox) / self.s + self.cx)

    def lat(self, y):
        return np.degrees(2 * np.arctan(np.exp(self.cy - (y - self.oy) / self.s)) - np.pi / 2)


def veld_rgba(view, w, h, mm, status, mx):
    """RGBA-beeld van het veld: per pixel de cel (bilineair tussen celcentra)."""
    lon = view.lon(np.arange(w) + 0.5)
    lat = view.lat(np.arange(h) + 0.5)
    lam = np.radians(lon)
    rho = raster.A_KM * raster._MC * raster._t(np.radians(lat)) / raster._TC
    r = rho[:, None] * np.cos(lam)[None, :] - raster.ROW_OFF - raster.R0
    k = rho[:, None] * np.sin(lam)[None, :] - raster.COL_OFF - raster.K0
    ri, ki = np.floor(r).astype(int), np.floor(k).astype(int)
    binnen = (ri >= 0) & (ri < raster.NRIJ) & (ki >= 0) & (ki < raster.NKOL)
    ric, kic = np.clip(ri, 0, raster.NRIJ - 1), np.clip(ki, 0, raster.NKOL - 1)
    st = np.where(binnen, status[ric, kic], 0)
    v = mm[ric, kic].astype(np.float64)
    rr, kk = r - 0.5, k - 0.5
    r0, k0 = np.floor(rr).astype(int), np.floor(kk).astype(int)
    ok = (r0 >= 0) & (k0 >= 0) & (r0 + 1 < raster.NRIJ) & (k0 + 1 < raster.NKOL)
    r0c, k0c = np.clip(r0, 0, raster.NRIJ - 2), np.clip(k0, 0, raster.NKOL - 2)
    s4 = (status[r0c, k0c] > 0) & (status[r0c, k0c + 1] > 0) & (status[r0c + 1, k0c] > 0) & (status[r0c + 1, k0c + 1] > 0)
    fr, fk = rr - r0c, kk - k0c
    bil = (mm[r0c, k0c] * (1 - fk) + mm[r0c, k0c + 1] * fk) * (1 - fr) + \
          (mm[r0c + 1, k0c] * (1 - fk) + mm[r0c + 1, k0c + 1] * fk) * fr
    v = np.where(ok & s4, bil, v)
    out = np.zeros((h, w, 4), np.uint8)
    nat = (st > 0) & (v >= 0.1)
    li = np.minimum(1023, (v / mx * 1023).astype(int))
    out[nat, :3] = LUT[li[nat]]
    # zacht uitlopen over de laatste 8 cellen van het radargebied (geen harde schuine rand)
    rand = np.clip(np.minimum.reduce([r, raster.NRIJ - r, k, raster.NKOL - k]) / 8.0, 0, 1)
    out[nat, 3] = (235 * rand[nat]).astype(np.uint8)
    geen = binnen & (st == 0)
    out[geen] = (150, 150, 150, 120)
    return out


def _ringen(geo):
    for f in geo.get("features", [geo]):
        g = f.get("geometry", f)
        if not g:
            continue
        t, c = g["type"], g["coordinates"]
        if t == "Polygon":
            yield "poly", c
        elif t == "MultiPolygon":
            for p in c:
                yield "poly", p
        elif t == "LineString":
            yield "lijn", [c]
        elif t == "MultiLineString":
            yield "lijn", c


def teken_geo(draw, geo, view, vul=None, lijn=None, breedte=1, gat=None):
    """gat: vulkleur voor binnenringen (bv. transparant op een aparte laag: eilanden in rivieren)."""
    for soort, ringen in _ringen(geo):
        for i, ring in enumerate(ringen):
            a = np.asarray(ring, dtype=float)
            if a.ndim != 2 or len(a) < 2:
                continue
            x, y = view.px(a[:, 0], a[:, 1])
            pts = list(zip(x.tolist(), y.tolist()))
            if soort == "poly" and vul is not None:
                draw.polygon(pts, fill=vul if i == 0 else gat)
            if lijn is not None:
                draw.line(pts + ([pts[0]] if soort == "poly" else []), fill=lijn, width=breedte, joint="curve")


_GEO = {}


def geo(naam):
    if naam not in _GEO:
        _GEO[naam] = json.loads((REPO / naam).read_text())
    return _GEO[naam]


def font(grootte, vet=False):
    return ImageFont.truetype(FONT, int(grootte), index=1 if vet else 0)


def nl_tijd(dt):
    l = dt.astimezone(NL)
    return f"{DAGEN[l.weekday()]} {l.day} {MAANDEN[l.month - 1]} {l.year} {l.hour:02d}:{l.minute:02d}"


def toplijst(som, tel, masker, n, min_km):
    idx = np.flatnonzero((tel.ravel() > 0) & masker.ravel() & (som.ravel() > 0))
    idx = idx[np.argsort(-som.ravel()[idx], kind="stable")][:20000]
    gekozen = []
    for c in idx:
        r, k = divmod(int(c), raster.NKOL)
        lon, lat = raster.celcentrum_lonlat(r, k)
        kk = float(raster.schaalfactor_k(lat))
        if all(math.hypot(g[0] - r, g[1] - k) / kk >= min_km for g in gekozen):
            gekozen.append((r, k, float(lon), float(lat), int(som.ravel()[c])))
            if len(gekozen) >= n:
                break
    return gekozen


_PLAATSEN = None


RICHTING = ["N", "NO", "O", "ZO", "Z", "ZW", "W", "NW"]


def locatie_naam(lon, lat, km=2):
    """Plaatsnaam alleen binnen km van het punt, anders "11 km N van Pieterburen" (nooit een provincienaam)."""
    naam = plaats_bij(lon, lat, km)
    if naam:
        return naam
    global _PLAATSEN
    cl = math.cos(math.radians(lat))
    best = min(_PLAATSEN, key=lambda p: ((p["lon"] - lon) * cl * 111.32) ** 2 + ((p["lat"] - lat) * 110.57) ** 2)
    dx, dy = (lon - best["lon"]) * cl * 111.32, (lat - best["lat"]) * 110.57
    hoek = (math.degrees(math.atan2(dx, dy)) + 360) % 360
    return f"{round(math.hypot(dx, dy))} km {RICHTING[round(hoek / 45) % 8]} van {best['naam']}"


def plaats_bij(lon, lat, max_km=8):
    global _PLAATSEN
    if _PLAATSEN is None:
        d = json.loads((REPO / "plaatsen_lookup.json").read_text())["plaatsen"]
        _PLAATSEN = [p for p in d if p.get("land") == "NL"]
    cl = math.cos(math.radians(lat))
    best, bd = None, 1e9
    for p in _PLAATSEN:
        dd = ((p["lon"] - lon) * cl * 111.32) ** 2 + ((p["lat"] - lat) * 110.57) ** 2
        if dd < bd:
            best, bd = p, dd
    return best["naam"] if best and math.sqrt(bd) <= max_km else None


LAGEN = {
    "ruw": ("Neerslagaccumulatie Nederland", None),
    "bijgesteld": ("Neerslagaccumulatie Nederland", "Radar bijgesteld met regenmeters"),
}


def render(v, titel, sub, gebieden, verwerkt: datetime, laag: str = "ruw") -> bytes:
    """PNG (bytes) van veld v met titel, periode, legenda, maxima en bron."""
    W, Hh = B * SS, H * SS
    view = View(W, Hh, (0, BAND_BOVEN * SS, W, Hh - (BAND_BOVEN + BAND_ONDER) * SS))
    img = Image.new("RGBA", (W, Hh), (200, 221, 229, 255))
    d = ImageDraw.Draw(img)
    teken_geo(d, geo("basemap/europa_land.json"), view, vul=(241, 240, 232, 255))
    teken_geo(d, geo("nl_land_detail.geojson"), view, vul=(241, 240, 232, 255))
    teken_geo(d, geo("nl_meren.geojson"), view, vul=(200, 221, 229, 255))
    mm = v.som.astype(np.float64) / 100
    status = np.where(v.telling == 0, 0, np.where(v.telling < v.verwacht, 2, 1)).astype(np.uint8)
    nl = (gebieden & 15) > 0
    mx = auto_schaal(v.som, v.telling, nl)
    veld = Image.fromarray(veld_rgba(view, W, Hh, mm, status, mx))
    img = Image.alpha_composite(img, veld)
    # rivieren (TOP10NL) als water over het veld, daarna lijnen — elk uit één bron, zodat er
    # nergens dubbele grenzen ontstaan (zie de toelichting in neerslagaccumulatie.js)
    if (REPO / "nl_rivieren_top10nl.geojson").exists():
        water = Image.new("RGBA", img.size, (0, 0, 0, 0))
        teken_geo(ImageDraw.Draw(water), geo("nl_rivieren_top10nl.geojson"), view, vul=(200, 221, 229, 158), gat=(0, 0, 0, 0))
        img = Image.alpha_composite(img, water)
    d = ImageDraw.Draw(img)
    teken_geo(d, geo("accumulatie_provinciegrenzen.json"), view, lijn=(40, 55, 62, 115), breedte=2)
    teken_geo(d, geo("accumulatie_grenzen.json"), view, lijn=(40, 55, 62, 190), breedte=3)
    teken_geo(d, geo("nl_land_detail.geojson"), view, lijn=(30, 45, 52, 215), breedte=2)
    img = img.resize((B, H), Image.LANCZOS)
    # miniatuur uit de kale kaart (zonder tekstvakken): vierkant rond Nederland
    x0, y0 = view.px(3.25, 53.65)
    x1, y1 = view.px(7.3, 50.7)
    zijde = max(x1 - x0, y1 - y0) / SS
    cx, cy = (x0 + x1) / 2 / SS, (y0 + y1) / 2 / SS
    kaal = img.crop((int(cx - zijde / 2), int(cy - zijde / 2), int(cx + zijde / 2), int(cy + zijde / 2)))
    kaal = kaal.convert("RGB").resize((360, 360), Image.LANCZOS)
    tbuf = io.BytesIO()
    kaal.save(tbuf, "PNG", optimize=True)
    # posterlayout: kaart alleen in het middenvlak, banden effen (titel en legenda staan nooit over de kaart)
    ImageDraw.Draw(img).rectangle([0, 0, B, BAND_BOVEN], fill=(246, 248, 251, 255))
    ImageDraw.Draw(img).rectangle([0, H - BAND_ONDER, B, H], fill=(246, 248, 251, 255))
    d = ImageDraw.Draw(img)
    u = B / 1080
    # 5 natste plekken; labels nooit in de titel-/legendaband of over elkaar
    top = toplijst(v.som, v.telling, nl, 5, 25)
    f = font(21 * u, True)
    bezet = [(0, 0, B, BAND_BOVEN), (0, H - BAND_ONDER, B, H)]
    for r, k, lon, lat, s in top:
        x, y = view.px(lon, lat)
        x, y = float(x) / SS, float(y) / SS
        t = f"{locatie_naam(lon, lat)}  {s / 100:.0f} mm"
        tw, th = d.textlength(t, font=f), 26 * u
        stip = (x - 6 * u, y - 6 * u, x + 6 * u, y + 6 * u)
        if any(stip[0] < b[2] and stip[2] > b[0] and stip[1] < b[3] and stip[3] > b[1] for b in bezet):
            continue
        for ax, ay, anker in ((x + 10 * u, y, "lm"), (x - 10 * u, y, "rm"), (x + 6 * u, y - th, "lm"), (x + 6 * u, y + th, "lm")):
            vak = (ax, ay - th / 2, ax + tw, ay + th / 2) if anker == "lm" else (ax - tw, ay - th / 2, ax, ay + th / 2)
            if vak[0] < 6 or vak[2] > B - 6 or any(vak[0] < b[2] and vak[2] > b[0] and vak[1] < b[3] and vak[3] > b[1] for b in bezet):
                continue
            bezet += [vak, stip]
            d.ellipse([x - 5 * u, y - 5 * u, x + 5 * u, y + 5 * u], fill=(17, 17, 17, 255))
            d.text((ax, ay), t, font=f, fill=(17, 17, 17, 255), anchor=anker,
                   stroke_width=int(3 * u), stroke_fill=(255, 255, 255, 230))
            break                          # past het nergens: stip én label weg (geen losse stippen)
    # tekstblok
    bx, by = 40 * u, 40 * u
    kop, laaglabel = LAGEN[laag]
    extra = 34 * u if laaglabel else 0
    hoogte = 86 * u + len(sub) * 26 * u + (34 * u if top else 0) + 4 * u + extra
    d.rounded_rectangle([bx - 18 * u, by - 18 * u, bx + 640 * u, by + hoogte], 12 * u, fill=(255, 255, 255, 228))
    d.text((bx, by), kop, font=font(36 * u, True), fill=(0, 32, 91, 255))
    if laaglabel:
        tw = d.textlength(laaglabel, font=font(20 * u, True))
        d.rounded_rectangle([bx - 4 * u, by + 46 * u, bx + tw + 8 * u, by + 74 * u], 5 * u, fill=(3, 94, 122, 255))
        d.text((bx + 2 * u, by + 60 * u), laaglabel, font=font(20 * u, True), fill=(255, 255, 255, 255), anchor="lm")
        by += extra
    d.text((bx, by + 50 * u), titel, font=font(26 * u, True), fill=(15, 23, 42, 255))
    yy = by + 86 * u
    for regel in sub:
        d.text((bx, yy), regel, font=font(19 * u), fill=(51, 65, 85, 255))
        yy += 26 * u
    if top:
        pb = locatie_naam(top[0][2], top[0][3])
        d.text((bx, yy + 4 * u), f"Hoogste som: {top[0][4] / 100:.1f} mm".replace(".", ",") + (f", {pb}" if " van " in pb else f" bij {pb}"),
               font=font(20 * u, True), fill=(15, 23, 42, 255))
    # legenda
    lw, lx, ly = 720 * u, 40 * u, H - 150 * u
    d.rounded_rectangle([lx - 18 * u, ly - 44 * u, lx + lw + 18 * u, ly + 70 * u], 12 * u, fill=(255, 255, 255, 228))
    d.text((lx, ly - 34 * u), "Neerslagsom (mm)", font=font(18 * u, True), fill=(0, 32, 91, 255))
    for x in range(int(lw)):
        c = LUT[min(1023, int(x / (lw - 1) * 1023))]
        d.line([(lx + x, ly), (lx + x, ly + 20 * u)], fill=tuple(int(t) for t in c) + (255,))
    for t in schaal_ticks(mx):
        d.text((lx + t / mx * lw, ly + 28 * u), str(t), font=font(16 * u), fill=(51, 65, 85, 255), anchor="ma")
    # bron
    if v.aanwezig == 0:
        bron = "geen radardata"
    elif v.n_rf == v.aanwezig:
        bron = "KNMI-radar finaal gecorrigeerd (RFCOR)"
    elif v.n_rf == 0:
        bron = "KNMI-radar realtime gecorrigeerd (RTCOR)"
    else:
        bron = f"KNMI-radar {round(100 * v.n_rf / v.aanwezig)}% finaal (RFCOR), rest realtime (RTCOR)"
    if laag == "bijgesteld" and v.aanwezig:
        if v.n_rf == v.aanwezig:
            bron += " — al door KNMI met meters gecorrigeerd, geen extra bijstelling"
        else:
            bron += (", realtime-deel" if v.n_rf else "") + " bijgesteld met KNMI-regenmeters (Weerlab)"
    regel = (f"Bron: {bron} · radarschatting · productversie {VERSIE} · "
             f"verwerkt {verwerkt.astimezone(NL):%d-%m-%Y %H:%M} · weerlab.nl")
    fb = font(14 * u)
    tw = d.textlength(regel, font=fb)
    d.rounded_rectangle([B - tw - 36 * u, H - 42 * u, B - 12 * u, H - 12 * u], 6 * u, fill=(255, 255, 255, 228))
    d.text((B - tw - 24 * u, H - 27 * u), regel, font=fb, fill=(51, 65, 85, 255), anchor="lm")
    if v.aanwezig < v.verwacht:
        d.text((lx, ly - 70 * u), f"Let op: onvolledig ({v.aanwezig}/{v.verwacht} tijdstappen) — minimumwaarden",
               font=font(17 * u, True), fill=(180, 83, 9, 255))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "PNG", optimize=True)
    return buf.getvalue(), top, mx, tbuf.getvalue()


def miniatuur(png: bytes) -> bytes:
    im = Image.open(io.BytesIO(png))
    w, h = im.size
    # vierkante uitsnede rond Nederland (zonder tekstblokken)
    vak = im.crop((int(w * 0.08), int(h * 0.12), int(w * 0.92), int(h * 0.12 + w * 0.84))).resize((360, 360), Image.LANCZOS)
    buf = io.BytesIO()
    vak.save(buf, "PNG", optimize=True)
    return buf.getvalue()


# ── welke kaarten ───────────────────────────────────────────────────────────
def producten(eerste: date, laatste: datetime, begin_archief: datetime | None = None):
    """Alle complete producten binnen het archief: (soort, label, titel, begin, eind)."""
    uit = []
    begin_archief = begin_archief or datetime(eerste.year, eerste.month, eerste.day, tzinfo=UTC)
    d = eerste
    while True:
        b, e = periode.lokdag_grenzen(d)
        if e > laatste:
            break
        if b >= begin_archief:
            uit.append(("lokdag", f"{d:%Y%m%d}", f"{DAGEN[d.weekday()].capitalize()} {d.day} {MAANDEN[d.month - 1]} {d.year}", b, e))
        d += timedelta(days=1)
    d = eerste + timedelta(days=1)
    while True:
        bl = periode.etmaalblok(d)
        if bl.eind > laatste:
            break
        if bl.begin < begin_archief:
            d += timedelta(days=1)
            continue
        v = d - timedelta(days=1)
        uit.append(("etmaal", f"{d:%Y%m%d}", f"Etmaal {v.day} {MAANDEN[v.month - 1][:3]} – {d.day} {MAANDEN[d.month - 1][:3]} {d.year} (08–08 UTC)", bl.begin, bl.eind))
        d += timedelta(days=1)
    m = eerste - timedelta(days=eerste.weekday())
    while True:
        b, _ = periode.lokdag_grenzen(m)
        e, _ = periode.lokdag_grenzen(m + timedelta(days=7))
        if e > laatste:
            break
        if b >= begin_archief:
            j, w, _ = m.isocalendar()
            zo = m + timedelta(days=6)
            uit.append(("week", f"{j}-W{w:02d}", f"Week {w}: {m.day} {MAANDEN[m.month - 1][:3]} – {zo.day} {MAANDEN[zo.month - 1][:3]} {zo.year}", b, e))
        m += timedelta(days=7)
    j, mnd = eerste.year, eerste.month
    while True:
        b, _ = periode.lokdag_grenzen(date(j, mnd, 1))
        nj, nm = (j + 1, 1) if mnd == 12 else (j, mnd + 1)
        e, _ = periode.lokdag_grenzen(date(nj, nm, 1))
        if e > laatste:
            break
        if b >= begin_archief:
            uit.append(("maand", f"{j}{mnd:02d}", f"{MAANDEN[mnd - 1].capitalize()} {j}", b, e))
        j, mnd = nj, nm
    return uit


def werk_bij(arch: Archief, _gewijzigd=None, laatste: datetime | None = None, forceer=False, laag="ruw"):
    import gzip as _gz  # noqa: F401
    idx = arch.lees_index()
    dagen = idx.get("dagen", {})
    if not dagen:
        return []
    if laatste is None:
        laatste = datetime.strptime(idx["laatste"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=UTC)
    if "begin_archief" not in idx:
        return []
    begin_archief = datetime.strptime(idx["begin_archief"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=UTC)
    eerste = begin_archief.date()
    from .opslag import standaard_map
    gebieden = np.frombuffer(__import__("gzip").decompress((standaard_map() / "pub/raster/gebieden.u8.gz").read_bytes()),
                             np.uint8).reshape(raster.NRIJ, raster.NKOL)
    ai_pad = arch.pub / "archief" / "index.json"
    ai = json.loads(ai_pad.read_text()) if ai_pad.exists() else {"kaarten": []}
    bestaand = {(k["soort"], k["label"]): k for k in ai["kaarten"]}
    gemaakt = []
    verwerkt = datetime.now(UTC)
    for soort, label, titel, b, e in producten(eerste - timedelta(days=1), laatste, begin_archief):
        revs = []
        t = b
        while t < e:
            revs.append(dagen.get(f"{t:%Y%m%d}", {}).get("rev", "x"))
            t += timedelta(days=1)
        revs.append(dagen.get(f"{(e - timedelta(minutes=5)):%Y%m%d}", {}).get("rev", "x"))
        rev = hashlib.sha1("".join(revs).encode()).hexdigest()[:10]
        oud = bestaand.get((soort, label))
        png_rel = f"archief/{soort}/{label}.png"
        if not forceer and oud and oud.get("rev") == rev and (arch.pub / png_rel).exists():
            continue
        try:
            v = arch.som_periode(b, e)
        except ValueError:
            continue
        uren = (e - b) / timedelta(hours=1)
        sub = [f"{nl_tijd(b)} – {nl_tijd(e)}", f"{uren:.0f} uur · Nederlandse tijd" if soort != "etmaal"
               else "neerslagetmaal 08–08 UTC"]
        png, top, mx, mini = render(v, titel, sub, gebieden, verwerkt, laag)
        arch.schrijf_pub(png_rel, png)
        arch.schrijf_pub(f"archief/{soort}/{label}_t.png", mini)
        nl = (gebieden & 15) > 0
        bestaand[(soort, label)] = {
            "soort": soort, "label": label, "titel": titel, "begin": f"{b:%Y-%m-%dT%H:%MZ}",
            "eind": f"{e:%Y-%m-%dT%H:%MZ}", "png": png_rel, "thumb": f"archief/{soort}/{label}_t.png",
            "rev": rev, "max": top[0][4] if top else 0,
            "maxplaats": locatie_naam(top[0][2], top[0][3]) if top else None,
            "compleet": v.aanwezig == v.verwacht and bool((v.telling[nl] == v.verwacht).all()),
            "rf": v.n_rf, "rt": v.n_rt, "frames": v.aanwezig, "verwacht": v.verwacht,
            "schaal": mx, "gemaakt": f"{verwerkt:%Y-%m-%dT%H:%MZ}",
        }
        gemaakt.append(f"{soort}:{label}")
    ai["kaarten"] = sorted(bestaand.values(), key=lambda k: (k["soort"], k["label"]))
    ai["bijgewerkt"] = f"{verwerkt:%Y-%m-%dT%H:%MZ}"
    arch.schrijf_pub("archief/index.json", json.dumps(ai, ensure_ascii=False, separators=(",", ":")).encode())
    return gemaakt


if __name__ == "__main__":
    import sys
    if "--bijgesteld" in sys.argv:
        from .bijgesteld import adj_map
        a = Archief(adj_map())
        print(werk_bij(a, forceer="--forceer" in sys.argv, laag="bijgesteld"))
    else:
        a = Archief()
        print(werk_bij(a, forceer="--forceer" in sys.argv))
    a.bewaar_wachtrij()
