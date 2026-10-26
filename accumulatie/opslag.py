"""
opslag.py — Lokaal archief (5-minutenframes) en afgeleide blokken.

Mappen (standaard ~/Library/Application Support/weerlab/accumulatie,
te overschrijven met WL_ACCU_DIR):

  frames/rt/JJJJ/JJJJMMDD.npz   RTCOR-frames (live én dag-tar), uitsnede uint16
  frames/rf/JJJJ/JJJJMMDD.npz   RFCOR-frames (finaal)
        Een frame met eindtijd T staat in de dag van (T - 5 min): dag D
        bevat dus eindtijden 00:05 .. 24:00 UTC, precies de UTC-dagsom.
  pub/                          spiegel van R2-prefix 'accumulatie/' (zie formaat.py)
        uur/JJJJMMDD/HH.bin.gz  dag/JJJJ/JJJJMMDD.bin.gz  etmaal/JJJJ/…
        lokdag/JJJJ/…  maand/JJJJMM.bin.gz  reeks/JJJJMMDD/RR_KK.bin.gz
        preset/<id>.bin.gz  index.json  archief/…

Voorrang per 5-minutenvak: rf (finaal) boven rt; binnen rt de dag-tar boven
het losse live-bestand. Een vak dat in geen enkele bron zit ontbreekt — het
telt nooit als 0 mm en de tellingen laten precies zien waar het mist.
"""
from __future__ import annotations

import gzip
import json
import os
import zlib
from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from . import formaat, periode, raster
from .bron import BUITEN, ONTBREKEND, Frame
from .periode import UTC, Blok, umin, van_umin

VERSIE = "1.0"
HERKOMST_RANG = {"live": 1, "tar": 2, "rf": 3}


def standaard_map() -> Path:
    p = os.environ.get("WL_ACCU_DIR")
    if p:
        return Path(p)
    return Path.home() / "Library" / "Application Support" / "weerlab" / "accumulatie"


def framedag(eind: datetime) -> date:
    return (eind - periode.MIN5).date()


def schrijf_atomair(pad: Path, data: bytes) -> bool:
    """Schrijf alleen als de inhoud verandert. True = gewijzigd."""
    pad.parent.mkdir(parents=True, exist_ok=True)
    if pad.exists() and pad.stat().st_size == len(data) and pad.read_bytes() == data:
        return False
    tmp = pad.with_name(pad.name + f".{os.getpid()}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, pad)
    return True


class Archief:
    def __init__(self, root: Path | None = None):
        self.root = Path(root) if root else standaard_map()
        self.pub = self.root / "pub"
        self._cache: OrderedDict = OrderedDict()
        self.gewijzigd: set[str] = set()      # pub-paden (relatief) die geüpload moeten worden
        self._wachtrij = self.root / "upload_wachtrij.txt"

    # ── frames ──────────────────────────────────────────────────────────────
    def _dagpad(self, bron: str, d: date) -> Path:
        return self.root / "frames" / bron / f"{d.year:04d}" / f"{d:%Y%m%d}.npz"

    def _laad_dag(self, bron: str, d: date):
        k = (bron, d)
        if k in self._cache:
            self._cache.move_to_end(k)
            return self._cache[k]
        p = self._dagpad(bron, d)
        if p.exists():
            with np.load(p, allow_pickle=False) as z:
                sl = z["sleutels"].astype(np.int64)
                data = z["data"]
                meta = json.loads(str(z["meta"]))
            dag = {int(s): (data[i], meta[i]) for i, s in enumerate(sl)}
        else:
            dag = {}
        self._cache[k] = dag
        while len(self._cache) > 12:
            self._cache.popitem(last=False)
        return dag

    def _bewaar_dag(self, bron: str, d: date, dag: dict):
        p = self._dagpad(bron, d)
        p.parent.mkdir(parents=True, exist_ok=True)
        sl = np.array(sorted(dag), dtype=np.int64)
        data = (np.stack([dag[s][0] for s in sl]) if len(sl)
                else np.zeros((0, raster.NRIJ, raster.NKOL), np.uint16))
        meta = json.dumps([dag[s][1] for s in sl])
        tmp = p.with_name(p.stem + f".{os.getpid()}.tmp.npz")
        np.savez_compressed(tmp, sleutels=sl, data=data, meta=np.array(meta))
        os.replace(tmp, p)
        self._cache[(bron, d)] = dag

    def voeg_frames_toe(self, frames: list[Frame], herkomst: str):
        """Frames opslaan. Retourneert (gewijzigde dagen, meldingen).

        Dubbele vakken (zelfde eindtijd) worden nooit opgeteld: het frame met
        de hoogste herkomstrang wint; bij gelijke rang blijft het bestaande."""
        bron_van = {"live": "rt", "tar": "rt", "rf": "rf"}[herkomst]
        rang = HERKOMST_RANG[herkomst]
        per_dag: dict[date, list[Frame]] = {}
        for fr in frames:
            if fr.bron != bron_van:
                raise ValueError(f"{fr.bestand}: bron {fr.bron} past niet bij herkomst {herkomst}")
            per_dag.setdefault(framedag(fr.eind), []).append(fr)
        gewijzigd, meldingen = set(), []
        for d, lijst in per_dag.items():
            dag = dict(self._laad_dag(bron_van, d))
            veranderd = False
            for fr in lijst:
                s = fr.sleutel
                meta = {"bestand": fr.bestand, "herkomst": herkomst, "radars": fr.radars}
                if s in dag:
                    oud_data, oud_meta = dag[s]
                    if HERKOMST_RANG[oud_meta["herkomst"]] > rang:
                        continue
                    if HERKOMST_RANG[oud_meta["herkomst"]] == rang and \
                            np.array_equal(oud_data, fr.data):
                        continue
                    if not np.array_equal(oud_data, fr.data):
                        meldingen.append(f"{fr.bestand}: {herkomst} vervangt afwijkend "
                                         f"{oud_meta['herkomst']}-frame")
                    elif HERKOMST_RANG[oud_meta["herkomst"]] == rang:
                        continue
                dag[s] = (fr.data, meta)
                veranderd = True
            if veranderd:
                self._bewaar_dag(bron_van, d, dag)
                gewijzigd.add(d)
        return gewijzigd, meldingen

    def effectieve_frames(self, d: date):
        """{sleutel: (data, bron, meta)} voor framedag d, rf vóór rt."""
        uit = {s: (v[0], "rt", v[1]) for s, v in self._laad_dag("rt", d).items()}
        for s, v in self._laad_dag("rf", d).items():
            uit[s] = (v[0], "rf", v[1])
        return uit

    def frames_tussen(self, begin: datetime, eind: datetime):
        """Effectieve frames met begin < T <= eind, gesorteerd."""
        uit = {}
        d = framedag(begin + periode.MIN5)
        while d <= framedag(eind):
            for s, v in self.effectieve_frames(d).items():
                if umin(begin) < s <= umin(eind):
                    uit[s] = v
            d += timedelta(days=1)
        return dict(sorted(uit.items()))

    def dagen_met_frames(self, bron: str | None = None):
        uit = set()
        for b in ([bron] if bron else ["rt", "rf"]):
            for p in (self.root / "frames" / b).glob("*/*.npz"):
                uit.add(datetime.strptime(p.stem, "%Y%m%d").date())
        return sorted(uit)

    # ── velden ──────────────────────────────────────────────────────────────
    def veld_uit_frames(self, begin: datetime, eind: datetime) -> formaat.Veld:
        shape = (raster.NRIJ, raster.NKOL)
        som = np.zeros(shape, np.uint32)
        tel = np.zeros(shape, np.uint16)
        n = n_rf = n_rt = 0
        for _s, (data, bron, _m) in self.frames_tussen(begin, eind).items():
            geldig = data < ONTBREKEND
            som += np.where(geldig, data, 0).astype(np.uint32)
            tel += geldig
            n += 1
            if bron == "rf":
                n_rf += 1
            else:
                n_rt += 1
        return formaat.Veld(som, tel, umin(begin), umin(eind), n, n_rf, n_rt)

    def blokpad(self, b: Blok) -> Path:
        if b.soort == "uur":
            return self.pub / "uur" / (b.label + ".bin.gz")
        if b.soort in ("dag", "etmaal", "lokdag"):
            return self.pub / b.soort / b.label[:4] / (b.label + ".bin.gz")
        if b.soort == "maand":
            return self.pub / "maand" / (b.label + ".bin.gz")
        raise ValueError(b.soort)

    def lees_blok(self, b: Blok) -> formaat.Veld:
        if b.soort == "frame":
            return self.veld_uit_frames(b.begin, b.eind)
        v = formaat.lees_veld(self.blokpad(b).read_bytes())
        if v.begin != umin(b.begin) or v.eind != umin(b.eind):
            raise ValueError(f"Blok {b} heeft afwijkend tijdvak")
        return v

    def heeft_blok(self, b: Blok) -> bool:
        return b.soort == "frame" or self.blokpad(b).exists()

    def som_periode(self, begin: datetime, eind: datetime, alleen_frames=False) -> formaat.Veld:
        """Accumulatie over (begin, eind]. Exact: blokken zijn zelf exacte sommen."""
        if alleen_frames:
            return self.veld_uit_frames(begin, eind)
        blokken = periode.deel_op(begin, eind, self.heeft_blok)
        v = formaat.leeg_veld(umin(begin), (raster.NRIJ, raster.NKOL))
        # aaneengesloten frame-stukken in één keer lezen
        i = 0
        while i < len(blokken):
            b = blokken[i]
            if b.soort == "frame":
                j = i
                while j + 1 < len(blokken) and blokken[j + 1].soort == "frame":
                    j += 1
                v = v + self.veld_uit_frames(b.begin, blokken[j].eind)
                i = j + 1
            else:
                v = v + self.lees_blok(b)
                i += 1
        return v

    # ── publicatie ──────────────────────────────────────────────────────────
    def schrijf_pub(self, rel: str, data: bytes) -> bool:
        if schrijf_atomair(self.pub / rel, data):
            self.gewijzigd.add(rel)
            return True
        return False

    def bewaar_wachtrij(self):
        """Gewijzigde pub-bestanden onthouden tot de upload gelukt is."""
        oud = set(self._wachtrij.read_text().split()) if self._wachtrij.exists() else set()
        alles = sorted(oud | self.gewijzigd)
        self._wachtrij.parent.mkdir(parents=True, exist_ok=True)
        self._wachtrij.write_text("\n".join(alles) + ("\n" if alles else ""))
        return alles

    def bouw_dag(self, d: date, laatste: datetime):
        """Uurblokken + UTC-dagblok + uurreeks-tegels voor framedag d.

        Alleen vakken die al voorbij zijn (eind <= laatste) worden blok; het
        lopende uur staat wel (als gedeeltelijk) in de uurreeks. Retourneert
        de dagrevisie (crc32 van de inhoud)."""
        frames = self.effectieve_frames(d)
        shape = (raster.NRIJ, raster.NKOL)
        dag0 = datetime(d.year, d.month, d.day, tzinfo=UTC)
        uur_som = np.zeros((24,) + shape, np.uint32)
        uur_tel = np.zeros((24,) + shape, np.uint8)
        uur_n = np.zeros(24, int)
        uur_rf = np.zeros(24, int)
        for s, (data, bron, _m) in frames.items():
            eind = van_umin(s)
            h = int((eind - periode.MIN5 - dag0) / periode.UUR)
            geldig = data < ONTBREKEND
            uur_som[h] += np.where(geldig, data, 0).astype(np.uint32)
            uur_tel[h] += geldig
            uur_n[h] += 1
            uur_rf[h] += bron == "rf"
        crc = 0
        for h in range(24):
            b = periode.uurblok(dag0 + h * periode.UUR)
            if b.eind > laatste:
                continue
            v = formaat.Veld(uur_som[h], uur_tel[h].astype(np.uint16), umin(b.begin),
                             umin(b.eind), int(uur_n[h]), int(uur_rf[h]),
                             int(uur_n[h] - uur_rf[h]))
            blob = formaat.schrijf_veld(v)
            crc = zlib.crc32(blob, crc)
            self.schrijf_pub(f"uur/{b.label}.bin.gz", blob)
        db = periode.dagblok(d)
        if db.eind <= laatste:
            v = formaat.Veld(uur_som.sum(0, dtype=np.uint32), uur_tel.sum(0, dtype=np.uint16),
                             umin(db.begin), umin(db.eind), int(uur_n.sum()),
                             int(uur_rf.sum()), int(uur_n.sum() - uur_rf.sum()))
            self.schrijf_pub(f"dag/{d:%Y}/{d:%Y%m%d}.bin.gz", formaat.schrijf_veld(v))
        # uurreeks-tegels: alleen afgesloten uren (het lopende uur zou de
        # tegels elke 5 minuten laten wijzigen; de presets dekken het wel)
        afgesloten = [h for h in range(24) if dag0 + (h + 1) * periode.UUR <= laatste]
        for h in range(24):
            if h not in afgesloten:
                uur_som[h] = 0
                uur_tel[h] = 0
        geldig_tm = umin(dag0) + 60 * len(afgesloten)
        C = raster.CHUNK
        for tr in range(raster.NCHUNK_R):
            for tk in range(raster.NCHUNK_K):
                sl = (slice(None), slice(tr * C, tr * C + C), slice(tk * C, tk * C + C))
                blob = formaat.schrijf_reeks(uur_som[sl], uur_tel[sl], tr, tk,
                                             umin(dag0), geldig_tm)
                self.schrijf_pub(f"reeks/{d:%Y%m%d}/{tr:02d}_{tk:02d}.bin.gz", blob)
        return {"rev": f"{crc & 0xFFFFFFFF:08x}", "frames": int(uur_n.sum()),
                "uren_klaar": len(afgesloten),
                "frames_klaar": self.frames_klaar(d, laatste),
                "rf": int(uur_rf.sum()), "rt": int(uur_n.sum() - uur_rf.sum()),
                "verwacht": int(min(288, max(0, (min(laatste, db.eind) - db.begin) / periode.MIN5))),
                "uren_onvolledig": [h for h in range(24)
                                    if periode.uurblok(dag0 + h * periode.UUR).eind <= laatste
                                    and uur_n[h] < 12]}

    def frames_klaar(self, d: date, laatste: datetime) -> int:
        """Aantal effectieve frames van dag d in al afgesloten uren (snelle signatuur)."""
        dag0 = datetime(d.year, d.month, d.day, tzinfo=UTC)
        n_uur = sum(1 for h in range(24) if dag0 + (h + 1) * periode.UUR <= laatste)
        grens = umin(dag0) + 60 * n_uur
        return sum(1 for s in self.effectieve_frames(d) if s <= grens)

    def bouw_uit_uren(self, b: Blok, laatste: datetime) -> bool:
        """Etmaal/lokdag/maand opbouwen uit uurblokken (exact). False = (nog) niet."""
        if b.eind > laatste:
            return False
        uren = []
        t = b.begin
        while t < b.eind:
            ub = periode.uurblok(t)
            if not self.blokpad(ub).exists():
                return False
            uren.append(ub)
            t += periode.UUR
        v = formaat.leeg_veld(umin(b.begin), (raster.NRIJ, raster.NKOL))
        if b.soort == "maand":
            # maand via dagblokken: 31 leesacties i.p.v. 744
            d = b.begin.date()
            while datetime(d.year, d.month, d.day, tzinfo=UTC) < b.eind:
                db = periode.dagblok(d)
                if not self.blokpad(db).exists():
                    return False
                v = v + self.lees_blok(db)
                d += timedelta(days=1)
        else:
            for ub in uren:
                v = v + self.lees_blok(ub)
        rel = str(self.blokpad(b).relative_to(self.pub))
        self.schrijf_pub(rel, formaat.schrijf_veld(v))
        return True

    def bouw_afgeleid(self, d: date, laatste: datetime):
        """Alle samengestelde blokken die framedag d raken."""
        gebouwd = []
        for b in (periode.etmaalblok(d), periode.etmaalblok(d + timedelta(days=1)),
                  periode.lokdagblok(d - timedelta(days=1)), periode.lokdagblok(d),
                  periode.lokdagblok(d + timedelta(days=1)),
                  periode.maandblok(d.year, d.month)):
            if self.bouw_uit_uren(b, laatste):
                gebouwd.append(f"{b.soort}:{b.label}")
        return gebouwd

    # ── index ───────────────────────────────────────────────────────────────
    def lees_index(self) -> dict:
        p = self.pub / "index.json"
        if p.exists():
            return json.loads(p.read_text())
        return {"versie": VERSIE, "dagen": {}, "presets": []}

    def schrijf_index(self, idx: dict):
        idx["versie"] = VERSIE
        data = json.dumps(idx, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
        self.schrijf_pub("index.json", data)
