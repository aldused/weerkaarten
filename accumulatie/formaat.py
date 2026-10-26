"""
formaat.py — Binaire blokformaten voor gepubliceerde accumulaties.

Alles little-endian, het hele bestand gzip-gecomprimeerd (.bin.gz, géén
Content-Encoding: de browser pakt het zelf uit met DecompressionStream).
Waarden zijn gehele honderdsten millimeter, precies de bronresolutie, dus
optellen in de browser is exact (geen afrondingsfouten, ook over maanden).

WLA1 — accumulatieveld (blok of preset), header 48 bytes:
  0  4s  magic 'WLA1'
  4  u8  versie (1)
  5  u8  bytes per waarde (2 = uint16, 4 = uint32)
  6  u8  vlaggen: bit0 = per-cel tellingen aanwezig, bit1 = byte-shuffle
  7  u8  bytes per telling (1 of 2)
  8  u16 rijen, 10 u16 kolommen
  12 i32 begin (unix-minuten UTC, exclusief: eerste frame eindigt begin+5)
  16 i32 eind  (unix-minuten UTC, inclusief eindtijd laatste frame)
  20 u32 verwacht aantal 5-minuutframes  (= (eind-begin)/5)
  24 u32 aanwezige frames
  28 u32 frames uit RFCOR (finaal)
  32 u32 frames uit RTCOR (realtime)
  36 u32 maximum (0,01 mm) over cellen met data
  40 u32 gereserveerd, 44 u32 gereserveerd
  48 ... waarden (rijen×kolommen), daarna optioneel tellingen
Zonder tellingen geldt: elke cel heeft 'aanwezige frames' geldige waarnemingen.
Met tellingen: per cel het aantal frames met een geldige waarde (0 = geen data).

WLR1 — uurreeks voor één tegel van 32×32 cellen en één UTC-dag:
  0 4s 'WLR1', 4 u8 versie, 5 u8 bytes/waarde, 6 u8 vlaggen (bit1 shuffle),
  7 u8 aantal uren (24), 8 u16 tegelrij, 10 u16 tegelkolom, 12 i32 begin dag
  (unix-min), 16 i32 geldig t/m (unix-min, laatste verwerkte frame-eind),
  20 u16 tegelgrootte, 22 u16 gereserveerd, 24..31 gereserveerd
  32 ... waarden (uren×32×32), daarna tellingen uint8 (uren×32×32, max 12)
"""
from __future__ import annotations

import gzip
import struct
from dataclasses import dataclass

import numpy as np

KOP_A = struct.Struct("<4sBBBBHHiiIIIIIII")
KOP_R = struct.Struct("<4sBBBBHHiiHH8x")
assert KOP_A.size == 48 and KOP_R.size == 32


def _shuffle(a: np.ndarray) -> bytes:
    a = np.ascontiguousarray(a)
    n = a.dtype.itemsize
    if n == 1:
        return a.tobytes()
    return np.ascontiguousarray(a.view(np.uint8).reshape(-1, n).T).tobytes()


def _unshuffle(buf: bytes, dtype, count: int) -> np.ndarray:
    dt = np.dtype(dtype).newbyteorder("<")
    n = dt.itemsize
    b = np.frombuffer(buf, dtype=np.uint8, count=count * n)
    if n == 1:
        return b.copy().view(dt)
    return np.ascontiguousarray(b.reshape(n, count).T).view(dt).ravel()


@dataclass
class Veld:
    som: np.ndarray            # uint32 (rijen, kol) 0,01 mm
    telling: np.ndarray        # uint16 (rijen, kol) geldige frames per cel
    begin: int                 # unix-min (exclusief)
    eind: int                  # unix-min (inclusief)
    aanwezig: int              # frames aanwezig
    n_rf: int = 0
    n_rt: int = 0

    @property
    def verwacht(self) -> int:
        return (self.eind - self.begin) // 5

    def __add__(self, ander: "Veld") -> "Veld":
        """Twee aansluitende velden optellen (exact). Overlap/gat = fout."""
        if ander.begin != self.eind:
            raise ValueError(f"Velden sluiten niet aan: {self.eind} vs {ander.begin}")
        return Veld(self.som + ander.som, self.telling + ander.telling,
                    self.begin, ander.eind, self.aanwezig + ander.aanwezig,
                    self.n_rf + ander.n_rf, self.n_rt + ander.n_rt)


def leeg_veld(begin: int, shape) -> Veld:
    return Veld(np.zeros(shape, np.uint32), np.zeros(shape, np.uint16), begin, begin, 0)


def schrijf_veld(v: Veld) -> bytes:
    som = np.asarray(v.som)
    mx = int(som[v.telling > 0].max()) if (v.telling > 0).any() else 0
    bpw = 2 if mx <= 0xFFFF else 4
    vals = som.astype("<u2" if bpw == 2 else "<u4")
    uniform = bool((v.telling[v.telling > 0] == v.aanwezig).all()) and \
        bool(((v.telling == 0) == (v.aanwezig == 0)).all())
    vlag = 0b10
    tel = b""
    bpt = 1 if v.aanwezig <= 0xFF and int(v.telling.max(initial=0)) <= 0xFF else 2
    if not uniform:
        vlag |= 0b01
        tel = _shuffle(v.telling.astype("<u1" if bpt == 1 else "<u2"))
    kop = KOP_A.pack(b"WLA1", 1, bpw, vlag, bpt, som.shape[0], som.shape[1],
                     v.begin, v.eind, v.verwacht, v.aanwezig, v.n_rf, v.n_rt, mx, 0, 0)
    return gzip.compress(kop + _shuffle(vals) + tel, compresslevel=9, mtime=0)


def lees_veld(blob: bytes) -> Veld:
    raw = gzip.decompress(blob) if blob[:2] == b"\x1f\x8b" else blob
    (magic, versie, bpw, vlag, bpt, nr, nk, begin, eind, verwacht, aanwezig,
     n_rf, n_rt, _mx, _r1, _r2) = KOP_A.unpack_from(raw, 0)
    if magic != b"WLA1" or versie != 1:
        raise ValueError("Geen WLA1-bestand")
    n = nr * nk
    off = KOP_A.size
    som = _unshuffle(raw[off:off + n * bpw], "u2" if bpw == 2 else "u4", n)
    off += n * bpw
    if vlag & 1:
        tel = _unshuffle(raw[off:off + n * bpt], "u1" if bpt == 1 else "u2", n)
        tel = tel.astype(np.uint16)
    else:
        tel = np.full(n, aanwezig, np.uint16)
    v = Veld(som.astype(np.uint32).reshape(nr, nk), tel.reshape(nr, nk),
             begin, eind, aanwezig, n_rf, n_rt)
    if v.verwacht != verwacht:
        raise ValueError("Kop inconsistent: verwacht aantal frames")
    return v


def schrijf_reeks(som: np.ndarray, telling: np.ndarray, tr: int, tk: int,
                  begin_dag: int, geldig_tm: int) -> bytes:
    """som (uren, 32, 32) uint32, telling (uren, 32, 32) uint8."""
    mx = int(som.max(initial=0))
    bpw = 2 if mx <= 0xFFFF else 4
    kop = KOP_R.pack(b"WLR1", 1, bpw, 0b10, som.shape[0], tr, tk,
                     begin_dag, geldig_tm, som.shape[1], 0)
    return gzip.compress(kop + _shuffle(som.astype("<u2" if bpw == 2 else "<u4"))
                         + _shuffle(telling.astype("<u1")), compresslevel=9, mtime=0)


def lees_reeks(blob: bytes):
    raw = gzip.decompress(blob) if blob[:2] == b"\x1f\x8b" else blob
    magic, versie, bpw, _vlag, nu, tr, tk, begin, geldig, tg, _ = KOP_R.unpack_from(raw, 0)
    if magic != b"WLR1":
        raise ValueError("Geen WLR1-bestand")
    n = nu * tg * tg
    off = KOP_R.size
    som = _unshuffle(raw[off:off + n * bpw], "u2" if bpw == 2 else "u4", n).reshape(nu, tg, tg)
    off += n * bpw
    tel = _unshuffle(raw[off:off + n], "u1", n).reshape(nu, tg, tg)
    return dict(som=som.astype(np.uint32), telling=tel, tegelrij=tr, tegelkol=tk,
                begin=begin, geldig_tm=geldig)
