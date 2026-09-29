/* KNMI station observations and current Open-Meteo model series.
   All calculations use UTC instants; only display is Europe/Amsterdam. */
(function () {
  'use strict';
  const MIN = 60000;
  const valid = v => typeof v === 'number' && Number.isFinite(v);
  const utc = value => typeof value === 'string' ? Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : value + 'Z') : NaN;
  function interpolate(series, t) {
    if (!series || !Number.isFinite(t)) return null;
    const exact = series.find(p => p.t === t);
    if (exact) return valid(exact.v) ? exact.v : null;
    for (let i = 1; i < series.length; i++) {
      const a = series[i - 1], b = series[i];
      if (a.t < t && t < b.t && b.t - a.t <= 20 * MIN && valid(a.v) && valid(b.v)) {
        return a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
      }
    }
    return null;
  }
  function observation(station, t) {
    const point = station.history.find(p => p.t === t);
    return point && valid(point.v) ? point.v : null;
  }
  function normalizeStations(data) {
    return Object.values(data.stations || {}).filter(s => s && typeof s.naam === 'string' && valid(s.lat) && valid(s.lon) && s.lat >= 50.7 && s.lat <= 53.7 && s.lon >= 3.2 && s.lon <= 7.4).map(s => ({
      name: s.naam, lat: s.lat, lon: s.lon,
      history: (Array.isArray(s.historie) ? s.historie : []).filter(p => p && Number.isFinite(utc(p.t))).map(p => ({t: utc(p.t), v: valid(p.ta) ? p.ta : null})).sort((a,b) => a.t - b.t)
    })).filter(s => s.history.some(p => valid(p.v))).sort((a,b) => a.name.localeCompare(b.name, 'nl'));
  }
  function stats(rows) {
    const values = rows.filter(r => valid(r.obs) && valid(r.model)).map(r => r.model - r.obs);
    return {count: values.length, mean: values.length ? values.reduce((a,b) => a+b, 0) / values.length : null, cold: values.filter(v => v < -.5).length, close: values.filter(v => Math.abs(v) <= .5).length, warm: values.filter(v => v > .5).length};
  }
  const core = {utc, interpolate, observation, normalizeStations, stats};
  if (typeof module !== 'undefined') module.exports = core;
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);
  const MODELS = {harmonie: {name:'HARMONIE', api:'knmi_harmonie_arome_netherlands', color:'#c3813c'}, icond2:{name:'ICON-D2', api:'icon_d2', color:'#6877b9'}};
  const production = /(^|\.)weerlab\.nl$/.test(location.hostname);
  const localPreview = ['127.0.0.1','localhost'].includes(location.hostname);
  const obsURL = localPreview ? '/__live/observations' : 'https://data.weerlab.nl/actueel.json';
  const modelURL = localPreview ? '/__live/model' : production ? 'https://om.weerlab.nl/om/forecast' : 'https://api.open-meteo.com/v1/forecast';
  let stations = [], models = {}, frames = [], latest = null, selected = 'De Bilt', model = 'harmonie', mode = 'pair', busy = false, geo = null, modelErrors = [], observationError = false;
  const fmt = v => valid(v) ? v.toFixed(1).replace('.', ',') : '—';
  const signed = v => valid(v) ? (Math.abs(v) < .05 ? '0,0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',')) : '—';
  const time = t => new Date(t).toLocaleTimeString('nl-NL', {timeZone:'Europe/Amsterdam', hour:'2-digit', minute:'2-digit'});
  const date = t => new Date(t).toLocaleDateString('nl-NL', {timeZone:'Europe/Amsterdam', day:'numeric',month:'short',year:'numeric'});
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const chosenTime = () => frames[Number($('time').value)];
  const modelValue = (key, station, t) => interpolate(models[key]?.[station.name], t);
  const delta = (a,b) => valid(a) && valid(b) ? a - b : null;
  const verdict = d => !valid(d) ? 'Geen vergelijking beschikbaar' : Math.abs(d) < .05 ? 'Gelijk aan de meting' : `${fmt(Math.abs(d))} °C ${d > 0 ? 'te warm' : 'te koud'}`;
  const deltaClass = d => !valid(d) ? 'muted' : Math.abs(d) <= .5 ? 'close' : d > 0 ? 'warm' : 'cold';
  function color(d) {
    if (!valid(d)) return '#eef2f3';
    const weight = Math.min(1, Math.abs(d) / 3), target = d < 0 ? [116,177,218] : [229,166,112];
    return `rgb(${target.map(v => Math.round(250 + (v - 250) * weight)).join(',')})`;
  }
  async function fetchJSON(url) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
    try { const response = await fetch(url, {signal: controller.signal}); if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.json(); }
    finally { clearTimeout(timer); }
  }
  function xy(lon,lat) { return [40 + (lon - 3.25) * 149, 745 - (lat - 50.75) * 245]; }
  function drawGeography() {
    $('geography').innerHTML = geo.features.map(f => {
      const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
      return `<path class="land" fill-rule="evenodd" d="${polygons.map(poly => poly.map(ring => ring.map(([lon,lat], i) => `${i?'L':'M'}${xy(lon,lat).map(v=>v.toFixed(1)).join(' ')}`).join('') + 'Z').join('')).join('')}"/>`;
    }).join('');
  }
  async function loadModels(list) {
    // Multi-location requests preserve order; location_id is used when provided.
    // Chunking bounds request size and lets other stations survive one failed request.
    const output = {harmonie:{}, icond2:{}}, failures = new Set();
    const jobs = [];
    for (const [key, info] of Object.entries(MODELS)) {
      for (let start = 0; start < list.length; start += 8) jobs.push(async () => {
        const chunk = list.slice(start, start + 8);
        const params = new URLSearchParams({latitude:chunk.map(s=>s.lat).join(','),longitude:chunk.map(s=>s.lon).join(','),minutely_15:'temperature_2m',models:info.api,past_minutely_15:'12',forecast_minutely_15:'8',timezone:'UTC',temperature_unit:'celsius'});
        try {
          const json = await fetchJSON(modelURL + '?' + params), results = Array.isArray(json) ? json : [json];
          if (results.length !== chunk.length) throw new Error('Onvolledige modelrespons');
          const ids = new Set();
          for (let i = 0; i < results.length; i++) {
            const item = results[i], index = Number.isInteger(item.location_id) ? item.location_id : i;
            if (!chunk[index] || ids.has(index) || !item.minutely_15?.time?.length || item.minutely_15_units?.temperature_2m !== '°C') throw new Error('Ongeldige modelrespons');
            ids.add(index);
            output[key][chunk[index].name] = item.minutely_15.time.map((t,j) => ({t:utc(t),v:valid(item.minutely_15.temperature_2m?.[j]) ? item.minutely_15.temperature_2m[j] : null})).filter(p => Number.isFinite(p.t)).sort((a,b)=>a.t-b.t);
          }
        } catch (error) { failures.add(info.name); console.warn('Temperatuurvergelijking:', info.name, error.message); }
      });
    }
    let cursor = 0;
    await Promise.all(Array.from({length:Math.min(3,jobs.length)}, async () => { while (cursor < jobs.length) await jobs[cursor++](); }));
    return {output, failures:[...failures]};
  }
  function status() {
    const old = latest && Date.now() - latest > 30 * MIN;
    const issues = [];
    if (observationError) issues.push('Verversen van KNMI-metingen mislukt; de eerder geladen meetmomenten blijven zichtbaar.');
    if (old) issues.push(`Verouderde KNMI-data: laatste meting ${date(latest)} om ${time(latest)}.`);
    if (modelErrors.length) issues.push(`${modelErrors.join(' en ')} gedeeltelijk of niet beschikbaar; ontbrekende waarden zijn —.`);
    if (!geo) issues.push('De provinciekaart is niet beschikbaar; stations zijn ook te kiezen via de lijst.');
    $('notice').classList.toggle('warning', !!issues.length);
    $('notice').textContent = issues.length ? issues.join(' ') : `KNMI-metingen per 10 minuten · laatste meting ${time(latest)} uur · modellen via Open-Meteo · automatisch verversen elke 5 minuten`;
  }
  async function refresh() {
    if (busy) return;
    busy = true; $('refresh').disabled = true;
    const wasLatest = Number($('time').value) === frames.length - 1 || !frames.length, previousTime = chosenTime();
    $('notice').textContent = 'KNMI-metingen ophalen…';
    try {
      const raw = await fetchJSON(obsURL + '?_=' + Math.floor(Date.now() / (5 * MIN)));
      const nextStations = normalizeStations(raw);
      const times = nextStations.flatMap(s => s.history.filter(p => valid(p.v) && p.t <= Date.now() + 5 * MIN).map(p=>p.t));
      if (!times.length) throw new Error('Geen metingen met een geldig tijdstip');
      stations = nextStations; latest = Math.max(...times); observationError = false;
      frames = Array.from({length:7}, (_,i) => latest - (6-i)*10*MIN);
      $('time').disabled = false;
      $('time').value = wasLatest ? 6 : Math.max(0, frames.indexOf(previousTime));
      if (!stations.some(s=>s.name===selected)) selected = stations[0].name;
      $('station').innerHTML = stations.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
      $('station').value = selected;
      // Clear old model series before showing a new observation cycle.
      models = {}; modelErrors = []; render();
      $('notice').textContent = 'KNMI-metingen geladen · HARMONIE en ICON-D2 worden opgehaald…';
      const result = await loadModels(stations);
      models = result.output; modelErrors = result.failures;
      render(); status();
    } catch (error) {
      observationError = true;
      if (stations.length) status();
      else { $('notice').classList.add('warning'); $('notice').textContent = 'KNMI-metingen konden niet worden geladen. Kies Verversen om het opnieuw te proberen.'; $('station-meta').textContent = 'Geen meetgegevens beschikbaar'; }
      console.warn('KNMI temperatuur:', error.message);
    } finally { busy = false; $('refresh').disabled = false; }
  }
  // Small label offsets keep nearby stations readable; the dot stays at the exact coordinate.
  const offsets = {'Vlissingen':[-29,11], 'Wilhelminadorp':[13,-12], 'Westdorpe':[1,11], 'Rotterdam Airport':[2,18], 'Hoek van Holland':[-17,-12], 'De Bilt':[25,-10], 'Cabauw':[-14,-18], 'Herwijnen':[25,11], 'Den Helder':[-18,0], 'Stavoren':[6,12], 'Lelystad':[-6,14], 'Marknesse':[5,-4], 'Eindhoven':[-10,14], 'Volkel':[13,-9], 'Horst':[23,14]};
  function drawMarkers(t) {
    $('markers').innerHTML = stations.map(s => {
      const [x,y] = xy(s.lon,s.lat), [dx,dy] = offsets[s.name] || [0,0];
      const obs = observation(s,t), forecast = modelValue(model,s,t), d = delta(forecast,obs);
      const label = `${s.name}: KNMI ${fmt(obs)} °C; ${MODELS[model].name} ${fmt(forecast)} °C; ${verdict(d)}`;
      return `<g class="marker" role="button" tabindex="0" data-station="${esc(s.name)}" aria-pressed="${s.name===selected}" aria-label="${esc(label)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><title>${esc(label)}</title><circle class="station-dot" r="2.5"/><path d="M0 0 L${dx} ${dy-10}" stroke="#8aa0a8" stroke-width="1"/><g transform="translate(${dx} ${dy-21})"><rect class="marker-box" x="${mode==='pair'?-40:-29}" y="-13" width="${mode==='pair'?80:58}" height="29" rx="7" fill="${mode==='delta'?color(d):'#fff'}"/>${mode==='pair'?`<path d="M0 -8V10" stroke="#e0e6e8"/><text x="-20" y="6" text-anchor="middle" fill="#163e45">${fmt(obs)}</text><text x="20" y="6" text-anchor="middle" fill="#996027">${fmt(forecast)}</text>`:`<text y="6" text-anchor="middle" fill="#264657">${signed(d)}°</text>`}<text class="station-caption" y="27" text-anchor="middle">${esc(s.name)}</text></g></g>`;
    }).join('');
  }
  function drawTrend(s,t) {
    const range = frames, series = [{name:'KNMI-meting', color:'#173e46', values:range.map(at=>observation(s,at))}, ...Object.keys(MODELS).map(k=>({name:MODELS[k].name,color:MODELS[k].color,values:range.map(at=>modelValue(k,s,at))}))];
    const values = series.flatMap(s=>s.values).filter(valid);
    if (!values.length) { $('trend').innerHTML = '<text x="12" y="75" fill="#617681" font-size="12">Geen historie beschikbaar</text>'; return; }
    const min = Math.floor(Math.min(...values)-.4), max = Math.ceil(Math.max(...values)+.4);
    const x = i => 30 + i * 49, y = v => 119 - (v-min)/(max-min)*96;
    let html = [min, (min+max)/2,max].map(v=>`<path d="M30 ${y(v)}H328" stroke="#e5ebed"/><text x="0" y="${y(v)+4}" font-size="10" fill="#748992">${fmt(v)}</text>`).join('');
    html += `<path d="M${x(range.indexOf(t))} 17V124" stroke="#acc0c5" stroke-dasharray="3 3"/>`;
    // Break paths at missing samples; never bridge an unavailable observation.
    for (const line of [...series].reverse()) {
      let path = '', connected = false;
      line.values.forEach((v,i)=>{ if (!valid(v)) {connected=false;return;} path += `${connected?'L':'M'}${x(i)} ${y(v)} `;connected=true; });
      html += `<path d="${path}" fill="none" stroke="${line.color}" stroke-width="${line.name==='KNMI-meting'?2.5:1.8}" stroke-linejoin="round"/>`;
      html += line.values.map((v,i)=>valid(v)?`<circle cx="${x(i)}" cy="${y(v)}" r="${range[i]===t?3.5:2}" fill="${line.color}"><title>${esc(line.name)} ${time(range[i])}: ${fmt(v)} °C</title></circle>`:'').join('');
    }
    html += [0,3,6].map(i=>`<text x="${x(i)}" y="147" text-anchor="middle" font-size="10" fill="#748992">${time(range[i])}</text>`).join('');
    $('trend').innerHTML = html;
    $('trend').setAttribute('aria-label',`Temperatuurverloop ${s.name} van ${time(range[0])} tot ${time(range[6])}. Exacte waarden staan in de vergelijking bij elk gekozen meetmoment.`);
  }
  function render() {
    if (!frames.length) return;
    const t = chosenTime(), s = stations.find(s=>s.name===selected);
    $('map-title').textContent = mode === 'pair' ? 'Meting & model' : 'Waar wijkt het model af?';
    $('map-time').textContent = time(t); $('map-date').textContent = date(t);
    $('key-model').textContent = MODELS[model].name;
    $('map-key').style.visibility = mode === 'pair' ? 'visible' : 'hidden';
    $('timeline-label').textContent = t===latest ? `Laatste meting · ${time(t)}` : `${Math.round((latest-t)/MIN)} minuten terug · ${time(t)}`;
    $('time').setAttribute('aria-valuetext', `${date(t)} ${time(t)}, ${Math.round((latest-t)/MIN)} minuten voor de laatste meting`);
    $('previous').disabled = Number($('time').value)===0; $('next').disabled = Number($('time').value)===6;
    $('latest').disabled = t===latest;
    $('ticks').innerHTML = [0,3,6].map(i=>`<span>${time(frames[i])}${i===6?' · laatste':''}</span>`).join('');
    drawMarkers(t);
    $('station-name').textContent = s.name;
    document.querySelector('.detail-link').href = 'nowcast.html?' + new URLSearchParams({lat:s.lat,lon:s.lon,naam:s.name});
    $('station-meta').textContent = `${s.lat.toFixed(3)}° N · ${s.lon.toFixed(3)}° O · ${time(t)} uur`;
    $('obs-value').textContent = fmt(observation(s,t));
    $('model-cards').innerHTML = Object.entries(MODELS).map(([k,info]) => {
      const v = modelValue(k,s,t), d = delta(v,observation(s,t));
      return `<div class="model-card ${k===model?'active':''}"><span class="name">${info.name}</span><strong>${fmt(v)} °C</strong><span class="verdict ${deltaClass(d)}">${valid(d)?signed(d)+'° · ':''}${verdict(d)}</span></div>`;
    }).join('');
    drawTrend(s,t);
    const summary = stats(stations.map(s=>({obs:observation(s,t),model:modelValue(model,s,t)})));
    $('summary-title').textContent = `${MODELS[model].name} vergeleken`;
    $('bias').textContent = signed(summary.mean) + '°';
    $('bias-label').textContent = valid(summary.mean) ? `gemiddeld ${verdict(summary.mean).replace(/^Gelijk/, 'gelijk')}` : 'Geen vergelijkbare waarden';
    $('count-cold').textContent = summary.cold; $('count-close').textContent = summary.close; $('count-warm').textContent = summary.warm;
    $('coverage').textContent = `${summary.count} van ${stations.length} stations vergelijkbaar om ${time(t)}. Ongewogen gemiddelde van deze stations.`;
    $('table-count').textContent = `· ${stations.length} stations · ${time(t)}`;
    $('station-table').innerHTML = stations.map(s=>`<tr><td><button data-station="${esc(s.name)}">${esc(s.name)}</button></td><td>${fmt(observation(s,t))}°</td>${Object.keys(MODELS).map(k=>{const v=modelValue(k,s,t),d=delta(v,observation(s,t));return `<td>${fmt(v)}°</td><td class="${deltaClass(d)}">${signed(d)}°</td>`;}).join('')}</tr>`).join('');
  }
  function selectStation(name) {
    if (!stations.some(s=>s.name===name)) return;
    selected = name; $('station').value = name; render();
  }
  $('model').addEventListener('change', e=>{model=e.target.value;render();});
  $('station').addEventListener('change', e=>selectStation(e.target.value));
  $('time').addEventListener('input',render);
  $('previous').addEventListener('click',()=>{$('time').value=Math.max(0,Number($('time').value)-1);render();});
  $('next').addEventListener('click',()=>{$('time').value=Math.min(6,Number($('time').value)+1);render();});
  $('latest').addEventListener('click',()=>{$('time').value=6;render();});
  $('refresh').addEventListener('click',refresh);
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();}));
  $('markers').addEventListener('click',e=>{const marker=e.target.closest('[data-station]');if(marker)selectStation(marker.dataset.station);});
  $('markers').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const marker=e.target.closest('[data-station]');if(marker){e.preventDefault();const name=marker.dataset.station;selectStation(name);Array.from($('markers').children).find(el=>el.dataset.station===name)?.focus();}}});
  $('station-table').addEventListener('click',e=>{const button=e.target.closest('[data-station]');if(button){selectStation(button.dataset.station);$('station-name').scrollIntoView({behavior:'smooth',block:'center'});}});
  fetchJSON('modelcheck_nl.json').then(data=>{geo=data;drawGeography();if(latest&&!busy)status();}).catch(()=>{if(latest&&!busy)status();});

  let zoom = 1;
  function setZoom(value) {
    const map = $('map'), wrap = map.parentElement;
    const centerX = (wrap.scrollLeft + wrap.clientWidth / 2) / Math.max(1,map.clientWidth);
    const centerY = (wrap.scrollTop + wrap.clientHeight / 2) / Math.max(1,map.clientHeight);
    zoom = Math.min(2.5,Math.max(1,value));
    wrap.classList.toggle('zoomed',zoom > 1);
    map.style.width = zoom > 1 ? (wrap.clientWidth * zoom) + 'px' : '';
    map.style.maxHeight = zoom > 1 ? 'none' : '';
    map.style.flexShrink = '0';
    wrap.scrollLeft = centerX * map.clientWidth - wrap.clientWidth / 2;
    wrap.scrollTop = centerY * map.clientHeight - wrap.clientHeight / 2;
    $('zoom-in').disabled = zoom >= 2.5; $('zoom-out').disabled = zoom <= 1;
  }
  $('zoom-in').addEventListener('click',()=>setZoom(zoom+.5));
  $('zoom-out').addEventListener('click',()=>setZoom(zoom-.5));
  $('zoom-reset').addEventListener('click',()=>setZoom(1));
  window.addEventListener('resize',()=>{if(zoom>1)setZoom(1);});
  refresh();
  setInterval(()=>{if(!document.hidden)refresh();},5*MIN);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
