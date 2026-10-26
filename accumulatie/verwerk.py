#!/usr/bin/env python3
"""
verwerk.py — Automatische verwerking neerslagaccumulatie (KNMI-radar).

  python3 -m accumulatie.verwerk live              # nieuwe RTCOR 5-min bestanden (+herkansing)
  python3 -m accumulatie.verwerk tars [--dagen 10] # RTCOR dag-tars (vullen gaten, ~10 UTC)
  python3 -m accumulatie.verwerk rf                # nieuwe RFCOR (finaal) dag-tars
  python3 -m accumulatie.verwerk backfill --van 2026-09-01 --tot 2026-10-25 [--bron rf|rt|beste]
  python3 -m accumulatie.verwerk presets           # alleen presets + index opnieuw
  python3 -m accumulatie.verwerk herbouw --van ... --tot ...   # blokken opnieuw uit frames
  python3 -m accumulatie.verwerk alles             # live + tars + rf + archief (launchd)

Elke run: ophalen → valideren (bron.py) → frames opslaan (dubbele vakken
vervangen, nooit optellen) → aangetaste dagen herbouwen → afgeleide blokken
→ presets → index.json. Gewijzigde pub-bestanden komen in de uploadwachtrij;
uploaden naar R2 gebeurt alleen met --r2 (bèta: standaard uit).
"""
from __future__ import annotations

import argparse
import fcntl
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import requests

HIER = Path(__file__).resolve().parent
REPO = HIER.parent
sys.path.insert(0, str(REPO / "scripts"))
sys.path.insert(0, str(REPO))

from knmi_api import knmi_get  # noqa: E402

from accumulatie import bron, formaat, periode, raster  # noqa: E402
from accumulatie.opslag import Archief, framedag  # noqa: E402
from accumulatie.periode import NL, UTC, umin, van_umin  # noqa: E402

API = "https://api.dataplatform.knmi.nl/open-data/v1/datasets"
DS = {
    "rt5": ("nl_rdr_data_rtcor_5m", "1.0"),
    "rttar": ("nl_rdr_data_rtcor_5m_tar", "1.0"),
    "rftar": ("nl_rdr_data_rfcor_5m", "1.0"),
}
LIVE_TERUG_UUR = 36          # zoveel uur terug blijven we ontbrekende live-bestanden herproberen


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), *a, flush=True)


# ── KNMI Open Data API ──────────────────────────────────────────────────────
def lijst(ds_key, begin=None, eind=None, max_keys=1000):
    """Alle bestandsnamen (met metadata) in [begin, eind] (lexicografisch op naam)."""
    d, v = DS[ds_key]
    url = f"{API}/{d}/versions/{v}/files"
    params = {"maxKeys": max_keys, "orderBy": "filename", "sorting": "asc"}
    if begin:
        params["begin"] = begin
    if eind:
        params["end"] = eind
    uit, token = [], None
    for _ in range(100):
        if token:
            params["nextPageToken"] = token
        r = knmi_get(url, params=params, timeout=30)
        r.raise_for_status()
        j = r.json()
        uit += j.get("files", [])
        token = j.get("nextPageToken")
        if not token or not j.get("isTruncated", True):
            break
    return uit


def download(ds_key, naam, timeout=300) -> bytes:
    d, v = DS[ds_key]
    r = knmi_get(f"{API}/{d}/versions/{v}/files/{naam}/url", timeout=20)
    r.raise_for_status()
    u = r.json()["temporaryDownloadUrl"]
    for poging in range(3):
        try:
            r2 = requests.get(u, timeout=timeout)
            r2.raise_for_status()
            return r2.content
        except requests.RequestException as e:
            if poging == 2:
                raise
            log(f"  download herhaald ({e})")
            time.sleep(3 * (poging + 1))


# ── status ──────────────────────────────────────────────────────────────────
class Status:
    def __init__(self, arch: Archief):
        self.pad = arch.root / "status.json"
        self.d = json.loads(self.pad.read_text()) if self.pad.exists() else {}
        self.d.setdefault("tars_rt", {})
        self.d.setdefault("tars_rf", {})
        self.d.setdefault("fouten", [])

    def bewaar(self):
        self.pad.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.pad.with_suffix(".tmp")
        self.d["fouten"] = self.d["fouten"][-200:]
        tmp.write_text(json.dumps(self.d, indent=1, sort_keys=True))
        tmp.replace(self.pad)

    def fout(self, tekst):
        log("  FOUT:", tekst)
        self.d["fouten"].append(f"{datetime.now(UTC):%Y-%m-%dT%H:%MZ} {tekst}")


def laatste_frame(arch: Archief) -> datetime | None:
    for d in reversed(arch.dagen_met_frames()):
        fr = arch.effectieve_frames(d)
        if fr:
            return van_umin(max(fr))
    return None


# ── stappen ─────────────────────────────────────────────────────────────────
def stap_live(arch: Archief, st: Status, terug_uur: int = LIVE_TERUG_UUR) -> set:
    nu = datetime.now(UTC)
    van = nu - timedelta(hours=terug_uur)
    namen = lijst("rt5", begin=f"RAD_NL25_RAC_RT_{van:%Y%m%d%H%M}.h5")
    aanwezig = set()
    d = van.date()
    while d <= nu.date():
        for b in ("rt", "rf"):
            aanwezig |= set(arch._laad_dag(b, d))
        d += timedelta(days=1)
    nieuw = []
    for f in namen:
        naam = f["filename"]
        try:
            t = datetime.strptime(naam.split("_")[-1][:12], "%Y%m%d%H%M").replace(tzinfo=UTC)
        except ValueError:
            continue
        if umin(t) in aanwezig:
            continue
        nieuw.append(naam)
    log(f"live: {len(namen)} in lijst, {len(nieuw)} nieuw")
    frames = []
    for naam in nieuw:
        try:
            import io
            frames.append(bron.lees_h5(io.BytesIO(download("rt5", naam, 60)), naam))
        except Exception as e:  # noqa: BLE001
            st.fout(f"live {naam}: {e}")
    if not frames:
        return set()
    # De bestandsnaam van RTCOR-live is de eindtijd; controleer dat (attributen winnen).
    for fr in frames:
        tn = fr.bestand.split("_")[-1][:12]
        if fr.eind.strftime("%Y%m%d%H%M") != tn:
            st.fout(f"{fr.bestand}: naamtijd {tn} ≠ attribuut-eindtijd {fr.eind:%Y%m%d%H%M}")
    dagen, meld = arch.voeg_frames_toe(frames, "live")
    for m in meld:
        log("  ", m)
    return dagen


def _tar_dag(naam: str) -> date:
    """Begin-datum uit tar-naam (alleen voor selectie; tijden komen uit de HDF5)."""
    deel = naam.split("__L2__")[1][:8]
    return datetime.strptime(deel, "%Y%m%d").date()


def stap_tars(arch: Archief, st: Status, ds_key: str, van: date, tot: date,
              opnieuw=False, alleen_dagen=None) -> set:
    """Dag-tars ophalen. alleen_dagen: verwerk een tar alleen als hij één van
    deze (frame)dagen raakt — zo breidt de dagelijkse RFCOR-stap het archief
    nooit stilletjes naar achteren uit."""
    sleutel = "tars_rt" if ds_key == "rttar" else "tars_rf"
    herkomst = "tar" if ds_key == "rttar" else "rf"
    prefix = "RAD25_OPER_R___TARRRT__L2__" if ds_key == "rttar" else "RAD25_OPER_R___TARRRF__L2__"
    namen = lijst(ds_key, begin=f"{prefix}{van - timedelta(days=1):%Y%m%d}",
                  eind=f"{prefix}{tot + timedelta(days=1):%Y%m%d}~")
    dagen = set()
    for f in namen:
        naam = f["filename"]
        dag = _tar_dag(naam)
        if not (van - timedelta(days=1) <= dag <= tot):
            continue
        if alleen_dagen is not None and not ({dag, dag + timedelta(days=1)} & alleen_dagen):
            continue
        stempel = f.get("lastModified") or f.get("created")
        if not opnieuw and st.d[sleutel].get(naam) == stempel:
            continue
        log(f"{herkomst}: {naam} ({f.get('size', 0)/1e6:.0f} MB)")
        try:
            blob = download(ds_key, naam)
            frames, fouten = bron.lees_tar(blob)
        except Exception as e:  # noqa: BLE001
            st.fout(f"{naam}: {e}")
            continue
        for fo in fouten:
            st.fout(fo)
        if len(frames) != 288:
            log(f"  let op: {len(frames)} van 288 frames in {naam}")
        gew, meld = arch.voeg_frames_toe(frames, herkomst)
        for m in meld[:5]:
            log("  ", m)
        if len(meld) > 5:
            log(f"   … en {len(meld) - 5} andere vervangingen")
        dagen |= gew
        if frames and not fouten:
            st.d[sleutel][naam] = stempel     # anders bij een volgende run opnieuw proberen
        st.bewaar()
    return dagen


def herbouw(arch: Archief, dagen, laatste: datetime, forceer=True):
    """Dagen opnieuw opbouwen. forceer=False (live): alleen als er een uur is
    afgesloten of er frames in afgesloten uren bij kwamen."""
    idx = arch.lees_index()
    for d in sorted(dagen):
        t0 = time.time()
        oud = idx["dagen"].get(f"{d:%Y%m%d}")
        if not forceer and oud:
            dag0 = datetime(d.year, d.month, d.day, tzinfo=UTC)
            n_uur = sum(1 for h in range(24) if dag0 + timedelta(hours=h + 1) <= laatste)
            if oud.get("uren_klaar") == n_uur and \
                    oud.get("frames_klaar") == arch.frames_klaar(d, laatste):
                continue
        info = arch.bouw_dag(d, laatste)
        info["verwerkt"] = f"{datetime.now(UTC):%Y-%m-%dT%H:%M:%SZ}"
        idx["dagen"][f"{d:%Y%m%d}"] = info
        afg = arch.bouw_afgeleid(d, laatste)
        log(f"  dag {d}: {info['frames']}/{info['verwacht']} frames "
            f"(rf {info['rf']}, rt {info['rt']}) {time.time()-t0:.1f}s; {', '.join(afg)}")
    arch.schrijf_index(idx)


def bouw_presets(arch: Archief, laatste: datetime):
    idx = arch.lees_index()
    uit = []
    for pid, label, _s, _w in periode.PRESETS:
        b, e = periode.preset_tijdvak(pid, laatste)
        if e <= b:
            uit.append({"id": pid, "label": label, "begin": f"{b:%Y-%m-%dT%H:%MZ}",
                        "eind": f"{e:%Y-%m-%dT%H:%MZ}", "leeg": True})
            continue
        try:
            v = arch.som_periode(b, e)
        except ValueError as ex:
            log(f"  preset {pid}: {ex}")
            continue
        blob = formaat.schrijf_veld(v)
        arch.schrijf_pub(f"preset/{pid}.bin.gz", blob)
        uit.append({"id": pid, "label": label, "begin": f"{b:%Y-%m-%dT%H:%MZ}",
                    "eind": f"{e:%Y-%m-%dT%H:%MZ}", "verwacht": v.verwacht,
                    "aanwezig": v.aanwezig, "rf": v.n_rf, "rt": v.n_rt,
                    "max": int(v.som[v.telling > 0].max()) if (v.telling > 0).any() else 0,
                    "rev": f"{umin(e)}-{v.aanwezig}-{len(blob)}"})
    idx["presets"] = uit
    idx["laatste"] = f"{laatste:%Y-%m-%dT%H:%MZ}"
    idx["verwerkt"] = f"{datetime.now(UTC):%Y-%m-%dT%H:%M:%SZ}"
    dagen = sorted(idx["dagen"])
    if dagen:
        idx["eerste_dag"] = dagen[0]
        for k in dagen:
            fr = arch.effectieve_frames(datetime.strptime(k, "%Y%m%d").date())
            if fr:
                idx["begin_archief"] = f"{van_umin(min(fr)) - periode.MIN5:%Y-%m-%dT%H:%MZ}"
                break
    idx["product"] = {
        "titel": "Neerslagaccumulatie Nederland",
        "eenheid": "0,01 mm (gehele getallen)",
        "raster": {"rijen": raster.NRIJ, "kolommen": raster.NKOL, "r0": raster.R0,
                   "k0": raster.K0, "proj4": raster.PROJ4, "chunk": raster.CHUNK,
                   "row_off": raster.ROW_OFF, "col_off": raster.COL_OFF},
        "bronnen": {
            "rt": "KNMI RTCOR 5-min (nl_rdr_data_rtcor_5m 1.0), realtime gecorrigeerd met automatische stations",
            "rf": "KNMI RFCOR 5-min (nl_rdr_data_rfcor_5m 1.0), finale heranalyse incl. handmatig neerslagnet",
        },
        "licentie": "KNMI Data Platform, CC BY 4.0",
    }
    arch.schrijf_index(idx)
    log(f"presets bijgewerkt t/m {laatste:%Y-%m-%d %H:%M}Z")


VLUCHTIG = ("index.json", "archief/index.json", "validatie/", "raster/")   # zonder ?r=-revisie in de URL


def upload_r2(arch: Archief, prefix="accumulatie", alles=False):
    """Upload naar R2 (bucket weerlab-data, prefix accumulatie/ of accumulatie-bijgesteld/).

    Blokken, reeksen, presets en archief-PNG's worden altijd met een ?r=<revisie>
    opgevraagd en krijgen daarom 'immutable'; index- en validatiebestanden 'no-cache'.
    Content-Type kiest rclone op extensie. index.json gaat als laatste, zodat de
    client nooit naar een nog niet geüpload blok wijst. alles=True: hele pub-map."""
    import subprocess
    rc = "/opt/homebrew/bin/rclone"
    doel = f"r2:weerlab-data/{prefix}"
    lijstje = arch.bewaar_wachtrij() if not alles else None
    if lijstje is not None and not lijstje:
        return
    vast_args = ["--transfers", "32", "--checkers", "32", "--fast-list" if alles else "--no-traverse",
                 "--header-upload", "Cache-Control: public, max-age=31536000, immutable"]
    vlucht_args = ["--header-upload", "Cache-Control: no-cache"]
    if alles:
        uitsluit = []
        for v in VLUCHTIG:
            uitsluit += ["--exclude", v + ("**" if v.endswith("/") else "")]
        subprocess.run([rc, "copy", str(arch.pub), doel, *vast_args, *uitsluit], check=True)
        insluit = []
        for v in VLUCHTIG:
            if v != "index.json":
                insluit += ["--include", v + ("**" if v.endswith("/") else "")]
        subprocess.run([rc, "copy", str(arch.pub), doel, *vlucht_args, *insluit], check=True)
        subprocess.run([rc, "copyto", str(arch.pub / "index.json"), f"{doel}/index.json", *vlucht_args], check=True)
        n = "alles"
    else:
        vast = [p for p in lijstje if not p.startswith(VLUCHTIG)]
        vlucht = [p for p in lijstje if p.startswith(VLUCHTIG) and p != "index.json"]
        for groep, args in ((vast, vast_args), (vlucht, vlucht_args)):
            if groep:
                tmp = arch.root / "upload_lijst.txt"
                tmp.write_text("\n".join(groep) + "\n")
                subprocess.run([rc, "copy", str(arch.pub), doel, "--files-from", str(tmp), *args], check=True)
        if "index.json" in lijstje:
            subprocess.run([rc, "copyto", str(arch.pub / "index.json"), f"{doel}/index.json", *vlucht_args], check=True)
        n = len(lijstje)
    arch._wachtrij.write_text("")
    arch.gewijzigd.clear()
    log(f"R2 {prefix}: {n} bestanden geüpload")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("stap", choices=["live", "tars", "rf", "backfill", "presets", "herbouw", "alles"])
    ap.add_argument("--van")
    ap.add_argument("--tot")
    ap.add_argument("--dagen", type=int, default=7)
    ap.add_argument("--terug-uur", type=int, default=LIVE_TERUG_UUR)
    ap.add_argument("--bron", choices=["rt", "rf", "beste"], default="beste")
    ap.add_argument("--r2", action="store_true", help="upload wachtrij naar R2")
    ap.add_argument("--geen-archief", action="store_true")
    ap.add_argument("--geen-bijstelling", action="store_true")
    ap.add_argument("--root")
    ap.add_argument("--opnieuw", action="store_true", help="tars opnieuw verwerken")
    ap.add_argument("--upload-alles", action="store_true", help="eenmalig: volledige pub-mappen naar R2")
    a = ap.parse_args(argv)

    arch = Archief(Path(a.root) if a.root else None)
    arch.root.mkdir(parents=True, exist_ok=True)
    if a.upload_alles:
        from accumulatie.bijgesteld import adj_map
        upload_r2(arch, "accumulatie", alles=True)
        upload_r2(Archief(adj_map()), "accumulatie-bijgesteld", alles=True)
        return 0
    slot = open(arch.root / ".lock", "w")
    try:
        fcntl.flock(slot, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("Andere verwerking loopt nog; stop.")
        return 0
    st = Status(arch)
    vandaag = datetime.now(UTC).date()
    dagen = set()            # live: herbouw alleen bij afgesloten uur
    dagen_forceer = set()    # tar/rf/backfill/herbouw: altijd herbouwen
    if a.stap in ("live", "alles"):
        dagen |= stap_live(arch, st, a.terug_uur)
    if a.stap in ("tars", "alles"):
        dagen_forceer |= stap_tars(arch, st, "rttar", vandaag - timedelta(days=a.dagen), vandaag)
    if a.stap in ("rf", "alles"):
        # Alleen dagen die al in het archief staan en nog niet volledig finaal zijn.
        grens = vandaag - timedelta(days=60)
        nodig = {d for d in arch.dagen_met_frames("rt")
                 if d >= grens and len(arch._laad_dag("rf", d)) < len(arch._laad_dag("rt", d))}
        if nodig:
            dagen_forceer |= stap_tars(arch, st, "rftar", min(nodig), max(nodig), alleen_dagen=nodig)
    if a.stap == "backfill":
        van = date.fromisoformat(a.van)
        tot = date.fromisoformat(a.tot)
        if a.bron in ("rf", "beste"):
            dagen_forceer |= stap_tars(arch, st, "rftar", van, tot, a.opnieuw)
        if a.bron in ("rt", "beste"):
            # RTCOR-tar voor dagen zonder (volledige) RFCOR
            rf_dagen = set(arch.dagen_met_frames("rf"))
            nodig = [van + timedelta(days=i) for i in range((tot - van).days + 1)]
            if a.bron == "beste":
                nodig = [d for d in nodig
                         if d not in rf_dagen or len(arch._laad_dag("rf", d)) < 288]
            if nodig:
                dagen_forceer |= stap_tars(arch, st, "rttar", min(nodig), max(nodig), a.opnieuw)
    if a.stap == "herbouw":
        van = date.fromisoformat(a.van)
        tot = date.fromisoformat(a.tot)
        dagen_forceer |= {van + timedelta(days=i) for i in range((tot - van).days + 1)}
    laatste = laatste_frame(arch)
    if laatste is None:
        log("Nog geen frames in archief.")
        st.bewaar()
        return 1
    # Dagen zonder één enkel bestand (storing) krijgen toch blokken, met 0
    # aanwezige tijdstappen: zo blijft elke periode samen te stellen en ziet de
    # gebruiker expliciet "geen data" in plaats van een gat of 0 mm.
    idx_nu = arch.lees_index()
    alle = arch.dagen_met_frames()
    if alle:
        d = alle[0]
        while d <= framedag(laatste):
            if f"{d:%Y%m%d}" not in idx_nu.get("dagen", {}):
                dagen_forceer.add(d)
            d += timedelta(days=1)
    if dagen_forceer:
        herbouw(arch, dagen_forceer, laatste)
    # Live-dagen en de lopende dag: alleen herbouwen als er een uur afsloot.
    lf = framedag(laatste)
    herbouw(arch, (dagen | {lf - timedelta(days=1), lf}) - dagen_forceer, laatste, forceer=False)
    dagen |= dagen_forceer
    bouw_presets(arch, laatste)
    if not a.geen_archief and a.stap in ("alles", "backfill", "herbouw", "tars", "rf"):
        try:
            from accumulatie import kaartarchief
            kaartarchief.werk_bij(arch, dagen | {lf - timedelta(days=1)}, laatste)
        except Exception as e:  # noqa: BLE001
            st.fout(f"kaartarchief: {e}")
    # Aparte laag "radar bijgesteld met regenmeters" (eigen archief; ruwe radar blijft onaangetast)
    adj = None
    if a.stap in ("alles", "live", "tars", "rf", "backfill", "herbouw") and not a.geen_bijstelling and a.root is None:
        try:
            from accumulatie import bijgesteld
            adj, adj_dagen = bijgesteld.werk_bij(arch, laatste, log=log)
            if not a.geen_archief and a.stap != "live":
                from accumulatie import kaartarchief
                kaartarchief.werk_bij(adj, None, laatste, laag="bijgesteld")
            adj.bewaar_wachtrij()
        except Exception as e:  # noqa: BLE001
            st.fout(f"bijstelling: {e}")
    arch.bewaar_wachtrij()
    st.d["laatste_frame"] = f"{laatste:%Y-%m-%dT%H:%MZ}"
    st.d["laatste_run"] = f"{datetime.now(UTC):%Y-%m-%dT%H:%M:%SZ}"
    st.bewaar()
    if a.r2:
        upload_r2(arch)
        if adj is not None:
            upload_r2(adj, "accumulatie-bijgesteld")
    return 0


if __name__ == "__main__":
    sys.exit(main())
