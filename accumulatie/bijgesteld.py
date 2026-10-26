"""
bijgesteld.py — Archief en pijplijn voor de laag "radar bijgesteld met regenmeters".

Een tweede, volledig gescheiden archief (standaard
~/Library/Application Support/weerlab/accumulatie_bijgesteld, R2-prefix
'accumulatie-bijgesteld/') met exact dezelfde structuur als het ruwe archief.
Zijn 5-minutenframes zijn de ruwe KNMI-frames × het factorveld van hun
neerslagetmaal (bijstellen.py). Alle blokken, presets, uurreeksen en
archiefkaarten worden daarna met dezelfde code gebouwd als voor de ruwe radar,
dus elke periode is ook hier exact samen te stellen.

Status per etmaal in bijstelling.json (en in index.json → 'bijstelling'):
  soort    handmatig+automatisch | automatisch | finaal (geen extra correctie) | geen
  F        gebiedsfactor; n_hand / n_auto meters; afgewezen = verworpen meters
  invoer   hash van ruwe dagrevisies + meterwaarden + venster → herberekenen
           zodra er iets verandert (voorlopig → gevalideerd, RTCOR → RFCOR …)

Het lopende etmaal wordt elk heel uur herberekend met de automatische stations
tot dat moment; nieuwe 5-minutenframes krijgen tussendoor de laatst bekende factor.
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np

from . import bijstellen as BS
from . import meters, periode, raster
from .bron import ONTBREKEND, Frame
from .opslag import Archief, framedag, standaard_map
from .periode import UTC, umin, van_umin

MIN_HANDMATIG = 50       # minder stations: het handmatige net is (nog) niet compleet genoeg


def adj_map() -> Path:
    p = os.environ.get("WL_ACCU_ADJ_DIR")
    return Path(p) if p else standaard_map().parent / "accumulatie_bijgesteld"


def _etmalen_in(arch: Archief, laatste: datetime):
    """Etmaallabels vanaf het eerste etmaal met frames t/m het lopende etmaal."""
    dagen = arch.dagen_met_frames()
    if not dagen:
        return []
    d = dagen[0]
    eind = periode.etmaalblok(framedag(laatste) + timedelta(days=1))
    uit = []
    while True:
        b = periode.etmaalblok(d)
        if b.begin >= laatste:
            break
        uit.append(d)
        d += timedelta(days=1)
        if b == eind:
            break
    return uit


def _hash(*delen):
    return hashlib.sha1(json.dumps(delen, sort_keys=True, default=str).encode()).hexdigest()[:12]


def bereken_etmaal(ruw: Archief, d: date, laatste: datetime, cache_map: Path):
    """→ (factorveld float32 | None voor f=1, info-dict)."""
    blok = periode.etmaalblok(d)
    lopend = blok.eind > laatste
    if lopend:
        # AWS-10-minutenwaarden lopen ~10–20 min achter; venster op hele 10 min
        e = min(laatste, datetime.now(UTC) - timedelta(minutes=20))
        e = e.replace(minute=e.minute - e.minute % 10, second=0, microsecond=0)
    else:
        e = blok.eind
    info = {"etmaal": d.isoformat(), "begin": f"{blok.begin:%Y-%m-%dT%H:%MZ}", "venster_eind": f"{e:%Y-%m-%dT%H:%MZ}",
            "lopend": lopend}
    if e <= blok.begin + timedelta(hours=1):
        info.update(soort="geen", F=1.0, n_hand=0, n_auto=0, afgewezen=[])
        return None, info, _hash(info)
    v = ruw.som_periode(blok.begin, e)
    revs = [ruw.lees_index().get("dagen", {}).get(f"{x:%Y%m%d}", {}).get("rev") for x in (d - timedelta(days=1), d)]
    if v.aanwezig and v.n_rf == v.aanwezig:
        info.update(soort="finaal", F=1.0, n_hand=0, n_auto=0, afgewezen=[])
        return None, info, _hash(revs, "finaal")
    hand = meters.handmatig(d, cache_map) if not lopend else []
    if len(hand) < MIN_HANDMATIG:
        hand = []
    auto = meters.automatisch(blok.begin, e, cache_map)
    mm = v.som.astype(np.float64) / 100
    paren = []
    for q in hand + auto:
        r, k = (int(t) for t in raster.cel_van_lonlat(q["lon"], q["lat"]))
        if r < 0 or v.telling[r, k] < max(1, v.verwacht - 6):
            continue
        paren.append({"id": q["id"], "net": q["net"], "lon": q["lon"], "lat": q["lat"], "G": q["mm"], "R": float(mm[r, k])})
    invoer = _hash(revs, e, [(q["id"], q["G"], round(q["R"], 2)) for q in paren])
    if len(paren) < 5:
        info.update(soort="geen", F=1.0, n_hand=0, n_auto=0, afgewezen=[])
        return None, info, invoer
    m = BS.pas_toe(paren)
    gebruikt = set(m.gebruikt)
    info.update(soort="handmatig+automatisch" if hand else "automatisch", F=round(m.F, 4),
                n_hand=sum(1 for q in paren if q["net"] == "handmatig" and q["id"] in gebruikt),
                n_auto=sum(1 for q in paren if q["net"] == "automatisch" and q["id"] in gebruikt),
                afgewezen=m.afgewezen, n_nat=m.n_nat,
                meters_status="gevalideerd" if hand and all(x["status"] == "gevalideerd" for x in hand) else "voorlopig")
    return BS.factorveld(m), info, invoer


def _pas_frames_toe(ruw: Archief, adj: Archief, d: date, f, alleen_nieuw=False):
    """Ruwe frames van etmaal d × f → adj-archief. Geeft gewijzigde framedagen terug."""
    blok = periode.etmaalblok(d)
    ruwe = ruw.frames_tussen(blok.begin, blok.eind)
    if alleen_nieuw:
        bestaand = {}
        for fd in {framedag(van_umin(s)) for s in ruwe}:
            bestaand.update(adj.effectieve_frames(fd))
        ruwe = {s: v for s, v in ruwe.items() if s not in bestaand or bestaand[s][1] != v[1]}
    per_herkomst = {"tar": [], "rf": []}
    for s, (data, bron, meta) in ruwe.items():
        if f is None:
            nieuw = data
        else:
            geldig = data < ONTBREKEND
            x = np.where(geldig, np.minimum(np.rint(data.astype(np.float64) * f), ONTBREKEND - 1), data)
            nieuw = x.astype(np.uint16)
        fr = Frame(eind=van_umin(s), data=nieuw, bron=bron, bestand=meta.get("bestand", ""), radars=meta.get("radars", []))
        per_herkomst["rf" if bron == "rf" else "tar"].append(fr)
    dagen = set()
    for h, lijst in per_herkomst.items():
        if lijst:
            g, _ = adj.voeg_frames_toe(lijst, h)
            dagen |= g
    return dagen


def werk_bij(ruw: Archief, laatste: datetime, adj: Archief | None = None, log=print, forceer=False):
    adj = adj or Archief(adj_map())
    adj.root.mkdir(parents=True, exist_ok=True)
    cache_map = ruw.root / "validatie_cache"
    fdir = adj.root / "factoren"
    fdir.mkdir(exist_ok=True)
    st_pad = adj.root / "bijstelling.json"
    st = json.loads(st_pad.read_text()) if st_pad.exists() else {}
    gewijzigd = set()
    nu_uur = laatste.replace(minute=0, second=0, microsecond=0)
    for d in _etmalen_in(ruw, laatste):
        k = f"{d:%Y%m%d}"
        oud = st.get(k)
        lopend = periode.etmaalblok(d).eind > laatste
        # Lopend etmaal: alleen elk heel uur volledig herberekenen; tussendoor nieuwe frames met oude factor.
        if lopend and oud and oud.get("uur") == f"{nu_uur:%Y%m%dT%H}" and not forceer:
            fpad = fdir / f"{k}.npy"
            f = np.load(fpad) if fpad.exists() else None
            gewijzigd |= _pas_frames_toe(ruw, adj, d, f, alleen_nieuw=True)
            continue
        # Afgesloten etmalen: alleen opnieuw als de ruwe radar veranderde, of (≤ 45 dagen oud)
        # hooguit elke 6 uur om nieuwe/gevalideerde meterwaarden op te pikken.
        ridx = ruw.lees_index().get("dagen", {})
        revs = [ridx.get(f"{x:%Y%m%d}", {}).get("rev") for x in (d - timedelta(days=1), d)]
        nu = datetime.now(UTC)
        if not lopend and oud and oud.get("revs") == revs and not forceer:
            gec = datetime.strptime(oud.get("gecontroleerd", "2000-01-01T00:00Z"), "%Y-%m-%dT%H:%MZ").replace(tzinfo=UTC)
            if d < nu.date() - timedelta(days=45) or nu - gec < timedelta(hours=6):
                continue
        f, info, invoer = bereken_etmaal(ruw, d, laatste, cache_map)
        if oud and oud.get("invoer") == invoer and not forceer and not lopend:
            oud["gecontroleerd"] = f"{nu:%Y-%m-%dT%H:%MZ}"
            oud["revs"] = revs
            continue
        info["revs"] = revs
        info["gecontroleerd"] = f"{nu:%Y-%m-%dT%H:%MZ}"
        if f is None:
            (fdir / f"{k}.npy").unlink(missing_ok=True)
        else:
            np.save(fdir / f"{k}.npy", f.astype(np.float32))
        info["invoer"] = invoer
        info["uur"] = f"{nu_uur:%Y%m%dT%H}"
        info["berekend"] = f"{datetime.now(UTC):%Y-%m-%dT%H:%MZ}"
        st[k] = info
        gewijzigd |= _pas_frames_toe(ruw, adj, d, f)
        log(f"  bijgesteld {d}: {info['soort']} F={info['F']} hand={info.get('n_hand')} auto={info.get('n_auto')}"
            f"{' afgewezen=' + ','.join(info['afgewezen']) if info.get('afgewezen') else ''}")
    tmp = st_pad.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=1, sort_keys=True))
    tmp.replace(st_pad)
    # blokken, presets en index met dezelfde code als het ruwe archief
    from .verwerk import bouw_presets, herbouw
    if gewijzigd:
        herbouw(adj, gewijzigd, laatste)
    lf = framedag(laatste)
    herbouw(adj, {lf - timedelta(days=1), lf} - gewijzigd, laatste, forceer=False)
    bouw_presets(adj, laatste)
    idx = adj.lees_index()
    idx["laag"] = "bijgesteld"
    idx["bijstelling"] = {k: {x: v[x] for x in ("soort", "F", "n_hand", "n_auto", "lopend", "venster_eind", "meters_status")
                              if x in v} for k, v in st.items()}
    idx["product"]["titel"] = "Neerslagaccumulatie Nederland — radar bijgesteld met regenmeters"
    idx["product"]["methode"] = ("KNMI-radar × factorveld per neerslagetmaal (gebiedsfactor + Gauss/Barnes-correctie, "
                                 f"L = {BS.Param().L:g} km) uit het handmatige KNMI-neerslagnet en de automatische stations; "
                                 "finale KNMI-dagen (RFCOR) ongewijzigd.")
    adj.schrijf_index(idx)
    return adj, gewijzigd
