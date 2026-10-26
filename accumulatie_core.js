/*!
 * Weerlab — Neerslagaccumulatie Nederland: rekenkern (zonder DOM).
 *
 * Gedeeld door neerslagaccumulatie.html en de node-tests
 * (tests/accumulatie_core.test.cjs). Spiegelt accumulatie/raster.py,
 * formaat.py en periode.py; de tests vergelijken beide implementaties.
 *
 *  - Projectie KNMI-radarraster (polaire stereografie, ellipsoïde, lat_ts 60)
 *  - Decoderen van WLA1-velden en WLR1-uurreeksen (gehele 0,01 mm)
 *  - Tijdvakken in UTC ↔ Nederlandse tijd, opdeling in blokken (DP)
 *  - Kleurenschaal, toplijst met ontdubbeling, reeksstatistiek, CSV
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AccuCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── Raster (zie accumulatie/raster.py) ────────────────────────────────────
  var A_KM = 6378.137, B_KM = 6356.752, LAT_TS = 60;
  var ROW_OFF = 3650, COL_OFF = 0;
  var R0 = 200, K0 = 192, NRIJ = 448, NKOL = 384, CHUNK = 32;
  var E2 = 1 - (B_KM / A_KM) * (B_KM / A_KM), E = Math.sqrt(E2);
  var RAD = Math.PI / 180;

  function tFun(phi) {
    var s = Math.sin(phi);
    return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - E * s) / (1 + E * s), E / 2);
  }
  function mFun(phi) { var s = Math.sin(phi); return Math.cos(phi) / Math.sqrt(1 - E2 * s * s); }
  var MC = mFun(LAT_TS * RAD), TC = tFun(LAT_TS * RAD), FAC = A_KM * MC / TC;

  /** rho (rasterkm) als functie van breedte; x = rho·sin λ, y = −rho·cos λ */
  function rhoVanLat(lat) { return FAC * tFun(lat * RAD); }

  function vooruit(lon, lat) {
    var rho = rhoVanLat(lat), l = lon * RAD;
    return [rho * Math.sin(l), -rho * Math.cos(l)];
  }

  function terug(x, y) {
    var rho = Math.hypot(x, y), t = rho / FAC;
    var phi = Math.PI / 2 - 2 * Math.atan(t);
    for (var i = 0; i < 15; i++) {
      var s = Math.sin(phi);
      phi = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - E * s) / (1 + E * s), E / 2));
    }
    return [Math.atan2(x, -y) / RAD, phi / RAD];
  }

  function schaalK(lat) { var p = lat * RAD; return rhoVanLat(lat) / (A_KM * mFun(p)); }

  /** Fractionele index in de uitsnede: rij 0 = noordrand. Celcentrum = index + 0,5. */
  function fracIndex(lon, lat) {
    var xy = vooruit(lon, lat);
    return [-xy[1] - ROW_OFF - R0, xy[0] - COL_OFF - K0];
  }

  /** Cel waarin het punt valt (floor), of null buiten de uitsnede. */
  function celVan(lon, lat) {
    var f = fracIndex(lon, lat), r = Math.floor(f[0]), k = Math.floor(f[1]);
    if (r < 0 || r >= NRIJ || k < 0 || k >= NKOL) return null;
    return [r, k];
  }

  function celcentrum(r, k) {
    var x = (k + K0 + 0.5 + COL_OFF), y = -(r + R0 + 0.5 + ROW_OFF);
    return terug(x, y);   // [lon, lat]
  }

  /** Cellen (indexen) waarvan het centrum binnen straalKm (echte km) van het punt ligt. */
  function cellenInStraal(lon, lat, straalKm) {
    var c = celVan(lon, lat);
    if (!c) return [];
    if (!(straalKm > 0)) return [c[0] * NKOL + c[1]];
    var k = schaalK(lat), rg = straalKm * k, f = fracIndex(lon, lat), uit = [];
    var r0 = Math.max(0, Math.floor(f[0] - rg - 1)), r1 = Math.min(NRIJ - 1, Math.ceil(f[0] + rg + 1));
    var k0 = Math.max(0, Math.floor(f[1] - rg - 1)), k1 = Math.min(NKOL - 1, Math.ceil(f[1] + rg + 1));
    for (var r = r0; r <= r1; r++) for (var q = k0; q <= k1; q++) {
      var dr = r + 0.5 - f[0], dk = q + 0.5 - f[1];
      if (dr * dr + dk * dk <= rg * rg) uit.push(r * NKOL + q);
    }
    if (!uit.length) uit.push(c[0] * NKOL + c[1]);
    return uit;
  }

  // ── Binaire formaten (zie accumulatie/formaat.py) ─────────────────────────
  function unshuffle(u8, off, count, bpw) {
    var out = new Uint8Array(count * bpw);
    for (var b = 0; b < bpw; b++) {
      var base = off + b * count;
      for (var i = 0; i < count; i++) out[i * bpw + b] = u8[base + i];
    }
    return out;
  }
  function alsGetallen(bytes, bpw, count) {
    if (bpw === 1) return new Uint8Array(bytes.buffer, bytes.byteOffset, count);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var out = bpw === 2 ? new Uint16Array(count) : new Uint32Array(count);
    for (var i = 0; i < count; i++) out[i] = bpw === 2 ? dv.getUint16(i * 2, true) : dv.getUint32(i * 4, true);
    return out;
  }

  function decodeerVeld(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (magic !== "WLA1") throw new Error("Geen WLA1-veld");
    var bpw = u8[5], vlag = u8[6], bpt = u8[7];
    var nr = dv.getUint16(8, true), nk = dv.getUint16(10, true), n = nr * nk;
    var v = {
      nr: nr, nk: nk, begin: dv.getInt32(12, true), eind: dv.getInt32(16, true),
      verwacht: dv.getUint32(20, true), aanwezig: dv.getUint32(24, true),
      nRf: dv.getUint32(28, true), nRt: dv.getUint32(32, true), max: dv.getUint32(36, true)
    };
    var off = 48;
    var som = alsGetallen(vlag & 2 ? unshuffle(u8, off, n, bpw) : u8.subarray(off, off + n * bpw), bpw, n);
    off += n * bpw;
    v.som = som instanceof Uint32Array ? som : Uint32Array.from(som);
    if (vlag & 1) {
      var t = alsGetallen(vlag & 2 ? unshuffle(u8, off, n, bpt) : u8.subarray(off, off + n * bpt), bpt, n);
      v.tel = Uint16Array.from(t);
    } else {
      v.tel = new Uint16Array(n).fill(v.aanwezig);
    }
    return v;
  }

  function decodeerReeks(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "WLR1") throw new Error("Geen WLR1-reeks");
    var bpw = u8[5], nu = u8[7], tg = dv.getUint16(20, true), n = nu * tg * tg;
    var off = 32;
    var som = alsGetallen(unshuffle(u8, off, n, bpw), bpw, n);
    off += n * bpw;
    var tel = new Uint8Array(u8.subarray(off, off + n));
    return { uren: nu, tegel: tg, tegelrij: dv.getUint16(8, true), tegelkol: dv.getUint16(10, true),
             begin: dv.getInt32(12, true), geldigTm: dv.getInt32(16, true),
             som: som, tel: tel };
  }

  /** Twee aansluitende velden exact optellen. */
  function telOp(a, b) {
    if (!a) return b;
    if (a.eind !== b.begin) throw new Error("Velden sluiten niet aan");
    var n = a.som.length, som = new Uint32Array(n), tel = new Uint16Array(n);
    for (var i = 0; i < n; i++) { som[i] = a.som[i] + b.som[i]; tel[i] = a.tel[i] + b.tel[i]; }
    return { nr: a.nr, nk: a.nk, begin: a.begin, eind: b.eind, verwacht: a.verwacht + b.verwacht,
             aanwezig: a.aanwezig + b.aanwezig, nRf: a.nRf + b.nRf, nRt: a.nRt + b.nRt,
             som: som, tel: tel };
  }

  // ── Tijd ──────────────────────────────────────────────────────────────────
  var MIN = 60000, UUR = 3600000, DAG = 86400000;
  var NL_TZ = "Europe/Amsterdam";
  var dtf = null;
  function wandklok(ms) {        // {j, m, d, h, mi, wd} in NL-tijd
    if (!dtf) dtf = new Intl.DateTimeFormat("en-GB", { timeZone: NL_TZ, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
    var p = {}; dtf.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return { j: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute,
             wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) };
  }
  function nlOffsetMin(ms) {
    var w = wandklok(ms);
    return Math.round((Date.UTC(w.j, w.m - 1, w.d, w.h, w.mi) - ms) / MIN);
  }
  /**
   * NL wandkloktijd → UTC-ms. Dubbel uur (wintertijd in) → eerste (zomertijd);
   * niet-bestaand uur (zomertijd in) → het uur erna.
   */
  function nlNaarUtc(j, m, d, h, mi) {
    var naief = Date.UTC(j, m - 1, d, h, mi || 0);
    var kand = [naief - 120 * MIN, naief - 60 * MIN];
    for (var i = 0; i < kand.length; i++) {
      var w = wandklok(kand[i]);
      if (w.j === j && w.m === m && w.d === d && w.h === h && w.mi === (mi || 0)) return kand[i];
    }
    return naief - nlOffsetMin(naief - 180 * MIN) * MIN;   // gat: met de offset van vóór de wissel doorschuiven
  }
  function lokdagGrenzen(j, m, d) {
    var n = new Date(Date.UTC(j, m - 1, d + 1));
    return [nlNaarUtc(j, m, d, 0, 0), nlNaarUtc(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), 0, 0)];
  }
  function pad2(x) { return (x < 10 ? "0" : "") + x; }
  function ymd(ms) { var d = new Date(ms); return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()); }

  // ── Blokken en opdeling (spiegel van periode.deel_op, uurresolutie) ──────
  var KOSTEN = { uur: 2, dag: 3, etmaal: 3, lokdag: 3, maand: 4 };

  function kandidaten(t, eind, beschikbaar) {
    var uit = [], d = new Date(t);
    if (d.getUTCMinutes() !== 0) return uit;
    if (t + UUR <= eind) uit.push({ soort: "uur", begin: t, eind: t + UUR, label: ymd(t) + "/" + pad2(d.getUTCHours()) });
    if (d.getUTCHours() === 0) {
      if (t + DAG <= eind) uit.push({ soort: "dag", begin: t, eind: t + DAG, label: ymd(t) });
      if (d.getUTCDate() === 1) {
        var e = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
        if (e <= eind) uit.push({ soort: "maand", begin: t, eind: e, label: ymd(t).slice(0, 6) });
      }
    }
    if (d.getUTCHours() === 8 && t + DAG <= eind) uit.push({ soort: "etmaal", begin: t, eind: t + DAG, label: ymd(t + DAG) });
    var w = wandklok(t);
    if (w.h === 0 && w.mi === 0) {
      var g = lokdagGrenzen(w.j, w.m, w.d);
      if (g[0] === t && g[1] <= eind) uit.push({ soort: "lokdag", begin: t, eind: g[1], label: "" + w.j + pad2(w.m) + pad2(w.d) });
    }
    return uit.filter(function (b) { return beschikbaar(b); });
  }

  /** Kortste opdeling van (begin, eind] in beschikbare blokken; null als het niet kan. */
  function deelOp(begin, eind, beschikbaar) {
    if (eind <= begin) return [];
    if ((begin % UUR) || (eind % UUR)) throw new Error("Eigen periode moet op hele uren liggen");
    var n = (eind - begin) / UUR, best = new Float64Array(n + 1).fill(Infinity), vorig = new Array(n + 1);
    best[0] = 0;
    for (var i = 0; i < n; i++) {
      if (best[i] === Infinity) continue;
      var ks = kandidaten(begin + i * UUR, eind, beschikbaar);
      for (var q = 0; q < ks.length; q++) {
        var b = ks[q], j = (b.eind - begin) / UUR, c = best[i] + KOSTEN[b.soort];
        if (c < best[j]) { best[j] = c; vorig[j] = [i, b]; }
      }
    }
    if (best[n] === Infinity) return null;
    var uit = [], j2 = n;
    while (j2) { uit.push(vorig[j2][1]); j2 = vorig[j2][0]; }
    return uit.reverse();
  }

  /** Pad (relatief aan de databasis) van een blok. */
  function blokPad(b) {
    if (b.soort === "uur") return "uur/" + b.label + ".bin.gz";
    if (b.soort === "maand") return "maand/" + b.label + ".bin.gz";
    return b.soort + "/" + b.label.slice(0, 4) + "/" + b.label + ".bin.gz";
  }

  /** UTC-dagen (YYYYMMDD) die een blok raakt — voor beschikbaarheid en revisies. */
  function dagenVan(begin, eind) {
    var uit = [], t = Math.floor(begin / DAG) * DAG;
    while (t < eind) { uit.push(ymd(t)); t += DAG; }
    return uit;
  }

  /**
   * Beschikbaarheid volgens index.json: een blok bestaat als alle uren erin
   * zijn afgesloten (dagen[D].uren_klaar) in dagen die in de index staan.
   */
  function maakBeschikbaar(index) {
    var dagen = index.dagen || {};
    return function (b) {
      for (var t = b.begin; t < b.eind; t += UUR) {
        var dg = dagen[ymd(t)];
        if (!dg) return false;
        if (new Date(t).getUTCHours() >= (dg.uren_klaar == null ? 24 : dg.uren_klaar)) return false;
      }
      return true;
    };
  }
  function blokRevisie(index, b) {
    var dagen = index.dagen || {};
    var revs = dagenVan(b.begin, b.eind).map(function (d) { return dagen[d] ? dagen[d].rev : "x"; });
    return revs.length === 1 ? revs[0] : korteHash(revs.join(""));
  }
  function korteHash(s) {          // FNV-1a, voor lange revisieketens (maanden)
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  // ── Presets op de client (voor de beschrijving; de velden komen van de server) ─
  // ── Kleurenschaal ─────────────────────────────────────────────────────────
  var PALET = [
    [0.00, [205, 232, 255]], [0.035, [140, 200, 250]], [0.09, [56, 140, 235]],
    [0.17, [25, 190, 200]], [0.26, [45, 190, 85]], [0.35, [160, 215, 40]],
    [0.44, [255, 225, 30]], [0.53, [255, 160, 25]], [0.62, [240, 70, 30]],
    [0.71, [215, 30, 110]], [0.80, [190, 45, 210]], [0.90, [120, 45, 195]],
    [1.00, [60, 20, 105]]
  ];
  function paletKleur(f) {
    f = Math.max(0, Math.min(1, f));
    for (var i = 1; i < PALET.length; i++) {
      if (f <= PALET[i][0]) {
        var a = PALET[i - 1], b = PALET[i], w = (f - a[0]) / (b[0] - a[0]);
        return [0, 1, 2].map(function (c) { return Math.round(a[1][c] + w * (b[1][c] - a[1][c])); });
      }
    }
    return PALET[PALET.length - 1][1].slice();
  }
  /** LUT van 1024 RGBA-kleuren over [0, max] mm. */
  function maakLut(n) {
    n = n || 1024;
    var lut = new Uint8ClampedArray(n * 4);
    for (var i = 0; i < n; i++) {
      var c = paletKleur(i / (n - 1));
      lut[i * 4] = c[0]; lut[i * 4 + 1] = c[1]; lut[i * 4 + 2] = c[2]; lut[i * 4 + 3] = 255;
    }
    return lut;
  }
  var NETTE_MAXIMA = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000];
  /** Automatische schaal: kleinste nette waarde ≥ het 99,9e percentiel binnen NL. */
  function autoSchaal(veld, masker) {
    var w = [];
    for (var i = 0; i < veld.som.length; i++) if (veld.tel[i] > 0 && (!masker || masker[i])) w.push(veld.som[i]);
    if (!w.length) return 10;
    w.sort(function (a, b) { return a - b; });
    var p = w[Math.min(w.length - 1, Math.floor(w.length * 0.999))] / 100;
    for (var q = 0; q < NETTE_MAXIMA.length; q++) if (NETTE_MAXIMA[q] >= p) return NETTE_MAXIMA[q];
    return NETTE_MAXIMA[NETTE_MAXIMA.length - 1];
  }
  function schaalTicks(max) {
    var stap = max <= 10 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : max <= 150 ? 25 : max <= 300 ? 50 : 100;
    var uit = [];
    for (var v = 0; v <= max + 1e-9; v += stap) uit.push(v);
    return uit;
  }

  // ── Toplijst ──────────────────────────────────────────────────────────────
  /**
   * Natste plekken met ontdubbeling: een kandidaat telt alleen als hij verder
   * dan minKm (echte km) van alle eerder gekozen maxima ligt. Zo verschijnt
   * één neerslagkern niet tien keer als aangrenzende cellen.
   */
  function toplijst(veld, filter, n, minKm) {
    var kand = [];
    for (var i = 0; i < veld.som.length; i++) if (veld.tel[i] > 0 && veld.som[i] > 0 && filter(i)) kand.push(i);
    kand.sort(function (a, b) { return veld.som[b] - veld.som[a]; });
    var gekozen = [];
    for (var q = 0; q < kand.length && gekozen.length < n; q++) {
      var c = kand[q], r = Math.floor(c / NKOL), k = c % NKOL, ll = celcentrum(r, k), kk = schaalK(ll[1]);
      var ok = true;
      for (var g = 0; g < gekozen.length; g++) {
        var dr = gekozen[g].r - r, dk = gekozen[g].k - k;
        if (Math.sqrt(dr * dr + dk * dk) / kk < minKm) { ok = false; break; }
      }
      if (ok) gekozen.push({ cel: c, r: r, k: k, lon: ll[0], lat: ll[1], som: veld.som[c], tel: veld.tel[c] });
    }
    return gekozen;
  }

  function dichtstePlaats(lon, lat, plaatsen, maxKm) {
    var best = null, bd = Infinity, cl = Math.cos(lat * RAD);
    for (var i = 0; i < plaatsen.length; i++) {
      var p = plaatsen[i], dx = (p.lon - lon) * cl * 111.32, dy = (p.lat - lat) * 110.57, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || Math.sqrt(bd) > (maxKm || 8)) return null;
    return { plaats: best, km: Math.sqrt(bd) };
  }

  // ── Reeksstatistiek ───────────────────────────────────────────────────────
  /**
   * uren: [{t (UTC-ms begin uur), som (0,01 mm) | null, tel, verwacht}]
   * Een uur zonder enige waarneming is null (ontbreekt), nooit 0.
   */
  function reeksStatistiek(uren) {
    var totaal = 0, natsteUur = null, cum = [], ontbrekend = 0, onvolledig = 0, run = 0;
    for (var i = 0; i < uren.length; i++) {
      var u = uren[i];
      if (u.som == null) { ontbrekend++; cum.push(run); continue; }
      if (u.tel < u.verwacht) onvolledig++;
      run += u.som; cum.push(run); totaal += u.som;
      if (!natsteUur || u.som > natsteUur.som) natsteUur = u;
    }
    var natste24 = null;
    if (uren.length >= 24) {
      var som = 0, gat = 0;
      for (var j = 0; j < uren.length; j++) {
        som += uren[j].som || 0; if (uren[j].som == null) gat++;
        if (j >= 24) { som -= uren[j - 24].som || 0; if (uren[j - 24].som == null) gat--; }
        if (j >= 23 && (!natste24 || som > natste24.som)) natste24 = { begin: uren[j - 23].t, eind: uren[j].t + UUR, som: som, gaten: gat };
      }
    }
    return { totaal: totaal, cumulatief: cum, natsteUur: natsteUur, natste24: natste24,
             ontbrekend: ontbrekend, onvolledig: onvolledig };
  }

  // ── Opmaak ────────────────────────────────────────────────────────────────
  function mm(honderdsten, dec) {
    if (honderdsten == null) return "–";
    return (honderdsten / 100).toFixed(dec == null ? 1 : dec).replace(".", ",");
  }
  var DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
  var MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus",
                 "september", "oktober", "november", "december"];
  function nlTijd(ms, opties) {
    var w = wandklok(ms);
    var s = (opties && opties.kort ? DAGEN[w.wd].slice(0, 2) : DAGEN[w.wd]) + " " + w.d + " " +
      (opties && opties.kort ? MAANDEN[w.m - 1].slice(0, 3) : MAANDEN[w.m - 1]);
    if (!opties || !opties.zonderJaar) s += " " + w.j;
    return s + " " + pad2(w.h) + ":" + pad2(w.mi);
  }
  function tzLabel(ms) { return nlOffsetMin(ms) === 120 ? "CEST" : "CET"; }

  function csvRegel(waarden) {
    return waarden.map(function (v) {
      v = v == null ? "" : String(v);
      return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(";");
  }

  // ── RD (EPSG:28992) — benaderingsformules Schreutelkamp & Strang van Hees ──
  // Nauwkeurig tot ~1 m binnen Nederland (getoetst tegen pyproj in de tests).
  var RD_K = [[0, 1, 3235.65389], [2, 0, -32.58297], [0, 2, -0.24750], [2, 1, -0.84978], [0, 3, -0.06550],
              [2, 2, -0.01709], [1, 0, -0.00738], [4, 0, 0.00530], [2, 3, -0.00039], [4, 1, 0.00033], [1, 1, -0.00012]];
  var RD_L = [[1, 0, 5260.52916], [1, 1, 105.94684], [1, 2, 2.45656], [3, 0, -0.81885], [1, 3, 0.05594],
              [3, 1, -0.05607], [0, 1, 0.01199], [3, 2, -0.00256], [1, 4, 0.00128], [0, 2, 0.00022],
              [2, 0, -0.00022], [5, 0, 0.00026]];
  var RD_R = [[0, 1, 190094.945], [1, 1, -11832.228], [2, 1, -114.221], [0, 3, -32.391], [1, 0, -0.705],
              [3, 1, -2.340], [1, 3, -0.608], [0, 2, -0.008], [2, 3, 0.148]];
  var RD_S = [[1, 0, 309056.544], [0, 2, 3638.893], [2, 0, 73.077], [1, 2, -157.984], [3, 0, 59.788],
              [0, 1, 0.433], [2, 2, -6.439], [1, 1, -0.032], [0, 4, 0.092], [1, 4, -0.054]];
  function rdNaarWgs(x, y) {
    var dx = (x - 155000) * 1e-5, dy = (y - 463000) * 1e-5, la = 0, lo = 0, i;
    for (i = 0; i < RD_K.length; i++) la += RD_K[i][2] * Math.pow(dx, RD_K[i][0]) * Math.pow(dy, RD_K[i][1]);
    for (i = 0; i < RD_L.length; i++) lo += RD_L[i][2] * Math.pow(dx, RD_L[i][0]) * Math.pow(dy, RD_L[i][1]);
    return [5.38720621 + lo / 3600, 52.15517440 + la / 3600];
  }
  function wgsNaarRd(lon, lat) {
    var dp = 0.36 * (lat - 52.15517440), dl = 0.36 * (lon - 5.38720621), x = 155000, y = 463000, i;
    for (i = 0; i < RD_R.length; i++) x += RD_R[i][2] * Math.pow(dp, RD_R[i][0]) * Math.pow(dl, RD_R[i][1]);
    for (i = 0; i < RD_S.length; i++) y += RD_S[i][2] * Math.pow(dp, RD_S[i][0]) * Math.pow(dl, RD_S[i][1]);
    return [x, y];
  }
  /** Kader van de Weerlab-regiokaart Rijnmond (RD, 1920×1080, zie accumulatie/regiokaart.py). */
  var REGIOKAART = { x0: 44075.95, y1: 455292.51, m: 45.7911, b: 1920, h: 1080 };

  // ── GeoTIFF ───────────────────────────────────────────────────────────────
  /**
   * GeoTIFF (ArrayBuffer) in het oorspronkelijke KNMI-raster, zonder herprojectie:
   * float32, nodata -9999, polaire stereografie (lat_ts 60) op de KNMI-ellipsoïde,
   * coördinaten in meter. x0/y0 = linkerbovenhoek (m), cel = celgrootte (m).
   */
  function maakGeoTiff(pix, w, h, x0, y0, cel, omschrijving) {
    var keys = [ // [key, location, count, value]
      [1024, 0, 1, 1], [1025, 0, 1, 1], [1026, 34737, 0, "KNMI RAD_NL25 polar stereographic|"],
      [2048, 0, 1, 32767], [2049, 34737, 0, "KNMI radar ellipsoid|"], [2050, 0, 1, 32767], [2054, 0, 1, 9102],
      [2056, 0, 1, 32767], [2057, 34736, 1, 6378137], [2058, 34736, 1, 6356752],
      [3072, 0, 1, 32767], [3074, 0, 1, 32767], [3075, 0, 1, 15], [3076, 0, 1, 9001],
      [3081, 34736, 1, 60], [3082, 34736, 1, 0], [3083, 34736, 1, 0], [3092, 34736, 1, 1], [3095, 34736, 1, 0]
    ];
    var dbl = [], asc = "", dir = [1, 1, 0, keys.length];
    keys.forEach(function (k) {
      if (k[1] === 34736) { dir.push(k[0], 34736, 1, dbl.length); dbl.push(k[3]); }
      else if (k[1] === 34737) { dir.push(k[0], 34737, k[3].length, asc.length); asc += k[3]; }
      else dir.push(k[0], 0, 1, k[3]);
    });
    var omschr = omschrijving.replace(/[^\x20-\x7e]/g, "?") + "\0";
    var tags = [
      [256, 3, 1, w], [257, 3, 1, h], [258, 3, 1, 32], [259, 3, 1, 1], [262, 3, 1, 1],
      [270, 2, omschr.length, omschr], [273, 4, 1, 0], [277, 3, 1, 1], [278, 3, 1, h], [279, 4, 1, w * h * 4],
      [284, 3, 1, 1], [339, 3, 1, 3], [33550, 12, 3, [cel, cel, 0]], [33922, 12, 6, [0, 0, 0, x0, y0, 0]],
      [34735, 3, dir.length, dir], [34736, 12, dbl.length, dbl], [34737, 2, asc.length + 1, asc + "\0"], [42113, 2, 6, "-9999\0"]
    ];
    var grootte = { 2: 1, 3: 2, 4: 4, 12: 8 };
    var ifdOff = 8, ifdLen = 2 + tags.length * 12 + 4, extraOff = ifdOff + ifdLen, extra = [];
    tags.forEach(function (t) {
      var n = t[2] * grootte[t[1]];
      t.groot = n > 4;
      if (t.groot) { t.off = extraOff; extraOff += n + (n % 2); }
    });
    var dataOff = extraOff + (extraOff % 4 ? 4 - extraOff % 4 : 0);
    tags.forEach(function (t) { if (t[0] === 273) t[3] = dataOff; });
    var buf = new ArrayBuffer(dataOff + w * h * 4), dv = new DataView(buf);
    dv.setUint8(0, 0x49); dv.setUint8(1, 0x49); dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true);
    dv.setUint16(ifdOff, tags.length, true);
    function schrijfWaarden(off, t) {
      var vals = typeof t[3] === "string" ? t[3] : [].concat(t[3]);
      for (var i = 0; i < t[2]; i++) {
        if (t[1] === 2) dv.setUint8(off + i, vals.charCodeAt(i));
        else if (t[1] === 3) dv.setUint16(off + i * 2, vals[i], true);
        else if (t[1] === 4) dv.setUint32(off + i * 4, vals[i], true);
        else if (t[1] === 12) dv.setFloat64(off + i * 8, vals[i], true);
      }
    }
    tags.forEach(function (t, i) {
      var o = ifdOff + 2 + i * 12;
      dv.setUint16(o, t[0], true); dv.setUint16(o + 2, t[1], true); dv.setUint32(o + 4, t[2], true);
      if (t.groot) { dv.setUint32(o + 8, t.off, true); schrijfWaarden(t.off, t); } else schrijfWaarden(o + 8, t);
    });
    dv.setUint32(ifdOff + 2 + tags.length * 12, 0, true);
    for (var i = 0; i < pix.length; i++) dv.setFloat32(dataOff + i * 4, pix[i], true);
    return buf;
  }

  return {
    maakGeoTiff: maakGeoTiff, rdNaarWgs: rdNaarWgs, wgsNaarRd: wgsNaarRd, REGIOKAART: REGIOKAART,
    R0: R0, K0: K0, NRIJ: NRIJ, NKOL: NKOL, CHUNK: CHUNK, ROW_OFF: ROW_OFF, COL_OFF: COL_OFF,
    UUR: UUR, DAG: DAG, MIN: MIN,
    rhoVanLat: rhoVanLat, vooruit: vooruit, terug: terug, schaalK: schaalK, fracIndex: fracIndex,
    celVan: celVan, celcentrum: celcentrum, cellenInStraal: cellenInStraal,
    decodeerVeld: decodeerVeld, decodeerReeks: decodeerReeks, telOp: telOp,
    wandklok: wandklok, nlOffsetMin: nlOffsetMin, nlNaarUtc: nlNaarUtc, lokdagGrenzen: lokdagGrenzen, ymd: ymd,
    deelOp: deelOp, blokPad: blokPad, dagenVan: dagenVan, maakBeschikbaar: maakBeschikbaar,
    blokRevisie: blokRevisie, korteHash: korteHash,
    PALET: PALET, paletKleur: paletKleur, maakLut: maakLut, autoSchaal: autoSchaal, schaalTicks: schaalTicks,
    NETTE_MAXIMA: NETTE_MAXIMA,
    toplijst: toplijst, dichtstePlaats: dichtstePlaats, reeksStatistiek: reeksStatistiek,
    mm: mm, nlTijd: nlTijd, tzLabel: tzLabel, csvRegel: csvRegel, pad2: pad2
  };
});
