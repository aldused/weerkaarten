'use strict';

const byId = id => document.getElementById(id);
const map = byId('map');
const canvas = map.querySelector('canvas');
const context = canvas.getContext('2d');
const rainOpacity = 0.52;
const markers = byId('maximum-markers');
const download = byId('png');
const maximumSummary = byId('maximum-summary');
const number = new Intl.NumberFormat('nl-NL', {maximumFractionDigits: 2});
const dateLabel = new Intl.DateTimeFormat('nl-NL', {timeZone: 'Europe/Amsterdam', dateStyle: 'long'});
const periodDate = new Intl.DateTimeFormat('nl-NL', {
  timeZone: 'Europe/Amsterdam', weekday: 'long', day: 'numeric', month: 'long'
});
function formatBoundary(time) {
  const clock = localTime.format(time).slice(-5);
  return periodDate.format(time) + ' ' + (clock.endsWith(':00') ? clock.slice(0, 2) : clock) + ' uur';
}

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

let places = [];
request('plaatsen_lookup.json')
  .then(response => response.json())
  .then(data => {
    places = data.plaatsen.filter(place => place.land === 'NL' &&
      Number.isFinite(place.lat) && Number.isFinite(place.lon));
    paint();
  })
  .catch(error => console.warn('Plaatsnamen niet beschikbaar', error));

function nearestPlace(lon, lat) {
  const longitudeScale = Math.cos(lat * Math.PI / 180);
  let nearest;
  let minDistance = Infinity;
  for (const place of places) {
    const distance = (place.lat - lat) ** 2 + ((place.lon - lon) * longitudeScale) ** 2;
    if (distance < minDistance) {
      minDistance = distance;
      nearest = place;
    }
  }
  return nearest?.naam;
}

let nationalGeometry;
function loadNational() {
  nationalGeometry ??= request('demo_wgt_grondtemp.html')
    .then(response => response.text())
    .then(html => JSON.parse(html.split('/*GEO-START*/const GEO=')[1].split(';/*GEO-END*/')[0]))
    .then(geo => ({geo, land: new Path2D(geo.nl)}))
    .catch(error => { nationalGeometry = null; throw error; });
  return nationalGeometry;
}

const backgrounds = {
  async Nederland() {
    const {geo, land} = await loadNational();
    const [lon0, lat1, cosine, scale] = geo.proj;
    const neighbours = geo.buren.map(country => new Path2D(country.d));
    const provinces = geo.provincies.map(province => new Path2D(province.d));
    return {
      width: geo.w, height: geo.h,
      lonlat: (x, y) => [lon0 + x / (cosine * scale), lat1 - y / scale],
      xy: (lon, lat) => [(lon - lon0) * cosine * scale, (lat1 - lat) * scale],
      onLand: (x, y) => context.isPointInPath(land, x, y, 'evenodd'),
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
    const {geo, land} = await loadNational();
    const [lon0, lat1, cosine, scale] = geo.proj;
    const base = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? 'accumulatie_data/' : 'https://data.weerlab.nl/accumulatie/';
    const region = await (await request(base + 'raster/rijnmond.geojson')).json();
    const {REGIOKAART: rd, rdNaarWgs, wgsNaarRd} = window.AccuCore;
    const boundary = new Path2D();
    for (const {geometry} of region.features) {
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      for (const polygon of polygons) {
        for (const ring of polygon) {
          ring.forEach(([lon, lat], i) => {
            const [east, north] = wgsNaarRd(lon, lat);
            const x = (east - rd.x0) / rd.m;
            const y = (rd.y1 - north) / rd.m;
            if (i === 0) boundary.moveTo(x, y);
            else boundary.lineTo(x, y);
          });
          boundary.closePath();
        }
      }
    }
    const backdrop = document.createElement('canvas');
    backdrop.width = rd.b;
    backdrop.height = rd.h;
    const backdropContext = backdrop.getContext('2d');
    backdropContext.drawImage(img, 0, 0, rd.b, rd.h);
    const pixels = backdropContext.getImageData(0, 0, rd.b, rd.h);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const [red, green, blue] = [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]];
      if (green > Math.max(red, blue)) {
        // Neutral land shades retain the contrast between the original greens.
        const shade = Math.round(194 + green * 0.25);
        pixels.data[i] = shade;
        pixels.data[i + 1] = shade;
        pixels.data[i + 2] = shade;
      }
    }
    backdropContext.putImageData(pixels, 0, 0);
    return {
      width: rd.b, height: rd.h,
      lonlat: (x, y) => rdNaarWgs(rd.x0 + x * rd.m, rd.y1 - y * rd.m),
      xy(lon, lat) {
        const [east, north] = wgsNaarRd(lon, lat);
        return [(east - rd.x0) / rd.m, (rd.y1 - north) / rd.m];
      },
      onLand(x, y, lon, lat) {
        return context.isPointInPath(boundary, x, y, 'evenodd') &&
          context.isPointInPath(land, (lon - lon0) * cosine * scale, (lat1 - lat) * scale, 'evenodd');
      },
      base: ctx => ctx.drawImage(backdrop, 0, 0)
    };
  }
};
const backgroundCache = new Map();
async function chooseRegion() {
  const id = ++mapRequest;
  const name = byId('region').value;
  map.classList.toggle('landelijk', name === 'Nederland');
  geometry = null;
  download.disabled = true;
  markers.replaceChildren();
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
  markers.replaceChildren();
  maximumSummary.textContent = '';
  download.disabled = !forecast || !selected.length;
  geometry.base(context);
  if (forecast && selected.length) {
    const rasterWidth = Math.min(width, 800);
    const rasterHeight = Math.round(height * rasterWidth / width);
    if (raster.width !== rasterWidth || raster.height !== rasterHeight) {
      raster.width = rasterWidth;
      raster.height = rasterHeight;
    }
    if (geometry.forecast !== forecast) {
      geometry.cells = new Int32Array(rasterWidth * rasterHeight);
      geometry.landCells = new Map();
      const visibleCells = new Set();
      for (let y = 0, i = 0; y < rasterHeight; y++) {
        for (let x = 0; x < rasterWidth; x++, i++) {
          const [lon, lat] = geometry.lonlat((x + 0.5) * width / rasterWidth, (y + 0.5) * height / rasterHeight);
          const cell = forecast.cell(lat, lon);
          geometry.cells[i] = cell;
          if (cell >= 0) visibleCells.add(cell);
        }
      }
      for (const cell of visibleCells) {
        const [lon, lat] = forecast.coordinates(cell);
        const [x, y] = geometry.xy(lon, lat);
        if (x >= 0 && y >= 0 && x < width && y < height && geometry.onLand(x, y, lon, lat)) {
          geometry.landCells.set(cell, {x, y});
        }
      }
      geometry.forecast = forecast;
    }
    const frame = rasterContext.createImageData(rasterWidth, rasterHeight);
    const colors = new Map();
    geometry.cells.forEach((cell, i) => {
      if (!colors.has(cell)) {
        const sum = forecast.sum(selected, cell);
        const color = palette.findLast(([minimum]) => sum >= minimum);
        colors.set(cell, color ? [...color.slice(1), Math.round(255 * rainOpacity)] : Number.isNaN(sum) ? [100, 105, 115, 110] : null);
      }
      const color = colors.get(cell);
      if (color) frame.data.set(color, i * 4);
    });
    rasterContext.putImageData(frame, 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(raster, 0, 0, width, height);
    const ranked = [...geometry.landCells].map(([cell, point]) =>
      ({...point, sum: forecast.sum(selected, cell)}))
      .filter(point => point.sum >= 0.01).sort((a, b) => b.sum - a.sum);
    const top = [];
    for (const point of ranked) {
      if (top.every(other => Math.hypot((point.x - other.x) / width, (point.y - other.y) / height) >= 0.12)) {
        top.push(point);
        if (top.length === 3) break;
      }
    }
    const entries = top.map(({x, y, sum}) => {
      const amount = number.format(sum) + ' mm';
      const marker = document.createElement('span');
      marker.className = 'maximum' + (x > width / 2 ? ' links' : '');
      marker.style.left = x / width * 100 + '%';
      marker.style.top = y / height * 100 + '%';
      const label = document.createElement('b');
      const [lon, lat] = geometry.lonlat(x, y);
      const place = nearestPlace(lon, lat);
      label.textContent = amount + (place ? ' · bij ' + place : '');
      marker.append(label);
      markers.append(marker);
      return label.textContent;
    });
    positionLabels();
    if (entries.length) {
      maximumSummary.textContent = (selected.length < activePeriodHours ? 'Hoogste deelsommen' : 'Hoogste neerslagsommen') +
        ' boven land · ' + entries.join(' · ');
    }
  }
  geometry.lines?.(context);
}

function positionLabels() {
  const bounds = map.getBoundingClientRect();
  const dots = [...markers.children].map(marker => marker.getBoundingClientRect());
  const occupied = [...dots];
  [...markers.children].forEach((marker, index) => {
    const label = marker.querySelector('b');
    label.hidden = false;
    label.style.translate = 'none';
    const box = label.getBoundingClientRect();
    const dot = dots[index];
    const centerX = (dot.left + dot.right) / 2;
    const centerY = (dot.top + dot.bottom) / 2;
    const gap = 6;
    const left = dot.left - box.width - gap;
    const right = dot.right + gap;
    const above = dot.top - box.height - gap;
    const below = dot.bottom + gap;
    const middle = centerY - box.height / 2;
    const sides = centerX > bounds.left + bounds.width / 2 ? [left, right] : [right, left];
    const candidates = [
      ...sides.flatMap(x => [[x, middle], [x, above], [x, below]]),
      [centerX - box.width / 2, above], [centerX - box.width / 2, below]
    ];
    for (const [x, y] of candidates) {
      const tx = Math.max(bounds.left + gap, Math.min(x, bounds.right - box.width - gap));
      const ty = Math.max(bounds.top + gap, Math.min(y, bounds.bottom - box.height - gap));
      const rect = {left: tx, top: ty, right: tx + box.width, bottom: ty + box.height};
      if (rect.right > bounds.right - gap || rect.bottom > bounds.bottom - gap ||
          occupied.some(other => rect.left < other.right + gap && rect.right + gap > other.left &&
            rect.top < other.bottom + gap && rect.bottom + gap > other.top)) continue;
      label.style.translate = (tx - box.left) + 'px ' + (ty - box.top) + 'px';
      occupied.push(rect);
      return;
    }
    label.hidden = true;
  });
}
new ResizeObserver(positionLabels).observe(map);

download.onclick = () => {
  const status = byId('download-status');
  status.textContent = '';
  try {
    const bounds = canvas.getBoundingClientRect();
    const scale = canvas.width / bounds.width;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    let extraHeight = 0;
    const ctx = exportCanvas.getContext('2d');
    ctx.font = '16px system-ui';
    let rowWidth = 20;
    for (const [label] of bins) {
      const itemWidth = ctx.measureText(label).width + 38;
      if (rowWidth + itemWidth > canvas.width - 20) {
        extraHeight += 23;
        rowWidth = 20;
      }
      rowWidth += itemWidth;
    }
    exportCanvas.height = canvas.height + 206 + extraHeight;
    ctx.fillStyle = '#0d1420';
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.fillStyle = '#00205b';
    ctx.fillRect(0, 0, exportCanvas.width, 80);
    ctx.fillRect(0, canvas.height + 80, exportCanvas.width, 126 + extraHeight);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 27px system-ui';
    const region = byId('region').value;
    const part = byId('part').value;
    const date = part === 'all' ? localTime.format(forecast.run).slice(0, 10) : byId('date').value;
    ctx.fillText('Neerslagsom · ' + region + ' (mm)', 20, 35);
    ctx.font = '16px system-ui';
    ctx.fillText(byId('status').textContent, 20, 62, canvas.width - 40);
    ctx.drawImage(canvas, 0, 80);
    for (const marker of markers.children) {
      const dot = marker.getBoundingClientRect();
      const label = marker.querySelector('b');
      const box = label.getBoundingClientRect();
      const x = (dot.left + dot.width / 2 - bounds.left) * scale;
      const y = (dot.top + dot.height / 2 - bounds.top) * scale + 80;
      ctx.fillStyle = '#121d30';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.arc(x, y, 5.5 * scale, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      if (label.hidden) continue;
      const left = (box.left - bounds.left) * scale;
      const top = (box.top - bounds.top) * scale + 80;
      ctx.fillRect(left, top, box.width * scale, box.height * scale);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + 13 * scale + 'px system-ui';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.textContent, left + 7 * scale, top + box.height * scale / 2,
        Math.max(1, (box.width - 14) * scale));
    }
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#c2cfe1';
    ctx.font = '16px system-ui';
    ctx.fillText('Neerslagsom (mm)', 20, canvas.height + 102);
    let legendX = 20;
    let legendY = canvas.height + 126;
    for (const [label, color] of bins) {
      const itemWidth = ctx.measureText(label).width + 38;
      if (legendX + itemWidth > canvas.width - 20) {
        legendX = 20;
        legendY += 23;
      }
      ctx.fillStyle = color;
      ctx.fillRect(legendX, legendY - 12, 15, 13);
      ctx.strokeStyle = '#8895a7';
      ctx.lineWidth = 1;
      ctx.strokeRect(legendX, legendY - 12, 15, 13);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, legendX + 20, legendY);
      legendX += itemWidth;
    }
    ctx.fillText(byId('source').textContent, 20, canvas.height + 174 + extraHeight, canvas.width - 40);
    ctx.fillStyle = '#fff';
    ctx.fillText('weerlab.nl · Ed Aldus', 20, canvas.height + 196 + extraHeight);
    exportCanvas.toBlob(blob => {
      if (!blob) {
        status.textContent = 'De kaart kon niet worden opgeslagen.';
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = ['neerslag', region.toLowerCase(), date,
        part === 'all' ? 'hele-run' : dayparts[Number(part)].replace('–', '-')].join('_') + '.png';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }, 'image/png');
  } catch (error) {
    status.textContent = 'De kaart kon niet worden opgeslagen.';
    console.warn(error);
  }
};

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
  const part = byId('part').value;
  const all = part === 'all';
  byId('date').disabled = all;
  if (!forecast) return;
  const hours = forecast.hours;
  const period = all
    ? {start: hours[0].start, end: hours.at(-1).end, hours, expected: hours.length}
    : periodFor(byId('date').value, Number(part), hours);
  selected = period.hours;
  activePeriodHours = period.expected;
  const windowLabel = 'Neerslag: ' + formatBoundary(period.start) + ' tot ' + formatBoundary(period.end);
  const partial = selected.length < period.expected;
  byId('status').textContent = windowLabel + (selected.length
    ? partial ? ' · Deelsom voor ' + formatBoundary(selected[0].start) + ' tot ' + formatBoundary(selected.at(-1).end) +
      ' (' + selected.length + ' van ' + period.expected + ' uur)' : ' · ' + selected.length + ' uur'
    : ' · Geen verwachting beschikbaar');
  byId('point').textContent = 'Klik op de kaart voor de neerslagsom op die plek.';
  requestAnimationFrame(paint);
}

const [today, currentTime] = localTime.format(Date.now()).split(' ');
const initialDay = Date.parse(today + 'T12:00:00Z');
const initialDates = [0, 1, 2].map(offset => new Date(initialDay + offset * 24 * HOUR));
byId('date').replaceChildren(...initialDates.map(date => new Option(dateLabel.format(date), date.toISOString().slice(0, 10))));
byId('part').replaceChildren(...dayparts.map((name, i) => new Option(name + ' uur', i)),
  new Option('Hele modelrun', 'all'));
byId('part').value = Math.floor(Number(currentTime.slice(0, 2)) / 6);
byId('date').onchange = update;
byId('part').onchange = update;
byId('region').onchange = chooseRegion;
chooseRegion();

const legend = byId('legend');
legend.append('Neerslagsom (mm)');
const bins = [
  ['Minder dan 0,3 mm', 'transparent'],
  ...palette.map(([min, r, g, b], idx) => [
    number.format(min) + (palette[idx + 1] ? '–<' + number.format(palette[idx + 1][0]) : '+'),
    'rgba(' + [r, g, b, rainOpacity].join(',') + ')'
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
  const metadataUrl = base + 'harmonie_canvas_meta.json';
  const meta = await (await request(metadataUrl)).json();
  const file = await request(base + 'harmonie_data_neerslag.bin?v=' + encodeURIComponent(meta.run_utc));
  const buffer = await file.arrayBuffer();
  const after = await (await request(metadataUrl)).json();
  if (JSON.stringify(meta) !== JSON.stringify(after)) throw new Error('Modelrun wisselde tijdens laden');
  const next = readForecast(meta, buffer);
  if (next.hours.at(-1).end <= Date.now()) throw new Error('Modelrun is verlopen');
  const date = localTime.format(Date.now()).slice(0, 10);
  const oldDate = byId('date').value;
  const dates = [...new Set(next.hours.map(hour => localTime.format(hour.start).slice(0, 10)))];
  forecast = next;
  byId('date').replaceChildren(...dates.map(value => new Option(dateLabel.format(new Date(value + 'T12:00:00Z')), value)));
  byId('date').value = dates.includes(oldDate) ? oldDate : dates.includes(date) ? date : dates[0];
  byId('source').textContent = 'KNMI HARMONIE Cy43 · Run ' + localTime.format(next.run) +
    ' · Bijgewerkt ' + meta.bijgewerkt + ' · Exportrooster circa 2 × 2 km in Nederland.';
  update();
}

let refreshTimer;
async function refresh() {
  clearTimeout(refreshTimer);
  const retry = byId('retry');
  retry.hidden = true;
  try {
    await load();
  } catch (error) {
    if (!forecast || forecast.hours.at(-1).end <= Date.now()) {
      forecast = null;
      selected = [];
      byId('source').textContent = '';
      byId('status').textContent = 'Modelgegevens konden niet worden geladen.';
      byId('point').textContent = '';
      paint();
    } else {
      update();
      byId('status').textContent += ' · Verversen mislukt.';
    }
    retry.hidden = false;
    console.warn('HARMONIE-neerslagkaart', error);
  } finally {
    refreshTimer = setTimeout(refresh, 15 * 60 * 1000);
  }
}
byId('retry').onclick = refresh;
refresh();
