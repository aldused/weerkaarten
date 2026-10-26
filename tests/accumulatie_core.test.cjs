// node --test tests/accumulatie_core.test.cjs
// JS-rekenkern (accumulatie_core.js) tegen de Python-referentie
// (tests/fixtures/accumulatie_ref.json, gemaakt door tests/maak_accumulatie_fixture.py).
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const path = require("node:path");
const fs = require("node:fs");
const C = require("../accumulatie_core.js");
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/accumulatie_ref.json"), "utf8"));

test("projectie gelijk aan Python (raster.py) tot op 1 µm", () => {
  for (const [lon, lat, x, y, r, k, kf] of REF.punten) {
    const [jx, jy] = C.vooruit(lon, lat);
    assert.ok(Math.abs(jx - x) < 1e-9 && Math.abs(jy - y) < 1e-9, `${lon},${lat}`);
    const cel = C.celVan(lon, lat);
    if (r < 0) assert.equal(cel, null);
    else assert.deepEqual(cel, [r, k]);
    assert.ok(Math.abs(C.schaalK(lat) - kf) < 1e-12);
    const [lo2, la2] = C.terug(jx, jy);
    assert.ok(Math.abs(lo2 - lon) < 1e-9 && Math.abs(la2 - lat) < 1e-9);
  }
  for (const [r, k, lon, lat] of REF.centra) {
    const [jl, jb] = C.celcentrum(r, k);
    assert.ok(Math.abs(jl - lon) < 1e-9 && Math.abs(jb - lat) < 1e-9);
    assert.deepEqual(C.celVan(jl, jb), [r, k]);
  }
});

test("cellen binnen straal: centrum, symmetrisch, groeit met straal", () => {
  const een = C.cellenInStraal(4.5347, 51.8567, 0);
  assert.equal(een.length, 1);
  const vijf = C.cellenInStraal(4.5347, 51.8567, 5);
  assert.ok(vijf.length > 70 && vijf.length < 100, String(vijf.length));   // π·(5·1,044)² ≈ 86
  assert.ok(vijf.includes(een[0]));
  assert.deepEqual(C.cellenInStraal(0.2, 48.0, 5), []);
});

test("WLA1-veld decoderen gelijk aan Python (uint32-pad + tellingen)", () => {
  const v = C.decodeerVeld(zlib.gunzipSync(Buffer.from(REF.veld_b64, "base64")));
  const c = REF.veld_controle;
  assert.equal(v.som[0], c.som_0_0);
  assert.equal(v.som[447 * 384 + 383], c.som_447_383);
  assert.equal(v.tel[10 * 384 + 11], c.tel_10_11);
  assert.equal(v.tel[12 * 384 + 13], c.tel_12_13);
  assert.equal(v.tel[0], c.tel_0_0);
  assert.equal(v.som.reduce((a, b) => a + b, 0), c.som_totaal);
  assert.equal(v.verwacht, 300);
  assert.equal(v.eind - v.begin, 1500);
});

test("WLR1-uurreeks decoderen", () => {
  const r = C.decodeerReeks(zlib.gunzipSync(Buffer.from(REF.reeks_b64, "base64")));
  const j = 5 * 1024 + 1 * 32 + 2;
  assert.equal(r.som[j], REF.reeks_controle.som_5_1_2);
  assert.equal(r.tel[j], 7);
  assert.equal(r.som.reduce((a, b) => a + b, 0), REF.reeks_controle.som_totaal);
  assert.equal(r.geldigTm - r.begin, 600);
});

test("telOp: exact en alleen aansluitend", () => {
  const mk = (b, e, w) => ({ nr: 1, nk: 2, begin: b, eind: e, verwacht: (e - b) / 5, aanwezig: (e - b) / 5, nRf: 0, nRt: (e - b) / 5,
    som: Uint32Array.from([w, 2 * w]), tel: Uint16Array.from([(e - b) / 5, (e - b) / 5]) });
  const s = C.telOp(C.telOp(null, mk(0, 60, 7)), mk(60, 120, 4294967295 - 7 - 10));
  assert.equal(s.som[0], 4294967295 - 10);
  assert.equal(s.verwacht, 24);
  assert.throws(() => C.telOp(mk(0, 60, 1), mk(65, 120, 1)));
});

test("opdeling in blokken identiek aan Python periode.deel_op", () => {
  for (const iv of REF.intervallen) {
    const js = C.deelOp(iv.begin, iv.eind, () => true).map((b) => [b.soort, b.label, b.begin, b.eind]);
    assert.deepEqual(js, iv.blokken, new Date(iv.begin).toISOString());
  }
});

test("opdeling met ontbrekende dagen valt terug op uren of faalt netjes", () => {
  const b = Date.UTC(2026, 9, 20), e = Date.UTC(2026, 9, 23);
  const zonderDagen = C.deelOp(b, e, (bl) => bl.soort === "uur");
  assert.equal(zonderDagen.length, 72);
  assert.equal(C.deelOp(b, e, () => false), null);
});

test("Nederlandse tijd: lokale dagen 23/24/25 uur, dubbel en niet-bestaand uur", () => {
  for (const [j, m, d, b, e] of REF.lokdagen) assert.deepEqual(C.lokdagGrenzen(j, m, d), [b, e]);
  assert.equal(C.nlNaarUtc(2026, 10, 25, 2, 0), Date.UTC(2026, 9, 25, 0, 0));      // eerste 02:00 (CEST)
  assert.equal(C.nlNaarUtc(2026, 10, 25, 3, 0), Date.UTC(2026, 9, 25, 2, 0));
  assert.equal(C.nlNaarUtc(2026, 3, 29, 2, 0), Date.UTC(2026, 2, 29, 1, 0));       // bestaat niet → 03:00 CEST
  assert.equal(C.tzLabel(Date.UTC(2026, 6, 1)), "CEST");
  assert.equal(C.tzLabel(Date.UTC(2026, 11, 1)), "CET");
  assert.equal(C.nlTijd(Date.UTC(2026, 9, 22, 22)), "vrijdag 23 oktober 2026 00:00");
});

test("beschikbaarheid volgt index.dagen en uren_klaar", () => {
  const idx = { dagen: { "20261025": { uren_klaar: 24, rev: "a" }, "20261026": { uren_klaar: 5, rev: "b" } } };
  const be = C.maakBeschikbaar(idx);
  assert.ok(be({ begin: Date.UTC(2026, 9, 26, 4), eind: Date.UTC(2026, 9, 26, 5) }));
  assert.ok(!be({ begin: Date.UTC(2026, 9, 26, 5), eind: Date.UTC(2026, 9, 26, 6) }));
  assert.ok(!be({ begin: Date.UTC(2026, 9, 24, 23), eind: Date.UTC(2026, 9, 25, 1) }));
  assert.equal(C.blokRevisie(idx, { begin: Date.UTC(2026, 9, 25, 3), eind: Date.UTC(2026, 9, 25, 4) }), "a");
  assert.match(C.blokRevisie(idx, { begin: Date.UTC(2026, 9, 25, 8), eind: Date.UTC(2026, 9, 26, 8) }), /^[0-9a-f]{8}$/);
});

test("toplijst ontdubbelt aangrenzende cellen", () => {
  const n = C.NRIJ * C.NKOL, som = new Uint32Array(n), tel = new Uint16Array(n).fill(1);
  som[100 * C.NKOL + 100] = 5000; som[100 * C.NKOL + 101] = 4990; som[101 * C.NKOL + 100] = 4980;
  som[300 * C.NKOL + 300] = 3000;
  const top = C.toplijst({ som, tel }, () => true, 5, 10);
  assert.deepEqual(top.map((t) => t.som), [5000, 3000]);
  assert.equal(C.toplijst({ som, tel }, () => true, 5, 0).length, 4);
});

test("reeksstatistiek: ontbrekend uur is geen 0, natste uur en 24 uur", () => {
  const U = C.UUR, uren = [];
  for (let i = 0; i < 30; i++) uren.push({ t: i * U, som: i === 3 ? null : i === 10 ? 900 : 100, tel: 12, verwacht: 12 });
  const s = C.reeksStatistiek(uren);
  assert.equal(s.ontbrekend, 1);
  assert.equal(s.totaal, 28 * 100 + 900);
  assert.equal(s.natsteUur.t, 10 * U);
  assert.equal(s.natste24.som, 900 + 23 * 100);
  assert.equal(s.natste24.gaten, 0);
  assert.equal(s.cumulatief[29], s.totaal);
});

test("schaal en opmaak", () => {
  const n = 1000, som = new Uint32Array(n).fill(1234), tel = new Uint16Array(n).fill(1);
  assert.equal(C.autoSchaal({ som, tel }), 15);
  assert.deepEqual(C.schaalTicks(50), [0, 10, 20, 30, 40, 50]);
  assert.equal(C.mm(5640), "56,4");
  assert.equal(C.csvRegel(["a;b", 'x"y', 3]), '"a;b";"x""y";3');
  const lut = C.maakLut(16);
  assert.equal(lut.length, 64);
  assert.deepEqual(Array.from(lut.slice(0, 3)), C.PALET[0][1]);
});

test("RD ↔ WGS84 binnen 1,5 m van pyproj (EPSG:28992)", () => {
  for (const [lon, lat, x, y] of REF.rdpunten) {
    const [jx, jy] = C.wgsNaarRd(lon, lat);
    assert.ok(Math.hypot(jx - x, jy - y) < 1.5, `wgs→rd ${lon},${lat}: ${Math.hypot(jx - x, jy - y).toFixed(2)} m`);
    const [lo2, la2] = C.rdNaarWgs(x, y);
    const fout = Math.hypot((lo2 - lon) * 68700, (la2 - lat) * 111200);
    assert.ok(fout < 1.5, `rd→wgs ${x},${y}: ${fout.toFixed(2)} m`);
  }
});
