'use strict';

const byId = id => document.getElementById(id);
const map = byId('map');
const canvas = map.querySelector('canvas');
const context = canvas.getContext('2d');
const maximum = byId('maximum');
const maximumSummary = byId('maximum-summary');
const number = new Intl.NumberFormat('nl-NL', {maximumFractionDigits: 2});
const dateLabel = new Intl.DateTimeFormat('nl-NL', {timeZone: 'Europe/Amsterdam', dateStyle: 'long'});
let forecast;
let selected = [];
let activePeriodHours;
let geometry;
let mapRequest = 0;

async function request(url) {
  const response = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response;
}

const backgrounds = {
  async Nederland() {
    const html = await (await request('demo_wgt_grondtemp.html')).text();
    const geo = JSON.parse(html.split('/*GEO-START*/const GEO=')[1].split(';/*GEO-END*/')[0]);
    const [lon0, lat1, cosine, scale] = geo.proj;
    const land = new Path2D(geo.nl);
    const neighbours = geo.buren.map(country => new Path2D(country.d));
    const provinces = geo.provincies.map(province => new Path2D(province.d));
    return {
      width: geo.w, height: geo.h,
      lonlat: (x, y) => [lon0 + x / (cosine * scale), lat1 - y / scale],
      base(ctx) {
        ctx.fillStyle = '#d6e7f3';
        ctx.fillRect(0, 0, geo.w, geo.h);
        ctx.fillStyle = '#e6e4db';
        neighbours.forEach(path => ctx.fill(path, 'evenodd'));
        ctx.fillStyle = '#f5f3e9';
        ctx.fill(land, 'evenodd');
      },
      lines(ctx) {
        ctx.strokeStyle = '#637589';
        ctx.lineWidth = 0.8;
        provinces.forEach(path => ctx.stroke(path));
        ctx.lineWidth = 1.2;
        ctx.stroke(land);
      }
    };
  },
  async Rijnmond() {
    const img = new Image();
    img.src = 'rijnmond_regiokaart.png';
    await img.decode();
    const {REGIOKAART: rd, rdNaarWgs} = window.AccuCore;
    return {
      width: rd.b, height: rd.h,
      lonlat: (x, y) => rdNaarWgs(rd.x0 + x * rd.m, rd.y1 - y * rd.m),
      base: ctx => ctx.drawImage(img, 0, 0, rd.b, rd.h)
    };
  }
};
const backgroundCache = new Map();
async function chooseRegion() {
  const id = ++mapRequest;
  const name = byId('region').value;
  map.classList.toggle('landelijk', name === 'Nederland');
  geometry = null;
  maximum.hidden = true;
  maximumSummary.textContent = '';
  context.clearRect(0, 0, canvas.width, canvas.height);
  byId('point').textContent = 'Klik op de kaart voor de neerslagsom op die plek.';
  byId('background-status').textContent = 'Kaartondergrond laden…';
  try {
    if (!backgroundCache.has(name)) backgroundCache.set(name, backgrounds[name]());
    const next = await backgroundCache.get(name);
    if (id !== mapRequest) return;
    geometry = next;
    canvas.width = next.width;
    canvas.height = next.height;
    byId('background-status').textContent = '';
    paint();
  } catch (error) {
    backgroundCache.delete(name);
    if (id === mapRequest) byId('background-status').textContent = 'Kaartondergrond tijdelijk niet beschikbaar.';
    console.warn(error);
  }
}

const raster = document.createElement('canvas');
const rasterContext = raster.getContext('2d');
function paint() {
  if (!geometry) return;
  const {width, height} = geometry;
  maximum.hidden = true;
  maximumSummary.textContent = '';
  geometry.base(context);
  if (forecast && selected.length) {
    if (raster.width !== width || raster.height !== height) {
      raster.width = width;
      raster.height = height;
    }
    if (geometry.forecast !== forecast) {
      geometry.cells = new Int32Array(width * height);
      for (let y = 0, i = 0; y < height; y++) {
        for (let x = 0; x < width; x++, i++) {
          const [lon, lat] = geometry.lonlat(x + 0.5, y + 0.5);
          geometry.cells[i] = forecast.cell(lat, lon);
        }
      }
      geometry.forecast = forecast;
    }
    const frame = rasterContext.createImageData(width, height);
    const colors = new Map();
    let wettest;
    geometry.cells.forEach((cell, i) => {
      if (!colors.has(cell)) {
        const sum = forecast.sum(selected, cell);
        if (sum >= palette[0][0] && (!wettest || sum > wettest.sum)) wettest = {sum, i};
        const color = palette.findLast(([minimum]) => sum >= minimum);
        colors.set(cell, color ? [...color.slice(1), 156] : Number.isNaN(sum) ? [100, 105, 115, 110] : null);
      }
      const color = colors.get(cell);
      if (color) frame.data.set(color, i * 4);
    });
    rasterContext.putImageData(frame, 0, 0);
    context.drawImage(raster, 0, 0);
    if (wettest) {
      const x = wettest.i % width + 0.5;
      const y = Math.floor(wettest.i / width) + 0.5;
      const [lon, lat] = geometry.lonlat(x, y);
      const amount = number.format(wettest.sum) + ' mm';
      maximum.style.left = x / width * 100 + '%';
      maximum.style.top = y / height * 100 + '%';
      maximum.classList.toggle('links', x > width / 2);
      maximum.querySelector('b').textContent = amount;
      maximum.hidden = false;
      maximumSummary.textContent = (selected.length < activePeriodHours ? 'Hoogste deelsom op de kaart' : 'Hoogste neerslagsom op de kaart') +
        ' · ' + amount + ' bij ' + number.format(lat) + '° NB, ' + number.format(lon) + '° OL';
    }
  }
  geometry.lines?.(context);
}

canvas.addEventListener('click', event => {
  if (!geometry || !forecast) return;
  const rect = canvas.getBoundingClientRect();
  const [lon, lat] = geometry.lonlat(
    (event.clientX - rect.left) * canvas.width / rect.width,
    (event.clientY - rect.top) * canvas.height / rect.height);
  const sum = forecast.sum(selected, forecast.cell(lat, lon));
  byId('point').textContent = Number.isFinite(sum)
    ? number.format(sum) + ' mm · ' + lat.toFixed(3) + '° NB, ' + lon.toFixed(3) + '° OL'
    : 'Op deze plaats en in dit tijdvak is geen modelwaarde beschikbaar.';
});

function update() {
  const period = periodFor(byId('date').value, Number(byId('part').value), forecast.hours);
  selected = period.hours;
  activePeriodHours = period.expected;
  const format = time => localTime.format(time);
  const windowLabel = format(period.start) + ' – ' + format(period.end) + ' (Nederlandse tijd)';
  const partial = selected.length < period.expected;
  byId('status').textContent = windowLabel + (selected.length
    ? partial ? ' · Deelsom voor ' + format(selected[0].start) + ' – ' + format(selected.at(-1).end) +
      ' (' + selected.length + ' van ' + period.expected + ' uur)' : ' · ' + selected.length + ' uur'
    : ' · Geen verwachting beschikbaar');
  byId('point').textContent = 'Klik op de kaart voor de neerslagsom op die plek.';
  paint();
}

byId('date').onchange = update;
byId('part').onchange = update;
byId('region').onchange = chooseRegion;
chooseRegion();

const legend = byId('legend');
legend.append('Neerslagsom (mm)');
const bins = [
  ['Droog / spoor (<0,01)', 'transparent'],
  ...palette.map(([min, r, g, b], idx) => [
    number.format(min) + (palette[idx + 1] ? '–<' + number.format(palette[idx + 1][0]) : '+'),
    'rgba(' + [r, g, b, 0.61].join(',') + ')'
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

async function load() {
  const base = new URLSearchParams(location.search).get('bron') === 'lokaal'
    ? './' : 'https://harmonie-data.weerlab.nl/';
  const metadataUrl = base + 'harmonie46_canvas_meta.json';
  const meta = await (await request(metadataUrl)).json();
  const file = await request(base + 'harmonie46_data_neerslag.bin?v=' + encodeURIComponent(meta.run_utc));
  const buffer = await file.arrayBuffer();
  const after = await (await request(metadataUrl)).json();
  if (JSON.stringify(meta) !== JSON.stringify(after)) throw new Error('Modelrun wisselde tijdens laden');
  const next = readForecast(meta, buffer);
  if (next.hours.at(-1).end <= Date.now()) throw new Error('Modelrun is verlopen');
  const [date, time] = localTime.format(Date.now()).split(' ');
  const oldDate = byId('date').value;
  const dates = [...new Set(next.hours.map(hour => localTime.format(hour.start).slice(0, 10)))];
  forecast = next;
  byId('date').replaceChildren(...dates.map(value => new Option(dateLabel.format(new Date(value + 'T12:00:00Z')), value)));
  byId('date').value = dates.includes(oldDate) ? oldDate : dates.includes(date) ? date : dates[0];
  if (!oldDate) {
    byId('part').replaceChildren(...dayparts.map((name, i) => new Option(name + ' uur', i)));
    const startClock = byId('date').value === date ? time : localTime.format(next.run).slice(-5);
    byId('part').value = Math.floor(Number(startClock.slice(0, 2)) / 6);
  }
  byId('date').disabled = false;
  byId('part').disabled = false;
  byId('source').textContent = 'KNMI HARMONIE Cy46 · Run ' + localTime.format(next.run) +
    ' · Bijgewerkt ' + meta.bijgewerkt + ' · Exportrooster circa 2 × 2 km in Nederland.';
  update();
}

async function refresh() {
  try {
    await load();
  } catch (error) {
    if (!forecast || forecast.hours.at(-1).end <= Date.now()) {
      forecast = null;
      selected = [];
      for (const id of ['date', 'part']) byId(id).disabled = true;
      byId('source').textContent = '';
      byId('status').textContent = 'Geen actuele modelgegevens beschikbaar.';
      byId('point').textContent = '';
      paint();
    } else {
      update();
      byId('status').textContent += ' · Verversen mislukt.';
    }
    console.warn('HARMONIE-neerslagkaart', error);
  } finally {
    setTimeout(refresh, 15 * 60 * 1000);
  }
}
refresh();
