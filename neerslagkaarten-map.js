'use strict';

const byId = id => document.getElementById(id);
const regions = {
  Rijnmond: [[51.73, 3.88], [52.08, 4.90]],
  Nederland: [[50.74, 3.27], [53.66, 7.24]]
};
const dateLabel = new Intl.DateTimeFormat('nl-NL', {
  timeZone: 'Europe/Amsterdam', dateStyle: 'long'
});
const map = L.map('map', {scrollWheelZoom: false, maxBounds: [[49, 0.522], [56, 11.281]]});
const tiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>'
}).addTo(map);
tiles.on('tileerror', () => { byId('map').setAttribute('aria-label', 'Kaart met onvolledig geladen geografische ondergrond'); });
L.control.scale({imperial: false}).addTo(map);

const RainLayer = L.Layer.extend({
  onAdd() {
    this.canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide', map.getPanes().overlayPane);
    this.canvas.style.pointerEvents = 'none';
    map.on('moveend resize', paint);
    paint();
  },
  onRemove() {
    map.off('moveend resize', paint);
    this.canvas.remove();
  }
});
const layer = new RainLayer();
let forecast;
let selected = [];
let lastPoint;
const number = new Intl.NumberFormat('nl-NL', {maximumFractionDigits: 2});
const timeLabel = time => localTime.format(time);
const hoursLabel = hour => timeLabel(hour.start) + ' – ' + timeLabel(hour.end);

function fitRegion() {
  map.fitBounds(regions[byId('region').value], {animate: false});
}
byId('region').onchange = fitRegion;
fitRegion();
layer.addTo(map);

function paint() {
  if (!layer.canvas) return;
  const size = map.getSize();
  const canvas = layer.canvas;
  canvas.width = size.x;
  canvas.height = size.y;
  L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
  if (!forecast || !selected.length || !size.x || !size.y) return;
  const context = canvas.getContext('2d');
  const frame = context.createImageData(size.x, size.y);
  const longitudes = Array.from({length: size.x}, (_, x) => map.containerPointToLatLng([x + 0.5, 0]).lng);
  const colorCache = new Map();
  for (let y = 0; y < size.y; y++) {
    const lat = map.containerPointToLatLng([0, y + 0.5]).lat;
    for (let x = 0; x < size.x; x++) {
      const cell = forecast.cell(lat, longitudes[x]);
      if (!colorCache.has(cell)) {
        const rate = forecast.rate(selected, cell);
        const color = palette.findLast(([minimum]) => rate >= minimum);
        colorCache.set(cell, color ? [...color.slice(1), 160] : Number.isNaN(rate) ? [100, 105, 115, 110] : null);
      }
      const color = colorCache.get(cell);
      if (color) frame.data.set(color, (y * size.x + x) * 4);
    }
  }
  context.putImageData(frame, 0, 0);
}

function showPoint() {
  if (!lastPoint) return;
  const value = forecast?.rate(selected, forecast.cell(lastPoint.lat, lastPoint.lng));
  byId('point').textContent = Number.isFinite(value)
    ? number.format(value) + ' mm/u · ' + lastPoint.lat.toFixed(3) + '° NB, ' + lastPoint.lng.toFixed(3) + '° OL'
    : 'Op deze plaats en tijd is geen modelwaarde beschikbaar.';
}
map.on('click', event => { lastPoint = event.latlng; showPoint(); });

function update() {
  const period = forecast.periods.get(byId('date').value + '/' + byId('part').value);
  const hour = byId('hour').value;
  selected = period?.hours.filter(item => hour === '' || String(item.index) === hour) ?? [];
  const start = selected[0]?.start;
  const end = selected.at(-1)?.end;
  // Local clock windows are 00–06, 06–12, 12–18 and 18–24, including DST.
  const part = Number(byId('part').value);
  const expectedStart = String(part * 6).padStart(2, '0') + ':00';
  const expectedEnd = String((part + 1) * 6 % 24).padStart(2, '0') + ':00';
  const partial = hour === '' && selected.length &&
    (timeLabel(start).slice(-5) !== expectedStart || timeLabel(end).slice(-5) !== expectedEnd);
  byId('status').textContent = selected.length
    ? timeLabel(start) + ' – ' + timeLabel(end) + ' Nederlandse tijd · ' + selected.length +
      (selected.length === 1 ? ' modeluur' : ' modeluren') + (partial ? ' · onvolledig dagdeel' : '')
    : 'Voor dit dagdeel is geen verwachting beschikbaar.';
  paint();
  showPoint();
}

function updateHours() {
  const period = forecast.periods.get(byId('date').value + '/' + byId('part').value);
  byId('hour').replaceChildren(new Option('Dagdeelgemiddelde', ''));
  for (const hour of period?.hours ?? []) byId('hour').add(new Option(hoursLabel(hour), hour.index));
  byId('hour').disabled = !period;
  update();
}
byId('date').onchange = updateHours;
byId('part').onchange = updateHours;
byId('hour').onchange = update;

const legend = byId('legend');
legend.append('Gemiddelde intensiteit (mm/u)');
const bins = [
  ['Droog / spoor (<0,01)', 'transparent'],
  ...palette.map(([min, r, g, b], idx) => [
    number.format(min) + (palette[idx + 1] ? '–<' + number.format(palette[idx + 1][0]) : '+'),
    'rgba(' + [r, g, b, 0.63].join(',') + ')'
  ]),
  ['Geen data', 'rgba(100,105,115,.43)']
];
for (const [label, color] of bins) {
  const item = document.createElement('span');
  const swatch = document.createElement('i');
  swatch.style.background = color;
  item.append(swatch, label);
  legend.append(item);
}

async function request(url) {
  const response = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response;
}

async function load() {
  const params = new URLSearchParams(location.search);
  const base = params.get('bron') === 'lokaal' ? './' : 'https://harmonie-data.weerlab.nl/';
  const metadataUrl = base + 'harmonie46_canvas_meta.json';
  const meta = await (await request(metadataUrl)).json();
  const file = await request(base + 'harmonie46_data_neerslag.bin?v=' + encodeURIComponent(meta.run_utc));
  const buffer = await file.arrayBuffer();
  const after = await (await request(metadataUrl)).json();
  if (JSON.stringify(meta) !== JSON.stringify(after)) throw new Error('Modelrun wisselde tijdens laden');
  const next = readForecast(meta, buffer);
  if (next.hours.at(-1).end <= Date.now()) throw new Error('Modelrun is verlopen');
  const [date, time] = localTime.format(Date.now()).split(' ');
  const first = next.periods.values().next().value;
  const dates = [...new Set([...next.periods.values()].map(item => item.date))];
  const oldDate = byId('date').value;
  const oldHour = byId('hour').value;
  const oldHourStart = forecast?.hours[Number(oldHour)]?.start;
  forecast = next;
  byId('date').replaceChildren(...dates.map(value => new Option(dateLabel.format(new Date(value + 'T12:00:00Z')), value)));
  byId('date').value = dates.includes(oldDate) ? oldDate : dates.includes(date) ? date : first.date;
  if (!oldDate) {
    const part = Math.floor(Number(time.slice(0, 2)) / 6);
    byId('part').replaceChildren(...dayparts.map((name, i) => new Option(name, i)));
    byId('part').value = byId('date').value === date && next.periods.has(date + '/' + part) ? part : first.part;
  }
  byId('date').disabled = false;
  byId('part').disabled = false;
  byId('source').textContent = 'KNMI HARMONIE Cy46 (experimentele modelverwachting) · Run ' +
    timeLabel(next.run) + ' · Bijgewerkt ' + meta.bijgewerkt +
    ' · Nederlands lokaal tijdstip · Exportrooster circa 2 × 2 km in Nederland.';
  updateHours();
  if (oldHour !== '') {
    const equivalent = next.hours.find(item => item.start === oldHourStart);
    if (equivalent && [...byId('hour').options].some(option => option.value === String(equivalent.index))) {
      byId('hour').value = equivalent.index;
      update();
    }
  }
}

async function refresh() {
  try {
    await load();
  } catch (error) {
    if (forecast && forecast.hours.at(-1).end > Date.now()) {
      byId('status').textContent += byId('status').textContent.includes('Verversen mislukt')
        ? '' : ' · Verversen mislukt.';
    } else {
      forecast = null;
      selected = [];
      for (const id of ['date', 'part', 'hour']) byId(id).disabled = true;
      byId('source').textContent = '';
      byId('status').textContent = 'Geen actuele modelgegevens beschikbaar.';
      paint();
      showPoint();
    }
    console.warn('HARMONIE-neerslagkaart', error);
  } finally {
    setTimeout(refresh, 15 * 60 * 1000);
  }
}
refresh();
