/* Sneeuwverwachting Nederland: MOS/MIX-basiskaart + vooraf berekende ensemblerasters. */
(function(){'use strict';
const S = SneeuwCore, $ = id => document.getElementById(id), NS = 'http://www.w3.org/2000/svg';
const params = new URLSearchParams(location.search);
const DATA = (params.get('data') || 'https://data.weerlab.nl/sneeuw').replace(/\/$/, '');
const FIXED_RUN = params.get('run');

const PRODUCTS = {
  sneeuwval_kans: {title:'Kans op sneeuwval', variantLabel:'Venster', label: v => v + ' u',
    definition: (m, v, t) => `Kans dat er sneeuw valt (≥ ${m.criteria.snowfall_threshold_mm.toString().replace('.', ',')} mm water-equivalent) in ${v} uur: ${S.windowLabel(t, +v)}.`},
  sneeuwdek_kans: {title:'Kans op sneeuwdek', variantLabel:'Minimaal', label: v => '≥ ' + v + ' cm',
    definition: (m, v, t) => `Kans dat er op ${S.fullLabel(t)} minstens ${v} cm sneeuw ligt (modelsneeuwhoogte).`},
  sneeuwhoogte: {title:'Verwachte sneeuwhoogte', variantLabel:'Statistiek',
    label: v => ({p10:'P10', p50:'Mediaan', mean:'Gemiddeld', p90:'P90', max:'Maximum'})[v],
    definition: (m, v, t) => ({p10:'P10: 9 van de 10 leden hebben minstens deze hoogte.', p50:'Mediaan: de middelste van de geldige leden.',
      mean:'Gemiddelde over de geldige leden.', p90:'P90: slechts 1 van de 10 leden heeft meer.', max:'Maximum: het hoogste lid — het natste scenario, niet de verwachting.'})[v]
      + ' Modelsneeuwhoogte op ' + S.fullLabel(t) + '.'},
  neerslagsoort: {title:'Neerslagsoort', variantLabel:'Weergave',
    label: v => ({dominant:'Meest waarschijnlijk', neerslag:'Kans op neerslag', sneeuw:'Sneeuw', natte_sneeuw:'Natte sneeuw',
      regen_sneeuw:'Regen en sneeuw', ijzel:'IJzel', ijskorrels:'IJskorrels', regen:'Regen'})[v],
    definition: (m, v, t) => v === 'dominant'
      ? `Meest waarschijnlijke neerslagsoort op ${S.fullLabel(t)} (momentopname), alleen waar minstens ${m.criteria.ptype_min_precip_pct} % van de leden neerslag heeft.`
      : v === 'neerslag' ? `Kans dat er op ${S.fullLabel(t)} neerslag valt (welke soort dan ook).`
      : `Kans dat de neerslag op ${S.fullLabel(t)} valt als ${PRODUCTS.neerslagsoort.label(v).toLowerCase()} (aandeel van alle leden, momentopname).`}
};
const MODELS = {icond2eps:{staleHours:9}, ecmwfens:{staleHours:22}};
const PLACES = [['Den Helder',52.96,4.76],['Leeuwarden',53.20,5.79],['Groningen',53.22,6.57],['Assen',52.99,6.56],['Zwolle',52.51,6.09],
  ['Lelystad',52.52,5.47],['Amsterdam',52.37,4.90],['Den Haag',52.08,4.30],['Rotterdam',51.92,4.48],['Utrecht',52.09,5.12],['Arnhem',51.98,5.91],
  ['Enschede',52.22,6.89],['Middelburg',51.50,3.61],["'s-Hertogenbosch",51.69,5.30],['Eindhoven',51.44,5.48],['Breda',51.59,4.78],['Maastricht',50.85,5.69]];

let state = {model:'icond2eps', product:'sneeuwval_kans', variant:{sneeuwval_kans:'6', sneeuwdek_kans:'1', sneeuwhoogte:'p50', neerslagsoort:'dominant'}, t:0, cell:-1};
try{ const s = JSON.parse(localStorage.getItem('weerlab-sneeuw') || '{}');
  if(PRODUCTS[s.product]) state.product = s.product; if(s.variant) Object.assign(state.variant, s.variant); if(MODELS[s.model]) state.model = s.model; }catch{}
if(MODELS[params.get('model')]) state.model = params.get('model');
const save = () => { try{ localStorage.setItem('weerlab-sneeuw', JSON.stringify({model:state.model, product:state.product, variant:state.variant})); }catch{} };

let manifest = null, rasters = {}, times = [], provinces = null, landPath = null, provPath = null, outlinePath = null, timer = null, hatch = null;

/* ---------- data ---------- */
async function bytes(url, cache='force-cache'){
  const r = await fetch(url, {cache}); if(!r.ok) throw Error(`${r.status} bij ${url.split('/').slice(-2).join('/')}`);
  let b = new Uint8Array(await r.arrayBuffer());
  if(S.isGzip(b)) b = new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  return b;
}
const manifestUrl = () => FIXED_RUN ? `${DATA}/${state.model}/${FIXED_RUN}/manifest.json` : `${DATA}/${state.model}_latest.json`;
async function loadModel(keepTime){
  const m = JSON.parse(new TextDecoder().decode(await bytes(manifestUrl() + (FIXED_RUN ? '' : '?t=' + Date.now()), 'no-store')));
  if(!m.complete || m.schema !== 1) throw Error('Onvolledige of onbekende dataset.');
  const base = `${DATA}/${state.model}/${m.run_key}/`;
  const entries = await Promise.all(Object.entries(m.files).map(async ([k, f]) => [k, S.parseRaster(await bytes(base + f))]));
  for(const [, r] of entries) if(r.nx !== m.grid.nx || r.ny !== m.grid.ny || r.nt !== m.valid_utc.length) throw Error('Rasterafmetingen kloppen niet met het manifest.');
  const prevMs = times[state.t];
  manifest = m; rasters = Object.fromEntries(entries); times = m.valid_utc.map(Date.parse);
  if(!m.products[state.product]) state.product = 'sneeuwval_kans';
  for(const [p, def] of Object.entries(m.products))
    if(!def.variants.includes(state.variant[p])) state.variant[p] = def.variants.includes('6') ? '6' : def.variants[0];
  if(keepTime && prevMs) { const i = times.indexOf(prevMs); state.t = i >= 0 ? i : 0; }
  else { const now = Date.now(); const i = times.findIndex(t => t >= now - 1800000); state.t = i >= 0 ? i : 0; }
  $('error').hidden = true;
}
async function poll(){
  if(FIXED_RUN) return;
  try{ const m = JSON.parse(new TextDecoder().decode(await bytes(manifestUrl() + '?t=' + Date.now(), 'no-store')));
    if(manifest && m.run_key !== manifest.run_key){ await loadModel(true); buildTimeline(); render(); } }
  catch(e){ /* laatste geldige set blijft staan */ }
}

/* ---------- basiskaart (zelfde opbouw als mosmix_kaart.html) ---------- */
function ringsD(outerOnly){
  let d = '';
  for(const f of provinces.features){
    const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for(const poly of polys) for(const ring of (outerOnly ? [poly[0]] : poly))
      d += ring.map(([lon, lat], i) => (i ? 'L' : 'M') + S.lonToX(lon).toFixed(1) + ' ' + S.latToY(lat).toFixed(1)).join('') + 'Z';
  }
  return d;
}
function el(tag, attrs, parent){ const e = document.createElementNS(NS, tag); for(const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; }
function buildBasemap(){
  const d = ringsD(false), outer = ringsD(true);
  landPath = new Path2D(d); provPath = landPath; outlinePath = new Path2D(outer);
  const svg = $('basemap'); svg.replaceChildren();
  el('path', {d, class:'basemap-land', 'fill-rule':'evenodd'}, svg);
  el('path', {d, class:'basemap-prov'}, svg);
  const ov = $('overlay'); ov.replaceChildren();
  el('path', {d, class:'prov-lijn'}, ov);
  el('path', {d:outer, class:'nl-buitengrens'}, ov);
  for(const [name, lat, lon] of PLACES){
    const g = el('g', {class:'plaats'}, ov), x = S.lonToX(lon), y = S.latToY(lat);
    el('circle', {cx:x, cy:y, r:3.5}, g);
    const t = el('text', {x:x + 7, y:y + 5}, g); t.textContent = name;
  }
  el('circle', {id:'marker', class:'marker', r:12, cx:-100, cy:-100}, ov);
}
function hatchPattern(ctx){
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d'); x.fillStyle = '#e2e8f0'; x.fillRect(0, 0, 8, 8);
  x.strokeStyle = '#94a3b8'; x.lineWidth = 2; x.beginPath(); x.moveTo(-2, 10); x.lineTo(10, -2); x.stroke();
  return ctx.createPattern(c, 'repeat');
}

/* ---------- veld tekenen (scherm en export delen deze functie) ---------- */
function currentKey(){ return state.product + '/' + state.variant[state.product]; }
function encodingOf(product, variant){ const d = manifest.products[product]; return (d.variant_encoding && d.variant_encoding[variant]) || d.encoding; }
function currentEncoding(){ return encodingOf(state.product, state.variant[state.product]); }
function fieldImages(){
  const g = manifest.grid, frame = rasters[currentKey()].frame(state.t), enc = currentEncoding();
  const color = document.createElement('canvas'), miss = document.createElement('canvas');
  color.width = miss.width = g.nx; color.height = miss.height = g.ny;
  const ci = color.getContext('2d').createImageData(g.nx, g.ny), mi = miss.getContext('2d').createImageData(g.nx, g.ny);
  const cache = new Map();
  for(let i = 0; i < frame.length; i++){
    const code = frame[i];
    if(code === S.MISSING){ mi.data[i*4+3] = 255; continue; }
    let rgb = cache.get(code);
    if(rgb === undefined){ const c = S.colorFor(S.decode(code, enc), enc); rgb = c ? S.hexRGB(c) : null; cache.set(code, rgb); }
    if(rgb){ ci.data[i*4] = rgb[0]; ci.data[i*4+1] = rgb[1]; ci.data[i*4+2] = rgb[2]; ci.data[i*4+3] = 235; }
  }
  color.getContext('2d').putImageData(ci, 0, 0); miss.getContext('2d').putImageData(mi, 0, 0);
  let anyMissing = false; for(let i = 3; i < mi.data.length; i += 4) if(mi.data[i]){ anyMissing = true; break; }
  return {color, miss, anyMissing};
}
/** Tekent het veld in kaartcoördinaten (800x1100) op ctx; ctx-transform bepaalt schaal/positie. */
function drawField(ctx, imgs){
  ctx.save(); ctx.clip(landPath, 'evenodd');
  // Categorieën niet mengen; kansen en hoeveelheden wel vloeiend tekenen.
  ctx.imageSmoothingEnabled = currentEncoding() !== 'categorie'; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imgs.color, 0, 0, S.MAP.w, S.MAP.h);
  if(imgs.anyMissing){
    const tmp = document.createElement('canvas'); tmp.width = S.MAP.w; tmp.height = S.MAP.h;
    const t = tmp.getContext('2d'); t.imageSmoothingEnabled = false; t.drawImage(imgs.miss, 0, 0, S.MAP.w, S.MAP.h);
    t.globalCompositeOperation = 'source-in'; t.fillStyle = hatchPattern(t); t.fillRect(0, 0, S.MAP.w, S.MAP.h);
    ctx.drawImage(tmp, 0, 0);
  }
  ctx.restore();
}

/* ---------- UI ---------- */
function buildVariants(){
  const p = PRODUCTS[state.product], box = $('variants'); box.replaceChildren();
  $('variant-label').textContent = p.variantLabel;
  for(const v of manifest.products[state.product].variants){
    const b = document.createElement('button'); b.textContent = p.label(v); b.setAttribute('aria-pressed', String(v === state.variant[state.product]));
    b.onclick = () => { state.variant[state.product] = v; save(); buildVariants(); render(); };
    box.appendChild(b);
  }
}
function buildTimeline(){
  const days = [...new Set(times.map(S.dayKey))], box = $('days'); box.replaceChildren();
  for(const d of days){
    const i = times.findIndex(t => S.dayKey(t) === d), b = document.createElement('button');
    b.textContent = S.dayLabel(times[i]); b.dataset.day = d;
    b.onclick = () => { const cur = new Date(times[state.t]).getUTCHours();
      const same = times.findIndex(t => S.dayKey(t) === d && new Date(t).getUTCHours() === cur); setT(same >= 0 ? same : i); };
    box.appendChild(b);
  }
  $('slider').max = times.length - 1;
}
function buildHours(){
  const day = S.dayKey(times[state.t]), box = $('hours');
  if(box.dataset.day !== day){
    box.replaceChildren(); box.dataset.day = day;
    times.forEach((t, i) => { if(S.dayKey(t) !== day) return;
      const b = document.createElement('button'); b.textContent = S.hourLabel(t).slice(0, 2); b.dataset.i = i; b.title = S.fullLabel(t);
      b.onclick = () => setT(i);
      b.onpointerenter = e => { if(e.pointerType === 'mouse' && e.buttons === 0 && !timer) setT(i); };
      box.appendChild(b); });
  }
  for(const b of box.children) b.setAttribute('aria-pressed', String(+b.dataset.i === state.t));
  for(const b of $('days').children) b.setAttribute('aria-pressed', String(b.dataset.day === day));
}
function setT(i){ state.t = Math.max(0, Math.min(times.length - 1, i)); render(); }

function legendHTML(){
  // Alle tijdstappen zitten in één bestand per variant: scrubben gaat zonder netwerk.
  return S.scaleFor(currentEncoding()).map(k => `<span><i style="background:${k.color}"></i>${k.label}</span>`).join('')
    + '<span><i class="nb"></i>n.b. (te weinig leden of venster vóór runstart)</span>';
}
const fmtUpdate = iso => S.fullLabel(Date.parse(iso));
function render(){
  if(!manifest) return;
  const p = PRODUCTS[state.product], v = state.variant[state.product], t = times[state.t];
  $('product-title').textContent = p.title;
  for(const b of document.querySelectorAll('.products button')) b.setAttribute('aria-pressed', String(b.dataset.product === state.product));
  $('hdr-model').textContent = `${manifest.model} · ${p.title}`;
  for(const b of document.querySelectorAll('.products button')) b.disabled = !manifest.products[b.dataset.product];
  $('model').value = state.model;
  $('hdr-run').textContent = `Modelrun ${S.fullLabel(Date.parse(manifest.run_utc))} · +${Math.round((t - Date.parse(manifest.run_utc)) / 3600000)} u`;
  $('hdr-valid').textContent = 'Geldig ' + S.fullLabel(t);
  $('hdr-update').textContent = 'Laatste update ' + fmtUpdate(manifest.updated_utc);
  const stale = S.staleWarning(Date.parse(manifest.run_utc), Date.now(), MODELS[state.model].staleHours); $('stale').hidden = !stale; $('stale').textContent = stale;
  $('legend').innerHTML = legendHTML();
  $('definition').textContent = p.definition(manifest, v, t);
  $('slider').value = state.t;
  const ctx = $('field').getContext('2d'); ctx.clearRect(0, 0, S.MAP.w, S.MAP.h);
  drawField(ctx, fieldImages());
  buildHours(); renderPoint();
}

function value(key, cell, t){
  const r = rasters[key]; if(!r) return null;
  const [p, v] = key.split('/'); return S.decode(r.frame(t)[cell], encodingOf(p, v));
}
const pct = v => v === null ? 'n.b.' : v + ' %';
const catLabel = v => v === null ? 'n.b.' : v === 0 ? 'geen of weinig kans op neerslag' : (S.CAT_SCALE.find(k => k.code === v) || {label:'?'}).label;
const cm = v => v === null ? 'n.b.' : v.toFixed(1).replace('.', ',') + ' cm';
function renderPoint(){
  const body = $('point-body');
  if(state.cell < 0){ body.innerHTML = ''; return; }
  const g = manifest.grid, i = state.cell % g.nx, j = Math.floor(state.cell / g.nx), t = state.t;
  const lon = g.lon_min + (i + .5) * (g.lon_max - g.lon_min) / g.nx, lat = g.lat_max - (j + .5) * (g.lat_max - g.lat_min) / g.ny;
  const m = $('marker'); m.setAttribute('cx', S.lonToX(lon)); m.setAttribute('cy', S.latToY(lat));
  const rows = (label, list) => `<tr><th colspan="2">${label}</th></tr>` + list.map(([a, b]) => `<tr><td>${a}</td><td class="v">${b}</td></tr>`).join('');
  const P = manifest.products;
  body.innerHTML = `<p class="note">${lat.toFixed(3).replace('.', ',')}° N · ${lon.toFixed(3).replace('.', ',')}° O · geldig ${S.fullLabel(times[t])}</p><table>`
    + rows('Kans op sneeuwval (venster tot nu)', P.sneeuwval_kans.variants.map(v => [`${v} u`, pct(value('sneeuwval_kans/' + v, state.cell, t))]))
    + rows('Kans op sneeuwdek', P.sneeuwdek_kans.variants.map(v => [`≥ ${v} cm`, pct(value('sneeuwdek_kans/' + v, state.cell, t))]))
    + rows('Sneeuwhoogte', [['Ligt nu (run +0 u, mediaan)', cm(value('sneeuwhoogte/p50', state.cell, 0))],
        ...P.sneeuwhoogte.variants.map(v => [PRODUCTS.sneeuwhoogte.label(v), cm(value('sneeuwhoogte/' + v, state.cell, t))])])
    + (P.neerslagsoort ? rows('Neerslagsoort (momentopname)', [['Meest waarschijnlijk', catLabel(value('neerslagsoort/dominant', state.cell, t))],
        ...P.neerslagsoort.variants.filter(v => v !== 'dominant').map(v => [PRODUCTS.neerslagsoort.label(v), pct(value('neerslagsoort/' + v, state.cell, t))])]) : '')
    + `</table><p class="note">Waarden van de dichtstbijzijnde kaartcel (~2 km) zonder interpolatie; het modelrooster zelf is ${String(manifest.native_resolution_km).replace('.', ',')} km. Bron: ${manifest.source}, run ${S.fullLabel(Date.parse(manifest.run_utc))}.</p>`;
}

/* ---------- export (direct uit de data, geen schermafdruk) ---------- */
const FORMATS = {hoog:[1600,2200], vierkant:[1080,1080], staand:[1080,1350], breed:[1920,1080], facebook:[1200,630]};
function exportPNG(){
  const format = $('export-format').value, [W, H] = FORMATS[format], c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), p = PRODUCTS[state.product], v = state.variant[state.product], t = times[state.t];
  const wide = W / H > 1.2, pad = Math.round(Math.min(W, H) * .03), head = wide ? 0 : Math.round(H * .11), foot = wide ? 0 : Math.round(H * .13);
  x.fillStyle = '#f6f8fb'; x.fillRect(0, 0, W, H);
  // kaartvak met vaste 800:1100-verhouding
  const boxW = wide ? W * .5 : W - 2 * pad, boxH = H - head - foot - 2 * pad, s = Math.min(boxW / S.MAP.w, boxH / S.MAP.h);
  const mw = S.MAP.w * s, mh = S.MAP.h * s, mx = wide ? pad : (W - mw) / 2, my = head + pad + (boxH - mh) / 2;
  x.save(); x.translate(mx, my); x.scale(s, s);
  x.fillStyle = '#b8d4e8'; x.fillRect(0, 0, S.MAP.w, S.MAP.h);
  x.fillStyle = '#f5efd9'; x.fill(landPath, 'evenodd');
  drawField(x, fieldImages());
  x.strokeStyle = 'rgba(71,85,105,.45)'; x.lineWidth = .8; x.stroke(provPath);
  x.strokeStyle = '#fff'; x.lineWidth = 2; x.lineJoin = 'round'; x.stroke(outlinePath);
  x.font = '600 15px "DM Sans",sans-serif'; x.lineJoin = 'round';
  for(const [name, lat, lon] of PLACES){ const px = S.lonToX(lon), py = S.latToY(lat);
    x.fillStyle = '#1e293b'; x.beginPath(); x.arc(px, py, 3.5, 0, 7); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 3; x.strokeText(name, px + 7, py + 5); x.fillText(name, px + 7, py + 5); }
  x.restore();
  // tekstblok
  const tx = wide ? mx + mw + pad * 1.5 : pad, tw = wide ? W - tx - pad : W - 2 * pad, base = Math.max(14, Math.round(wide ? H * .042 : Math.min(W, H) * .028));
  let ty = wide ? pad + base * 1.4 : pad + base * 1.3;
  const line = (txt, size, weight, color, gap = 1.35) => { x.font = `${weight} ${size}px "DM Sans",sans-serif`; x.fillStyle = color; x.fillText(txt, tx, ty, tw); ty += size * gap; };
  line(`${p.title} · ${p.label(v)}`, base * 1.35, 800, '#0f172a');
  line(`Geldig ${S.fullLabel(t)}`, base, 600, '#1e293b');
  line(`${manifest.model} · run ${S.fullLabel(Date.parse(manifest.run_utc))}`, base * .8, 500, '#475569', 1.6);
  if(!wide) ty = H - foot + pad * .4;
  // legenda
  const scale = S.scaleFor(currentEncoding()), sw = base * .9; x.font = `500 ${Math.round(base * .72)}px "DM Sans",sans-serif`;
  let lx = tx; const items = [...scale.map(k => [k.color, k.label]), [null, 'n.b.']];
  for(const [col, lab] of items){ const w = sw + 6 + x.measureText(lab).width + base * .8;
    if(lx + w > tx + tw){ lx = tx; ty += sw * 1.6; }
    if(col){ x.fillStyle = col; x.fillRect(lx, ty - sw * .8, sw, sw); } else { x.fillStyle = hatchPattern(x); x.fillRect(lx, ty - sw * .8, sw, sw); }
    x.strokeStyle = '#cbd5e1'; x.lineWidth = 1; x.strokeRect(lx, ty - sw * .8, sw, sw);
    x.fillStyle = '#334155'; x.fillText(lab, lx + sw + 6, ty); lx += w; }
  ty += sw * 2;
  x.font = `500 ${Math.round(base * .62)}px "DM Sans",sans-serif`; x.fillStyle = '#64748b';
  x.fillText(`Bron: ${manifest.license} · weerlab.nl`, tx, wide ? Math.min(ty, H - pad) : H - pad * .8, tw);
  c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    const d = new Date(t).toISOString().slice(0, 13).replace(/[-T]/g, '');
    a.download = `Sneeuw_${state.product}_${v}_${manifest.model_key}_${d}UTC_${format}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, 'image/png');
}

/* ---------- bediening ---------- */
function togglePlay(){
  if(timer){ clearInterval(timer); timer = null; $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Afspelen'); return; }
  $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', 'Pauzeren');
  timer = setInterval(() => setT(state.t >= times.length - 1 ? 0 : state.t + 1), +$('speed').value);
}
function wire(){
  for(const b of document.querySelectorAll('.products button')) b.onclick = () => { state.product = b.dataset.product; save(); buildVariants(); render(); };
  $('slider').oninput = e => setT(+e.target.value);
  $('play').onclick = togglePlay;
  $('speed').onchange = () => { if(timer){ togglePlay(); togglePlay(); } };
  $('now').onclick = () => { const i = times.findIndex(t => t >= Date.now() - 1800000); setT(i >= 0 ? i : 0); };
  $('export').onclick = exportPNG;
  $('model').onchange = async e => {
    const prev = times[state.t], prevModel = state.model; state.model = e.target.value;
    try{ await loadModel(false); save(); if(prev){ let best = 0; times.forEach((t, i) => { if(Math.abs(t - prev) < Math.abs(times[best] - prev)) best = i; }); state.t = best; }
      buildVariants(); buildTimeline(); $('hours').dataset.day = ''; render(); }
    catch(err){ state.model = prevModel; e.target.value = prevModel;
      $('error').hidden = false; $('error').textContent = 'Dit model is nu niet beschikbaar: ' + err.message; }
  };
  document.addEventListener('keydown', e => {
    if(e.target.closest && e.target.closest('select,input:not([type=range])')) return;
    if(e.key === 'ArrowRight'){ setT(state.t + 1); e.preventDefault(); }
    if(e.key === 'ArrowLeft'){ setT(state.t - 1); e.preventDefault(); }
    if(e.key === ' ' && e.target === document.body){ togglePlay(); e.preventDefault(); }
  });
  $('map').addEventListener('click', e => {
    const r = $('basemap').getBoundingClientRect();
    state.cell = S.cellAt((e.clientX - r.left) / r.width * S.MAP.w, (e.clientY - r.top) / r.height * S.MAP.h, manifest.grid);
    renderPoint();
  });
}

async function start(){
  try{
    const [prov] = await Promise.all([fetch('nl_provincies.geojson').then(r => r.json()), loadModel(false)]);
    provinces = prov; buildBasemap(); wire(); buildVariants(); buildTimeline(); render();
    setInterval(poll, 5 * 60 * 1000);
  }catch(e){ $('error').hidden = false; $('error').textContent = 'Sneeuwdata niet beschikbaar: ' + e.message; }
}
start();
})();
