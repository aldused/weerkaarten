const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'weerbewaking_pluim_export.js'), 'utf8');

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name}: functie ontbreekt`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name}: functie-einde niet gevonden`);
}

const context = { Date, Number, String, Error, Object, Array };
vm.runInNewContext([
  functionSource('verifiedRunMeta'),
  functionSource('sameRunSnapshot'),
  functionSource('boundResponseToRunMeta'),
  functionSource('completeMemberWindow'),
].join('\n'), context);

const meta = {
  last_run_initialisation_time: Date.parse('2026-08-08T06:00:00Z') / 1000,
  data_end_time: Date.parse('2026-08-08T12:00:00Z') / 1000,
  last_run_modification_time: 123,
};
const bounded = context.boundResponseToRunMeta({
  hourly: {
    time: ['2026-08-08T03:00:00Z', '2026-08-08T06:00:00Z', '2026-08-08T09:00:00Z', '2026-08-08T12:00:00Z', '2026-08-08T15:00:00Z'],
    temperature_2m: [999, 10, 20, 30, 888],
    temperature_2m_member01: [777, 11, 21, 31, 666],
  },
}, meta);
assert.deepEqual(Array.from(bounded.hourly.time), ['2026-08-08T06:00:00Z', '2026-08-08T09:00:00Z', '2026-08-08T12:00:00Z']);
assert.deepEqual(Array.from(bounded.hourly.temperature_2m), [10, 20, 30]);
assert.deepEqual(Array.from(bounded.hourly.temperature_2m_member01), [11, 21, 31]);

assert.equal(context.sameRunSnapshot(meta, { ...meta }), true);
assert.equal(context.sameRunSnapshot(meta, { ...meta, data_end_time: meta.data_end_time + 3600 }), false);
assert.equal(context.sameRunSnapshot(meta, { ...meta, last_run_modification_time: 124 }), false);

assert.throws(
  () => context.completeMemberWindow(['t0', 't1'], [Array.from({length:50}, () => [1, 2])]),
  /50 leden ontvangen, verwacht 51/,
  'de code-export mag geen statistiek op minder dan 51 leden maken',
);
const completeWindow = context.completeMemberWindow(
  ['t0', 't1', 't2', 't3'],
  [Array.from({length:51}, (_, member) => [1, 2, member === 50 ? null : 3, 4])],
);
assert.equal(completeWindow.first, 0);
assert.equal(completeWindow.lastExclusive, 2, 'de code-export moet vóór een onvolledige ingeststaart stoppen');

const rainKeys = ['precipitation', ...Array.from({length:50}, (_, index) => `precipitation_member${String(index + 1).padStart(2, '0')}`)];
const spatialContext = {
  PlumeMath: {
    ensembleMemberKeys(hourly) { return rainKeys.filter(key => Array.isArray(hourly[key])); },
    finiteNumber(value) { return value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value); },
  },
};
vm.runInNewContext(functionSource('mergeUniqueSpatialPrecipitation'), spatialContext);
const spatialResponses = [0, 1, 2].map(point => ({
  latitude: 52 + point * 0.01,
  longitude: 5,
  hourly: {
    time: ['2026-08-08T06:00:00Z', '2026-08-08T09:00:00Z'],
    ...Object.fromEntries(rainKeys.map(key => [key, [point + 1, point + 2]])),
  },
}));
spatialResponses[2].hourly.precipitation_member50[1] = null;
const spatialMerged = spatialContext.mergeUniqueSpatialPrecipitation(spatialResponses);
assert.equal(spatialMerged.hourly.precipitation[0], 2);
assert.equal(spatialMerged.hourly.precipitation_member50[1], null, 'een ruimtelijk gemiddelde mag geen ontbrekend roosterpunt negeren');
assert.throws(
  () => spatialContext.mergeUniqueSpatialPrecipitation(spatialResponses.slice(0, 2)),
  /Te weinig unieke neerslagroosterpunten/,
  'de code-export vereist minimaal drie unieke roosterpunten voor neerslag',
);

assert.match(source, /const before = await fetchRunMeta\(runContext\);[\s\S]*const value = await loader\(before\);[\s\S]*const after = await fetchRunMeta\(runContext\);/);
assert.match(source, /_weerlab_fresh', '1'/, 'code-gated export moet de proxy-edgecache omzeilen');
assert.match(source, /fetchEnsembleWithSpatialRain\(lat, lon, startIso, fetchEndIso, runMeta\)/);
assert.match(source, /fetchEndIso: verschuifIsoDatum\(endIso, 1\)/, 'laatste 18-24 UTC-neerslagvak vereist een extra brondag');
assert.match(source, /const window = completeMemberWindow\(rawTimes, requiredMatrices\)/, 'ieder exportpaneel moet een volledig 51-ledentijdvenster gebruiken');
assert.match(source, /async function withRequestedRun\(runHour, task\)/, 'code-export kan geen vaste hoofdrun afdwingen');
assert.match(source, /selector\.withRunHour\(hour, task\)/, 'code-export gebruikt de gezamenlijke runselector niet');
assert.match(source, /const needsSpatialRain = runHour == null/, 'vaste archiefrun mag niet met actuele omliggende neerslagpunten worden gemengd');
assert.match(source, /buildModels\(stable\.value, startIso, endIso, stable\.runMeta, params\)/, 'code-export bouwt ongevraagde panelen met ontbrekende archiefvelden');

const rrdk = fs.readFileSync(path.resolve(__dirname, '..', 'weerbewaking_ridderkerk_rhoon_dekuip.html'), 'utf8');
assert.match(rrdk, /const runHour=Number\(selector\.state\?\.selectedHour\)/, 'RRDK gebruikt niet de zichtbaar gekozen pluimrun');
assert.match(rrdk, /\[0,6,12,18\]\.includes\(runHour\)/, 'RRDK accepteert niet alle vier ECMWF-cycli');
assert.match(rrdk, /runHour,\s*\n\s*params:/, 'RRDK geeft de gekozen cyclus niet aan de kleurpluimexport door');
assert.doesNotMatch(rrdk, /runHour:\s*12/, 'RRDK-kleurpluimdownload staat nog hard op 12 UTC');
assert.match(rrdk, /Pluimen bij PDF · gekozen run/, 'RRDK maakt de dynamische runkeuze niet zichtbaar');

const switcher = fs.readFileSync(path.resolve(__dirname, '..', 'pluim_run_switcher_032667819e3a.js'), 'utf8');
assert.match(switcher, /async function withRunHour\(hour, task\)/, 'runselector mist een geïsoleerde exportkeuze');
assert.match(switcher, /async function createRunContext\(hour\)/, 'runselector maakt geen onveranderlijke exportcontext');
assert.doesNotMatch(switcher, /state\.selectedHour = selectedHour;[\s\S]*await task/, 'export muteert nog de zichtbare globale run');

console.log('pluim-export: één geverifieerde ENS-run, verse edge en hard runvenster');
