'use strict';

const byId = id => document.getElementById(id);
const integer = new Intl.NumberFormat('nl-NL');
const decimal = new Intl.NumberFormat('nl-NL', {minimumFractionDigits:1, maximumFractionDigits:1});
const dateFmt = new Intl.DateTimeFormat('nl-NL', {day:'numeric', month:'long', year:'numeric', timeZone:'UTC'});
const winter = end => `${Number(end)-1}/${String(end).slice(-2)}`;
const formatDate = iso => dateFmt.format(new Date(iso + 'T00:00:00Z'));
const url = name => 'winter-data/' + name;
const namesFirst = (stations, a, b) => stations[a].localeCompare(stations[b], 'nl');
const temperature = n => decimal.format(n) + ' °C';
const htmlNode = (tag, value) => {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  return node;
};

function optionList(el, entries, preferred) {
  el.replaceChildren(...entries.map(([value, label]) => new Option(label, value)));
  if (entries.some(([value]) => String(value) === String(preferred))) el.value = preferred;
}
function row(cells, firstHeader = false) {
  const el = htmlNode('tr');
  cells.forEach((value, i) => {
    const cell = htmlNode(i === 0 && firstHeader ? 'th' : 'td');
    if (cell.tagName === 'TH') cell.scope = 'row';
    if (value instanceof Node) cell.append(value);
    else cell.textContent = value;
    el.append(cell);
  });
  return el;
}
function emptyRow(text, span) {
  const el = row([text]);
  el.firstChild.colSpan = span;
  return el;
}
async function get(name, body = 'json') {
  const response = await fetch(url(name));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${name}`);
  return response[body]();
}
function unavailable(el, text, error) {
  el.textContent = text;
  console.error(error);
}
function downloadFile(filename, blob) {
  const href = URL.createObjectURL(blob);
  const a = htmlNode('a');
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
function exportCSV(filename, rows) {
  const csv = rows.map(r => r.map(v => {
    let s = v == null ? '' : String(v).replace(/"/g, '""');
    return /[;\r\n"]/.test(s) ? '"' + s + '"' : s;
  }).join(';')).join('\r\n');
  downloadFile(filename, new Blob(['\ufeff', csv, '\r\n'], {type:'text/csv;charset=utf-8'}));
}

async function initSnow() {
  const data = (await get('sneeuwdagen.csv', 'text')).trim().split(/\r?\n/).slice(1)
    .map(s => s.split(',').map(Number));
  const metric = byId('snow-metric'), year = byId('snow-year'), svg = byId('snow-chart');
  const value = byId('snow-value'), definition = byId('snow-definition');
  optionList(year, data.slice().reverse().map(([y]) => [y, winter(y)]));
  const rolling = [1,2].map(m => data.map((_, i) => i < 29 ? null :
    data.slice(i-29, i+1).reduce((sum, r) => sum + r[m], 0) / 30));
  let geometry;
  function graphic(w, top, bottom, m, picked) {
    const left = 35, right = w-8, ref = rolling[m-1];
    const dy = m === 1 ? 10 : 20, ymax = dy * 7;
    const step = (right-left)/data.length, barWidth = Math.max(1, step*.7);
    const x = i => left + (i+.5)*step;
    const y = n => bottom - (bottom-top)*n/ymax;
    const marks = w < 500 ? [1951,1970,1990,2010,2026] : [1951,1960,1970,1980,1990,2000,2010,2020,2026];
    const p = [];
    for (let t = 0; t <= ymax; t += dy) {
      p.push(`<path d="M${left} ${y(t)}H${right}" stroke="#dbe7ef"/><text class="axis-text" x="${left-7}" y="${y(t)+3}" text-anchor="end">${t}</text>`);
    }
    p.push(`<rect x="${x(picked)-step/2}" y="${top}" width="${step}" height="${bottom-top}" fill="#e0eff5"/>`);
    data.forEach(([end, ...values], i) => {
      const n = values[m-1];
      p.push(`<rect x="${x(i)-barWidth/2}" y="${y(n)}" width="${barWidth}" height="${bottom-y(n)}" fill="${i === picked ? '#0f4e71' : '#427fb5'}"/>`);
      if (marks.includes(end)) p.push(`<text class="axis-text" text-anchor="${i === 0 ? 'start' : i === data.length-1 ? 'end' : 'middle'}" x="${x(i)}" y="${bottom+19}">${end}</text>`);
    });
    const path = ref.flatMap((n, i) => n == null ? [] : [`${i === 29 ? 'M' : 'L'}${x(i)} ${y(n)}`]).join(' ');
    p.push(`<path d="${path}" fill="none" stroke="#8b4f09" stroke-width="2" stroke-dasharray="4 4"/>`);
    return {markup:p.join(''), left, right, step};
  }
  function draw() {
    const w = Math.round(svg.clientWidth), h = Math.round(svg.clientHeight);
    if (w < 70 || h < 70) return;
    const m = Number(metric.value), picked = data.findIndex(([n]) => n === Number(year.value));
    const ref = rolling[m-1][picked], count = data[picked][m];
    definition.textContent = m === 1
      ? 'Gemiddeld aantal dagen met sneeuwval per weerstation. Kies een winterhalfjaar of klik op een staaf.'
      : 'Een dag telt één keer als op minstens één weerstation sneeuw viel. Kies een winterhalfjaar of klik op een staaf.';
    value.textContent = `${winter(year.value)} · circa ${m === 1 ? decimal.format(count) : integer.format(count)} sneeuwdagen`
      + (ref == null ? '' : ` · 30-jaarsgemiddelde ${decimal.format(ref)}`);
    geometry = graphic(w, 12, h-28, m, picked);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = '<title id="snow-chart-title">Sneeuwdagen per winterhalfjaar, eindjaren 1951 tot en met 2026</title>' + geometry.markup;
  }
  const svgDownload = byId('snow-svg');
  svgDownload.disabled = false;
  svgDownload.addEventListener('click', () => {
    const m = Number(metric.value), picked = data.findIndex(([n]) => n === Number(year.value));
    const {markup} = graphic(1128, 74, 348, m, picked);
    const title = m === 1 ? 'Sneeuwdagen · gemiddeld per station' : 'Sneeuwdagen · ergens in Nederland';
    const contents = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="466" viewBox="0 0 1200 466">
  <title>${title}</title>
  <style>.axis-text{font:11px system-ui,sans-serif;fill:#4d6175}</style>
  <rect width="1200" height="466" fill="#fff"/>
  <g transform="translate(36 24)" fill="#132b43" font-family="system-ui,sans-serif">
    <text x="0" y="23" font-size="28" font-weight="750">${title}</text>
    <text x="0" y="48" font-size="14">Nederland · winterhalfjaren 1950/51–2025/26 · eindjaar op de as</text>
    ${markup}
    <line x1="0" y1="391" x2="25" y2="391" stroke="#8b4f09" stroke-width="2" stroke-dasharray="4 4"/>
    <text x="34" y="395" font-size="13">Voortschrijdend 30-jaarsgemiddelde</text>
    <text x="0" y="419" font-size="12">Weerlab · Sneeuwdagen uit de aangeleverde grafieken, afgelezen en afgerond.</text>
  </g>
</svg>`;
    downloadFile(`weerlab-sneeuwdagen-${m === 1 ? 'stationsgemiddelde' : 'landelijk'}.svg`,
      new Blob([contents], {type:'image/svg+xml;charset=utf-8'}));

  });
  function choose(evt) {
    if (!geometry) return;
    const px = evt.clientX-svg.getBoundingClientRect().left;
    if (px < geometry.left || px >= geometry.right) return;
    const next = data[Math.floor((px-geometry.left)/geometry.step)]?.[0];
    if (next && Number(year.value) !== next) {
      year.value = next;
      draw();
    }
  }
  svg.addEventListener('click', choose);
  metric.addEventListener('change', draw);
  year.addEventListener('change', draw);
  new ResizeObserver(draw).observe(svg);
  draw();
}

const TEMP_HEADERS = ['winter','stationnummer','station','meetdagen','vorstdagen','ijsdagen','maximum_boven_nul','minimum_boven_nul','laagste_minimum_C','hoogste_maximum_C','gemiddelde_C'];
async function initTemp() {
  const {stations, winters} = await get('temperatuur.json');
  const year = byId('temp-year'), station = byId('temp-station'), output = byId('temp-summary');
  optionList(year, Object.keys(winters).reverse().map(y => [y, winter(y)]));
  function stationIds() {
    return Object.keys(winters[year.value]).sort((a,b) => namesFirst(stations,a,b));
  }
  function render() {
    const y = year.value, values = winters[y], s = station.value;
    const v = values[s];
    const days = (Date.UTC(Number(y),2,1) - Date.UTC(Number(y)-1,11,1))/86400000;
    const labels = ['Vorstdagen', 'IJsdagen', 'Maximum boven nul', 'Minimum boven nul'];
    const cards = labels.map((label, i) => {
      const article = htmlNode('article');
      article.append(htmlNode('strong', v[i+1]), htmlNode('span', label));
      return article;
    });
    const msg = htmlNode('p', `${stations[s]} · ${v[0]} / ${days} meetdagen · laagste minimum ${temperature(v[5])}, hoogste maximum ${temperature(v[6])}${v[0] === days ? ', gemiddeld ' + temperature(v[7]) : ''}.`);
    msg.className = 'temp-note';
    output.replaceChildren(...cards, msg);
    byId('temp-caption').textContent = `Winter ${winter(y)} · ${stationIds().length} stations`;
    byId('temp-rows').replaceChildren(...stationIds().map(id => {
      const a = values[id];
      return row([stations[id], ...a.slice(1,5), temperature(a[5]), temperature(a[6]), `${a[0]} / ${days}`], true);
    }));
  }
  function updateStations() {
    const s = station.value || '260';
    optionList(station, stationIds().map(id => [id, stations[id]]), s);
    render();
  }
  year.addEventListener('change', updateStations);
  station.addEventListener('change', render);
  const download = byId('temp-export');
  download.disabled = false;
  download.addEventListener('click', () => {
    const y = year.value;
    exportCSV(`weerlab-winter-temperatuur-${y}.csv`, [TEMP_HEADERS, ...stationIds().map(id => {
      const v = winters[y][id];
      return [winter(y), id, stations[id], ...v.slice(0,5), ...v.slice(5).map(n => decimal.format(n))];
    })]);
  });
  updateStations();
}

async function initObs() {
  const allYears = await get('uren.json');
  const year = byId('obs-year'), metric = byId('obs-kind'), station = byId('obs-station');
  const download = byId('obs-export'), summary = byId('obs-summary');
  const tbody = byId('obs-rows'), coverBody = byId('obs-coverage');
  const any = ['', 'Alle stations in het uurarchief'];
  const measures = {
    1: ['Onderkoelde neerslag / ijzel', 'Weercodes voor onderkoelde regen of motregen.'],
    2: ['Sneeuwval', 'Uurvakken met sneeuwval. Vóór 1971 tellen de visuele sneeuwcodes mee.'],
    4: ['IJsvorming', 'De aparte KNMI-indicator voor ijsvorming. Beschikbaar in de nieuwe bron vanaf 2020/21.']
  };
  if (!allYears.length) throw new Error('Geen winters in uurarchief');
  optionList(year, allYears.slice().reverse().map(y => [y, winter(y)]));
  let data, batch = 0, selected = [];
  function render() {
    if (!data) return;
    const kind = Number(metric.value), s = station.value, source = data.stations;
    const coverageIndex = Math.log2(kind);
    const eventDays = new Map(), stationDays = new Map();
    selected = [];
    for (const e of data.events) {
      const [date, id, , flags] = e;
      if (!(flags & kind)) continue;
      if (!stationDays.has(id)) stationDays.set(id, new Set());
      stationDays.get(id).add(date);
      if (s && s !== id) continue;
      selected.push(e);
      if (!eventDays.has(date)) eventDays.set(date, new Map());
      const day = eventDays.get(date);
      if (!day.has(id)) day.set(id, []);
      day.get(id).push(e);
    }
    const ids = Object.keys(source).sort((a,b) => namesFirst(source,a,b));
    const hasData = id => data.coverage[id][coverageIndex] > 0;
    const stationsWithData = ids.filter(hasData).length;
    const stationInfo = s
      ? `${source[s]} · ${integer.format(data.coverage[s][coverageIndex])} van ${integer.format(data.expected)} uurvakken bruikbaar`
      : `${stationsWithData} stations met bruikbare registraties`;
    const known = s ? hasData(s) : stationsWithData > 0;
    byId('obs-description').textContent = measures[kind][1] + ' Bron: ' +
      (data.source === 'edr' ? 'KNMI Dataplatform (gevalideerd).' : 'KNMI-klimatologie.');
    summary.textContent = known
      ? `${eventDays.size} dagen met een melding · ${stationInfo} · ${winter(year.value)}`
      : `Geen bruikbare registraties · ${s ? source[s] + ' · ' : ''}${winter(year.value)}`;
    tbody.replaceChildren(...[...eventDays].reverse().map(([date, groups]) => {
      const list = [...groups.keys()].sort((a,b) => namesFirst(source,a,b));
      const details = htmlNode('details');
      details.append(htmlNode('summary', formatDate(date)));
      const hours = htmlNode('div');
      hours.className = 'hour-details';
      for (const id of list) {
        const suffix = groups.get(id).map(e => String(e[2]).padStart(2,'0') + ':00').join(', ');
        hours.append(htmlNode('p', `${source[id]}: ${suffix} UTC`));
      }
      details.append(hours);
      return row([details, list.map(id => source[id]).join(', '), [...groups.values()].reduce((sum, e) => sum+e.length, 0)]);
    }));
    if (!eventDays.size) tbody.append(emptyRow(known ? 'Geen meldingen in deze selectie.' : 'Voor deze selectie ontbreken de benodigde gegevens.', 3));
    coverBody.replaceChildren(...ids.map(id => row([
      source[id], hasData(id) ? stationDays.get(id)?.size ?? 0 : '–',
      `${integer.format(data.coverage[id][coverageIndex])} / ${integer.format(data.expected)}`
    ], true)));
    download.disabled = !selected.length;
  }
  async function load() {
    const request = ++batch;
    const activeYear = year.value, preferred = station.value;
    data = undefined;
    selected = [];
    tbody.replaceChildren();
    coverBody.replaceChildren();
    station.disabled = true;
    download.disabled = true;
    summary.textContent = 'Uurarchief laden…';
    try {
      const result = await get(`uur-${activeYear}.json`);
      if (request !== batch) return;
      data = result;
      const stations = data.stations;
      optionList(station, [any, ...Object.keys(stations).sort((a,b) => namesFirst(stations,a,b))
        .map(id => [id, `${stations[id]} · ${id}`])], preferred);
      station.disabled = false;
      render();
    } catch (error) {
      if (request === batch) unavailable(summary, 'Dit winterhalfjaar kon niet worden geladen. Kies een ander jaar.', error);
    }
  }
  year.addEventListener('change', load);
  for (const el of [metric, station]) el.addEventListener('change', render);
  download.addEventListener('click', () => exportCSV(`weerlab-uurmeldingen-${year.value}.csv`, [
    ['datum_UTC','stationnummer','station','einduur_UTC','weerverschijnsel','IX','WW_of_WaWa'],
    ...selected.map(([date, id, hh, , ix, ww]) => [date, id, data.stations[id], String(hh).padStart(2,'0')+':00', measures[metric.value][0], ix, ww])
  ]));
  await load();
}
initSnow().catch(e => unavailable(byId('snow-value'), 'De sneeuwreeks kon niet worden geladen. De CSV blijft beschikbaar via de downloadlink.', e));
initTemp().catch(e => unavailable(byId('temp-summary'), 'De temperatuurgegevens konden niet worden geladen.', e));
initObs().catch(e => unavailable(byId('obs-summary'), 'Het KNMI-uurarchief kon niet worden geladen.', e));
