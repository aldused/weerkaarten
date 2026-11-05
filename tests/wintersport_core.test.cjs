// node --test weerlab/tests/wintersport_core.test.cjs
const test = require("node:test");
const assert = require("node:assert");
const W = require("../wintersport-core.js");

const g = (id, cluster, regio, berg, s48) => ({ id, naam: id, cluster, regio, land: "AT", punten: { berg: { hoogte: berg }, dal: { hoogte: 800 }, midden: { hoogte: 1500 } },
  sommen: { berg: { "48": s48 === null ? null : { sneeuw_cm: s48, neerslag_mm: s48, regen_mm: 0, modellen: ["C-LAEF 1 km"] } } } });

test("afronding verse sneeuw: geen schijnnauwkeurigheid", () => {
  assert.deepStrictEqual([0.2, 3.4, 12, 13, 63.7].map(W.cm), [0, 3, 10, 15, 60]);
  assert.strictEqual(W.fmtCm(null), "—");
  assert.strictEqual(W.fmtCm(0.3), "<1");
});

test("finder: drempel, hoogte, één skidomein telt één keer", () => {
  const rows = W.finder([g("lech", "arlberg", "at", 2800, 30), g("st-anton", "arlberg", "at", 2800, 25), g("ischgl", "ischgl", "at", 2870, 12), g("laag", "laag", "at", 1200, 40)],
    { win: 48, hgt: "berg", min: 10, alt: 2000, regio: "" });
  assert.deepStrictEqual(rows.map(r => r.g.id), ["lech", "ischgl"]);
  assert.deepStrictEqual(rows[0].ook, ["st-anton"]);
});

test("ontbrekende som is geen 0", () => {
  const rows = W.finder([g("x", "x", "at", 2500, null)], { win: 48, hgt: "berg", min: 0, alt: 0, regio: "" });
  assert.strictEqual(rows.length, 0);
});

test("favorieten in localStorage", () => {
  const store = { d: {}, getItem(k) { return this.d[k] || null; }, setItem(k, v) { this.d[k] = v; } };
  assert.deepStrictEqual(W.favToggle(store, "ischgl"), ["ischgl"]);
  assert.deepStrictEqual(W.favToggle(store, "soelden"), ["ischgl", "soelden"]);
  assert.deepStrictEqual(W.favToggle(store, "ischgl"), ["soelden"]);
  store.d[W.FAV_KEY] = "kapot{";
  assert.deepStrictEqual(W.favLoad(store), []);
});

test("meldingsregels evalueren alleen lokaal", () => {
  const hits = W.alertHits([g("a", "a", "at", 2500, 25)], [{ id: "a", venster: 48, hoogte: "berg", drempel_cm: 20 }, { id: "a", venster: 48, hoogte: "berg", drempel_cm: 30 }]);
  assert.strictEqual(hits.length, 1);
});

test("zoeken zonder accenten", () => {
  assert.ok(W.matches({ naam: "Sölden", gebied: "Tirol · Ötztal", regio_naam: "Oostenrijkse Alpen", land: "AT" }, "solden otztal"));
});
