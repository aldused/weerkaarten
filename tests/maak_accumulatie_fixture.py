"""Genereert tests/fixtures/accumulatie_ref.json: Python-referentie voor accumulatie_core.js.

  python3 tests/maak_accumulatie_fixture.py
"""
import base64
import json
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from accumulatie import formaat, periode, raster  # noqa: E402

UTC = timezone.utc
rnd = random.Random(42)
punten = []
for _ in range(60):
    lon, lat = rnd.uniform(2.5, 8.0), rnd.uniform(50.3, 54.0)
    x, y = raster.vooruit(lon, lat)
    r, k = raster.cel_van_lonlat(lon, lat)
    punten.append([lon, lat, float(x), float(y), int(r), int(k), float(raster.schaalfactor_k(lat))])
centra = []
for r, k in [(0, 0), (100, 200), (447, 383), (260, 133)]:
    lon, lat = raster.celcentrum_lonlat(r, k)
    centra.append([r, k, float(lon), float(lat)])

intervallen = []
gevallen = [
    (datetime(2026, 10, 22, 22, tzinfo=UTC), datetime(2026, 10, 26, 5, tzinfo=UTC)),
    (datetime(2026, 3, 27, 13, tzinfo=UTC), datetime(2026, 4, 2, 9, tzinfo=UTC)),
    (datetime(2026, 9, 1, 0, tzinfo=UTC), datetime(2026, 10, 1, 0, tzinfo=UTC)),
    (datetime(2026, 8, 30, 21, tzinfo=UTC), datetime(2026, 10, 3, 17, tzinfo=UTC)),
    (datetime(2026, 10, 24, 8, tzinfo=UTC), datetime(2026, 10, 25, 8, tzinfo=UTC)),
]
for _ in range(25):
    b = datetime(2026, 8, 25, tzinfo=UTC) + timedelta(hours=rnd.randrange(0, 1500))
    gevallen.append((b, b + timedelta(hours=rnd.randrange(1, 900))))
for b, e in gevallen:
    bl = periode.deel_op(b, e, frames_toegestaan=False)
    intervallen.append({"begin": int(b.timestamp() * 1000), "eind": int(e.timestamp() * 1000),
                        "blokken": [[x.soort, x.label.replace("/", "/") if x.soort != "uur" else x.label,
                                     int(x.begin.timestamp() * 1000), int(x.eind.timestamp() * 1000)] for x in bl]})

lokdagen = []
for d in (date(2026, 3, 29), date(2026, 10, 25), date(2026, 7, 1), date(2027, 3, 28)):
    b, e = periode.lokdag_grenzen(d)
    lokdagen.append([d.year, d.month, d.day, int(b.timestamp() * 1000), int(e.timestamp() * 1000)])

som = ((np.arange(raster.NRIJ * raster.NKOL, dtype=np.uint64) * 7919) % 70001).astype(np.uint32).reshape(raster.NRIJ, raster.NKOL)
som[:, 100:] //= 64   # grotendeels klein, enkele waarden > 65535 (uint32-pad)
tel = np.full(som.shape, 300, np.uint16)
tel[10, 11] = 290
tel[12, 13] = 0
som[12, 13] = 0
veld = formaat.schrijf_veld(formaat.Veld(som, tel, 29340000, 29340000 + 1500, 300, 0, 300))
rs = ((np.arange(24 * 32 * 32) * 37) % 601).astype(np.uint32).reshape(24, 32, 32)
rt = np.full((24, 32, 32), 12, np.uint8)
rt[5, 1, 2] = 7
reeks = formaat.schrijf_reeks(rs, rt, 6, 4, 29340000, 29340000 + 600)
from pyproj import Transformer
_rd = Transformer.from_crs(4326, 28992, always_xy=True)
rdpunten = []
for _ in range(40):
    lon, lat = rnd.uniform(3.4, 7.2), rnd.uniform(50.8, 53.5)
    x, y = _rd.transform(lon, lat)
    rdpunten.append([lon, lat, x, y])
out = {
    "rdpunten": rdpunten,
    "punten": punten, "centra": centra, "intervallen": intervallen, "lokdagen": lokdagen,
    "veld_b64": base64.b64encode(veld).decode(),
    "veld_controle": {"som_0_0": int(som[0, 0]), "som_447_383": int(som[447, 383]), "tel_10_11": 290,
                      "tel_12_13": 0, "tel_0_0": 300, "som_totaal": int(som.sum())},
    "reeks_b64": base64.b64encode(reeks).decode(),
    "reeks_controle": {"som_5_1_2": int(rs[5, 1, 2]), "tel_5_1_2": 7, "som_totaal": int(rs.sum())},
}
(REPO / "tests/fixtures/accumulatie_ref.json").write_text(json.dumps(out))
print("ok", len(punten), len(intervallen))
