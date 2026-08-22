const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'janvisser.html'), 'utf8');
const switcher = fs.readFileSync(path.join(root, 'pluim_run_switcher_032667819e3a.js'), 'utf8');

function extractFunction(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} ontbreekt`);
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === '{') depth++;
    if (text[index] === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  throw new Error(`${name} is niet volledig`);
}

assert.match(source, /data-required="temperature_2m,precipitation,cloud_cover"/,
  'Jan Visser maakt de vereiste archiefvelden niet hard');
assert.match(source, /&run=\$\{encodeURIComponent\(run\.toISOString\(\)\.slice\(0,16\)\)\}/,
  'operationele HRES gebruikt geen expliciete ECMWF-run');
assert.match(source, /ensData\.weerlab_hres/,
  'de exact uitgelijnde HRES uit het runarchief wordt niet gebruikt');
assert.match(source, /const PANEL_IDS = \['chart-n-t', 'chart-n-p', 'chart-t', 'chart-p', 'chart-p-op', 'chart-cl'\]/,
  'de zes Jan Visser-panelen vormen geen vaste atomaire set');
assert.match(source, /clearAllPanels\(`Geen pluim getoond:/,
  'een paneelfout kan nog een gedeeltelijke pluim laten staan');
assert.doesNotMatch(source, /\/6 grafieken geladen/,
  'de Jan Visser-pluim rapporteert nog een gedeeltelijk geslaagde set');
assert.doesNotMatch(source, /bin\.idxs\.length < (?:4|10)/,
  'native 3-uursdata wordt nog door een oude uurdrempel afgekeurd');
assert.doesNotMatch(
  switcher,
  /find\(item => item\.run === state\.selectedRun\.run\) \|\| newestForHour/,
  'een ontbrekende exacte plaatsrun valt nog terug op een andere datum',
);

const context = { Date, Map, Math, Number, Array, isFinite };
vm.runInNewContext([
  extractFunction(source, 'isoMinute'),
  extractFunction(source, 'alignExactValues'),
  extractFunction(source, 'alignPrecipIntervals'),
  extractFunction(source, 'compute6hEnsMinMax'),
  extractFunction(source, 'compute12hEnsPrecipMean'),
  extractFunction(source, 'compute12hPrecip'),
].join('\n'), context);

const sourceTimes = Array.from({ length: 7 }, (_, hour) =>
  `2026-08-08T${String(hour).padStart(2, '0')}:00`);
const targetTimes = ['2026-08-08T00:00', '2026-08-08T03:00', '2026-08-08T06:00'];
assert.deepEqual(
  Array.from(context.alignExactValues(sourceTimes, [10, 11, 12, 13, 14, 15, 16], targetTimes)),
  [10, 13, 16],
  'uurlijkse HRES-temperatuur is niet op echte ENS-timestamps uitgelijnd',
);
assert.deepEqual(
  Array.from(context.alignPrecipIntervals(sourceTimes, [0, 1, 2, 3, 4, 5, 6], targetTimes)),
  [0, 6, 15],
  'tussenliggende uurlijkse HRES-neerslag wordt niet in native ENS-vakken opgeteld',
);

const nativeTimes = [0, 3, 6, 9, 12, 15, 18, 21, 24].map(offset =>
  new Date(Date.UTC(2026, 7, 8) + offset * 3600_000).toISOString().slice(0, 16));
const hourly = { time: nativeTimes };
for (let member = 0; member < 51; member++) {
  const suffix = member === 0 ? '' : `_member${String(member).padStart(2, '0')}`;
  hourly[`temperature_2m${suffix}`] = nativeTimes.map((_, index) => member + index);
  hourly[`precipitation${suffix}`] = [0, 1, 1, 1, 5, 2, 2, 2, 4];
}
const temp = context.compute6hEnsMinMax({ hourly });
assert.ok(temp.series.length >= 4, '3-uurlijkse ENS-data levert geen 6-uursvakken');
assert.equal(temp.series[0].t.toISOString(), '2026-08-08T06:00:00.000Z');

const rain = context.compute12hEnsPrecipMean({ hourly });
assert.equal(rain[0].start.toISOString(), '2026-08-08T00:00:00.000Z');
assert.equal(rain[0].sum, 8, '12Z-neerslag hoort bij het voorafgaande vak 00–12 UTC');
assert.equal(rain[1].start.toISOString(), '2026-08-08T12:00:00.000Z');
assert.equal(rain[1].sum, 10, '00Z-neerslag hoort bij het voorafgaande vak 12–24 UTC');

const hresRain = context.compute12hPrecip({ time: nativeTimes, precipitation: hourly.precipitation }, 'precipitation');
assert.deepEqual(Array.from(hresRain, bin => bin.sum), [8, 10],
  'operationele neerslag gebruikt niet dezelfde correcte 12-uursgrenzen');

console.log('Jan Visser: exacte run, native intervallen en HRES-uitlijning zijn geborgd');
