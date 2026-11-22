const ZONE = 'Europe/Amsterdam';
const MONTHS = 'januari februari maart april mei juni juli augustus september oktober november december'.split(' ');
const COLORS = ['geel', 'oranje', 'rood'];
const DATE = new Intl.DateTimeFormat('nl-NL', {timeZone: ZONE, day: 'numeric', month: 'long', year: 'numeric'});
const SHORT = new Intl.DateTimeFormat('nl-NL', {timeZone: ZONE, day: 'numeric', month: 'short'});
const CLOCK = new Intl.DateTimeFormat('nl-NL', {timeZone: ZONE, hour: '2-digit', minute: '2-digit'});
const DAY_PARTS = new Intl.DateTimeFormat('en-CA', {timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'});
const daysCache = new WeakMap(), searchCache = new WeakMap();

export function localDay(value) {
  const parts = Object.fromEntries(DAY_PARTS.formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function recordDays(record) {
  if (daysCache.has(record)) return daysCache.get(record);
  if (record.dates) { daysCache.set(record, record.dates); return record.dates; }
  const first = localDay(record.onset), last = localDay(Date.parse(record.expires) - 1);
  const days = [];
  for (let current = first; current <= last; current = new Date(Date.parse(current + 'T12:00Z') + 86400000).toISOString().slice(0, 10)) {
    days.push(current);
    if (days.length > 370) throw new Error('Ongeldige waarschuwingsperiode');
  }
  daysCache.set(record, days);
  return days;
}
export function matches(record, year, month, color, search = '') {
  if (!searchCache.has(record)) searchCache.set(record, fold([record.phenomenon, record.headline, record.description, ...record.areas].join(' ')));
  return recordDays(record).some(d => d.startsWith(`${year}-`) && (month === 'alle' || d.slice(5, 7) === month))
    && (color === 'alle' || record.codes.includes(color))
    && searchCache.get(record).includes(fold(search));
}
export function selectedRecords(records, year, month, color, search = '', phenomenon = 'alle', day = null) {
  return records.filter(record => matches(record, year, month, color, search)
    && (phenomenon === 'alle' || phenomenonGroup(record) === phenomenon)
    && (!day || recordDays(record).includes(day)));
}
export function annualSummary(record) {
  return `Het KNMI gaf ${record.codes.map(code => 'code ' + code).join(' en ')} af voor ${record.phenomenon.toLowerCase()} op ${record.date_label}. Gebied: ${record.areas.join(' · ')}.`;
}
export function fold(text) { return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
export function incompleteYellow(coverage, year, month) {
  const start = `${year}-${month === 'alle' ? '01' : month}-01`;
  return start < coverage.all_colors_since;
}

export function phenomenonGroup(record) {
  const name=fold(record.phenomenon);
  if (/gladheid\s*(?:&|en|\/)\s*sneeuw|sneeuw en gladheid/.test(name)) return 'Gladheid / sneeuw';
  if (/ladheid|ijzel|ijsregen/.test(name)) return 'Gladheid';
  if (/sneeuw/.test(name)) return 'Sneeuw';
  if (/onweer|onweers/.test(name)) return 'Onweersbuien';
  if (/hozen/.test(name)) return 'Wind- en waterhozen';
  if (/wind|storm/.test(name)) return 'Windstoten';
  if (/regen|neerslag|wateroverlast/.test(name)) return 'Regen';
  if (/hitte/.test(name)) return 'Hitte';
  if (/kou/.test(name)) return 'Kou';
  if (/mist|zicht/.test(name)) return 'Mist / slecht zicht';
  if (/temperatuur/.test(name)) return 'Temperatuur';
  return 'Niet nader vermeld';
}
const eventsCache = new WeakMap();
export function warningEvents(records) {
  if (eventsCache.has(records)) return eventsCache.get(records);
  const identified=new Map(), legacy=[];
  for (const record of records) {
    const phenomenon=phenomenonGroup(record);
    if (record.source_kind==='legacy') {legacy.push(record);continue;}
    const id=record.source_kind==='public' ? record.warning_set_id : record.id;
    const key=record.source_kind+'|'+(id||record.id)+'|'+phenomenon;
    if (!identified.has(key)) identified.set(key,{phenomenon,records:[],approximate:false,pending:record.source_kind==='public'&&!id});
    identified.get(key).records.push(record);
  }
  // The old province cube has no national WarningSet identity. Count continuous
  // nationwide periods, explicitly labelled as an approximation of issuances.
  legacy.sort((a,b)=>phenomenonGroup(a).localeCompare(phenomenonGroup(b))||Date.parse(a.onset)-Date.parse(b.onset));
  const periods=[];
  for (const record of legacy) {
    const phenomenon=phenomenonGroup(record), start=Date.parse(record.onset), end=Date.parse(record.expires);
    const previous=periods.at(-1);
    if (previous?.phenomenon===phenomenon && start<=previous.end) {previous.records.push(record);previous.end=Math.max(previous.end,end);}
    else periods.push({phenomenon,records:[record],end,approximate:true,pending:false});
  }
  const events=[...identified.values(),...periods];eventsCache.set(records,events);return events;
}
export function monthlyStatistics(records,year,month='alle',color='alle',search='',phenomenon='alle') {
  const rows=new Map();let pending=false;
  for (const event of warningEvents(records)) {
    if (phenomenon!=='alle'&&event.phenomenon!==phenomenon) continue;
    for (const code of COLORS) {
      if (color!=='alle'&&code!==color) continue;
      if (!event.records.some(r=>r.codes.includes(code)&&matches(r,year,month,code,search))) continue;
      pending ||= event.pending;
      if (!rows.has(event.phenomenon)) rows.set(event.phenomenon,{phenomenon:event.phenomenon,counts:{geel:0,oranje:0,rood:0},approximate:{geel:false,oranje:false,rood:false}});
      const row=rows.get(event.phenomenon);row.counts[code]++;row.approximate[code] ||= event.approximate;
    }
  }
  const result=[...rows.values()].sort((a,b)=>a.phenomenon.localeCompare(b.phenomenon,'nl'));
  const total={counts:{geel:0,oranje:0,rood:0},approximate:{geel:false,oranje:false,rood:false}};
  for (const row of result) for (const code of COLORS) {total.counts[code]+=row.counts[code];total.approximate[code] ||= row.approximate[code];}
  return {rows:result,total,pending};
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};
function dateOnly(value) { return DATE.format(new Date(value + 'T12:00Z')); }
function dateTime(value) { return `${DATE.format(new Date(value))}, ${CLOCK.format(new Date(value))} uur`; }
function period(record) {
  if (record.date_label) return record.date_label;
  const a = new Date(record.onset), b = new Date(record.expires);
  return `${SHORT.format(a)} ${CLOCK.format(a)} – ${localDay(a) === localDay(b) ? '' : SHORT.format(b) + ' '}${CLOCK.format(b)} uur`;
}
function badge(code) { return el('span', `badge ${code}`, `Code ${code}`); }
function safeLink(title, href) {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:') return el('span', '', title);
    const link = el('a', '', title);
    link.href = url.href; link.target = '_blank'; link.rel = 'noopener';
    return link;
  } catch { return el('span', '', title); }
}
function contextPanel(disclosure, record, selectedDay = null) {
  const host = el('section', 'weather-context');
  let loaded = false;
  disclosure.addEventListener('toggle', async () => {
    if (!disclosure.open || loaded) return;
    loaded = true; host.textContent = 'Bijbehorende weerkaarten ophalen…';
    try {
      const {renderWeatherContext} = await import('./waarschuwingen-context.mjs?v=20261122-context-1');
      await renderWeatherContext(host, record, {day:selectedDay});
    } catch {
      loaded = false; host.textContent = 'De aanvullende weerkaarten konden niet worden geladen. Sluit en open de melding om opnieuw te proberen.';
    }
  });
  return host;
}
function recordCard(record, selectedDay = null) {
  const box = el('details', 'record'), summary = el('summary'), grid = el('div', 'record-summary');
  const day = el('div', 'record-date', record.date_label || SHORT.format(new Date(record.onset)));
  if (record.onset) day.append(el('small', '', period(record)));
  if (record.status === 'cancelled') day.append(el('small', '', 'Later ingetrokken'));
  const codes = el('div', 'record-code'); record.codes.forEach(c => codes.append(badge(c)));
  const reason = el('div', 'record-reason', record.phenomenon);
  const shortReason = record.headline && fold(record.headline) !== fold(record.phenomenon) ? record.headline : record.description;
  if (shortReason) reason.append(el('small', 'reason-text', shortReason));
  const area = el('div', 'record-area', record.areas.join(' · '));
  area.append(el('small', '', 'Kaart, toelichting en bron bekijken'));
  grid.append(day, codes, reason, area); summary.append(grid);
  const detail = el('div', 'record-detail');
  detail.append(el('h4', '', 'Wat was er aan de hand?'), el('p', '', record.description || (record.source_kind === 'annual' ? annualSummary(record) : record.headline)));
  const mapHost = el('section', 'archive-map');
  detail.append(mapHost, contextPanel(box, record, selectedDay));
  let mapLoaded = false;
  box.addEventListener('toggle', async () => {
    if (!box.open || mapLoaded) return;
    mapLoaded = true;
    mapHost.textContent = 'Waarschuwingskaart laden…';
    try {
      const {renderWarningMap} = await import('./waarschuwingen-archief-kaart.mjs?v=20261122-herstel-2');
      await renderWarningMap(mapHost, record, {day: selectedDay});
    } catch {
      mapLoaded = false;
      mapHost.textContent = 'De kaart kon niet worden geladen. Sluit en open deze melding om opnieuw te proberen. De gebiedsbeschrijving staat hieronder.';
    }
  });
  if (record.detail) detail.append(el('h4', '', record.context_source ? 'Uit de KNMI-terugblik' : 'Toelichting van het KNMI'), el('p', '', record.detail));
  if (record.factsheet_images?.length) {
    const gallery = el('div', 'archive-figures');
    for (const item of record.factsheet_images) {
      if (/waarschuw|code (?:oranje|rood|geel)/i.test(item.caption) || /waarschuw/i.test(item.url)) continue;
      try {
        const source = new URL(item.url), thumbnail = new URL(item.thumbnail || item.url);
        if (![source, thumbnail].every(url => url.protocol === 'https:' && url.hostname === 'cdn.knmi.nl')) continue;
        const figure = el('figure'), link = safeLink('', source.href), img = el('img');
        img.src = thumbnail.href; img.alt = item.caption; img.loading = 'lazy'; img.decoding = 'async';
        img.addEventListener('error', () => {img.hidden = true; link.textContent = 'Afbeelding bij het KNMI bekijken';});
        link.append(img, el('span', 'archive-figure-zoom', 'Afbeelding vergroten'));
        figure.append(link, el('figcaption', '', item.caption)); gallery.append(figure);
      } catch { /* Keep the warning and map readable if one source URL is invalid. */ }
    }
    if (gallery.childElementCount) detail.append(el('h4', '', 'Kaarten en beelden uit de KNMI-terugblik'), gallery);
  }
  for (const [title, text] of [[record.context_source ? 'Gevolgen volgens de KNMI-terugblik' : 'Mogelijke gevolgen', record.impact], ['Advies van het KNMI', record.instruction]]) {
    if (text) detail.append(el('h4', '', title), el('p', '', Array.isArray(text) ? text.join('\n') : text));
  }
  const meta = el('dl', 'metadata');
  for (const [title, text] of [['Geldig', record.onset ? `${dateTime(record.onset)} tot ${dateTime(record.expires)}` : record.date_label], ['Gebied', record.areas.join(' · ')], ['Eerste uitgifte', record.issued ? dateTime(record.issued) : 'Exact tijdstip niet vermeld in het KNMI-jaaroverzicht'], ['Laatst gewijzigd', record.updated ? dateTime(record.updated) : null]]) {
    if (text) meta.append(el('dt', '', title), el('dd', '', text));
  }
  detail.append(meta);
  if (record.status === 'cancelled') detail.append(el('p', 'source-note', 'Deze afgegeven waarschuwing is later door het KNMI ingetrokken.'));
  if (record.context_source) detail.append(el('p', 'source-note', 'Bron terugblik en beelden: KNMI. De tekst is verkort weergegeven. Het KNMI is niet betrokken bij deze bewerking.'));
  if (record.source_kind === 'annual') detail.append(el('p', 'source-note', 'Overgenomen uit het KNMI-jaaroverzicht. Exacte tijden zijn niet beschikbaar. Bij meerdere kleurcodes vermeldt dit overzicht niet altijd op welke dag en in welk deelgebied elke code gold.'));
  if (record.revisions?.length > 1) {
    const revisions = el('details'), head = el('summary', '', `${record.revisions.length} uitgiftes en wijzigingen bekijken`), list = el('ul');
    for (const r of record.revisions) list.append(el('li', '', `${dateTime(r.issued)} · ${period(r)} · ${r.status === 'cancelled' ? 'ingetrokken' : r.status === 'expired' ? 'beëindigd' : 'afgegeven / bijgewerkt'}`));
    revisions.append(head, list); detail.append(revisions);
  }
  const sources = el('p', 'source-note'); sources.append(safeLink('Officiële KNMI-bron', record.source));
  if (record.factsheet) sources.append(document.createTextNode(' · '), safeLink('Achtergrond bij deze waarschuwing', record.factsheet));
  detail.append(sources); box.append(summary, detail);
  return box;
}

if (typeof document !== 'undefined') {
  if (window.parent !== window) document.body.classList.add('embedded');
  const $ = id => document.getElementById(id);
  let archive = null, shown = 60, selectedDay = null;
  let selectedPhenomenon = new URLSearchParams(location.search).get('fenomeen') || 'alle';
  const nowDay = localDay(Date.now()), params = new URLSearchParams(location.search);
  let year = Number(params.get('jaar')) || Number(nowDay.slice(0, 4));
  let month = /^(alle|0[1-9]|1[0-2])$/.test(params.get('maand') || '') ? params.get('maand') : nowDay.slice(5, 7);
  let color = COLORS.includes(params.get('code')) ? params.get('code') : 'alle';
  selectedDay = /^\d{4}-\d{2}-\d{2}$/.test(params.get('dag') || '') ? params.get('dag') : null;
  $('search').value = (params.get('zoek') || '').slice(0, 200);

  function saveFilters() {
    const p = new URLSearchParams(location.search);
    p.set('jaar', String(year)); p.set('maand', month);
    if (selectedDay) p.set('dag', selectedDay); else p.delete('dag');
    if(selectedPhenomenon==='alle')p.delete('fenomeen');else p.set('fenomeen',selectedPhenomenon);
    if (color === 'alle') p.delete('code'); else p.set('code', color);
    if ($('search').value.trim()) p.set('zoek', $('search').value.trim()); else p.delete('zoek');
    history.replaceState(null, '', location.pathname + '?' + p.toString());
  }
  function renderMonths() {
    $('months').replaceChildren();
    for (let index = 0; index < 12; index++) {
      const value = String(index + 1).padStart(2, '0'), button = el('button', '', MONTHS[index]);
      button.type = 'button'; button.dataset.month = value; button.setAttribute('aria-pressed', String(month === value));
      const markers = el('span', 'month-markers'); markers.setAttribute('aria-hidden', 'true');
      for (const c of COLORS) if (archive.records.some(r => matches(r, year, value, c))) markers.append(el('span', c));
      button.append(markers); $('months').append(button);
    }
    const all = el('button', '', 'Alle maanden van dit jaar'); all.dataset.month = 'alle'; all.type = 'button'; all.setAttribute('aria-pressed', String(month === 'alle')); $('months').append(all);
  }

  function renderStatistics(){
    const caption=`${month==='alle'?'Heel':MONTHS[Number(month)-1]} ${year}`;
    $('statistics-title').textContent=`${caption}: aantal codes per fenomeen`;
    const selected=monthlyStatistics(archive.records,year,month,color,$('search').value,selectedPhenomenon);
    const root=$('statistics'), yearRoot=$('year-statistics');root.replaceChildren();yearRoot.replaceChildren();
    if(selected.pending){root.append(el('p','muted','De maandtellingen worden voorbereid. De afzonderlijke meldingen zijn hieronder al te bekijken.'));return;}
    const today=localDay(Date.now());
    function cell(row,code,period){
      const node=el('td','count-value');
      const active=code==='total'?COLORS.filter(c=>color==='alle'||c===color):[code];
      const future=year===Number(today.slice(0,4))&&period!=='alle'&&period>today.slice(5,7);
      if(future||code!=='total'&&color!=='alle'&&code!==color){node.textContent='—';node.title=future?'Deze maand is nog niet aangebroken':'Andere kleurcode geselecteerd';return node;}
      const value=active.reduce((n,c)=>n+row.counts[c],0);
      const unknown=active.includes('geel')&&incompleteYellow(archive.coverage,year,period);
      const approximate=active.some(c=>row.approximate[c]);
      node.textContent=unknown&&!value?'—':`${approximate?'≈ ':''}${value}${unknown?'*':''}`;
      node.title=unknown?'De geschiedenis voor code geel is hier nog onvolledig.':approximate?'Oude gele waarschuwingen: samengevoegde aaneengesloten perioden.':`${value} afgegeven ${value===1?'code':'codes'}`;
      if(unknown||approximate)node.classList.add('count-provisional');
      if (value > 0) {
        const button = el('button', 'count-link', node.textContent);
        button.type = 'button'; button.dataset.countPeriod = period;
        button.dataset.countCode = code === 'total' ? color : code;
        button.dataset.countPhenomenon = row.phenomenon || selectedPhenomenon;
        const periodLabel = period === 'alle' ? `heel ${year}` : `${MONTHS[Number(period)-1]} ${year}`;
        button.setAttribute('aria-label', `${node.textContent} ${code === 'total' ? 'codes' : 'keer code '+code} · ${row.phenomenon || 'alle geselecteerde fenomenen'} · ${periodLabel}: kaarten en uitleg bekijken`);
        button.title = 'Bekijk de dagen, kaarten en uitleg bij dit aantal';
        node.replaceChildren(button);
      }
      return node;
    }
    function table(firstLabel,rows,periods){
      const table=el('table','count-table'),head=el('thead'),heading=el('tr');
      const first=el('th','',firstLabel);first.scope='col';heading.append(first);
      for(const code of [...COLORS,'total']){const th=el('th','',code==='total'?'Totaal':code[0].toUpperCase()+code.slice(1));th.scope='col';if(code!=='total')th.className='count-head-'+code;heading.append(th);}
      head.append(heading);const body=el('tbody');
      rows.forEach((row,index)=>{
        const tr=el('tr'),label=el('th','',row.label);label.scope='row';
        if(row.month){const button=el('button','count-month',row.label);button.type='button';button.dataset.countMonth=row.month;label.replaceChildren(button);}
        tr.append(label);for(const code of [...COLORS,'total'])tr.append(cell(row,code,periods[index]));body.append(tr);
      });table.append(head,body);return table;
    }
    const rows=selected.rows.map(row=>({...row,label:row.phenomenon}));
    if(!rows.length&&selectedPhenomenon!=='alle')rows.push({...selected.total,label:selectedPhenomenon});
    if(rows.length){rows.push({...selected.total,label:'Totaal geselecteerde codes'});root.append(table('Fenomeen',rows,rows.map(()=>month)));}
    else root.append(el('p','neutral','Geen geregistreerde waarschuwingen bij deze selectie. Controleer de vermelde archiefdekking.'));
    const annualRows=[];
    for(let index=0;index<12;index++){
      const value=String(index+1).padStart(2,'0');
      const result=monthlyStatistics(archive.records,year,value,color,$('search').value,selectedPhenomenon);
      annualRows.push({...result.total,label:MONTHS[index],month:value});
    }
    yearRoot.append(table('Maand',annualRows,annualRows.map(r=>r.month)));
    $('year-statistics-title').textContent=`Vergelijk alle maanden van ${year}${selectedPhenomenon==='alle'?'':': '+selectedPhenomenon}`;
    $('statistics-note').textContent=`De telling volgt je gekozen fenomeen, kleurcode en zoekterm. Elke waarschuwing telt maximaal één keer per kleur per geldigheidsmaand.${year===Number(today.slice(0,4))&&(month==='alle'||month===today.slice(5,7))?' De huidige periode loopt nog; stand t/m '+dateOnly(today)+'.':''}`;
  }

  function revealResults() {
    const heading = $('result-heading'); heading.tabIndex = -1;
    heading.focus({preventScroll:true}); heading.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function showCount(button) {
    month = button.dataset.countPeriod; color = button.dataset.countCode;
    selectedPhenomenon = button.dataset.countPhenomenon;
    $('phenomenon').value = selectedPhenomenon; selectedDay = null; shown = 60;
    render(); revealResults();
  }
  function renderDays(records) {
    const days = [...new Set(records.flatMap(recordDays))].filter(day => day.startsWith(year+'-') && (month === 'alle' || day.slice(5,7) === month)).sort().reverse();
    const root = $('days'); root.replaceChildren();
    $('day-navigation').hidden = !days.length;
    if (month === 'alle') {
      const label = el('label', 'archive-day-label', 'Kies een dag met waarschuwingen'), select = el('select');
      const all = el('option', '', 'Alle dagen'); all.value = ''; select.append(all);
      for (const day of days) {const option = el('option', '', dateOnly(day)); option.value = day; select.append(option);}
      select.value = selectedDay || ''; select.addEventListener('change', () => {selectedDay = select.value || null;shown=60;render();revealResults();});
      label.append(select); root.append(label); return;
    }
    const all = el('button', 'archive-day', 'Alle dagen'); all.type = 'button'; all.dataset.day = ''; all.setAttribute('aria-pressed', String(!selectedDay)); root.append(all);
    for (const day of days) {
      const warnings = records.filter(record => recordDays(record).includes(day));
      const phenomena = [...new Set(warnings.map(phenomenonGroup))];
      const button = el('button', 'archive-day', SHORT.format(new Date(day+'T12:00Z')));
      button.type = 'button'; button.dataset.day = day; button.setAttribute('aria-pressed', String(selectedDay === day));
      button.append(el('small', '', phenomena.join(' · '))); root.append(button);
    }
  }

  function render() {
    if (!archive) return;
    $('year').value = String(year);
    for (const button of $('colors').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.color === color));
    renderMonths(); saveFilters();
    const c = archive.coverage;
    $('coverage').textContent = `Oranje en rood: KNMI-jaaroverzichten vanaf 2010. Geel: ingelezen vanaf ${dateOnly(c.all_colors_since)}.${c.legacy_complete ? '' : ' Oudere gele meldingen worden automatisch aangevuld, terug tot februari 2023.'}`;
    const title = `${month === 'alle' ? 'Alle maanden' : MONTHS[Number(month) - 1]} ${year}`;
    const available = selectedRecords(archive.records, year, month, color, $('search').value, selectedPhenomenon);
    if (selectedDay && !available.some(record => recordDays(record).includes(selectedDay))) selectedDay = null;
    renderDays(available); saveFilters();
    const selected = available.filter(record => !selectedDay || recordDays(record).includes(selectedDay)).sort((a, b) => recordDays(b).at(-1).localeCompare(recordDays(a).at(-1)) || a.id.localeCompare(b.id));
    $('result-heading').replaceChildren(el('h3', '', selectedDay ? dateOnly(selectedDay) : title), el('span', '', `${selected.length} ${selected.length === 1 ? 'vermelding' : 'vermeldingen'}`));
    const incomplete = incompleteYellow(c, year, month);
    $('period-note').textContent = incomplete && color !== 'oranje' && color !== 'rood' ? (year < 2023 ? 'Voor deze periode is code geel niet beschikbaar in deze bronnen. Je ziet hier het officiële archief voor oranje en rood.' : 'De gele meldingen zijn voor deze periode nog niet volledig ingelezen. Ontbrekende gele meldingen betekenen niet dat er geen waarschuwingen waren.') : '';
    renderStatistics();
    const root = $('archive'); root.replaceChildren();
    if (!selected.length) root.append(el('p', 'neutral', incomplete && color !== 'oranje' && color !== 'rood' ? 'Geen ingelezen meldingen bij deze selectie. De historische reeks voor code geel is hier onvolledig.' : 'Geen meldingen gevonden bij deze selectie. Pas de maand, kleurcode of zoekterm aan.'));
    let previousMonth = null, group;
    for (const record of selected.slice(0, shown)) {
      const key = recordDays(record).filter(d => d.startsWith(year + '-') && (month === 'alle' || d.slice(5, 7) === month)).at(-1).slice(0, 7);
      if (key !== previousMonth) {
        group = el('section', 'month-group');
        if (month === 'alle') group.append(el('h4', 'month-title', `${MONTHS[Number(key.slice(5)) - 1]} ${year}`));
        const labels = el('div', 'table-head'); labels.setAttribute('aria-hidden', 'true');
        for (const title of ['Datum / geldigheid', 'Kleurcode', 'Waarvoor', 'Gebied']) labels.append(el('span', '', title));
        group.append(labels); root.append(group); previousMonth = key;
      }
      const card = recordCard(record, selectedDay);
      group.append(card);
      if (record === selected[0]) card.open = true;
    }
    $('more').hidden = selected.length <= shown;
    $('more').textContent = `Meer meldingen tonen (${Math.min(shown, selected.length)} van ${selected.length})`;
  }
  function renderLive(doc) {
    const root = $('live'); root.replaceChildren();
    if (!Number.isFinite(Date.parse(doc.generated)) || Date.now() - Date.parse(doc.generated) > 45 * 60000 || !Array.isArray(doc.warnings)) throw new Error('De actuele KNMI-controle is meer dan 45 minuten oud of ontbreekt.');
    const warnings = doc.warnings.filter(w => COLORS.includes(w.code) && Date.parse(w.expires) > Date.now() && w.warning_type === 'warning').sort((a, b) => COLORS.indexOf(b.code) - COLORS.indexOf(a.code));
    $('live-checked').textContent = `Gecontroleerd ${dateTime(doc.generated)} · vernieuwt automatisch elke 5 minuten`;
    if (!warnings.length) root.append(el('p', 'neutral', 'Er zijn op dit moment geen afgegeven waarschuwingen voor de komende 48 uur.'));
    for (const warning of warnings) {
      const card = el('article', `live-card ${warning.code}`);
      card.append(badge(warning.code), el('span', 'live-status', Date.parse(warning.onset) > Date.now() ? 'Begint later' : 'Nu geldig'), el('h3', '', warning.fenomeen), el('p', '', warning.headline), el('p', 'live-time', period(warning)), el('p', '', warning.gebieden.join(' · ')));
      const details = el('details'); details.append(el('summary', '', 'Weerkaarten, tekst en advies van het KNMI'));
      for (const text of [warning.detail, warning.detailed_description, warning.instruction]) if (text) details.append(el('p', '', Array.isArray(text) ? text.join('\n') : text));
      details.append(contextPanel(details, {phenomenon:warning.fenomeen,onset:warning.onset,expires:warning.expires,areas:warning.gebieden,codes:[warning.code]}));
      card.append(details); root.append(card);
    }
  }
  async function json(name) {
    const response = await fetch(`https://data.weerlab.nl/${name}?t=${Math.floor(Date.now() / 60000)}`, {cache: 'no-cache'});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }
  let loading = false;
  async function load() {
    if (loading) return;
    loading = true; $('refresh').disabled = true;
    try {
      await Promise.allSettled([
        (async () => {
          try { renderLive(await json('waarschuwingen.json')); }
          catch { $('live').replaceChildren(el('p', 'error', 'De actuele waarschuwingen kunnen nu niet betrouwbaar worden gecontroleerd. Bekijk de actuele situatie bij het KNMI.')); $('live').append(safeLink('Naar de actuele KNMI-waarschuwingen', 'https://www.knmi.nl/nederland-nu/weer/waarschuwingen')); $('live-checked').textContent = 'Actuele controle niet beschikbaar. Het historische archief blijft toegankelijk.'; }
        })(),
        (async () => {
          try {
            const data = await json('waarschuwingen-archief.json');
            if (data.schema !== 1 || !Array.isArray(data.records) || !data.coverage?.all_colors_since) throw new Error('Ongeldig archief');
            data.records.forEach(r => { if (!r.codes?.every(c => COLORS.includes(c)) || !Array.isArray(r.areas) || !recordDays(r).length) throw new Error('Ongeldige melding'); });
            archive = data;
            $('year').replaceChildren();
            for (let y = Number(nowDay.slice(0, 4)); y >= 2010; y--) { const option = el('option', '', String(y)); option.value = String(y); $('year').append(option); }
            if (year < 2010 || year > Number(nowDay.slice(0, 4))) year = Number(nowDay.slice(0, 4));
            $('year').disabled = false;
            const phenomena=[...new Set(archive.records.map(phenomenonGroup))].sort((a,b)=>a.localeCompare(b,'nl'));
            if(selectedPhenomenon!=='alle'&&!phenomena.includes(selectedPhenomenon))selectedPhenomenon='alle';
            $('phenomenon').replaceChildren();
            for(const value of ['alle',...phenomena]){const option=el('option','',value==='alle'?'Alle fenomenen':value);option.value=value;$('phenomenon').append(option);}
            $('phenomenon').value=selectedPhenomenon;
            render();
          } catch {
            $('coverage').textContent = archive ? 'Archief kon niet worden ververst. Je ziet de eerder geladen gegevens.' : 'Het archief is tijdelijk niet beschikbaar.';
            if (!archive) $('archive').replaceChildren(el('p', 'error', 'Het archief kon niet worden geladen. Probeer opnieuw met Verversen.'));
          }
        })(),
      ]);
    } finally { loading = false; $('refresh').disabled = false; }
  }
  $('months').addEventListener('click', event => { const button = event.target.closest('button[data-month]'); if (button) {month = button.dataset.month; selectedDay = null; shown = 60; render(); revealResults();} });
  $('colors').addEventListener('click', event => { const button = event.target.closest('button[data-color]'); if (button) {color = button.dataset.color; selectedDay = null; shown = 60; render();} });
  $('year').addEventListener('change', () => {year = Number($('year').value); month = 'alle'; selectedDay = null; shown = 60; render();});
  $('search').addEventListener('input', () => {selectedDay = null; shown = 60; render();});
  $('phenomenon').addEventListener('change',()=>{selectedPhenomenon=$('phenomenon').value;selectedDay=null;shown=60;render();});
  for (const id of ['statistics','year-statistics']) $(id).addEventListener('click', event => {
    const count = event.target.closest('button[data-count-period]');
    if (count) {showCount(count); return;}
    const button = event.target.closest('button[data-count-month]');
    if (button) {month=button.dataset.countMonth;selectedDay=null;shown=60;render();revealResults();}
  });
  $('days').addEventListener('click', event => {const button=event.target.closest('button[data-day]');if(button){selectedDay=button.dataset.day||null;shown=60;render();revealResults();}});
  $('clear-filters').addEventListener('click', () => {color='alle';selectedPhenomenon='alle';selectedDay=null;$('phenomenon').value='alle';$('search').value='';shown=60;render();});
  $('more').addEventListener('click', () => {shown += 60; render();});
  $('refresh').addEventListener('click', load);
  document.addEventListener('visibilitychange', () => {if (!document.hidden) load();});
  setInterval(() => {if (!document.hidden) load();}, 300000);
  load();
}
