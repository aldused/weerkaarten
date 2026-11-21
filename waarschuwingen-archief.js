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
export function fold(text) { return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
export function incompleteYellow(coverage, year, month) {
  const start = `${year}-${month === 'alle' ? '01' : month}-01`;
  return start < coverage.all_colors_since;
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
function recordCard(record) {
  const box = el('details', 'record'), summary = el('summary'), grid = el('div', 'record-summary');
  const day = el('div', 'record-date', record.date_label || SHORT.format(new Date(record.onset)));
  if (record.onset) day.append(el('small', '', period(record)));
  if (record.status === 'cancelled') day.append(el('small', '', 'Later ingetrokken'));
  const codes = el('div', 'record-code'); record.codes.forEach(c => codes.append(badge(c)));
  const reason = el('div', 'record-reason', record.phenomenon);
  const shortReason = record.headline && fold(record.headline) !== fold(record.phenomenon) ? record.headline : record.description;
  if (shortReason) reason.append(el('small', 'reason-text', shortReason));
  const area = el('div', 'record-area', record.areas.join(' · '));
  area.append(el('small', '', 'Toelichting en bron bekijken'));
  grid.append(day, codes, reason, area); summary.append(grid);
  const detail = el('div', 'record-detail');
  detail.append(el('h4', '', record.headline));
  for (const text of [record.description, record.detail]) if (text) detail.append(el('p', '', text));
  for (const [title, text] of [['Mogelijke gevolgen', record.impact], ['Advies van het KNMI', record.instruction]]) {
    if (text) detail.append(el('h4', '', title), el('p', '', Array.isArray(text) ? text.join('\n') : text));
  }
  const meta = el('dl', 'metadata');
  for (const [title, text] of [['Geldig', record.onset ? `${dateTime(record.onset)} tot ${dateTime(record.expires)}` : record.date_label], ['Gebied', record.areas.join(' · ')], ['Eerste uitgifte', record.issued ? dateTime(record.issued) : 'Exact tijdstip niet vermeld in het KNMI-jaaroverzicht'], ['Laatst gewijzigd', record.updated ? dateTime(record.updated) : null]]) {
    if (text) meta.append(el('dt', '', title), el('dd', '', text));
  }
  detail.append(meta);
  if (record.status === 'cancelled') detail.append(el('p', 'source-note', 'Deze afgegeven waarschuwing is later door het KNMI ingetrokken.'));
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
  let archive = null, shown = 60;
  const nowDay = localDay(Date.now()), params = new URLSearchParams(location.search);
  let year = Number(params.get('jaar')) || Number(nowDay.slice(0, 4));
  let month = /^(alle|0[1-9]|1[0-2])$/.test(params.get('maand') || '') ? params.get('maand') : nowDay.slice(5, 7);
  let color = COLORS.includes(params.get('code')) ? params.get('code') : 'alle';
  $('search').value = (params.get('zoek') || '').slice(0, 200);

  function saveFilters() {
    const p = new URLSearchParams(location.search);
    p.set('jaar', String(year)); p.set('maand', month);
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
  function render() {
    if (!archive) return;
    $('year').value = String(year);
    for (const button of $('colors').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.color === color));
    renderMonths(); saveFilters();
    const c = archive.coverage;
    $('coverage').textContent = `Oranje en rood: KNMI-jaaroverzichten vanaf 2010. Geel: ingelezen vanaf ${dateOnly(c.all_colors_since)}.${c.legacy_complete ? '' : ' Oudere gele meldingen worden automatisch aangevuld, terug tot februari 2023.'}`;
    const title = `${month === 'alle' ? 'Alle maanden' : MONTHS[Number(month) - 1]} ${year}`;
    const selected = archive.records.filter(r => matches(r, year, month, color, $('search').value)).sort((a, b) => recordDays(b).at(-1).localeCompare(recordDays(a).at(-1)) || a.id.localeCompare(b.id));
    $('result-heading').replaceChildren(el('h3', '', title), el('span', '', `${selected.length} ${selected.length === 1 ? 'vermelding' : 'vermeldingen'}`));
    const incomplete = incompleteYellow(c, year, month);
    $('period-note').textContent = incomplete && color !== 'oranje' && color !== 'rood' ? (year < 2023 ? 'Voor deze periode is code geel niet beschikbaar in deze bronnen. Je ziet hier het officiële archief voor oranje en rood.' : 'De gele meldingen zijn voor deze periode nog niet volledig ingelezen. Ontbrekende gele meldingen betekenen niet dat er geen waarschuwingen waren.') : '';
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
      group.append(recordCard(record));
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
      const details = el('details'); details.append(el('summary', '', 'Reden en advies van het KNMI'));
      for (const text of [warning.detail, warning.detailed_description, warning.instruction]) if (text) details.append(el('p', '', Array.isArray(text) ? text.join('\n') : text));
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
            $('year').disabled = false; render();
          } catch {
            $('coverage').textContent = archive ? 'Archief kon niet worden ververst. Je ziet de eerder geladen gegevens.' : 'Het archief is tijdelijk niet beschikbaar.';
            if (!archive) $('archive').replaceChildren(el('p', 'error', 'Het archief kon niet worden geladen. Probeer opnieuw met Verversen.'));
          }
        })(),
      ]);
    } finally { loading = false; $('refresh').disabled = false; }
  }
  $('months').addEventListener('click', event => { const button = event.target.closest('button[data-month]'); if (button) {month = button.dataset.month; shown = 60; render();} });
  $('colors').addEventListener('click', event => { const button = event.target.closest('button[data-color]'); if (button) {color = button.dataset.color; shown = 60; render();} });
  $('year').addEventListener('change', () => {year = Number($('year').value); month = 'alle'; shown = 60; render();});
  $('search').addEventListener('input', () => {shown = 60; render();});
  $('more').addEventListener('click', () => {shown += 60; render();});
  $('refresh').addEventListener('click', load);
  document.addEventListener('visibilitychange', () => {if (!document.hidden) load();});
  setInterval(() => {if (!document.hidden) load();}, 300000);
  load();
}
