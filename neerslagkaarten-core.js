'use strict';

const localTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const HOUR = 3600000;
const dayparts = ['00–06', '06–12', '12–18', '18–06'];
function periodFor(date, part, hours) {
  const midnight = Date.parse(date + 'T00:00:00Z');
  function boundary(offset) {
    const nominal = midnight + offset * HOUR;
    const wall = new Date(nominal).toISOString().slice(0, 16);
    return [1, 2].map(delta => nominal - delta * HOUR)
      .find(time => localTime.format(time).replace(' ', 'T') === wall);
  }
  const start = boundary(part * 6);
  const end = boundary(part === 3 ? 30 : (part + 1) * 6);
  return {start, end, expected: (end - start) / HOUR,
    hours: hours.filter(hour => hour.start >= start && hour.end <= end)};
}
const palette = [
  [0.01, 88, 175, 235], [0.2, 32, 119, 205], [1, 38, 155, 104],
  [2, 222, 182, 27], [5, 227, 104, 35], [10, 189, 48, 76], [20, 127, 43, 156]
];

function readForecast(meta, buffer) {
  const field = meta.parameters?.neerslag;
  const grid = field?.grid;
  const run = Date.parse(meta.run_utc);
  if (!grid || !Number.isFinite(run) || !meta.run_utc.endsWith('Z') ||
      field.dtype !== 'u8sqrt' || field.components !== 1 ||
      !Number.isFinite(field.scale) || field.scale <= 0 ||
      !Number.isFinite(field.power) || field.power <= 0 ||
      !['lat', 'lon'].every(axis => Number.isInteger(grid['n_' + axis]) &&
        grid['n_' + axis] >= 2 && Number.isFinite(grid[axis + '_min']) &&
        Number.isFinite(grid[axis + '_max']) && grid[axis + '_max'] > grid[axis + '_min']) ||
      buffer.byteLength < 16) throw new Error('Ongeldige modelbestanden');
  const header = new DataView(buffer);
  const {n_lat: rows, n_lon: cols} = grid;
  const steps = header.getUint16(4, true);
  if (header.getUint16(0, true) !== rows || header.getUint16(2, true) !== cols ||
      header.getUint16(6, true) !== 1 || header.getUint8(8) !== 1 ||
      !steps || steps !== meta.uren || steps !== meta.tijden?.length ||
      buffer.byteLength !== 16 + rows * cols * steps) throw new Error('Modelbestanden komen niet overeen');

  const bytes = new Uint8Array(buffer, 16);
  const values = Float64Array.from({length: 256}, (_, code) => (code / field.scale) ** field.power);
  const hours = Array.from({length: steps}, (_, index) => {
    const start = run + index * HOUR;
    const end = start + HOUR;
    if (localTime.format(end).replace(' ', 'T') !== meta.tijden[index]) {
      throw new Error('De geldigheidstijden komen niet overeen met de modelrun');
    }
    return {index, start, end};
  });

  function cell(lat, lon) {
    const y = Math.round((lat - grid.lat_min) * (rows - 1) / (grid.lat_max - grid.lat_min));
    const x = Math.round((lon - grid.lon_min) * (cols - 1) / (grid.lon_max - grid.lon_min));
    return y >= 0 && y < rows && x >= 0 && x < cols ? y * cols + x : -1;
  }

  function coordinates(index) {
    return [
      grid.lon_min + (index % cols) * (grid.lon_max - grid.lon_min) / (cols - 1),
      grid.lat_min + Math.floor(index / cols) * (grid.lat_max - grid.lat_min) / (rows - 1)
    ];
  }

  function sum(selected, index) {
    if (index < 0 || !selected.length) return NaN;
    let amount = 0;
    for (const hour of selected) amount += values[bytes[hour.index * rows * cols + index]];
    return amount;
  }

  return {run, hours, cell, coordinates, sum};
}

if (typeof module !== 'undefined') module.exports = {readForecast, localTime, dayparts, periodFor};
