/* Weekraster (web): UI-logica. Afgeleid van MeteobewakingWin/src/app.js; data via R2 (weatherpro_raster.json, knmi_warnings.json) en Open-Meteo. */
(function () {
  'use strict';
  const { prefs, savePrefs } = WP;
  document.getElementById('defs').innerHTML = Icons.defs();
  const $ = (s) => document.querySelector(s);

  // ---------- staat ----------
  const DEFAULT_CITIES = [];
  let cities = null, ALL = [];
  let selected = +localStorage.getItem('raster.selected') || null;
  const forecasts = {}, errors = {}, loading = new Set(), ensembles = {}, ensLoading = new Set();
  let knmiList = [], knmiFetched = 0, editing = false;
  const models = {}, modelErr = {}, modelLoading = new Set();
  const src = () => prefs.source || 'weatherpro';
  const active = (c, s = src()) => s === 'weatherpro' ? forecasts[c.id] : models[c.id + '|' + s];
  async function ensureModel(c, force) {
    const s = src(); if (!c || s === 'weatherpro') return; const key = c.id + '|' + s;
    if (!force && models[key] && Date.now() - models[key].fetched < 1800e3) return; if (modelLoading.has(key)) return; modelLoading.add(key);
    try { models[key] = await WP.loadModel(c, s, forecasts[c.id]); delete modelErr[key]; } catch (e) { modelErr[key] = e.message || String(e); }
    modelLoading.delete(key); renderAll();
  }
  let dayOffset = 0, popFor = null;

  // ---------- web-adapter: data komt uit R2-bestanden (feed heeft geen CORS) ----------
  const LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  const DATA = LOCAL ? '' : 'https://data.weerlab.nl/';
  window.api = { fetchText: (u) => fetch(u).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }), trayTooltip() {} };
  let rasterJson = null, rasterAt = 0;
  async function rasterData(force) {
    if (!force && rasterJson && Date.now() - rasterAt < 240e3) return rasterJson;
    const r = await fetch(DATA + 'weatherpro_raster.json', { cache: 'no-cache' }); if (!r.ok) throw new Error('weatherpro_raster.json niet beschikbaar (HTTP ' + r.status + ')');
    rasterJson = await r.json(); rasterAt = Date.now();
    ALL = rasterJson.cities.map(c => ({ id: c.lid, name: c.name, region: c.region, country: 'Netherlands', lat: c.lat, lon: c.lon, tz: 'Europe/Amsterdam' }));
    return rasterJson;
  }
  WP.loadFeed = async (lid) => { const d = await rasterData(); const c = d.cities.find(x => x.lid === lid); if (!c) throw new Error('plaats niet in het weekraster'); return WP.parseFeed(c.xml); };
  WP.loadKnmi = async () => { const r = await fetch(DATA + 'knmi_warnings.json', { cache: 'no-cache' }); if (!r.ok) throw new Error('KNMI-bestand niet beschikbaar'); const d = await r.json();
    return d.warnings.map(w => ({ id: w.id, level: w.level, type: w.type, area: w.area, onset: new Date(w.onset), expires: new Date(w.expires), text: w.text, typeName: (WP.TYPE[w.type] || ['Weer'])[0], icon: (WP.TYPE[w.type] || ['', '⚠️'])[1] }))
      .filter(w => w.expires > new Date()).sort((a, b) => b.level - a.level || a.onset - b.onset); };
  WP.search = async (q) => { await rasterData(); const s = q.toLowerCase(); return ALL.filter(c => c.name.toLowerCase().includes(s)); };
  WP.notify = () => {}; WP.notifyKnmi = () => {};   // geen meldingen op een website

  async function init() {
    try { await rasterData(true); } catch (e) { document.getElementById('grid').innerHTML = `<div class="empty">Geen gegevens beschikbaar: ${e.message}</div>`; return; }
    const ids = WP.safeJSON(localStorage.getItem('raster.cities'), null); cities = ids ? ALL.filter(c => ids.includes(c.id)) : [...ALL]; if (!cities.length) cities = [...ALL];
    if (!cities.some(c => c.id === selected)) selected = cities[0]?.id;
    bindUI(); renderAll();
    await refreshAll();
    setInterval(() => refreshAll(), 5 * 60e3);
  }
  const city = () => cities.find(c => c.id === selected);
  const saveCities = () => { localStorage.setItem('raster.cities', JSON.stringify(cities)); localStorage.setItem('raster.selected', selected); };

  async function refresh(id, force) {
    if (loading.has(id)) return;
    const f = forecasts[id];
    if (!force && f && f.expires && f.expires > Date.now() && Date.now() - f.fetched < 900e3) return;
    loading.add(id);
    try {
      forecasts[id] = await WP.loadFeed(id); delete errors[id];
      const c = cities.find(x => x.id === id); if (c) WP.notify(c, WP.alerts(c, forecasts[id]));
    } catch (e) { errors[id] = e.message || String(e); }
    loading.delete(id); renderAll();
  }
  async function refreshAll(force) { for (const c of [...cities]) await refresh(c.id, force); await refreshKnmi(force); await ensureEnsemble(city(), force); await ensureModel(city(), force); updateTray(); renderAll(); }

  async function ensureEnsemble(c, force) {
    if (!c || prefs.showSpread === false) return;
    const e = ensembles[c.id]; if (!force && e && Date.now() - e.fetched < 3600e3) return;
    if (ensLoading.has(c.id)) return; ensLoading.add(c.id);
    try { ensembles[c.id] = await WP.loadEnsemble(c.lat, c.lon); renderGrid(); } catch (err) { /* ensemble optioneel */ }
    ensLoading.delete(c.id);
  }
  async function refreshKnmi(force) {
    if (prefs.showKnmi === false) { knmiList = []; return; }
    if (!force && Date.now() - knmiFetched < 600e3) return;
    try { knmiList = await WP.loadKnmi(); knmiFetched = Date.now(); for (const c of cities) WP.notifyKnmi(c, WP.knmiFor(c, knmiList)); } catch (err) { /* optioneel */ }
  }

  // ---------- weergave ----------
  function renderAll() { renderLeft(); renderGrid(); renderList(); fitAll(); }

  function starts() {
    const c = city(), n = prefs.days, s0 = WP.addDays(WP.todayStart(c.tz), dayOffset, c.tz), out = [s0];
    for (let i = 1; i <= n; i++) out.push(WP.addDays(s0, i, c.tz));
    return out;
  }

  function renderGrid() {
    const c = city(), el = $('#grid'); if (!c) { el.innerHTML = ''; return; }
    const fc = active(c), s = src();
    if (!fc) { el.innerHTML = `<div class="empty">${s !== 'weatherpro' && modelErr[c.id + '|' + s] ? `${WP.SHORT[s]}: geen gegevens. ${modelErr[c.id + '|' + s]} Kies een andere bron.` : errors[c.id] ? 'Kan gegevens niet ophalen: ' + errors[c.id] : 'Laden…'}</div>`; return; }
    Grid.render(el, { city: c, fc, starts: starts(), alertsList: WP.alerts(c, fc), onDay: showPopover, sourceLabel: s === 'weatherpro' ? WP.SHORT[s] : `${WP.SHORT[s]} · t/m ${WP.wdShort(fc.hours[fc.hours.length - 1].date, c.tz)} ${WP.ddmm(fc.hours[fc.hours.length - 1].date, c.tz)}`, ens: prefs.showSpread === false ? null : ensembles[c.id], knmi: WP.knmiFor(c, knmiList) });
  }

  function renderLeft() {
    const c = city(), el = $('#left'); if (!c) return;
    const fc = active(c) || forecasts[c.id]; if (!fc) { el.innerHTML = `<div class="empty">${errors[c.id] || 'Laden…'}</div>`; return; }
    const o = fc.obs, night = WP.isNight(new Date(), c.lat, c.lon), tz = c.tz;
    const out = WP.rainOutlook(fc.hours, tz), rh = o ? WP.humidity(o.temp, o.dew) : null;
    // kortetermijn: blokken 02-08, 08-14, 14-20
    const hrNow = +WP.hh(new Date(), tz), lastB = [2, 8, 14, 20].filter(b => b <= hrNow).pop() ?? 20;
    let base = new Date(WP.todayStart(tz).getTime() + lastB * 3600e3); if (lastB > hrNow) base = new Date(base.getTime() - 86400e3);
    const blocks = [0, 1, 2].map(i => new Date(base.getTime() + i * 6 * 3600e3)).map(b0 => {
      const b1 = new Date(b0.getTime() + 6 * 3600e3), inB = fc.hours.filter(h => h.start >= b0 && h.start < b1), mid = inB[3] || inB[0], rain = inB.reduce((s, h) => s + (h.rain || 0), 0);
      return `<div>${WP.hh(b0, tz)}:00<br>${mid ? Icons.icon(WP.decode(mid.symbol, mid.ww, mid.cloud), WP.isNight(new Date(+b0 + 3 * 3600e3), c.lat, c.lon), 46) : ''}<div class="t">${WP.fTC(mid?.temp)}</div><small>${rain < 0.1 ? '<0,1mm' : WP.num(WP.rconv(rain)) + WP.ru()}</small></div>`;
    }).join('');
    const kw = WP.knmiFor(c, knmiList), al = WP.alerts(c, fc), rs = WP.riseSet(WP.todayStart(tz), c.lat, c.lon), dayToday = fc.days.find(d => d.date.toISOString().slice(0, 10) === WP.ymd(new Date(), tz));
    el.innerHTML = `
      <div class="cur-top"><div><b>Huidig</b><br>${o ? WP.ddmm(o.date, tz) + '-' + o.date.getFullYear() + ', ' + WP.hm(o.date, tz) : ''}</div><div>${c.name}</div></div>
      <div class="cur-ic">${o ? Icons.icon(WP.decode(o.symbol, o.ww, o.cloud), night, 120) : ''}</div>
      <div class="cur-t">${WP.fTC(o?.temp)}</div><div>${o ? WP.describe(o.ww, o.cloud) : ''}</div>
      ${o ? `<div class="cur-list">
        ${[['💧', 'Neerslag', WP.num(o.rain != null ? WP.rconv(o.rain) / Math.max(o.rainH || 1, 1) : 0) + ' ' + WP.ru() + '/u'], ['🌡', 'Voelt als', WP.fTC(WP.feelsLike(o.temp, o.dew, o.kn))], ['🚩', 'Wind', WP.compass(o.dir) + ' ' + (WP.isBft() ? WP.half(WP.bft(o.kn || 0)) + ' Bft' : WP.fW(o.kn))], ['💨', 'Windstoten', WP.fG(o.gust)], ['〰', 'Vochtigheid', rh == null ? '–' : Math.round(rh) + '%'], ['◌', 'Dauwpunt', WP.fTC(o.dew)], ['🧭', 'Luchtdruk', WP.fP(o.p)]].map(([ic, k, v]) => `<div><span class="ic">${ic}</span><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>` : ''}
      <div class="sunline">${Icons.horizon(true)} ${rs.rise ? WP.hm(rs.rise, tz) : '–'} &nbsp; ${Icons.horizon(false)} ${rs.set ? WP.hm(rs.set, tz) : '–'} &nbsp; ☀ ${dayToday?.sun != null ? WP.num(dayToday.sun) + 'h' : '–'}</div>
      <div class="outlook">${out.wetNow ? '🌧' : '☂'} ${out.long}</div>
      <div>Kortetermijnverwachting</div><div class="short">${blocks}</div>
      ${kw.length ? `<div class="alerts"><h4>🛡 KNMI-waarschuwingen</h4>${kw.map(w => `<div class="kbox" style="background:${WP.levelColor(w.level)}"><b>${w.icon} Code ${WP.levelName(w.level)}: ${w.typeName}</b><small>${WP.wdShort(w.onset, tz)} ${WP.hh(w.onset, tz)}:00 – ${WP.wdShort(w.expires, tz)} ${WP.hh(w.expires, tz)}:00 · ${w.area}</small></div>`).join('')}</div>` : ''}
      ${al.length ? `<div class="alerts"><h4>⚠ Waarschuwingen</h4>${al.map(a => `<div class="alert">${WP.alertIcon[a.kind]} ${WP.alertText(a, tz)}</div>`).join('')}</div>` : ''}`;
  }

  const fitAll = () => { Icons.fit($('#left')); Icons.fit($('#list')); };
  function renderList() {
    const el = $('#list'); if (searchActive) return;
    el.innerHTML = `<div class="listhead"><span>Plaatsen</span><button id="editBtn">${editing ? 'Klaar' : 'Bewerk'}</button></div>` + cities.map(c => {
      const f = forecasts[c.id], night = WP.isNight(new Date(), c.lat, c.lon), warn = f && WP.alerts(c, f).length, kmax = WP.knmiFor(c, knmiList).sort((a, b) => b.level - a.level)[0];
      return `<div class="city${c.id === selected ? ' sel' : ''}" data-id="${c.id}">${editing ? `<button class="minus" data-del="${c.id}" title="Verwijder ${c.name}">−</button>` : ''}<div class="nm"><b>${c.name}</b><small>${dutch(c.country)}</small></div>${kmax ? `<span class="kn" style="background:${WP.levelColor(kmax.level)}">${kmax.icon}</span>` : warn ? '<span class="warn">⚠</span>' : ''}${f?.obs ? `<span class="t">${WP.fTC(f.obs.temp)}</span>${Icons.icon(WP.decode(f.obs.symbol, f.obs.ww, f.obs.cloud), night, 36)}` : ''}</div>`;
    }).join('');
    el.querySelector('#editBtn').onclick = () => { editing = !editing; renderList(); };
    el.querySelectorAll('.minus').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); removeCity(+b.dataset.del); }));
    el.querySelectorAll('.city').forEach(d => {
      d.addEventListener('click', () => { if (editing) { removeCity(+d.dataset.id); return; } selected = +d.dataset.id; dayOffset = 0; saveCities(); renderAll(); refresh(selected); ensureEnsemble(city()); ensureModel(city()); });
      d.addEventListener('contextmenu', (e) => { e.preventDefault(); ctxMenu(e.clientX, e.clientY, +d.dataset.id); });
    });
  }
  function removeCity(id) { cities = cities.filter(c => c.id !== id); delete forecasts[id]; if (selected === id) selected = cities[0] && cities[0].id; saveCities(); renderAll(); }
  const NL = { Netherlands: 'Nederland', Belgium: 'België', Germany: 'Duitsland', France: 'Frankrijk', 'United Kingdom': 'Verenigd Koninkrijk', Spain: 'Spanje', Italy: 'Italië', Switzerland: 'Zwitserland', Austria: 'Oostenrijk', Luxembourg: 'Luxemburg' };
  const dutch = (s) => NL[s] || s;

  function ctxMenu(x, y, id) {
    const m = $('#ctx'), off = WP.alertOff(id);
    m.innerHTML = `<div data-a="alert">${off ? 'Waarschuwingen aan' : 'Waarschuwingen uit'}</div><div data-a="del">Verwijderen</div>`; m.style.left = x + 'px'; m.style.top = y + 'px'; m.hidden = false;
    m.onclick = (e) => { const a = e.target.dataset.a; m.hidden = true;
      if (a === 'alert') { prefs.alertsOff = off ? prefs.alertsOff.filter(i => i !== id) : [...prefs.alertsOff, id]; savePrefs(); }
      if (a === 'del') { cities = cities.filter(c => c.id !== id); delete forecasts[id]; if (selected === id) selected = cities[0]?.id; saveCities(); }
      renderAll(); };
  }

  // ---------- zoeken ----------
  let searchActive = false, searchTimer;
  function bindSearch() {
    const q = $('#q');
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); const v = q.value.trim(); const first = $('#list .city[data-i]'); if (first) first.click(); else if (v.length >= 2) runSearch(v); } if (e.key === 'Escape') { q.value = ''; searchActive = false; renderList(); } });
    q.addEventListener('input', () => { clearTimeout(searchTimer); const v = q.value.trim(); if (v.length < 2) { searchActive = false; renderList(); return; } searchTimer = setTimeout(() => runSearch(v), 350); });
  }
  async function runSearch(v) {
    searchActive = true; const el = $('#list'); el.innerHTML = '<div class="empty">Zoeken…</div>';
    try {
      const r = await WP.search(v);
      el.innerHTML = r.length ? r.map((c, i) => `<div class="city" data-i="${i}"><div class="nm"><b>${c.name}</b><small>${[c.region, dutch(c.country)].filter(Boolean).join(', ')}</small></div><span>＋</span></div>`).join('') : '<div class="empty">Geen resultaten</div>';
      el.querySelectorAll('.city').forEach(d => d.addEventListener('click', () => { const c = r[+d.dataset.i]; if (!cities.some(x => x.id === c.id)) cities.push(c); selected = c.id; saveCities(); $('#q').value = ''; searchActive = false; renderAll(); refresh(c.id, true); }));
    } catch (e) { el.innerHTML = `<div class="empty">Zoeken mislukt: ${e.message}</div>`; }
  }

  // ---------- popover per datum ----------
  function showPopover(i, anchor) {
    const c = city(), fc = active(c); if (!fc) return; popFor = { i, perHour: false, anchor };
    drawPop(); const p = $('#pop'), r = anchor.getBoundingClientRect(); p.hidden = false;
    p.style.left = Math.max(8, Math.min(innerWidth - 470, r.left + r.width / 2 - 230)) + 'px'; p.style.top = (r.bottom + 6) + 'px';
  }
  function drawPop() {
    const c = city(), fc = active(c), tz = c.tz, day0 = starts()[popFor.i], step = popFor.perHour ? 3600e3 : 3 * 3600e3, origin = popFor.perHour ? +day0 : +day0 - 3600e3, rows = [];
    for (let k = 0; k < 86400e3 / step; k++) {
      const b0 = new Date(origin + k * step), b1 = new Date(+b0 + step), hs = fc.hours.filter(h => h.start >= b0 && h.start < b1);
      const mid = hs.length > 1 ? hs[Math.floor(hs.length / 2)] : hs[0], rain = hs.reduce((s, h) => s + (h.rain || 0), 0);
      const sym = rain >= 0.1 ? hs.reduce((a, b) => (b.rain || 0) > (a.rain || 0) ? b : a, hs[0]) : mid;
      const prob = Math.max(0, ...hs.map(h => h.prob ?? 0)), sun = hs.reduce((s, h) => s + (h.sun || 0), 0), kn = Math.max(0, ...hs.map(h => h.kn ?? 0)), gu = Math.max(0, ...hs.map(h => h.gust ?? 0));
      const night = WP.isNight(new Date((+b0 + +b1) / 2), c.lat, c.lon);
      rows.push(`<div class="prow"><div class="tm">${WP.hh(b0, tz)}:00 -<b>${WP.hh(b1, tz)}:00</b></div><div>${sym ? Icons.icon(WP.decode(sym.symbol, sym.ww, sym.cloud), night, 48) : ''}</div><div class="tp">${WP.fTC(mid?.temp)}<small class="feel">${mid ? 'voelt ' + WP.fT(WP.feelsLike(mid.temp, mid.dew, mid.kn)) : ''}</small></div>
        <div class="c">💧 ${WP.fPct(prob)}<br>💧 ${WP.fR(rain)}</div><div class="c"><span class="sn">☀ ${Math.round(sun)}min</span><div class="w">${Icons.compass(mid?.dir, 18)}${WP.fW(kn)}${prefs.wind === 'bftkmh' ? ' · ' + WP.fG(gu) : ''}</div></div></div>`);
    }
    const rs = WP.riseSet(day0, c.lat, c.lon);
    $('#pop').innerHTML = `<h3>${WP.wdLong(day0, tz)} ${WP.dmon(day0, tz)}</h3><div class="popsun">${Icons.horizon(true)} ${rs.rise ? WP.hm(rs.rise, tz) : '–'} &nbsp; ${Icons.horizon(false)} ${rs.set ? WP.hm(rs.set, tz) : '–'}</div><div class="seg"><button data-h="0" class="${popFor.perHour ? '' : 'on'}">Per 3 uur</button><button data-h="1" class="${popFor.perHour ? 'on' : ''}">Per uur</button></div>${rows.join('')}`;
    $('#pop').hidden = false; Icons.fit($('#pop'));
    $('#pop').querySelectorAll('.seg button').forEach(b => b.onclick = (e) => { e.stopPropagation(); popFor.perHour = b.dataset.h === '1'; drawPop(); });
  }
  document.addEventListener('click', (e) => { if (!$('#pop').hidden && !e.target.closest('#pop') && !e.target.closest('.dayhead')) $('#pop').hidden = true; $('#ctx').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#pop').hidden = true; $('#modal').hidden = true; } if ((e.ctrlKey || e.metaKey) && e.key === 'r') { e.preventDefault(); refreshAll(true); } });

  // ---------- voorkeuren ----------
  function openPrefs() {
    const sel = (id, opts, val) => `<select id="${id}">${opts.map(([v, t]) => `<option value="${v}"${v == val ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    $('#prefs').innerHTML = `<h3>Voorkeuren</h3>
      <h4>Weereenheden</h4>
      <label>Temperatuur ${sel('pTemp', [['c', 'Celsius'], ['f', 'Fahrenheit']], prefs.temp)}</label>
      <label>Wind ${sel('pWind', WIND_OPTS, prefs.wind)}</label>
      <label>Luchtdruk ${sel('pPres', [['hpa', 'hPa'], ['inhg', 'inHg'], ['mmhg', 'mmHg']], prefs.pressure)}</label>
      <label>Neerslag ${sel('pRain', [['mm', 'mm'], ['in', 'inch']], prefs.rain)}</label>
      <label>Aantal dagen ${sel('pDays', [[7, '7 dagen'], [10, '10 dagen'], [14, '14 dagen']], prefs.days)}</label>
      <h4>Gegevens</h4>
      <label>Onzekerheid tonen (ECMWF-ensemble, P10–P90) <input type="checkbox" id="pSpread" ${prefs.showSpread === false ? '' : 'checked'}></label>
      <label>KNMI-waarschuwingen tonen (Nederland) <input type="checkbox" id="pKnmi" ${prefs.showKnmi === false ? '' : 'checked'}></label>
      <h4>Waarschuwingen</h4>
      <label>Meldingen en markering aan <input type="checkbox" id="pAon" ${prefs.alertsOn ? 'checked' : ''}></label>
      <label>Windstoot vanaf (km/u) <input type="number" id="pAg" value="${prefs.alertGust}" min="30" max="200" step="5"></label>
      <label>Neerslag vanaf (mm/u) <input type="number" id="pAr" value="${prefs.alertRain}" min="0.5" max="50" step="0.5"></label>
      <label>Hitte: max-temp vanaf (°) <input type="number" id="pAh" value="${prefs.alertHeat}" min="20" max="45"></label>
      <label>Vorst: min-temp t/m (°) <input type="number" id="pAf" value="${prefs.alertFrost}" min="-20" max="5"></label>
      <div class="btns"><button id="pTest">Testmelding</button><button id="pOk">Sluiten</button></div>`;
    $('#prefs').classList.remove('wide'); $('#modal').hidden = false;
    const apply = () => { prefs.temp = $('#pTemp').value; prefs.wind = $('#pWind').value; prefs.pressure = $('#pPres').value; prefs.rain = $('#pRain').value; prefs.days = +$('#pDays').value;
      prefs.showSpread = $('#pSpread').checked; prefs.showKnmi = $('#pKnmi').checked; prefs.alertsOn = $('#pAon').checked; prefs.alertGust = +$('#pAg').value; prefs.alertRain = +$('#pAr').value; prefs.alertHeat = +$('#pAh').value; prefs.alertFrost = +$('#pAf').value; savePrefs(); syncBar(); renderAll(); };
    $('#prefs').querySelectorAll('select,input').forEach(e => e.addEventListener('change', apply));
    $('#pOk').onclick = () => { $('#modal').hidden = true; };
    $('#pTest').onclick = () => { Notification.requestPermission().then(p => { if (p === 'granted') new Notification('Meteobewaking', { body: 'Testmelding: waarschuwingen staan aan.' }); }); };
  }
  const WIND_OPTS = [['bftkmh', 'Bft + stoten km/u'], ['bft', 'Beaufort'], ['kmh', 'km/u'], ['kn', 'knopen'], ['ms', 'm/s'], ['mph', 'mph']];

  // ---------- weerbericht + export ----------
  const esc = (t) => t.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
  function reportText(c) { return WP.weerbericht(c, active(c), ensembles[c.id], WP.knmiFor(c, knmiList), new Date(), WP.SOURCES.find(x => x[0] === src())[1]); }
  function openReport() {
    const c = city(); if (!c || !active(c)) return; const text = reportText(c);
    $('#prefs').classList.add('wide');
    $('#prefs').innerHTML = `<h3>Weerbericht</h3><pre id="rtext">${esc(text)}</pre><div class="btns"><span id="rbusy"></span><button id="rCopy">Kopieer tekst</button><button id="rOk">Sluiten</button></div>`;
    $('#modal').hidden = false;
    $('#rCopy').onclick = async () => { await navigator.clipboard.writeText(text); $('#rCopy').textContent = 'Gekopieerd ✓'; };
    $('#rOk').onclick = () => { $('#modal').hidden = true; $('#prefs').classList.remove('wide'); };
  }

  function syncBar() {
    $('#selSrc').innerHTML = WP.SOURCES.map(([v, t]) => `<option value="${v}"${v === src() ? ' selected' : ''}>${t}</option>`).join('');
    $('#selDays').innerHTML = [7, 10, 14].map(n => `<option value="${n}"${n === prefs.days ? ' selected' : ''}>${n} dagen</option>`).join('');
    $('#selWind').innerHTML = WIND_OPTS.map(([v, t]) => `<option value="${v}"${v === prefs.wind ? ' selected' : ''}>${t}</option>`).join('');
    $('#selTemp').value = prefs.temp;
  }
  function bindUI() {
    syncBar(); bindSearch();
    $('#selSrc').onchange = (e) => { prefs.source = e.target.value; savePrefs(); renderAll(); ensureModel(city()); };
    $('#selDays').onchange = (e) => { prefs.days = +e.target.value; savePrefs(); clampOffset(); renderGrid(); };
    $('#selWind').onchange = (e) => { prefs.wind = e.target.value; savePrefs(); renderAll(); };
    $('#selTemp').onchange = (e) => { prefs.temp = e.target.value; savePrefs(); renderAll(); };
    $('#prev').onclick = () => { dayOffset = Math.max(0, dayOffset - 1); renderGrid(); };
    $('#next').onclick = () => { dayOffset++; clampOffset(); renderGrid(); };
    $('#refresh').onclick = () => refreshAll(true);
    $('#gear').onclick = openPrefs; $('#report').onclick = openReport;
    const toggle = (side) => { const cur = document.body.dataset[side], visible = getComputedStyle($(side === 'left' ? '#left' : '#right')).display !== 'none'; document.body.dataset[side] = visible ? 'off' : 'on'; renderGrid(); };
    $('#tgLeft').onclick = () => toggle('left'); $('#tgRight').onclick = () => toggle('right');
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });
    new ResizeObserver(() => renderGrid()).observe($('#grid'));
  }
  function clampOffset() { dayOffset = Math.max(0, Math.min(dayOffset, 15 - prefs.days)); }

  function updateTray() {
    const c = city(), f = c && forecasts[c.id]; if (!f?.obs) return;
    const out = WP.rainOutlook(f.hours, c.tz); window.api.trayTooltip(`${c.name} ${WP.fTC(f.obs.temp)} · ${out.long}`);
    document.title = `Meteobewaking – ${c.name} ${WP.fTC(f.obs.temp)}`;
  }
  init();
})();
