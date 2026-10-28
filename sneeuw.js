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
    label: v => ({p10:'P10', p50:'Mediaan', mean:'Gemiddeld', p90:'P90', max:'Maximum', model:'Modelwaarde'})[v],
    definition: (m, v, t) => ({model:'Deterministische modelsneeuwhoogte (één run, geen spreiding).', p10:'P10: 9 van de 10 leden hebben minstens deze hoogte.', p50:'Mediaan: de middelste van de geldige leden.',
      mean:'Gemiddelde over de geldige leden.', p90:'P90: slechts 1 van de 10 leden heeft meer.', max:'Maximum: het hoogste lid — het natste scenario, niet de verwachting.'})[v]
      + ' Modelsneeuwhoogte op ' + S.fullLabel(t) + '.'},
  swe_kans: {title:'Kans op sneeuwdek (water-equivalent)', variantLabel:'Minimaal', label: v => '≥ ' + v + ' mm',
    definition: (m, v, t) => `Kans dat er op ${S.fullLabel(t)} een sneeuwdek ligt met minstens ${v} mm water-equivalent. HarmonEPS geeft geen sneeuwhoogte; hoeveel centimeter dit is, hangt van de sneeuwdichtheid af.`},
  swe: {title:'Sneeuwdek in water-equivalent', variantLabel:'Statistiek', label: v => ({p50:'Mediaan', p90:'P90', max:'Maximum'})[v],
    definition: (m, v, t) => ({p50:'Mediaan', p90:'P90 (1 op de 10 leden meer)', max:'Hoogste lid (natste scenario)'})[v] + ` van het sneeuwdek in mm water-equivalent op ${S.fullLabel(t)}; géén centimeters.`},
  nieuwe_sneeuw: {title:'Nieuwe sneeuw', variantLabel:'Venster',
    label: v => { const [k, w] = v.split('_'); return `${w} u · ${k === 'we' ? 'mm' : 'dek'}`; },
    definition: (m, v, t) => { const [k, w] = v.split('_');
      return k === 'we' ? `Sneeuwval in ${w} uur (${S.windowLabel(t, +w)}) in mm water-equivalent — géén centimeters verse sneeuw; de omrekening hangt af van temperatuur en sneeuwsoort.`
        : `Netto toename van de modelsneeuwhoogte in ${w} uur (${S.windowLabel(t, +w)}). Smelten en inklinken tellen mee, dus dit is niet de hoeveelheid verse sneeuw.`; }},
  neerslagsoort: {title:'Neerslagsoort', variantLabel:'Weergave',
    label: v => ({dominant:'Meest waarschijnlijk', neerslag:'Kans op neerslag', sneeuw:'Sneeuw', natte_sneeuw:'Natte sneeuw',
      regen_sneeuw:'Regen en sneeuw', ijzel:'IJzel', ijskorrels:'IJskorrels', regen:'Regen'})[v],
    definition: (m, v, t) => m.products.neerslagsoort.definition ? m.products.neerslagsoort.definition + ' Tijdstip: ' + S.fullLabel(t) + '.'
      : v === 'dominant'
      ? `Meest waarschijnlijke neerslagsoort op ${S.fullLabel(t)} (momentopname), alleen waar minstens ${m.criteria.ptype_min_precip_pct} % van de leden neerslag heeft.`
      : v === 'neerslag' ? `Kans dat er op ${S.fullLabel(t)} neerslag valt (welke soort dan ook).`
      : `Kans dat de neerslag op ${S.fullLabel(t)} valt als ${PRODUCTS.neerslagsoort.label(v).toLowerCase()} (aandeel van alle leden, momentopname).`}
};
const MODELS = {icond2eps:{name:'ICON-D2-EPS', staleHours:9}, ecmwfens:{name:'ECMWF ENS', staleHours:22},
  harmoniep1:{name:'HARMONIE P1', staleHours:6}, harmoneps:{name:'HarmonEPS', staleHours:6}};
const PLACES = [['Den Helder',52.96,4.76],['Leeuwarden',53.20,5.79],['Groningen',53.22,6.57],['Assen',52.99,6.56],['Zwolle',52.51,6.09],
  ['Lelystad',52.52,5.47],['Amsterdam',52.37,4.90],['Den Haag',52.08,4.30],['Rotterdam',51.92,4.48],['Utrecht',52.09,5.12],['Arnhem',51.98,5.91],
  ['Enschede',52.22,6.89],['Middelburg',51.50,3.61],["'s-Hertogenbosch",51.69,5.30],['Eindhoven',51.44,5.48],['Breda',51.59,4.78],['Maastricht',50.85,5.69]];

let state = {model:'icond2eps', product:'sneeuwval_kans', variant:{sneeuwval_kans:'6', sneeuwdek_kans:'1', sneeuwhoogte:'p50', swe_kans:'1', swe:'p50', nieuwe_sneeuw:'we_6', neerslagsoort:'dominant'},
  t:0, cell:-1, region:'nl', compare:false};
try{ const s = JSON.parse(localStorage.getItem('weerlab-sneeuw') || '{}');
  if(PRODUCTS[s.product]) state.product = s.product; if(s.variant) Object.assign(state.variant, s.variant);
  if(MODELS[s.model]) state.model = s.model; if(S.REGIONS[s.region]) state.region = s.region; }catch{}
if(MODELS[params.get('model')]) state.model = params.get('model');
if(S.REGIONS[params.get('regio')]) state.region = params.get('regio');
const save = () => { try{ localStorage.setItem('weerlab-sneeuw', JSON.stringify({model:state.model, product:state.product, variant:state.variant, region:state.region})); }catch{} };

const DS = {};          // model -> {manifest, rasters, times}; ontbrekend model = fout-object
let provinces = null, landPath = null, outlinePath = null, timer = null, places = null;
const ds = () => DS[state.model];

/* ---------- data ---------- */
async function bytes(url, cache='force-cache'){
  const r = await fetch(url, {cache}); if(!r.ok) throw Error(`${r.status} bij ${url.split('/').slice(-2).join('/')}`);
  let b = new Uint8Array(await r.arrayBuffer());
  if(S.isGzip(b)) b = new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  return b;
}
const manifestUrl = model => FIXED_RUN ? `${DATA}/${model}/${FIXED_RUN}/manifest.json` : `${DATA}/${model}_latest.json?t=${Date.now()}`;
async function loadDataset(model){
  const m = JSON.parse(new TextDecoder().decode(await bytes(manifestUrl(model), 'no-store')));
  if(!m.complete || m.schema !== 1) throw Error('Onvolledige of onbekende dataset.');
  const base = `${DATA}/${model}/${m.run_key}/`;
  const entries = await Promise.all(Object.entries(m.files).map(async ([k, f]) => [k, S.parseRaster(await bytes(base + f))]));
  for(const [, r] of entries) if(r.nx !== m.grid.nx || r.ny !== m.grid.ny || r.nt !== m.valid_utc.length) throw Error('Rasterafmetingen kloppen niet met het manifest.');
  DS[model] = {manifest:m, rasters:Object.fromEntries(entries), times:m.valid_utc.map(Date.parse)};
  return DS[model];
}
async function ensure(model){ if(!DS[model] || DS[model].error) { try{ await loadDataset(model); }catch(e){ DS[model] = {error:e.message}; } } return DS[model]; }
function adoptModel(prevMs){
  const d = ds(), m = d.manifest;
  if(!m.products[state.product]) state.product = Object.keys(PRODUCTS).find(p => m.products[p]);
  for(const [p, def] of Object.entries(m.products))
    if(!def.variants.includes(state.variant[p])) state.variant[p] = def.variants.find(v => v === '6' || v.endsWith('_6') || v === 'p50') || def.variants[0];
  let i = prevMs ? S.exactIndex(d.times, prevMs) : -1;
  if(i < 0 && prevMs){ i = 0; d.times.forEach((t, k) => { if(Math.abs(t - prevMs) < Math.abs(d.times[i] - prevMs)) i = k; }); }
  if(i < 0){ i = d.times.findIndex(t => t >= Date.now() - 1800000); if(i < 0) i = 0; }
  state.t = i;
}
async function poll(){
  if(FIXED_RUN) return;
  for(const model of Object.keys(DS)){
    try{ const m = JSON.parse(new TextDecoder().decode(await bytes(manifestUrl(model), 'no-store')));
      if(DS[model].manifest && m.run_key !== DS[model].manifest.run_key){
        const prev = ds().times[state.t]; await loadDataset(model);
        if(model === state.model){ adoptModel(prev); buildTimeline(); } render(); } }
    catch(e){ /* laatste geldige set blijft staan */ }
  }
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
  landPath = new Path2D(d); outlinePath = new Path2D(outer);
  const svg = $('basemap'); svg.replaceChildren();
  el('path', {d, class:'basemap-land', 'fill-rule':'evenodd'}, svg);
  el('path', {d, class:'basemap-prov', 'vector-effect':'non-scaling-stroke'}, svg);
  const ov = $('overlay'); ov.replaceChildren();
  el('path', {d, class:'prov-lijn', 'vector-effect':'non-scaling-stroke'}, ov);
  el('path', {d:outer, class:'nl-buitengrens', 'vector-effect':'non-scaling-stroke'}, ov);
  el('g', {id:'plaatsen'}, ov);
  el('circle', {id:'marker', class:'marker', r:12, cx:-100, cy:-100, 'vector-effect':'non-scaling-stroke'}, ov);
}
/** Plaatsnamen bij de huidige uitsnede: landelijk de vaste lijst, ingezoomd de grootste plaatsen in beeld. */
function visiblePlaces(view){
  if(state.region === 'nl' || !places) return PLACES;
  const [x, y, w, h] = view, inView = p => { const px = S.lonToX(p.lon), py = S.latToY(p.lat); return px > x + w * .03 && px < x + w * .85 && py > y + h * .03 && py < y + h * .97; };
  const out = [];
  for(const p of places){ if(!inView(p)) continue;
    if(out.some(q => Math.hypot(S.lonToX(q[2]) - S.lonToX(p.lon), S.latToY(q[1]) - S.latToY(p.lat)) < w * .07)) continue;
    out.push([p.naam, p.lat, p.lon]); if(out.length >= 14) break; }
  return out;
}
function applyView(){
  const view = S.regionView(state.region), vb = view.join(' ');
  $('basemap').setAttribute('viewBox', vb); $('overlay').setAttribute('viewBox', vb);
  const k = view[2] / S.MAP.w, g = $('plaatsen'); g.replaceChildren();
  for(const [name, lat, lon] of visiblePlaces(view)){
    const p = el('g', {class:'plaats'}, g), x = S.lonToX(lon), y = S.latToY(lat);
    el('circle', {cx:x, cy:y, r:3.5 * k}, p);
    const t = el('text', {x:x + 7 * k, y:y + 5 * k, 'font-size':15 * k, 'stroke-width':3 * k}, p); t.textContent = name;
  }
  $('marker').setAttribute('r', 12 * k);
  return view;
}
function hatchPattern(ctx){
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d'); x.fillStyle = '#e2e8f0'; x.fillRect(0, 0, 8, 8);
  x.strokeStyle = '#94a3b8'; x.lineWidth = 2; x.beginPath(); x.moveTo(-2, 10); x.lineTo(10, -2); x.stroke();
  return ctx.createPattern(c, 'repeat');
}

/* ---------- veld tekenen (scherm, vergelijking en export delen deze functies) ---------- */
function encodingOf(d, key){ const [p, v] = key.split('/'), def = d.manifest.products[p]; return (def.variant_encoding && def.variant_encoding[v]) || def.encoding; }
function fieldImages(d, key, t){
  const g = d.manifest.grid, frame = d.rasters[key].frame(t), enc = encodingOf(d, key);
  const color = document.createElement('canvas'), miss = document.createElement('canvas');
  color.width = miss.width = g.nx; color.height = miss.height = g.ny;
  const ci = color.getContext('2d').createImageData(g.nx, g.ny), mi = miss.getContext('2d').createImageData(g.nx, g.ny);
  const cache = new Map(); let anyMissing = false;
  for(let i = 0; i < frame.length; i++){
    const code = frame[i];
    if(code === S.MISSING){ mi.data[i*4+3] = 255; anyMissing = true; continue; }
    let rgb = cache.get(code);
    if(rgb === undefined){ const c = S.colorFor(S.decode(code, enc), enc); rgb = c ? S.hexRGB(c) : null; cache.set(code, rgb); }
    if(rgb){ ci.data[i*4] = rgb[0]; ci.data[i*4+1] = rgb[1]; ci.data[i*4+2] = rgb[2]; ci.data[i*4+3] = 235; }
  }
  color.getContext('2d').putImageData(ci, 0, 0); miss.getContext('2d').putImageData(mi, 0, 0);
  // Vloeiend alleen landelijk en niet bij categorieën; ingezoomd toont elk blokje één kaartcel.
  return {color, miss, anyMissing, smooth: state.region === 'nl' && enc !== 'categorie'};
}
/** Tekent het veld in kaartcoördinaten (800x1100) op ctx; de transform op ctx bepaalt uitsnede en schaal. */
function drawField(ctx, imgs){
  ctx.save(); ctx.clip(landPath, 'evenodd');
  ctx.imageSmoothingEnabled = imgs.smooth; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imgs.color, 0, 0, S.MAP.w, S.MAP.h);
  if(imgs.anyMissing){
    ctx.imageSmoothingEnabled = false;
    // Arcering in schermpixels: masker eerst op ware grootte naar een hulpcanvas.
    const m = document.createElement('canvas'), tr = ctx.getTransform();
    m.width = ctx.canvas.width; m.height = ctx.canvas.height;
    const mc = m.getContext('2d'); mc.imageSmoothingEnabled = false; mc.setTransform(tr); mc.drawImage(imgs.miss, 0, 0, S.MAP.w, S.MAP.h);
    mc.setTransform(1, 0, 0, 1, 0, 0); mc.globalCompositeOperation = 'source-in'; mc.fillStyle = hatchPattern(mc); mc.fillRect(0, 0, m.width, m.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(m, 0, 0); ctx.setTransform(tr);
  }
  ctx.restore();
}
/** Volledige kaart (zee, land, veld, grenzen, plaatsen) op een canvas: voor vergelijking en export. */
function drawMapCanvas(ctx, x0, y0, w, h, d, key, t, view){
  const s = Math.min(w / view[2], h / view[3]);
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  ctx.translate(x0, y0); ctx.scale(s, s); ctx.translate(-view[0], -view[1]);
  ctx.fillStyle = '#b8d4e8'; ctx.fillRect(view[0], view[1], view[2], view[3]);
  ctx.fillStyle = '#f5efd9'; ctx.fill(landPath, 'evenodd');
  if(d && key && t >= 0) drawField(ctx, fieldImages(d, key, t));
  const k = view[2] / S.MAP.w;
  ctx.strokeStyle = 'rgba(71,85,105,.45)'; ctx.lineWidth = .8 * k; ctx.stroke(landPath);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * k; ctx.lineJoin = 'round'; ctx.stroke(outlinePath);
  ctx.font = `600 ${15 * k}px "DM Sans",sans-serif`;
  for(const [name, lat, lon] of visiblePlaces(view)){ const px = S.lonToX(lon), py = S.latToY(lat);
    ctx.fillStyle = '#1e293b'; ctx.beginPath(); ctx.arc(px, py, 3.5 * k, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * k; ctx.strokeText(name, px + 7 * k, py + 5 * k); ctx.fillText(name, px + 7 * k, py + 5 * k); }
  ctx.restore();
}

/* ---------- UI ---------- */
const currentKey = () => state.product + '/' + state.variant[state.product];
const currentEncoding = () => encodingOf(ds(), currentKey());
function buildVariants(){
  const p = PRODUCTS[state.product], box = $('variants'); box.replaceChildren();
  $('variant-label').textContent = p.variantLabel;
  for(const v of ds().manifest.products[state.product].variants){
    const b = document.createElement('button'); b.textContent = p.label(v); b.setAttribute('aria-pressed', String(v === state.variant[state.product]));
    b.onclick = () => { state.variant[state.product] = v; save(); buildVariants(); render(); };
    box.appendChild(b);
  }
}
function buildTimeline(){
  const times = ds().times, days = [...new Set(times.map(S.dayKey))], box = $('days'); box.replaceChildren();
  for(const d of days){
    const i = times.findIndex(t => S.dayKey(t) === d), b = document.createElement('button');
    b.textContent = S.dayLabel(times[i]); b.dataset.day = d;
    b.onclick = () => { const cur = new Date(times[state.t]).getUTCHours();
      const same = times.findIndex(t => S.dayKey(t) === d && new Date(t).getUTCHours() === cur); setT(same >= 0 ? same : i); };
    box.appendChild(b);
  }
  $('slider').max = times.length - 1; $('hours').dataset.day = '';
}
function buildHours(){
  const times = ds().times, day = S.dayKey(times[state.t]), box = $('hours');
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
function setT(i){ state.t = Math.max(0, Math.min(ds().times.length - 1, i)); render(); }

function legendHTML(d, enc, product){
  const classes = d.manifest.products[product].classes;
  return S.scaleFor(enc).filter(k => !classes || classes.includes(k.code)).map(k => `<span><i style="background:${k.color}"></i>${k.label}</span>`).join('')
    + `<span><i class="nb"></i>n.b. (${d.manifest.deterministic ? 'geen modelwaarde' : 'te weinig leden'} of venster vóór runstart)</span>`;
}
function render(){
  const d = ds(); if(!d || !d.manifest) return;
  const m = d.manifest, p = PRODUCTS[state.product], v = state.variant[state.product], t = d.times[state.t];
  $('product-title').textContent = p.title;
  for(const b of document.querySelectorAll('.products button')){ b.setAttribute('aria-pressed', String(b.dataset.product === state.product)); b.disabled = !m.products[b.dataset.product]; }
  $('model').value = state.model; $('region').value = state.region;
  $('hdr-model').textContent = `${m.model} · ${p.title}`;
  $('hdr-run').textContent = `Modelrun ${S.fullLabel(Date.parse(m.run_utc))} · +${Math.round((t - Date.parse(m.run_utc)) / 3600000)} u`;
  $('hdr-valid').textContent = 'Geldig ' + S.fullLabel(t);
  $('hdr-update').textContent = 'Laatste update ' + S.fullLabel(Date.parse(m.updated_utc));
  const stale = S.staleWarning(Date.parse(m.run_utc), Date.now(), MODELS[state.model].staleHours); $('stale').hidden = !stale; $('stale').textContent = stale;
  $('legend').innerHTML = legendHTML(d, currentEncoding(), state.product);
  $('definition').textContent = p.definition(m, v, t) + (state.region === 'nl' ? ''
    : ` Uitsnede ${S.REGIONS[state.region].label}: elk blokje is één kaartcel (~2 km), niet gladgestreken; het modelrooster zelf is ${String(m.native_resolution_km).replace('.', ',')} km.`);
  $('slider').value = state.t;
  const view = applyView(), c = $('field'), ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
  const s = c.width / view[2]; ctx.setTransform(s, 0, 0, s, -view[0] * s, -view[1] * s);
  drawField(ctx, fieldImages(d, currentKey(), state.t));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  buildHours(); renderPoint();
  if(state.compare) renderCompare();
}

/* ---------- puntpaneel ---------- */
function value(d, key, cell, t){ const r = d.rasters[key]; return r ? S.decode(r.frame(t)[cell], encodingOf(d, key)) : null; }
const pct = v => v === null ? 'n.b.' : v + ' %';
const cm = v => v === null ? 'n.b.' : v.toFixed(1).replace('.', ',') + ' cm';
const catLabel = (d, v) => v === null ? 'n.b.' : v === 0 ? (d.manifest.deterministic ? 'geen neerslag' : 'geen of weinig kans op neerslag') : (S.CAT_SCALE.find(k => k.code === v) || {label:'?'}).label;
function fmtValue(d, key, cell, t){
  const x = value(d, key, cell, t), e = encodingOf(d, key);
  return e === 'categorie' ? catLabel(d, x) : x === null ? 'n.b.' : e === 'cm_x2' ? cm(x) : e === 'mm_x4' ? x.toFixed(2).replace('.', ',') + ' mm' : x + ' %';
}
function renderPoint(){
  const body = $('point-body'), d = ds();
  if(state.cell < 0){ body.innerHTML = ''; return; }
  const g = d.manifest.grid, i = state.cell % g.nx, j = Math.floor(state.cell / g.nx), t = state.t, tm = d.times[t];
  const lon = g.lon_min + (i + .5) * (g.lon_max - g.lon_min) / g.nx, lat = g.lat_max - (j + .5) * (g.lat_max - g.lat_min) / g.ny;
  const mk = $('marker'); mk.setAttribute('cx', S.lonToX(lon)); mk.setAttribute('cy', S.latToY(lat));
  const rows = (label, list) => `<tr><th colspan="2">${label}</th></tr>` + list.map(([a, b]) => `<tr><td>${a}</td><td class="v">${b}</td></tr>`).join('');
  const P = d.manifest.products, now = P.sneeuwhoogte && (P.sneeuwhoogte.variants.includes('p50') ? 'p50' : P.sneeuwhoogte.variants[0]);
  const TITLES = {sneeuwval_kans:'Kans op sneeuwval (venster tot nu)', sneeuwdek_kans:'Kans op sneeuwdek', sneeuwhoogte:'Sneeuwhoogte', swe_kans:'Kans op sneeuwdek (water-equivalent)', swe:'Sneeuwdek (water-equivalent)',
    nieuwe_sneeuw:'Nieuwe sneeuw (venster tot nu)', neerslagsoort: P.neerslagsoort && P.neerslagsoort.period === 'uur' ? 'Neerslagsoort (afgelopen uur)' : 'Neerslagsoort (momentopname)'};
  let html = '';
  for(const p of Object.keys(PRODUCTS)) if(P[p]) html += rows(TITLES[p], [
    ...(p === 'sneeuwhoogte' ? [['Ligt bij runstart (+0 u)', cm(value(d, 'sneeuwhoogte/' + now, state.cell, 0))]] : []),
    ...P[p].variants.map(v => [PRODUCTS[p].label(v), fmtValue(d, p + '/' + v, state.cell, t)])]);
  // Zelfde product en tijdstip bij de andere (al geladen) modellen.
  const others = Object.keys(MODELS).filter(k => k !== state.model && DS[k] && DS[k].manifest).map(k => {
    const o = DS[k], c = S.comparableKey(o.manifest.products, state.product, state.variant[state.product]), oi = S.exactIndex(o.times, tm);
    return [MODELS[k].name, !c ? 'niet vergelijkbaar' : oi < 0 ? 'geen stap op dit tijdstip' : fmtValue(o, c.key, state.cell, oi) + (c.note ? ' *' : '')]; });
  if(others.length) html += rows(`${PRODUCTS[state.product].title} · ${PRODUCTS[state.product].label(state.variant[state.product])} · andere modellen`, others);
  body.innerHTML = `<p class="note">${lat.toFixed(3).replace('.', ',')}° N · ${lon.toFixed(3).replace('.', ',')}° O · geldig ${S.fullLabel(tm)}</p><table>${html}</table>`
    + `<p class="note">Waarden van de dichtstbijzijnde kaartcel (~2 km) zonder interpolatie; het modelrooster zelf is ${String(d.manifest.native_resolution_km).replace('.', ',')} km. `
    + `* = vergelijkbare grootheid (bijv. modelwaarde i.p.v. mediaan). Bron: ${d.manifest.source}, run ${S.fullLabel(Date.parse(d.manifest.run_utc))}.</p>`;
}

/* ---------- plaatszoeker ---------- */
let placesPromise = null;
function loadPlaces(){ return placesPromise || (placesPromise = fetchPlaces().catch(e => { placesPromise = null; throw e; })); }
async function fetchPlaces(){
  const all = (await (await fetch('plaatsen_lookup.json')).json()).plaatsen;
  places = all.filter(p => p.land === 'NL' && p.lon >= S.MAP.lonMin && p.lon <= S.MAP.lonMax && p.lat >= S.MAP.latMin && p.lat <= S.MAP.latMax)
    .sort((a, b) => (b.pop || 0) - (a.pop || 0));
  return places;
}
function choosePlace(p){
  $('search').value = p.naam; $('search-results').hidden = true;
  const [x, y, w, h] = S.regionView(state.region), px = S.lonToX(p.lon), py = S.latToY(p.lat);
  if(px < x || px > x + w || py < y || py > y + h){ state.region = 'nl'; save(); }
  state.cell = S.cellAt(px, py, ds().manifest.grid); render();
  $('point').scrollIntoView({block:'nearest'});
}
function wireSearch(){
  const inp = $('search'), list = $('search-results'); let hits = [], active = -1;
  const show = () => { list.replaceChildren(); list.hidden = !hits.length;
    hits.forEach((p, i) => { const li = document.createElement('li'); li.textContent = p.naam; li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active)); li.onmousedown = e => { e.preventDefault(); choosePlace(p); }; list.appendChild(li); }); };
  inp.addEventListener('focus', () => { loadPlaces().catch(() => {}); });
  inp.addEventListener('input', async () => { await loadPlaces(); hits = S.searchPlaces(places, inp.value); active = hits.length ? 0 : -1; show(); });
  inp.addEventListener('keydown', e => {
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){ if(!hits.length) return; active = (active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; show(); e.preventDefault(); }
    else if(e.key === 'Enter' && hits[active]){ choosePlace(hits[active]); e.preventDefault(); }
    else if(e.key === 'Escape'){ list.hidden = true; }
  });
  inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 100));
}

/* ---------- modelvergelijking ---------- */
async function openCompare(on){
  state.compare = on; $('compare').hidden = !on; $('compare-toggle').setAttribute('aria-pressed', String(on));
  if(on){ await Promise.all(Object.keys(MODELS).map(ensure)); render(); $('compare').scrollIntoView({block:'nearest'}); }
}
function renderCompare(){
  const grid = $('compare-grid'), tm = ds().times[state.t], view = S.regionView(state.region);
  const product = state.product, variant = state.variant[product];
  $('compare-title').textContent = `${PRODUCTS[product].title} · ${PRODUCTS[product].label(variant)} · geldig ${S.fullLabel(tm)}`;
  if(grid.children.length !== Object.keys(MODELS).length){
    grid.replaceChildren();
    for(const k of Object.keys(MODELS)){
      const fig = document.createElement('figure'); fig.dataset.model = k;
      fig.innerHTML = `<figcaption><b>${MODELS[k].name}</b><span></span></figcaption><canvas width="440" height="605"></canvas><p class="cmp-note"></p>`;
      fig.querySelector('canvas').onclick = () => { if(DS[k] && DS[k].manifest){ const prev = ds().times[state.t]; state.model = k; save(); adoptModel(prev); buildVariants(); buildTimeline(); render(); } };
      grid.appendChild(fig);
    }
  }
  let enc = null, legendDs = null;
  for(const fig of grid.children){
    const k = fig.dataset.model, d = DS[k], cv = fig.querySelector('canvas'), ctx = cv.getContext('2d'), note = fig.querySelector('.cmp-note'), sub = fig.querySelector('figcaption span');
    fig.classList.toggle('actief', k === state.model);
    let key = null, ti = -1, msg = '';
    if(!d || d.error){ msg = 'Niet beschikbaar' + (d && d.error ? ': ' + d.error : ''); }
    else {
      const c = S.comparableKey(d.manifest.products, product, variant); ti = S.exactIndex(d.times, tm);
      sub.textContent = ` · run ${S.fullLabel(Date.parse(d.manifest.run_utc))}`;
      if(!c) msg = `Niet vergelijkbaar: ${d.manifest.model} levert “${PRODUCTS[product].title} · ${PRODUCTS[product].label(variant)}” niet.`;
      else if(ti < 0) msg = tm < d.times[0] || tm > d.times[d.times.length - 1] ? 'Dit tijdstip valt buiten de verwachtingstermijn van dit model.'
        : `Geen modelstap op dit tijdstip (stappen van ${d.manifest.step_hours || 1} uur).`;
      else { key = c.key; msg = c.note ? 'Let op: ' + c.note + '.' : '';
        if(product === 'neerslagsoort') msg += (msg ? ' ' : '') + (d.manifest.products.neerslagsoort.period === 'uur' ? 'Afgelopen uur.' : 'Momentopname.');
        if(!enc){ enc = encodingOf(d, key); legendDs = d; } }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    drawMapCanvas(ctx, 0, 0, cv.width, cv.height, key ? d : null, key, ti, view);
    if(!key){ ctx.fillStyle = 'rgba(246,248,251,.78)'; ctx.fillRect(0, 0, cv.width, cv.height); }
    note.textContent = msg; fig.classList.toggle('leeg', !key);
  }
  $('compare-legend').innerHTML = enc ? legendHTML(legendDs, enc, product) : '';
}

/* ---------- export (direct uit de data, geen schermafdruk) ---------- */
const FORMATS = {hoog:[1600,2200], vierkant:[1080,1080], staand:[1080,1350], breed:[1920,1080], facebook:[1200,630]};
function exportPNG(){
  const d = ds(), m = d.manifest, format = $('export-format').value, [W, H] = FORMATS[format], c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), p = PRODUCTS[state.product], v = state.variant[state.product], t = d.times[state.t], view = S.regionView(state.region);
  const wide = W / H > 1.2, pad = Math.round(Math.min(W, H) * .03), head = wide ? 0 : Math.round(H * .11), foot = wide ? 0 : Math.round(H * .13);
  x.fillStyle = '#f6f8fb'; x.fillRect(0, 0, W, H);
  const boxW = wide ? W * .5 : W - 2 * pad, boxH = H - head - foot - 2 * pad, s = Math.min(boxW / view[2], boxH / view[3]);
  const mw = view[2] * s, mh = view[3] * s, mx = wide ? pad : (W - mw) / 2, my = head + pad + (boxH - mh) / 2;
  drawMapCanvas(x, mx, my, mw, mh, d, currentKey(), state.t, view);
  const tx = wide ? mx + mw + pad * 1.5 : pad, tw = wide ? W - tx - pad : W - 2 * pad, base = Math.max(14, Math.round(wide ? H * .042 : Math.min(W, H) * .028));
  let ty = wide ? pad + base * 1.4 : pad + base * 1.3;
  const line = (txt, size, weight, color, gap = 1.35) => { x.font = `${weight} ${size}px "DM Sans",sans-serif`; x.fillStyle = color; x.fillText(txt, tx, ty, tw); ty += size * gap; };
  line(`${p.title} · ${p.label(v)}`, base * 1.35, 800, '#0f172a');
  line(`Geldig ${S.fullLabel(t)}${state.region === 'nl' ? '' : ' · ' + S.REGIONS[state.region].label}`, base, 600, '#1e293b');
  line(`${m.model} · run ${S.fullLabel(Date.parse(m.run_utc))}`, base * .8, 500, '#475569', 1.6);
  if(!wide) ty = H - foot + pad * .4;
  const classes = m.products[state.product].classes;
  const scale = S.scaleFor(currentEncoding()).filter(k => !classes || classes.includes(k.code)), sw = base * .9; x.font = `500 ${Math.round(base * .72)}px "DM Sans",sans-serif`;
  let lx = tx; const items = [...scale.map(k => [k.color, k.label]), [null, 'n.b.']];
  for(const [col, lab] of items){ const w = sw + 6 + x.measureText(lab).width + base * .8;
    if(lx + w > tx + tw){ lx = tx; ty += sw * 1.6; }
    x.fillStyle = col || hatchPattern(x); x.fillRect(lx, ty - sw * .8, sw, sw);
    x.strokeStyle = '#cbd5e1'; x.lineWidth = 1; x.strokeRect(lx, ty - sw * .8, sw, sw);
    x.fillStyle = '#334155'; x.fillText(lab, lx + sw + 6, ty); lx += w; }
  ty += sw * 2;
  x.font = `500 ${Math.round(base * .62)}px "DM Sans",sans-serif`; x.fillStyle = '#64748b';
  x.fillText(`Bron: ${m.license} · weerlab.nl`, tx, wide ? Math.min(ty, H - pad) : H - pad * .8, tw);
  c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    const stamp = new Date(t).toISOString().slice(0, 13).replace(/[-T]/g, '');
    a.download = `Sneeuw_${state.product}_${v}_${m.model_key}_${state.region}_${stamp}UTC_${format}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }, 'image/png');
}

/* ---------- bediening ---------- */
function togglePlay(){
  if(timer){ clearInterval(timer); timer = null; $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Afspelen'); return; }
  $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', 'Pauzeren');
  timer = setInterval(() => setT(state.t >= ds().times.length - 1 ? 0 : state.t + 1), +$('speed').value);
}
function wire(){
  for(const b of document.querySelectorAll('.products button')) b.onclick = () => { state.product = b.dataset.product; save(); buildVariants(); render(); };
  $('slider').oninput = e => setT(+e.target.value);
  $('play').onclick = togglePlay;
  $('speed').onchange = () => { if(timer){ togglePlay(); togglePlay(); } };
  $('now').onclick = () => { const i = ds().times.findIndex(t => t >= Date.now() - 1800000); setT(i >= 0 ? i : 0); };
  $('export').onclick = exportPNG;
  $('region').onchange = async e => { state.region = e.target.value; save(); await loadPlaces().catch(() => {}); render(); };
  $('compare-toggle').onclick = () => openCompare(!state.compare);
  $('model').onchange = async e => {
    const prev = ds().times[state.t], prevModel = state.model, next = e.target.value;
    const d = await ensure(next);
    if(d.error){ e.target.value = prevModel; $('error').hidden = false; $('error').textContent = 'Dit model is nu niet beschikbaar: ' + d.error; return; }
    $('error').hidden = true; state.model = next; save(); adoptModel(prev); buildVariants(); buildTimeline(); render();
  };
  document.addEventListener('keydown', e => {
    if(e.target.closest && e.target.closest('select,input:not([type=range])')) return;
    if(e.key === 'ArrowRight'){ setT(state.t + 1); e.preventDefault(); }
    if(e.key === 'ArrowLeft'){ setT(state.t - 1); e.preventDefault(); }
    if(e.key === ' ' && e.target === document.body){ togglePlay(); e.preventDefault(); }
  });
  $('map').addEventListener('click', e => {
    const r = $('basemap').getBoundingClientRect(), [vx, vy, vw, vh] = S.regionView(state.region);
    state.cell = S.cellAt(vx + (e.clientX - r.left) / r.width * vw, vy + (e.clientY - r.top) / r.height * vh, ds().manifest.grid);
    renderPoint();
  });
  wireSearch();
}

async function start(){
  try{
    const [prov] = await Promise.all([fetch('nl_provincies.geojson').then(r => r.json()), loadDataset(state.model)]);
    provinces = prov; buildBasemap(); wire(); adoptModel(null); buildVariants(); buildTimeline();
    if(state.region !== 'nl') await loadPlaces().catch(() => {});
    render();
    // Andere modellen op de achtergrond, voor het puntpaneel en de vergelijking.
    Promise.all(Object.keys(MODELS).filter(k => k !== state.model).map(ensure)).then(() => { renderPoint(); if(state.compare) renderCompare(); });
    setInterval(poll, 5 * 60 * 1000);
  }catch(e){ $('error').hidden = false; $('error').textContent = 'Sneeuwdata niet beschikbaar: ' + e.message; }
}
start();
})();
