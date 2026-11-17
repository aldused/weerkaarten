'use strict';

const element = id => document.getElementById(id);
const controls = {
  year: element('archive-year'),
  date: element('archive-date'),
  notable: element('notable-date'),
  before: element('previous-day'),
  after: element('next-day'),
  search: element('station-search'),
  csv: element('day-csv')
};
const numbers = new Intl.NumberFormat('nl-NL');
const dates = new Intl.DateTimeFormat('nl-NL', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'});
const labels = new Intl.Collator('nl-NL', {sensitivity: 'base', numeric: true});
const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const specialCodes = new Map([
  [997, 'Gebroken sneeuwdek < 1 cm'],
  [998, 'Gebroken sneeuwdek ≥ 1 cm'],
  [999, 'Sneeuwhopen']
]);
const featuredDate = '2026-01-08';
const emptyYear = {stations: {}, days: {}};
const archiveStatus = element('archive-status');
const calendar = element('calendar-grid');

let archive;
let currentYear;
let currentDate;
let yearData;
let cells = new Map();
let requestNumber = 0;

function html(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function dayInYear(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function changeDay(day, amount) {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateInMonth(day, year, month) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return dayInYear(year, month, Math.min(last, Number(day.slice(-2))));
}

function formatDay(day) {
  return dates.format(new Date(day + 'T00:00:00Z'));
}

function cm(code) {
  return code !== null && code < 997;
}

function description(code) {
  if (code === null) return 'Geen registratie';
  return specialCodes.get(code) || code + ' cm';
}

function summarize(rows) {
  const measured = new Set();
  const snow = new Set();
  let maximum = null;
  for (const [station, code] of rows) {
    if (code === null) continue;
    measured.add(station);
    if (code > 0) snow.add(station);
    if (cm(code) && (maximum === null || code > maximum)) maximum = code;
  }
  return {measured: measured.size, snow: snow.size, maximum};
}

function colorFor({maximum, snow, measured}) {
  if (!measured) return 'cell-none';
  if (maximum >= 20) return 'cell-max';
  if (maximum >= 10) return 'cell-high';
  if (maximum >= 5) return 'cell-medium';
  if (maximum > 0) return 'cell-low';
  return snow ? 'cell-trace' : 'cell-zero';
}

async function loadIndex() {
  if (window.sneeuwdekVoorbeeld) return window.sneeuwdekVoorbeeld.index;
  const response = await fetch('sneeuwdek-data/index.json');
  if (!response.ok) throw new Error('Archiefindex is niet beschikbaar');
  return response.json();
}

async function loadYear(year) {
  if (!archive.years[year]) return emptyYear;
  let bytes;
  if (window.sneeuwdekVoorbeeld) {
    const raw = atob(window.sneeuwdekVoorbeeld.years[year]);
    bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  } else {
    const response = await fetch(`sneeuwdek-data/${year}.json.gz`);
    if (!response.ok) throw new Error(`Archief voor ${year} is niet beschikbaar`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (bytes[0] !== 31 || bytes[1] !== 139) return JSON.parse(new TextDecoder().decode(bytes));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}

function buildCalendar(year) {
  const fragment = document.createDocumentFragment();
  cells = new Map();
  fragment.append(html('span'));
  for (let day = 1; day <= 31; day++) {
    fragment.append(html('span', day, 'calendar-label'));
  }
  let reported = 0;
  let snow = 0;
  for (let month = 1; month <= 12; month++) {
    fragment.append(html('span', months[month - 1], 'calendar-label calendar-month'));
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= 31; day++) {
      if (day > last) {
        fragment.append(html('span'));
        continue;
      }
      const date = dayInYear(year, month, day);
      const stats = summarize(yearData.days[date] || []);
      if (stats.measured) reported++;
      if (stats.snow) snow++;
      const button = html('button', undefined, 'calendar-day ' + colorFor(stats));
      button.type = 'button';
      button.dataset.day = date;
      button.tabIndex = -1;
      button.disabled = date < archive.first || date > archive.last;
      const depth = !stats.measured ? 'geen meting' : stats.maximum > 0 || !stats.snow ?
        `${stats.maximum} cm maximaal` : 'alleen bijzondere sneeuwdekcodes';
      button.title = `${formatDay(date)} · ${depth}`;
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', 'false');
      fragment.append(button);
      cells.set(date, button);
    }
  }
  calendar.replaceChildren(fragment);
  const count = archive.years[year]?.[3] || 0;
  archiveStatus.textContent = `${numbers.format(snow)} dagen met ergens sneeuwdek · ${numbers.format(reported)} dagen met registraties · ${numbers.format(count)} stations in ${year}`;
}

function updateTable() {
  if (!yearData || !currentDate) return;
  const source = yearData.days[currentDate] || [];
  const term = controls.search.value.trim().toLocaleLowerCase('nl');
  const idFor = station => String(station).padStart(3, '0');
  const order = code => code === null ? -1 : cm(code) ? code : .5;
  const rows = source.filter(([id]) => !term ||
    yearData.stations[id].toLocaleLowerCase('nl').includes(term) || idFor(id).includes(term));
  rows.sort((a, b) => order(b[1]) - order(a[1]) || labels.compare(yearData.stations[a[0]], yearData.stations[b[0]]));
  const output = rows.map(([id, code]) => {
    const row = html('tr');
    const name = html('th', yearData.stations[id]);
    name.scope = 'row';
    name.append(html('span', idFor(id), 'station-number'));
    const depth = html('td', code === null ? '—' : description(code));
    if (code === null) depth.setAttribute('aria-label', 'Geen registratie');
    row.append(name, depth);
    return row;
  });
  if (!output.length) {
    const row = html('tr');
    const cell = html('td', term ? 'Geen stations gevonden.' : 'Geen stationgegevens op deze datum.');
    cell.colSpan = 2;
    row.append(cell);
    output.push(row);
  }
  element('station-rows').replaceChildren(...output);
  element('station-caption').textContent = `${numbers.format(new Set(rows.map(([id]) => id)).size)} stations`;
}

function showDay(day, focus) {
  if (currentDate) {
    const previous = cells.get(currentDate);
    if (previous) {
      previous.tabIndex = -1;
      previous.setAttribute('aria-pressed', 'false');
    }
  }
  currentDate = day;
  const rows = yearData.days[day] || [];
  const stats = summarize(rows);
  const peak = new Set();
  if (stats.maximum > 0) {
    for (const [id, code] of rows) {
      if (code === stats.maximum) peak.add(yearData.stations[id]);
    }
  }
  const peakNames = [...peak].sort(labels.compare);
  element('report-title').textContent = formatDay(day);
  const exactDepth = stats.maximum !== null && (stats.maximum > 0 || !stats.snow);
  element('day-depth').textContent = exactDepth ? stats.maximum + ' cm' : '—';
  element('day-peak-place').textContent = peakNames.length > 3 ?
    peakNames.slice(0, 3).join(', ') + ` + ${peakNames.length - 3}` : peakNames.join(', ');
  element('day-snow-count').textContent = stats.measured ? numbers.format(stats.snow) : '—';
  element('day-coverage').textContent = numbers.format(stats.measured);
  controls.date.value = day;
  controls.before.disabled = day <= archive.first;
  controls.after.disabled = day >= archive.last;
  controls.search.disabled = !rows.length;
  controls.csv.disabled = !rows.length;
  const active = cells.get(day);
  if (active) {
    active.tabIndex = 0;
    active.setAttribute('aria-pressed', 'true');
    if (focus) active.focus();
  }
  updateTable();
}

async function selectDate(day, focus = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  day = day < archive.first ? archive.first : day > archive.last ? archive.last : day;
  const year = Number(day.slice(0, 4));
  controls.year.value = year;
  controls.date.value = day;
  const serial = ++requestNumber;
  if (year !== currentYear || !yearData) {
    yearData = null;
    archiveStatus.textContent = `KNMI-waarnemingen uit ${year} laden…`;
    controls.before.disabled = true;
    controls.after.disabled = true;
    controls.search.disabled = true;
    controls.csv.disabled = true;
    calendar.replaceChildren();
    try {
      const payload = await loadYear(year);
      if (serial !== requestNumber) return;
      yearData = payload;
      currentYear = year;
      buildCalendar(year);
    } catch (error) {
      if (serial !== requestNumber) return;
      archiveStatus.textContent = `Archief voor ${year} kon niet worden geladen. Kies opnieuw een datum of jaar.`;
      element('report-title').textContent = 'Daggegevens niet geladen';
      for (const key of ['day-depth', 'day-coverage', 'day-snow-count']) element(key).textContent = '—';
      element('day-peak-place').textContent = '';
      element('station-caption').textContent = '';
      element('station-rows').replaceChildren();
      console.error(error);
      return;
    }
  }
  showDay(day, focus);
}

function saveDay() {
  const rows = yearData.days[currentDate] || [];
  const fields = [['datum', 'tijd_UTC', 'stationnummer', 'KNMI_station', 'SX', 'dikte_cm']];
  for (const [station, code] of rows) {
    fields.push([currentDate, '08:00', String(station).padStart(3, '0'), yearData.stations[station],
      code, cm(code) ? code : '']);
  }
  const csv = fields.map(row => row.map(value => {
    const s = String(value ?? '').replace(/"/g, '""');
    return /[;\r\n"]/.test(s) ? '"' + s + '"' : s;
  }).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', csv, '\r\n'], {type: 'text/csv;charset=utf-8'}));
  const link = html('a');
  link.href = url;
  link.download = `knmi-sneeuwdek-${currentDate}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function init() {
  archive = await loadIndex();
  const firstYear = Number(archive.first.slice(0, 4));
  const lastYear = Number(archive.last.slice(0, 4));
  element('archive-period').textContent = `${firstYear}–${lastYear}`;
  element('archive-size').textContent =
    `Het archief loopt van ${formatDay(archive.first)} tot en met ${formatDay(archive.last)}. In totaal bevat het ${numbers.format(archive.observationCount)} geregistreerde stationdagen uit ${numbers.format(archive.stationCount)} stationsnummers door de jaren heen.`;
  for (let year = lastYear; year >= firstYear; year--) controls.year.add(new Option(year, year));
  controls.year.disabled = false;
  controls.date.disabled = false;
  controls.date.min = archive.first;
  controls.date.max = archive.last;
  controls.notable.disabled = featuredDate < archive.first || featuredDate > archive.last;
  controls.year.addEventListener('change', () => {
    const date = controls.date.value || archive.first;
    void selectDate(dateInMonth(date, Number(controls.year.value), Number(date.slice(5, 7))));
  });
  controls.date.addEventListener('change', () => void selectDate(controls.date.value));
  controls.notable.addEventListener('click', () => void selectDate(featuredDate));
  controls.before.addEventListener('click', () => void selectDate(changeDay(currentDate, -1)));
  controls.after.addEventListener('click', () => void selectDate(changeDay(currentDate, 1)));
  controls.search.addEventListener('input', updateTable);
  controls.csv.addEventListener('click', saveDay);
  calendar.addEventListener('click', event => {
    const day = event.target.closest('button[data-day]')?.dataset.day;
    if (day) void selectDate(day);
  });
  calendar.addEventListener('keydown', event => {
    const day = event.target.closest('button[data-day]')?.dataset.day;
    if (!day || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      void selectDate(changeDay(day, event.key === 'ArrowLeft' ? -1 : 1), true);
      return;
    }
    const year = Number(day.slice(0, 4));
    const month = Number(day.slice(5, 7)) + (event.key === 'ArrowUp' ? -1 : 1);
    void selectDate(dateInMonth(day, year, month), true);
  });
  await selectDate(controls.notable.disabled ? archive.last : featuredDate);
}

init().catch(error => {
  archiveStatus.textContent = 'Het KNMI-archief kon niet worden geladen.';
  element('archive-period').textContent = 'Niet geladen';
  console.error(error);
});
