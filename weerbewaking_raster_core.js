/* Gedeelde logica van het weekraster. GEGENEREERD door MeteobewakingWin/scripts/sync_web.py uit src/core.js (eigen localStorage-prefix 'raster.'). */
// Gedeelde logica: eenheden, tijd, feed, zon, symbolen, waarschuwingen, regenverwachting.
(function (g) {
  'use strict';
  const BASE = 'https://weatherpro.consumer.meteogroup.com/weatherpro/';
  const nl = 'nl-NL';

  // ---------- voorkeuren ----------
  const DEFAULTS = { temp: 'c', wind: 'bftkmh', pressure: 'hpa', rain: 'mm', days: 7,
    alertsOn: true, alertGust: 75, alertRain: 5, alertHeat: 30, alertFrost: 0, alertsOff: [] };
  const prefs = Object.assign({}, DEFAULTS, safeJSON(localStorage.getItem('raster.prefs'), {}));
  function savePrefs() { localStorage.setItem('raster.prefs', JSON.stringify(prefs)); }
  function safeJSON(s, d) { try { return s ? JSON.parse(s) : d; } catch { return d; } }

  // ---------- eenheden ----------
  const KN = 1.852;
  const bft = (kn) => { const ms = kn * 0.514444; const l = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7]; const i = l.findIndex(x => ms < x); return i < 0 ? 12 : i; };
  const isBft = () => prefs.wind === 'bft' || prefs.wind === 'bftkmh';
  const windVal = (kn) => ({ kmh: kn * KN, kn: kn, ms: kn * 0.514444, mph: kn * 1.15078, bft: bft(kn), bftkmh: bft(kn) })[prefs.wind];
  const windLabel = () => ({ kmh: 'km/u', kn: 'kn', ms: 'm/s', mph: 'mph', bft: 'Bft', bftkmh: 'Bft' })[prefs.wind];
  const half = (v) => Math.floor(v + 0.5);               // half-up zoals de app
  const num = (v, d = 1) => v.toLocaleString(nl, { maximumFractionDigits: d });
  const tconv = (c) => prefs.temp === 'c' ? c : c * 9 / 5 + 32;
  const tunit = () => prefs.temp === 'c' ? '°C' : '°F';
  const fT = (c, unit = true) => c == null ? '–' : half(tconv(c)) + (unit ? '°' : '');
  const fTC = (c) => c == null ? '–' : half(tconv(c)) + tunit();
  const fW = (kn) => kn == null ? '–' : half(windVal(kn)) + ' ' + windLabel();
  const fG = (kn) => kn == null ? '–' : prefs.wind === 'bftkmh' ? half(kn * KN) + ' km/u' : fW(kn);
  const pconv = (h) => prefs.pressure === 'hpa' ? h : prefs.pressure === 'inhg' ? h * 0.02953 : h * 0.750062;
  const pu = () => ({ hpa: 'hPa', inhg: 'inHg', mmhg: 'mmHg' })[prefs.pressure];
  const fP = (h) => h == null ? '–' : (prefs.pressure === 'inhg' ? pconv(h).toFixed(2) : Math.round(pconv(h))) + ' ' + pu();
  const rconv = (mm) => prefs.rain === 'mm' ? mm : mm / 25.4;
  const ru = () => prefs.rain === 'mm' ? 'mm' : 'in';
  const fR = (mm) => mm == null ? '–' : (mm < 0.1 && mm > 0 ? '<0,1' : num(rconv(mm), prefs.rain === 'mm' ? 1 : 2)) + ' ' + ru();
  const fPct = (v) => v == null ? '–' : Math.round(v) + '%';
  const COMPASS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OZO', 'ZO', 'ZZO', 'Z', 'ZZW', 'ZW', 'WZW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = (d) => d == null ? '–' : COMPASS[Math.round(d / 22.5) % 16];
  const humidity = (t, td) => (t == null || td == null) ? null : Math.min(100, 100 * Math.exp(17.625 * td / (243.04 + td)) / Math.exp(17.625 * t / (243.04 + t)));
  /** windchill (JAG/TI) t/m 10°C bij >4,8 km/u; hitte-index vanaf 26°C; anders de temperatuur. 10°C @ 15 kn -> 7°. */
  function feelsLike(t, td, kn) {
    if (t == null) return null;
    const v = (kn || 0) * 1.852;
    if (t <= 10 && v > 4.8) { const p = Math.pow(v, 0.16); return 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p; }
    const rh = humidity(t, td);
    if (t >= 26 && rh != null && rh >= 40) { const f = t * 9 / 5 + 32; const hi = -42.379 + 2.04901523 * f + 10.14333127 * rh - 0.22475541 * f * rh - 0.00683783 * f * f - 0.05481717 * rh * rh + 0.00122874 * f * f * rh + 0.00085282 * f * rh * rh - 0.00000199 * f * f * rh * rh; return Math.max(t, (hi - 32) * 5 / 9); }
    return t;
  }
  const apparent = (t, td, kn) => feelsLike(t, td, kn);
  const _oldApparent = (t, td, kn) => { const rh = humidity(t, td); if (rh == null) return null; const e = rh / 100 * 6.105 * Math.exp(17.27 * t / (237.7 + t)); return t + 0.33 * e - 0.70 * (kn || 0) * 0.514444 - 4; };

  // ---------- tijd in tijdzone ----------
  const fmtCache = {};
  function dtf(tz, opts) { const k = tz + JSON.stringify(opts); return fmtCache[k] || (fmtCache[k] = new Intl.DateTimeFormat(nl, Object.assign({ timeZone: tz }, opts))); }
  const parts = (d, tz) => { const o = {}; for (const p of dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d)) o[p.type] = +p.value; return o; };
  const offsetMs = (d, tz) => { const p = parts(d, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000; };
  /** Lokale middernacht (in tz) van kalenderdag y-m-d (maand 0-based, dag mag overlopen). */
  function zonedMidnight(y, m, d, tz) {
    const guess = Date.UTC(y, m, d);
    let t = guess - offsetMs(new Date(guess), tz);
    t = guess - offsetMs(new Date(t), tz);
    return new Date(t);
  }
  function todayStart(tz, now = new Date()) { const p = parts(now, tz); return zonedMidnight(p.year, p.month - 1, p.day, tz); }
  function addDays(start, n, tz) { const p = parts(new Date(start.getTime() + 12 * 3600e3), tz); return zonedMidnight(p.year, p.month - 1, p.day + n, tz); }
  const hh = (d, tz) => dtf(tz, { hour: '2-digit', hourCycle: 'h23' }).format(d).padStart(2, '0');
  const hm = (d, tz) => dtf(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const wdShort = (d, tz) => dtf(tz, { weekday: 'short' }).format(d).replace('.', '');
  const wdLong = (d, tz) => dtf(tz, { weekday: 'long' }).format(d);
  const ddmm = (d, tz) => { const p = parts(d, tz); return String(p.day).padStart(2, '0') + '-' + String(p.month).padStart(2, '0'); };
  const dmon = (d, tz) => dtf(tz, { day: 'numeric', month: 'long' }).format(d);
  const ymd = (d, tz) => { const p = parts(d, tz); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };

  // ---------- zon ----------
  function elevation(date, lat, lon) {
    const jd = date.getTime() / 86400000 + 2440587.5, n = jd - 2451545.0, r = Math.PI / 180;
    const L = (280.460 + 0.9856474 * n) % 360, gg = ((357.528 + 0.9856003 * n) % 360) * r;
    const lam = (L + 1.915 * Math.sin(gg) + 0.020 * Math.sin(2 * gg)) * r, eps = (23.439 - 0.0000004 * n) * r;
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam)), ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    const gmst = (18.697374558 + 24.06570982441908 * n) % 24, lst = (gmst * 15 + lon) * r, ha = lst - ra, la = lat * r;
    return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / r;
  }
  const isNight = (d, lat, lon) => elevation(d, lat, lon) < -0.833;
  function riseSet(dayStart, lat, lon) {
    let rise = null, set = null, prev = elevation(dayStart, lat, lon);
    for (let m = 1; m <= 1440; m++) {
      const t = new Date(dayStart.getTime() + m * 60000), e = elevation(t, lat, lon);
      if (!rise && prev < -0.833 && e >= -0.833) rise = new Date(t.getTime() - 60000);   // opkomst naar beneden afronden (zoals WeatherPro)
      if (!set && prev >= -0.833 && e < -0.833) set = t;
      prev = e;
    }
    return { rise, set };
  }

  // ---------- feed ----------
  async function loadFeed(lid) {
    const xml = await api.fetchText(`${BASE}WeatherServiceFeed.php?format=xml&lid=${lid}&mode=premium`);
    return parseFeed(xml);
  }
  const N = (e, k) => { const v = e.getAttribute(k); return v == null || v === '' ? null : Number(v); };
  function parseFeed(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('feed onleesbaar');
    const f = { obs: null, days: [], hours: [], fetched: Date.now() };
    const fc = doc.querySelector('forecast'); f.expires = fc && N(fc, 'expires') ? N(fc, 'expires') * 1000 : null;
    const o = doc.querySelector('obs');
    if (o) f.obs = { date: new Date(o.getAttribute('dtg')), temp: N(o, 'tt'), dew: N(o, 'td'), ww: N(o, 'ww'), cloud: N(o, 'n'), dir: N(o, 'dd'), kn: N(o, 'ff'), gust: N(o, 'ffg'), p: N(o, 'ppp'), rain: N(o, 'rrr'), rainH: N(o, 'rrrh'), symbol: o.getAttribute('symbol') };
    doc.querySelectorAll('day').forEach(e => f.days.push({ date: new Date(e.getAttribute('dtg')), tx: N(e, 'tx'), tn: N(e, 'tn'), ww: N(e, 'ww'), cloud: N(e, 'n'), dir: N(e, 'dd'), kn: N(e, 'ff'), gust: N(e, 'ffg'), sun: N(e, 'sun'), uvi: N(e, 'uvi'), uvLow: N(e, 'uvic'), rain: N(e, 'rrr'), rainN: N(e, 'rrr_n'), prob: N(e, 'prrr'), symbol: e.getAttribute('symbol'), symbolN: e.getAttribute('symbol_n') }));
    doc.querySelectorAll('hour').forEach(e => { const iv = (N(e, 'interval') || 3600) * 1000, d = new Date(e.getAttribute('dtg')); f.hours.push({ date: d, interval: iv, start: new Date(d.getTime() - iv), temp: N(e, 'tt'), dew: N(e, 'td'), ww: N(e, 'ww'), cloud: N(e, 'n'), dir: N(e, 'dd'), kn: N(e, 'ff'), gust: N(e, 'ffg'), p: N(e, 'ppp'), sun: N(e, 'sun'), rain: N(e, 'rrr'), prob: N(e, 'prrr'), symbol: e.getAttribute('symbol') }); });
    if (!f.days.length && !f.hours.length) throw new Error('lege feed');
    return f;
  }
  async function search(q) {
    const xml = await api.fetchText(`${BASE}SearchFeed.php?search=${encodeURIComponent(q)}`);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return [...doc.querySelectorAll('city')].map(c => ({ id: +c.getAttribute('id'), name: c.getAttribute('name'), region: c.getAttribute('province-name') || '', country: c.getAttribute('country-name') || '', lat: +c.getAttribute('latitude'), lon: +c.getAttribute('longitude'), tz: c.getAttribute('timezone') || 'UTC' }));
  }

  // ---------- symboolcode ----------
  /** [0] 1 zon/2 maan/9 geen · [1] bewolking 9/1/2/3 · [2] regen · [3] sneeuw · [5] 2 onweer 6 nevel 7 mist · [6] 2 windstoot */
  function decode(s, ww, octa) {
    if (s && /^\d{3,}$/.test(s)) { const d = [...s].map(Number); return { sky: d[0] === 1 || d[0] === 2, cloud: d[1] === 9 ? 0 : d[1], rain: d[2] === 9 ? 0 : d[2], snow: d[3] != null && d[3] !== 9 ? d[3] : 0, thunder: d[5] === 2, mist: d[5] === 6 || d[5] === 7, gust: d[6] === 2 }; }
    const n = octa || 0, w = ww || 0;
    const c = { sky: n < 7, cloud: n <= 1 ? 0 : n <= 3 ? 1 : n <= 6 ? 2 : 3, rain: 0, snow: 0, thunder: false, mist: [10, 40, 41, 42, 43, 44, 45, 46, 47, 48].includes(w), gust: false };
    if (w >= 95) { c.rain = 3; c.thunder = true; } else if (w === 65) c.rain = 5; else if ([63, 81, 82].includes(w)) c.rain = 3; else if ((w >= 50 && w <= 62) || [80, 25, 21, 20].includes(w)) c.rain = 1;
    if ((w >= 70 && w <= 79) || w === 85 || w === 86) c.snow = 2; else if ([23, 68, 69, 83, 84].includes(w)) { c.snow = 1; if (!c.rain) c.rain = 1; }
    return c;
  }
  function describe(ww, cloud) {
    const c = (cloud || 0) <= 1 ? 'Zonnig' : cloud <= 3 ? 'Licht bewolkt' : cloud <= 5 ? 'Half bewolkt' : cloud <= 7 ? 'Zwaar bewolkt' : 'Geheel bewolkt';
    const w = ww == null ? -1 : ww; let p = null;
    if (w >= 95) p = 'onweer'; else if (w === 85 || w === 86) p = 'sneeuwbui'; else if (w === 83 || w === 84) p = 'natte sneeuwbui'; else if (w === 82) p = 'zware bui';
    else if (w === 80 || w === 81) p = 'lichte regenbui'; else if (w >= 71 && w <= 79) p = 'sneeuw'; else if (w === 66 || w === 67) p = 'ijzel'; else if (w >= 63 && w <= 65) p = 'regen';
    else if ((w >= 60 && w <= 62) || [25, 21, 20].includes(w)) p = 'lichte regen'; else if (w >= 51 && w <= 57) p = 'motregen'; else if (w >= 45 && w <= 48) p = 'mist';
    return p ? `${c}, ${p}` : c;
  }

  // ---------- waarschuwingen ----------
  const alertOff = (id) => prefs.alertsOff.includes(id);
  function alerts(city, fc, now = new Date(), P = prefs) {
    if (!P.alertsOn || P.alertsOff.includes(city.id)) return [];
    const out = [], hrs = fc.hours.filter(h => h.date > now && h.start < now.getTime() + 48 * 3600e3).sort((a, b) => a.start - b.start);
    const runs = (kind, val, thr) => {
      let cur = null; const flush = () => { if (cur) out.push({ kind, start: cur.s, end: cur.e, peak: cur.p, city: city.id, id: `${city.id}|${kind}|${Math.floor(cur.s / 3600e3)}` }); cur = null; };
      for (const h of hrs) { const v = val(h); if (v != null && v >= thr) { if (cur && cur.e.getTime() === h.start.getTime()) { cur.e = h.date; cur.p = Math.max(cur.p, v); } else { flush(); cur = { s: h.start, e: h.date, p: v }; } } else flush(); }
      flush();
    };
    runs('gust', h => h.gust == null ? null : h.gust * KN, P.alertGust);
    runs('rain', h => h.rain, P.alertRain);
    const utc0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    for (const d of fc.days) if (d.date >= utc0 && d.date < new Date(utc0.getTime() + 5 * 86400e3)) {
      if (d.tx != null && d.tx >= P.alertHeat) out.push({ kind: 'heat', start: d.date, end: new Date(d.date.getTime() + 86400e3), peak: d.tx, city: city.id, id: `${city.id}|heat|${Math.floor(d.date / 3600e3)}` });
      if (d.tn != null && d.tn <= P.alertFrost) out.push({ kind: 'frost', start: d.date, end: new Date(d.date.getTime() + 86400e3), peak: d.tn, city: city.id, id: `${city.id}|frost|${Math.floor(d.date / 3600e3)}` });
    }
    return out.sort((a, b) => a.start - b.start);
  }
  function alertText(a, tz) {
    const wd = (d) => `${wdShort(d, tz)} ${hh(d, tz)}:00`;
    const day = (d) => `${wdLong(d, 'UTC')} ${dmon(d, 'UTC')}`;
    const when = (a.kind === 'heat' || a.kind === 'frost') ? day(a.start) : (a.start.getTime() === a.end.getTime() - 3600e3 ? wd(a.start) : `${wd(a.start)} – ${hh(a.end, tz)}:00`);
    return { gust: `Windstoten tot ${Math.round(a.peak)} km/u · ${when}`, rain: `Neerslag tot ${num(a.peak)} mm/u · ${when}`, heat: `Hitte: max ${Math.round(a.peak)}° · ${when}`, frost: `Vorst: min ${Math.round(a.peak)}° · ${when}` }[a.kind];
  }
  const alertIcon = { gust: '💨', rain: '🌧️', heat: '🌡️', frost: '❄️' };
  function notify(city, list) {
    if (!list.length || typeof Notification === 'undefined') return;
    const sent = safeJSON(localStorage.getItem('raster.alertsSent'), {}), cut = Date.now() - 4 * 86400e3;
    for (const k of Object.keys(sent)) if (sent[k] < cut) delete sent[k];
    for (const a of list) if (!sent[a.id]) {
      sent[a.id] = Date.now();
      const show = () => new Notification(city.name, { body: alertText(a, city.tz), icon: '../assets/icon.png' });
      if (Notification.permission === 'granted') show(); else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => p === 'granted' && show());
    }
    localStorage.setItem('raster.alertsSent', JSON.stringify(sent));
  }

  // ---------- regen komende uren ----------
  function rainOutlook(hours, tz, now = new Date()) {
    const next = hours.filter(h => h.date > now).sort((a, b) => a.start - b.start).slice(0, 24);
    const wet = (h) => (h.rain || 0) >= 0.2, mm = (v) => num(rconv(v)) + ' ' + ru();
    if (!next.length) return { short: '', long: '', wetNow: false };
    const sum = (r) => r.reduce((s, h) => s + (h.rain || 0), 0);
    if (wet(next[0])) {
      let k = 0; while (k < next.length && wet(next[k])) k++;
      const run = next.slice(0, k);
      if (k === next.length) return { short: '☂ nu', long: `Regen, de komende ${k} uur (${mm(sum(run))})`, wetNow: true };
      const until = run[run.length - 1].date;
      return { short: `☂ t/m ${hh(until, tz)}u`, long: `Regen tot ${hh(until, tz)}:00 (${mm(sum(run))})`, wetNow: true };
    }
    const i = next.findIndex(wet);
    if (i >= 0) { let k = i; while (k < next.length && wet(next[k])) k++; const run = next.slice(i, k); return { short: `☂ ${hh(run[0].start, tz)}u`, long: `Regen vanaf ${hh(run[0].start, tz)}:00 (${mm(sum(run))})`, wetNow: false }; }
    return { short: 'droog', long: `Droog de komende ${next.length} uur`, wetNow: false };
  }

  g.WP = { prefs, savePrefs, safeJSON, KN, bft, isBft, windVal, windLabel, half, num, tconv, tunit, fT, fTC, fW, fG, pconv, pu, fP, rconv, ru, fR, fPct, compass, humidity, apparent, feelsLike,
    parts, zonedMidnight, todayStart, addDays, hh, hm, wdShort, wdLong, ddmm, dmon, ymd, elevation, isNight, riseSet, loadFeed, parseFeed, search, decode, describe,
    alerts, alertText, alertIcon, alertOff, notify, rainOutlook };
})(window);

// ====================================================================================
// Aanvullingen: ensemble-onzekerheid, KNMI-waarschuwingen (Meteoalarm), weerbericht
// ====================================================================================
(function (g) {
  'use strict';
  const WP = g.WP, nl = 'nl-NL';

  // ---------- ensemble (ECMWF IFS, 51 leden, Open-Meteo) ----------
  const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b), pos = p * (s.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
  async function loadEnsemble(lat, lon) {
    const url = `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation&models=ecmwf_ifs025&forecast_days=15&timezone=UTC`;
    return parseEnsemble(await api.fetchText(url));
  }
  function parseEnsemble(txt) {
    const d = JSON.parse(txt), h = d.hourly; if (!h || !h.time) throw new Error('ensemble onleesbaar');
    const times = h.time.map(t => new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(t) ? t : t+'Z'));
    const series = (base) => { const out = []; if (h[base]) out.push(h[base]); for (let m = 1; m <= 50; m++) { const k = `${base}_member${String(m).padStart(2, '0')}`; if (h[k]) out.push(h[k]); } return out; };
    const temps = series('temperature_2m'), rains = series('precipitation');
    if (temps.length < 10) throw new Error('te weinig ensembleleden');
    const col = (m, i) => m.map(x => x[i]).filter(v => v != null);
    const n = times.length, t10 = [], t90 = [], r90 = [];
    for (let i = 0; i < n; i++) { const c = col(temps, i); t10.push(pct(c, 0.1)); t90.push(pct(c, 0.9)); r90.push(pct(col(rains, i), 0.9)); }
    const ext = (from, to, fn) => { const idx = []; times.forEach((t, i) => { if (t >= from && t < to) idx.push(i); }); if (!idx.length) return null; const v = temps.map(m => fn(...idx.map(i => m[i]).filter(x => x != null))).filter(Number.isFinite); return { p10: pct(v, 0.1), p50: pct(v, 0.5), p90: pct(v, 0.9) }; };
    return { times, temps, rains, t10, t90, r90, fetched: Date.now(), dailyMax: (a, b) => ext(a, b, Math.max), dailyMin: (a, b) => ext(a, b, Math.min) };
  }

  // ---------- KNMI-waarschuwingen via Meteoalarm ----------
  const TYPE = { 1: ['Wind', '💨'], 2: ['Sneeuw/ijs', '❄️'], 3: ['Onweer', '⛈️'], 4: ['Mist', '🌫️'], 5: ['Hitte', '🌡️'], 6: ['Kou', '🥶'], 7: ['Kust', '🌊'], 8: ['Bosbrand', '🔥'], 10: ['Regen', '🌧️'], 11: ['Overstroming', '🌊'], 12: ['Regen en overstroming', '🌧️'] };
  const levelName = (l) => l >= 4 ? 'rood' : l === 3 ? 'oranje' : 'geel';
  const levelColor = (l) => l >= 4 ? '#eb2e2e' : l === 3 ? '#ff9400' : '#ffe000';
  async function loadKnmi() {
    const d = JSON.parse(await api.fetchText('https://feeds.meteoalarm.org/api/v1/warnings/feeds-netherlands')), out = [];
    for (const w of d.warnings || []) for (const info of (w.alert && w.alert.info) || []) {
      if (info.language !== 'nl-NL') continue;
      const val = (k) => (info.parameter || []).find(p => p.valueName === k)?.value;
      const level = parseInt(String(val('awareness_level') || '').split(';')[0], 10), type = parseInt(String(val('awareness_type') || '').split(';')[0], 10) || 0;
      if (!(level >= 2)) continue;
      const onset = new Date(info.onset), expires = new Date(info.expires); if (!(expires > new Date())) continue;
      for (const a of info.area || []) out.push({ id: `${w.alert.identifier}|${a.areaDesc}`, level, type, area: a.areaDesc, onset, expires, text: info.description || info.headline || '', typeName: (TYPE[type] || ['Weer'])[0], icon: (TYPE[type] || ['', '⚠️'])[1] });
    }
    return out.sort((a, b) => b.level - a.level || a.onset - b.onset);
  }
  const EN2NL = { 'South Holland': 'Zuid-Holland', 'North Holland': 'Noord-Holland', 'North Brabant': 'Noord-Brabant', 'Frisia': 'Friesland' };
  function knmiAreas(city) {
    if (!['Netherlands', 'Nederland'].includes(city.country)) return [];
    const s = [EN2NL[city.region] || city.region];
    if (['Terschelling', 'Texel', 'Vlieland', 'Ameland', 'Schiermonnikoog'].includes(city.name)) s.push('Waddeneilanden');
    if (['Hoek van Holland', 'Vlissingen', 'IJmuiden', 'Harlingen', 'Delfzijl'].includes(city.name)) s.push(city.name);
    return s;
  }
  const knmiFor = (city, list) => { const a = knmiAreas(city); return (list || []).filter(w => a.includes(w.area) && w.expires > new Date()); };
  function notifyKnmi(city, list) {
    if (!list.length || typeof Notification === 'undefined' || !WP.prefs.alertsOn || WP.alertOff(city.id)) return;
    const sent = WP.safeJSON(localStorage.getItem('raster.alertsSent'), {});
    for (const w of list) if (!sent['knmi|' + w.id]) {
      sent['knmi|' + w.id] = Date.now();
      const show = () => new Notification(`${city.name}: KNMI code ${levelName(w.level)}`, { body: `${w.typeName} · ${WP.wdShort(w.onset, city.tz)} ${WP.hh(w.onset, city.tz)}:00 – ${WP.wdShort(w.expires, city.tz)} ${WP.hh(w.expires, city.tz)}:00` });
      if (Notification.permission === 'granted') show(); else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => p === 'granted' && show());
    }
    localStorage.setItem('raster.alertsSent', JSON.stringify(sent));
  }

  // ---------- weerbericht in spreektaal ----------
  const DIRS = ['noord', 'noordnoordoost', 'noordoost', 'oostnoordoost', 'oost', 'oostzuidoost', 'zuidoost', 'zuidzuidoost', 'zuid', 'zuidzuidwest', 'zuidwest', 'westzuidwest', 'west', 'westnoordwest', 'noordwest', 'noordnoordwest'];
  const dirName = (d) => DIRS[Math.round(d / 22.5) % 16];
  const join = (a) => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' en ' + a[a.length - 1];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function weerbericht(city, fc, ens, knmi, now = new Date(), bron = 'WeatherPro') {
    const tz = city.tz, today = WP.todayStart(tz, now), starts = [...Array(9).keys()].map(i => WP.addDays(today, i, tz));
    const dayPoint = (i) => fc.days.find(d => d.date.toISOString().slice(0, 10) === WP.ymd(starts[i], tz));
    const hours = (i) => fc.hours.filter(h => h.start >= starts[i] && h.start < starts[i + 1]);
    const dn = (i) => i === 0 ? 'Vandaag' : i === 1 ? 'Morgen' : cap(WP.wdLong(starts[i], tz));
    let out = `Weerbericht ${city.name} – ${WP.wdLong(now, tz)} ${WP.dmon(now, tz)}, ${WP.hm(now, tz)}\n`;
    if (knmi.length) { out += '\nKNMI-waarschuwingen\n'; for (const w of knmi) out += `• Code ${levelName(w.level)}: ${w.typeName.toLowerCase()} in ${w.area}, van ${WP.wdShort(w.onset, tz)} ${WP.hh(w.onset, tz)}:00 tot ${WP.wdShort(w.expires, tz)} ${WP.hh(w.expires, tz)}:00.\n`; }
    let prevDir = null;
    for (let i = 0; i < 3; i++) { const d = dayPoint(i); if (!d) continue; out += `\n${dn(i)}\n${daySentences(d, hours(i), tz, prevDir, i === 0, now)}\n`; prevDir = d.dir; }
    const od = [3, 4, 5, 6].map(i => [i, dayPoint(i)]).filter(x => x[1]);
    if (od.length) {
      out += '\nVooruitblik\n';
      const tx = od.map(x => x[1].tx).filter(v => v != null);
      if (tx.length) { const lo = Math.round(Math.min(...tx)), hi = Math.round(Math.max(...tx)); out += lo === hi ? `De maxima liggen rond ${hi} graden. ` : `De maxima liggen tussen ${lo} en ${hi} graden. `; }
      const tot = (d) => (d.rain || 0) + (d.rainN || 0);
      const wet = od.filter(x => tot(x[1]) >= 1).map(x => dn(x[0]).toLowerCase()), dry = od.filter(x => tot(x[1]) < 1).map(x => dn(x[0]).toLowerCase());
      if (wet.length) out += `Op ${join(wet)} valt er neerslag. `; if (dry.length && wet.length) out += `Op ${join(dry)} blijft het overwegend droog. `; if (!wet.length) out += 'Het blijft in deze periode overwegend droog. ';
      const windy = od.filter(x => Math.max(0, ...hours(x[0]).map(h => h.gust || 0)) * WP.KN >= 60).map(x => dn(x[0]).toLowerCase()); if (windy.length) out += `Op ${join(windy)} staat een stevige wind met windstoten van 60 km/u of meer. `;
      const frost = od.filter(x => (x[1].tn ?? 5) <= 0).map(x => dn(x[0]).toLowerCase()); if (frost.length) out += `In de nacht naar ${join(frost)} is lichte vorst mogelijk. `;
      out = out.trimEnd() + '\n';
    }
    if (ens) {
      const bits = []; for (let i = 2; i <= 6; i++) { const b = ens.dailyMax(starts[i], starts[i + 1]); if (b && b.p90 - b.p10 >= 3) bits.push(`${dn(i).toLowerCase()} (maximum tussen ${Math.round(b.p10)} en ${Math.round(b.p90)} graden)`); }
      out += '\nOnzekerheid\n' + (bits.length ? `Het ECMWF-ensemble toont een grote spreiding op ${join(bits)}. Houd hier rekening mee bij het gebruik van de verwachting.\n` : 'De ensembleleden van ECMWF zijn het goed met elkaar eens over het temperatuurverloop in de komende dagen.\n');
    }
    return out + `\nBron: ${bron}, ECMWF-ensemble (eigen rechtstreekse aanvoer), KNMI via Meteoalarm.`;
  }
  function daySentences(d, hs, tz, prevDir, isToday, now) {
    const s = [], n = d.cloud || 0;
    let first = cap(n <= 1 ? 'zonnig' : n <= 3 ? 'licht bewolkt met zon' : n <= 5 ? 'half bewolkt' : n <= 7 ? 'zwaar bewolkt' : 'geheel bewolkt');
    if (d.sun != null && d.sun >= 0.5) first += ` met circa ${WP.num(d.sun)} uur zon`; s.push(first + '.');
    const total = (d.rain || 0) + (d.rainN || 0), snowy = hs.some(h => (WP.decode(h.symbol, h.ww, h.cloud).snow || 0) > 0), wetWord = snowy ? 'sneeuw' : 'regen';
    const hr = (h) => +WP.hh(h.start, tz), blocks = [['nacht', 0, 5], ['ochtend', 6, 11], ['middag', 12, 17], ['avond', 18, 23]];
    const wetB = blocks.filter(([, a, b]) => hs.filter(h => hr(h) >= a && hr(h) <= b && (!isToday || h.date > now)).reduce((x, h) => x + (h.rain || 0), 0) >= 0.3).map(b => b[0]);
    const peak = Math.max(0, ...hs.map(h => h.rain || 0));
    if (total < 0.3) s.push('Het blijft droog.');
    else { const kind = total < 1 ? 'Een enkel buitje' : total < 5 ? `Af en toe ${wetWord}` : total < 15 ? `Regelmatig ${wetWord}` : `Veel ${wetWord}`;
      let t = `${kind}, vooral ${wetB.length ? 'in de ' + join(wetB) : 'gedurende de dag'} (circa ${WP.num(total, total < 5 ? 1 : 0)} mm)`; if (peak >= 4) t += `, plaatselijk tot ${WP.num(peak, 0)} mm per uur`; s.push(t + '.'); }
    if (d.tx != null) { let t = `De maximumtemperatuur wordt ${Math.round(d.tx)} graden`; if (d.tn != null) t += `, het minimum ${Math.round(d.tn)} graden`;
      const h15 = hs.find(h => hr(h) === 15); if (h15) { const fl = WP.feelsLike(h15.temp, h15.dew, h15.kn); if (fl != null && h15.temp != null && Math.abs(fl - h15.temp) >= 3) t += fl < h15.temp ? `. Door de wind voelt het aan als ${Math.round(fl)} graden` : `. Het voelt aan als ${Math.round(fl)} graden`; }
      s.push(t + '.'); }
    if (d.kn != null && d.dir != null) { const bft = WP.bft(d.kn), words = ['windstil', 'zwakke wind', 'zwakke wind', 'zwakke tot matige wind', 'matige wind', 'vrij krachtige wind', 'krachtige wind', 'harde wind', 'stormachtige wind'];
      let t = bft === 0 ? 'Het is vrijwel windstil' : `Een ${words[Math.min(bft, 8)]} uit ${dirName(d.dir)} (kracht ${bft})`; if (bft >= 9) t = `Storm uit ${dirName(d.dir)} (kracht ${bft})`;
      const gust = Math.max(0, ...hs.map(h => h.gust || 0), d.gust || 0) * WP.KN; if (gust >= 50) t += `, met ${gust >= 75 ? 'zware ' : ''}windstoten tot ${Math.round(gust)} km/u`;
      if (prevDir != null) { const delta = ((d.dir - prevDir + 540) % 360) - 180; if (Math.abs(delta) >= 45) t += `. De wind ${delta > 0 ? 'ruimt' : 'krimpt'} naar ${dirName(d.dir)}`; }
      s.push(t + '.'); }
    return s.join(' ');
  }

  Object.assign(WP, { loadEnsemble, parseEnsemble, loadKnmi, knmiFor, notifyKnmi, levelName, levelColor, weerbericht, TYPE });
})(window);

// ====================================================================================
// Gegevensbron: WeatherPro of een weermodel (Open-Meteo): HARMONIE 43, ECMWF IFS, ICON-D2
// ====================================================================================
(function (g) {
  'use strict';
  const WP = g.WP;
  const SOURCES = [['weatherpro', 'WeatherPro'], ['harmonie', 'HARMONIE 43 (KNMI)'], ['ecmwf', 'ECMWF IFS'], ['icond2', 'ICON-D2 (DWD)']];
  const SHORT = { weatherpro: 'WeatherPro', harmonie: 'HARMONIE 43', ecmwf: 'ECMWF', icond2: 'ICON-D2' };
  const SLUG = { harmonie: 'knmi_harmonie_arome_europe', ecmwf: 'ecmwf_ifs', icond2: 'icon_d2' };
  const NOAUDATA = 'Dit model heeft geen gegevens voor deze plaats.';

  async function loadModel(city, src, wp) {
    const slugs = src === 'harmonie' && ['Netherlands', 'Nederland'].includes(city.country) ? ['knmi_harmonie_arome_netherlands', SLUG.harmonie] : [SLUG[src]];
    let lastErr;
    for (const slug of slugs) {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&models=${slug}&hourly=temperature_2m,dew_point_2m,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover,pressure_msl,weather_code,direct_radiation,sunshine_duration,precipitation_probability&wind_speed_unit=kn&timezone=UTC&forecast_days=16`;
        return buildModel(await api.fetchText(url), city, wp, src);
      } catch (e) { lastErr = e; }
    }
    throw new Error(NOAUDATA);
  }

  function buildModel(txt, city, wp, src = 'ecmwf') {
    const d = JSON.parse(txt); if (d.error || !d.hourly || !d.hourly.time) throw new Error(NOAUDATA);
    const h = d.hourly, tz = city.tz, hours = [];
    const v = (k, i) => (h[k] && h[k][i] != null) ? h[k][i] : null;
    h.time.forEach((t, i) => {
      if (v('temperature_2m', i) == null) return;
      const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(t) ? t : t+'Z'), cl = v('cloud_cover', i), dr = v('direct_radiation', i), su = v('sunshine_duration', i), curve = WP.Sunshine && WP.Sunshine.curves[src];
      const zonMin = dr != null ? WP.Sunshine.minuten(dr, date, city.lat, city.lon, curve) : (su == null ? null : Math.min(su / 60, WP.Sunshine.daylightMinutes(date, city.lat, city.lon)));
      const L = WP.SymbolLogic, neff = L.nEff((cl || 0) / 12.5, zonMin, WP.Sunshine.daylightMinutes(date, city.lat, city.lon)), nn = L.halfUp(neff), wx = L.wmo(v('weather_code', i), v('precipitation', i) || 0);
      hours.push({ date, interval: 3600e3, start: new Date(+date - 3600e3), temp: v('temperature_2m', i), dew: v('dew_point_2m', i), ww: v('weather_code', i), cloud: nn, nEff: neff, symbol: L.symbool(nn, wx),
        dir: v('wind_direction_10m', i), kn: v('wind_speed_10m', i), gust: v('wind_gusts_10m', i), p: v('pressure_msl', i), sun: zonMin, rain: v('precipitation', i), prob: v('precipitation_probability', i) });
    });
    if (!hours.length) throw new Error(NOAUDATA);
    const groups = new Map(), byDate = new Map();
    for (const x of hours) { const k = WP.ymd(x.start, tz); (groups.get(k) || groups.set(k, []).get(k)).push(x); const k2 = WP.ymd(x.date, tz); (byDate.get(k2) || byDate.set(k2, []).get(k2)).push(x); }
    const days = [];
    for (const [k, hs] of [...groups.entries()].sort()) {
      const full = hs.length >= 12, temps = (byDate.get(k) || []).map(x => x.temp), hrOf = (x) => +WP.hh(x.start, tz);
      const dayHs = hs.filter(x => hrOf(x) >= 6 && hrOf(x) <= 18), cl = dayHs.map(x => x.cloud).filter(x => x != null);
      const rain = hs.reduce((s, x) => s + (x.rain || 0), 0), wet = hs.reduce((a, b) => (b.rain || 0) > (a.rain || 0) ? b : a, hs[0]);
      const noon = hs.reduce((a, b) => Math.abs(hrOf(b) - 12) < Math.abs(hrOf(a) - 12) ? b : a, hs[0]), pick = rain >= 0.3 ? wet : noon;
      const kn = hs.map(x => x.kn).filter(x => x != null); let sx = 0, sy = 0; for (const x of hs) if (x.dir != null && x.kn != null) { sx += x.kn * Math.sin(x.dir * Math.PI / 180); sy += x.kn * Math.cos(x.dir * Math.PI / 180); }
      const L = WP.SymbolLogic, ur = hs.map(x => ({ hour: hrOf(x), nEff: x.nEff != null ? x.nEff : (x.cloud || 0), code: x.ww, w: L.wmo(x.ww, x.rain || 0) })), ds = L.dag(ur), dww = ds ? L.dagWW(ur, ds.n) : null;
      const [Y, M, D] = k.split('-').map(Number), date = new Date(Date.UTC(Y, M - 1, D)), wpDay = wp && wp.days.find(z => z.date.toISOString().slice(0, 10) === k), probs = hs.map(x => x.prob).filter(x => x != null);
      days.push({ date, tx: full ? Math.max(...temps) : null, tn: full ? Math.min(...temps) : null, ww: dww != null ? dww : pick.ww, cloud: ds ? ds.n : (cl.length ? Math.round(cl.reduce((a, b) => a + b, 0) / cl.length) : null),
        dir: (sx || sy) ? (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360 : null, kn: kn.length ? kn.reduce((a, b) => a + b, 0) / kn.length : null, gust: Math.max(0, ...hs.map(x => x.gust || 0)) || null,
        sun: full && hs.every(x=>x.sun!=null) ? hs.reduce((s, x) => s + x.sun, 0) / 60 : null, uvi: wpDay ? wpDay.uvi : null, uvLow: wpDay ? wpDay.uvLow : null, rain, rainN: 0, prob: probs.length ? Math.max(...probs) : null, symbol: ds ? ds.symbol : null, symbolN: null });
    }
    return { obs: wp ? wp.obs : null, days, hours, expires: Date.now() + 3600e3, fetched: Date.now() };
  }
  Object.assign(WP, { SOURCES, SHORT, loadModel, buildModel });
})(window);

// ====================================================================================
// Gekalibreerde zonneschijn voor de modellen (port van weerlab/scripts/zonuren.py)
// ====================================================================================
(function (g) {
  'use strict';
  const WP = g.WP, CAL = {"harmonie":{"x":[0.0,0.0007,0.0038,0.0166,0.0503,0.1128,0.2047,0.3201,0.4382,0.5463,0.6366,0.7045,0.7557,0.8031,0.8499],"y":[0.0679,0.0679,0.1818,0.2381,0.376,0.4302,0.5248,0.5585,0.6051,0.7157,0.7157,0.7978,0.8379,0.8787,0.9231],"delta":0},"ecmwf":{"x":[0.0012,0.0143,0.0487,0.1303,0.2729,0.3893,0.4661,0.5199,0.5691,0.6078,0.647,0.6826,0.7149,0.7517,0.798,0.9084],"y":[0.0198,0.0198,0.0538,0.1058,0.1971,0.3806,0.5193,0.5696,0.6285,0.6898,0.7122,0.7787,0.8238,0.8384,0.8406,0.8406],"delta":0},"icond2":{"x":[0.0008,0.01,0.0338,0.0777,0.1303,0.1924,0.2643,0.3259,0.3901,0.4541,0.5242,0.6047,0.7052,0.8314,0.9746],"y":[0.0203,0.0361,0.1329,0.2631,0.3585,0.4612,0.5052,0.5779,0.6703,0.7403,0.7767,0.8114,0.8499,0.8946,0.8995],"delta":0}}, CAL_DATE = '2026-10-19T02:40Z';
  const TH = 120, MINH = 0.01, STEPS = [5, 15, 25, 35, 45, 55].map(x => x / 60), rad = Math.PI / 180;
  const pmod = (a, m) => ((a % m) + m) % m;
  function sinH(doy, uur, lat, lon) {
    const gam = 2 * Math.PI / 365 * (doy - 1 + (uur - 12) / 24);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(gam) - 0.032077 * Math.sin(gam) - 0.014615 * Math.cos(2 * gam) - 0.040849 * Math.sin(2 * gam));
    const dec = 0.006918 - 0.399912 * Math.cos(gam) + 0.070257 * Math.sin(gam) - 0.006758 * Math.cos(2 * gam) + 0.000907 * Math.sin(2 * gam) - 0.002697 * Math.cos(3 * gam) + 0.00148 * Math.sin(3 * gam);
    const tst = pmod(uur * 60 + eq + 4 * lon, 1440), ha = (tst / 4 - 180) * rad, la = lat * rad;
    return Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha);
  }
  function helder(doy, start, lat, lon) {
    let som = 0, min = 0;
    for (const f of STEPS) { const sh = sinH(doy, pmod(start + f, 24), lat, lon), am = 1 / Math.min(Math.max(sh, 1e-3), 1), dni = 1361 * Math.pow(0.7, Math.pow(am, 0.678)); if (sh > MINH && dni >= TH) { som += dni * Math.max(sh, 0); min += 10; } }
    return { helder: som / STEPS.length, minuten: min };
  }
  function interp(v, xs, ys) {   // np.interp (bij dubbele x telt de laatste)
    const n = xs.length; if (v < xs[0]) return ys[0]; if (v >= xs[n - 1]) return ys[n - 1];
    let j = 0; for (let i = 0; i < n; i++) if (xs[i] <= v) j = i;
    return ys[j] + (v - xs[j]) * (ys[j + 1] - ys[j]) / (xs[j + 1] - xs[j]);
  }
  /** zonminuten (0-60) voor het uurvak dat eindigt op `eind` (Open-Meteo: voorgaand uur) */
  function minuten(direct, eind, lat, lon, curve) {
    const doy = Math.round((Date.UTC(eind.getUTCFullYear(), eind.getUTCMonth(), eind.getUTCDate()) - Date.UTC(eind.getUTCFullYear(), 0, 1)) / 86400e3) + 1;
    const start = eind.getUTCHours() + eind.getUTCMinutes() / 60 - 1 + ((curve && curve.delta) || 0) / 60;
    const h = helder(doy, start, lat, lon); if (!(h.helder > 1)) return 0;
    const k = Math.max(direct / h.helder, 0), f = curve ? Math.min(Math.max(interp(k, curve.x, curve.y), 0), 1) : Math.min(Math.max(k, 0), 1);
    return Math.min(Math.max(f * h.minuten, 0), 60);
  }
  function daylightMinutes(eind, lat, lon) { let n = 0; const s = eind.getTime() - 3600e3; for (let m = 0; m < 60; m++) if (!WP.isNight(new Date(s + m * 60e3 + 30e3), lat, lon)) n++; return n; }
  Object.assign(WP, { Sunshine: { minuten, curves: CAL, calibratedOn: CAL_DATE, daylightMinutes } });
})(window);

// ====================================================================================
// Centrale symbool-beslislogica (port van scripts/symbolen_referentie.py; zie ook SymbolLogic.swift)
// Afgeleid uit de WeatherPro-feed: symbool = f(bewolking n, weercode); modellen: n_eff = 0,5·bewolking + 0,5·g(zonfractie).
// ====================================================================================
(function (g) {
  'use strict';
  const WP = g.WP;
  const G_UUR = [[0.02, 6.8], [0.19, 6.2], [0.32, 5.3], [0.44, 4.6], [0.56, 3.7], [0.68, 3.1], [0.82, 2.2], [0.97, 0.4]];
  const W = 0.5, MIN_DL = 45, GEEN_ZON = 0.03;
  function interp(x, p) { if (x <= p[0][0]) return p[0][1]; if (x >= p[p.length - 1][0]) return p[p.length - 1][1]; for (let i = 0; i < p.length - 1; i++) if (p[i][0] <= x && x <= p[i + 1][0]) return p[i][1] + (x - p[i][0]) * (p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]); return p[p.length - 1][1]; }
  function nEff(cloudOcta, zonMin, dlMin) { if (zonMin == null || dlMin == null || dlMin < MIN_DL) return cloudOcta; const f = Math.min(Math.max(zonMin / dlMin, 0), 1); if (f < GEEN_ZON) return cloudOcta; return W * cloudOcta + (1 - W) * interp(f, G_UUR); }
  const halfUp = (x) => Math.floor(x + 0.5);
  function wmo(code, mm = 0) {
    const c = code == null ? -1 : +code;
    if ([95, 96, 99].includes(c)) return { rain: 0, snow: 0, thunder: true, fog: false, mist: false, steady: false };
    let rain = ({ 51: 1, 53: 1, 55: 1, 56: 1, 57: 1, 61: 1, 63: 3, 65: 5, 66: 3, 67: 5, 80: 1, 81: 3, 82: 5 })[c] || 0;
    const snow = ({ 71: 1, 73: 3, 75: 5, 77: 1, 85: 1, 86: 3 })[c] || 0;
    if (!rain && !snow && mm >= 0.2 && [-1, 0, 1, 2, 3].includes(c)) rain = mm < 1.5 ? 1 : mm < 4 ? 3 : 5;
    return { rain, snow, thunder: false, fog: [45, 48].includes(c), mist: false, steady: [61, 63, 65].includes(c) };
  }
  function symbool(nIn, w) {
    const n = Math.max(0, Math.min(8, nIn)), zon = n <= 6 ? '1' : '9';
    let lvl = n <= 1 ? '9' : n <= 4 ? '1' : '2';
    if (w.thunder) lvl = n >= 6 ? '3' : (lvl === '9' || lvl === '1' ? '2' : lvl);
    if (n === 8 && w.steady) lvl = '3';
    const d5 = w.thunder ? '2' : w.fog ? '7' : w.mist ? '6' : '9';
    return zon + lvl + (w.rain ? String(w.rain) : '9') + (w.snow ? String(w.snow) : '9') + '9' + d5 + '9';
  }
  /** uren: [{hour (lokaal begin), nEff, w}] → {symbol, n} of null */
  function dag(uren) {
    const d = uren.filter(u => u.hour >= 7 && u.hour < 19); if (d.length < 4) return null;   // ook een onvolledige laatste modeldag
    const nDag = halfUp(d.reduce((s, u) => s + u.nEff, 0) / d.length), thunder = uren.some(u => u.w.thunder);
    const nat = d.filter(u => (u.w.rain || u.w.snow) && !u.w.thunder).length, anyRain = d.some(u => u.w.rain), anySnow = d.some(u => u.w.snow);
    const w = { rain: (nat >= 3 && !thunder && anyRain) ? 1 : 0, snow: (nat >= 3 && !thunder && anySnow && !anyRain) ? 1 : 0, thunder, fog: false, mist: false, steady: d.filter(u => u.w.steady).length >= 3 };
    return { symbol: symbool(nDag, w), n: nDag };
  }
  function dagWW(uren, nDag) {
    const d = uren.filter(u => u.hour >= 7 && u.hour < 19);
    if (uren.some(u => u.w.thunder)) return 95;
    const nat = d.filter(u => u.w.rain || u.w.snow);
    if (nat.length >= 3) { const cnt = {}; for (const u of nat) if (u.code != null && u.code >= 50) cnt[u.code] = (cnt[u.code] || 0) + 1; const m = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]; return m == null ? 61 : ([53, 55, 56, 57].includes(+m) ? 51 : +m); }
    return Math.min(nDag, 8);
  }
  /** WeatherPro-weercode (feed-ww) -> zelfde vorm als wmo() */
  function wpWeer(ww) {
    const c = ww == null ? -1 : +ww;
    if (c >= 95) return { rain: 0, snow: 0, thunder: true, fog: false, mist: false, steady: false };
    const rain = ({ 20: 1, 21: 1, 25: 1, 50: 1, 51: 1, 52: 1, 53: 1, 60: 1, 61: 1, 62: 3, 63: 3, 64: 5, 65: 5, 80: 1, 81: 3, 82: 5 })[c] || 0;
    const snow = ({ 70: 1, 71: 1, 72: 3, 73: 3, 74: 5, 75: 5, 77: 1, 85: 1, 86: 3 })[c] || 0;
    return { rain, snow, thunder: false, fog: c === 44 || c === 45, mist: c === 10, steady: c >= 60 && c <= 65 };
  }
  /** Optie 'WeatherPro-symbolen met zonfractie': uur- en dagsymbolen van de feed herberekend met dezelfde mix als de modellen. */
  function recomputeWP(fc, city) {
    const perDag = {};
    const hours = fc.hours.map(h => {
      const ne = nEff(h.cloud || 0, h.sun, WP.Sunshine.daylightMinutes(h.date, city.lat, city.lon)), w = wpWeer(h.ww), k = WP.ymd(h.start, city.tz);
      (perDag[k] = perDag[k] || []).push({ hour: +WP.hh(h.start, city.tz), nEff: ne, w });
      return Object.assign({}, h, { symbol: symbool(halfUp(ne), w), nEff: ne });
    });
    const days = fc.days.map(d => { const u = perDag[d.date.toISOString().slice(0, 10)]; const r = u && u.length >= 24 ? dag(u) : null; return r ? Object.assign({}, d, { symbol: r.symbol, cloud: r.n }) : d; });
    return Object.assign({}, fc, { hours, days });
  }
  Object.assign(WP, { SymbolLogic: { nEff, halfUp, wmo, wpWeer, symbool, dag, dagWW, recomputeWP, G_UUR } });
})(window);
