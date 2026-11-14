'use strict';

const localTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const HOUR = 3600000;
const dayparts = ['Nacht', 'Ochtend', 'Middag', 'Avond'];
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
  const periods = new Map();
  const hours = Array.from({length: steps}, (_, index) => {
    const start = run + index * HOUR;
    const end = start + HOUR;
    if (localTime.format(end).replace(' ', 'T') !== meta.tijden[index]) {
      throw new Error('De geldigheidstijden komen niet overeen met de modelrun');
    }
    const [date, time] = localTime.format(start).split(' ');
    const part = Math.floor(Number(time.slice(0, 2)) / 6);
    const key = date + '/' + part;
    if (!periods.has(key)) periods.set(key, {key, date, part, hours: []});
    const hour = {index, start, end};
    periods.get(key).hours.push(hour);
    return hour;
  });

  function cell(lat, lon) {
    const y = Math.round((lat - grid.lat_min) * (rows - 1) / (grid.lat_max - grid.lat_min));
    const x = Math.round((lon - grid.lon_min) * (cols - 1) / (grid.lon_max - grid.lon_min));
    return y >= 0 && y < rows && x >= 0 && x < cols ? y * cols + x : -1;
  }

  function rate(selected, index) {
    if (index < 0 || !selected.length) return NaN;
    let amount = 0;
    for (const hour of selected) amount += values[bytes[hour.index * rows * cols + index]];
    return amount / selected.length;
  }

  return {run, hours, periods, cell, rate};
}

if (typeof module !== 'undefined') module.exports = {readForecast, localTime, dayparts};
