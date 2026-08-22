const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'pluim_6_plus.html'), 'utf8');

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} ontbreekt`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} is niet volledig`);
}

assert.match(source, /pluim_run_switcher_032667819e3a\.js/);
assert.match(
  source,
  /data-required="cloud_cover,wind_direction_10m"/,
  '6+ moet alle vier cycli op de twee early-kernvelden kunnen openen',
);
assert.doesNotMatch(
  source.match(/data-required="([^"]+)"/)?.[1] || '',
  /cape/,
  'CAPE mag een early run niet als geheel blokkeren',
);
assert.doesNotMatch(
  source,
  /data-required="[^"]*temperature_(?:850|500)hPa/,
  'optionele drukvlakpanelen blokkeren nog de directe 00/06/12/18-runs',
);
assert.doesNotMatch(source, /Hoofdpluim/,
  '06/18-tussenruns worden nog ten onrechte als hoofdpluim aangeduid');
assert.match(source, /ENS-pluim/,
  '6+ benoemt de gekozen 00/06/12/18-cyclus niet als ENS-pluim');
assert.match(source, /single-runs-api\.open-meteo\.com\/v1\/forecast/);
assert.match(source, /&models=ecmwf_ifs&run=\$\{encodeURIComponent\(runInitialization\)\}/,
  'Single Runs HRES is niet op de gekozen timestamp vastgezet');
assert.match(source, /start_hour=\$\{encodeURIComponent\(startHour\)\}&end_hour=\$\{encodeURIComponent\(endHour\)\}/,
  'ENS wordt niet op het exacte runvenster aangevraagd');
assert.match(functionSource('fetchCycleMatchedData'), /sameRunMeta\(runMeta, metaAfter\)/,
  'metadata vóór en na de databatch wordt niet volledig vergeleken');

const context = {
  Date, Number, Object, Array, Set, Map,
  console: { warn() {} },
  WeerlabPlumeMath: { markUtcTimes: value => value },
};
vm.runInNewContext([
  functionSource('verifiedRunMeta'),
  functionSource('verifiedRunStartFromMeta'),
  functionSource('runMetaSentinel'),
  functionSource('sameRunMeta'),
  functionSource('trimHourlyToRunWindow'),
  functionSource('mergeOptionalEnsembleFields'),
  functionSource('fillNaN'),
  functionSource('membersOf'),
  functionSource('boundedMembersOf'),
  functionSource('trimTrailingMissing'),
  functionSource('requireMemberMatrix'),
  functionSource('exactEnsembleMembers'),
  functionSource('exactCommonEnsemble'),
  functionSource('optionalMemberMatrix'),
  functionSource('alignHresSeries'),
].join('\n'), context);

const startMs = Date.parse('2026-08-09T06:00:00Z');
const endMs = Date.parse('2026-08-09T15:00:00Z');
const meta = {
  last_run_initialisation_time: startMs / 1000,
  data_end_time: endMs / 1000,
  last_run_modification_time: 123,
};
assert.equal(context.verifiedRunMeta(meta).last_run_initialisation_time, startMs / 1000);
assert.throws(() => context.verifiedRunMeta({
  ...meta,
  last_run_initialisation_time: Date.parse('2026-08-09T07:00:00Z') / 1000,
}), /ongeldige cyclus/);
assert.equal(context.sameRunMeta(meta, { ...meta }), true);
assert.equal(context.sameRunMeta(meta, { ...meta, data_end_time: endMs / 1000 + 3600 }), false);

const inclusive = context.trimHourlyToRunWindow({ hourly: {
  time: ['2026-08-09T06:00:00Z', '2026-08-09T09:00:00Z', '2026-08-09T12:00:00Z', '2026-08-09T15:00:00Z'],
  cape: [1, 2, 3, 4],
} }, meta, 'ENS');
assert.equal(inclusive.hourly.time.length, 4, 'inclusieve data_end-stap valt weg');

const exclusive = context.trimHourlyToRunWindow({ hourly: {
  time: ['2026-08-09T06:00:00Z', '2026-08-09T09:00:00Z', '2026-08-09T12:00:00Z', '2026-08-09T15:00:00Z'],
  cape: [1, 2, 3],
} }, meta, 'ENS');
assert.equal(exclusive.hourly.time.length, 3, 'exclusieve data_end-grens wordt niet herkend');
assert.throws(() => context.trimHourlyToRunWindow({ hourly: {
  time: ['2026-08-09T06:00:00Z', '2026-08-09T09:00:00Z', '2026-08-09T12:00:00Z'],
  cape: [1, 2, 3],
} }, meta, 'ENS'), /dekt niet exact/);

const times = inclusive.hourly.time;
const hourly = { time: times };
for (const key of ['cloudcover', 'cape']) {
  hourly[key] = [1, 2, 3, 4];
  for (let member = 1; member <= 50; member++) {
    hourly[`${key}_member${String(member).padStart(2, '0')}`] = [member, member + 1, member + 2, member + 3];
  }
}
assert.equal(context.exactCommonEnsemble(hourly, ['cloudcover', 'cape']).cape.length, 51);
const missing = structuredClone(hourly);
delete missing.cape_member50;
assert.throws(() => context.exactCommonEnsemble(missing, ['cloudcover', 'cape']), /exact dezelfde 51/);
const incomplete = structuredClone(hourly);
incomplete.cloudcover_member17[2] = null;
assert.throws(() => context.exactCommonEnsemble(incomplete, ['cloudcover', 'cape']), /ieder tijdstip volledig/);

const pressureHourly = { time: times.slice() };
for (const key of ['temperature_850hPa', 'temperature_500hPa']) {
  pressureHourly[key] = [1, 2, 3, 4];
  for (let member = 1; member <= 50; member++) {
    pressureHourly[`${key}_member${String(member).padStart(2, '0')}`] = [member, member + 1, member + 2, member + 3];
  }
}
assert.equal(
  context.optionalMemberMatrix(pressureHourly, 'temperature_850hPa', 0, 4, new Set()).length,
  51,
  'een volledige drukvlakset moet het vijfde paneel activeren',
);
assert.equal(
  context.optionalMemberMatrix(
    pressureHourly, 'temperature_500hPa', 0, 4, new Set(['temperature_500hPa']),
  ),
  null,
  'een expliciet ontbrekend drukvlakveld mag geen null-statistieken produceren',
);
const partialPressure = structuredClone(pressureHourly);
partialPressure.temperature_850hPa_member17[2] = null;
assert.equal(
  context.optionalMemberMatrix(partialPressure, 'temperature_850hPa', 0, 4, new Set()),
  null,
  'een gedeeltelijk drukvlakveld moet als geheel worden weggelaten',
);
const allNullCape = structuredClone(hourly);
for (const key of Object.keys(allNullCape)) {
  if (key === 'cape' || key.startsWith('cape_member')) allNullCape[key] = allNullCape[key].map(() => null);
}
assert.equal(
  context.optionalMemberMatrix(allNullCape, 'cape', 0, 4, new Set()),
  null,
  '51 volledig-null CAPE-reeksen mogen geen leeg onweerpaneel of nulpluim vormen',
);

const coreDocument = { hourly: { time: times.slice(), cape: [1, 2, 3, 4] } };
const mergedWithoutPressure = context.mergeOptionalEnsembleFields(
  coreDocument, null, 'temperature_850hPa,temperature_500hPa', meta,
);
assert.deepEqual(
  Array.from(mergedWithoutPressure.weerlab_unavailable_variables),
  ['temperature_850hPa', 'temperature_500hPa'],
  'een mislukte optionele API-call mag de core-respons niet verliezen',
);
const mergedWrongRun = context.mergeOptionalEnsembleFields(coreDocument, {
  weerlab_run: '2026-08-09T00:00:00Z',
  hourly: pressureHourly,
}, 'temperature_850hPa,temperature_500hPa', meta);
assert.equal(mergedWrongRun.hourly.temperature_850hPa, undefined,
  'drukvlakvelden uit een andere initialisatie mogen niet worden gemengd');

const targetTimes = times.map(value => new Date(value));
const hresTimes = [
  new Date('2026-08-09T06:00:00Z'),
  new Date('2026-08-09T07:00:00Z'),
  new Date('2026-08-09T09:00:00Z'),
  new Date('2026-08-09T12:00:00Z'),
  new Date('2026-08-09T15:00:00Z'),
];
assert.deepEqual(
  Array.from(context.alignHresSeries(targetTimes, hresTimes, [10, 999, 20, 30, 40], 'test')),
  [10, 20, 30, 40],
  'HRES wordt per index in plaats van per timestamp gekoppeld',
);
assert.throws(
  () => context.alignHresSeries(
    targetTimes,
    [hresTimes[0], hresTimes[1], hresTimes[3], hresTimes[4]],
    [10, 999, 30, 40],
    'test',
  ),
  /mist een ENS-tijdstip/,
  'een intern ontbrekend HRES-tijdstip wordt niet afgekeurd',
);
assert.deepEqual(
  Array.from(context.alignHresSeries(targetTimes, hresTimes, [10, 999, 20, 30, null], 'test')),
  [10, 20, 30, null],
  'een legitiem kortere HRES-staart blokkeert de complete ENS-run',
);
assert.deepEqual(
  Array.from(context.alignHresSeries(targetTimes, hresTimes, [null, null, null, null, null], 'drukvlak', false)),
  [null, null, null, null],
  'een niet beschikbare optionele drukvlak-HRES valt nog terug op een andere run',
);

Object.assign(context, {
  DAY_MS: 24 * 60 * 60 * 1000,
  DAGEN_LANG: ['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'],
  MAANDEN_LANG: ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'],
  currentStation: { name: 'De Bilt' },
  CLOUD_CATS: [
    {label:'Onbewolkt',lo:0,hi:12,color:'#1'},
    {label:'Bewolkt',lo:12,hi:101,color:'#2'},
  ],
  WINDDIR_SECTORS: ['N','NO','O','ZO','Z','ZW','W','NW'],
  WINDDIR_COLORS: {N:'#1',NO:'#2',O:'#3',ZO:'#4',Z:'#5',ZW:'#6',W:'#7',NW:'#8'},
});
vm.runInNewContext([
  functionSource('addLegacyFieldAliases'),
  functionSource('percentile'),
  functionSource('rangeOf'),
  functionSource('pad'),
  functionSource('cloudStackSeries'),
  functionSource('windDirStackSeries'),
  functionSource('cutoffLengthForDataEnd'),
  functionSource('buildModel'),
].join('\n'), context);

function memberField(values) {
  const result = { values: values.slice() };
  for (let member = 1; member <= 50; member++) {
    result[`values_member${String(member).padStart(2, '0')}`] = values.map(
      value => value == null ? null : value + member / 100,
    );
  }
  return result;
}
function addMemberField(hourlyTarget, key, values) {
  const fields = memberField(values);
  hourlyTarget[key] = fields.values;
  for (let member = 1; member <= 50; member++) {
    const suffix = `_member${String(member).padStart(2, '0')}`;
    hourlyTarget[key + suffix] = fields[`values${suffix}`];
  }
}
const coreOnlyHourly = { time: times.slice() };
addMemberField(coreOnlyHourly, 'cloudcover', [20, 40, 60, 80]);
addMemberField(coreOnlyHourly, 'winddirection_10m', [0, 90, 180, 270]);
addMemberField(coreOnlyHourly, 'cape', [0, 100, 300, 800]);
addMemberField(coreOnlyHourly, 'temperature_850hPa', [null, null, null, null]);
addMemberField(coreOnlyHourly, 'temperature_500hPa', [null, null, null, null]);
const fourPanelModel = context.buildModel({
  weerlab_run: '2026-08-09T06:00:00Z',
  weerlab_unavailable_variables: ['temperature_850hPa', 'temperature_500hPa'],
  hourly: structuredClone(coreOnlyHourly),
}, null, startMs, endMs);
assert.equal(fourPanelModel.panels.length, 4, 'een directe core-run moet eerlijk vier panelen tonen');
assert.equal(fourPanelModel.hasHres, false, 'ontbrekende Single Runs-HRES wordt nog als overlay aangekondigd');
assert.match(fourPanelModel.panelStatus, /4 van 6 panelen/);

const earlyHourly = structuredClone(coreOnlyHourly);
for (const key of Object.keys(earlyHourly)) {
  if (key === 'cape' || key.startsWith('cape_member')) earlyHourly[key] = earlyHourly[key].map(() => null);
}
const earlyModel = context.buildModel({
  weerlab_run: '2026-08-09T06:00:00Z',
  weerlab_unavailable_variables: ['cape', 'temperature_850hPa', 'temperature_500hPa'],
  hourly: earlyHourly,
}, null, startMs, endMs);
assert.equal(earlyModel.panels.length, 3,
  'de early run moet bewolking en windrichting tonen zonder een fictief CAPE-paneel');
assert.match(earlyModel.panelStatus, /CAPE\/onweer.*tijdelijk niet beschikbaar/);

const fullHourly = structuredClone(coreOnlyHourly);
addMemberField(fullHourly, 'temperature_850hPa', [5, 4, 3, 2]);
addMemberField(fullHourly, 'temperature_500hPa', [-20, -21, -22, -23]);
const sixPanelModel = context.buildModel({
  weerlab_run: '2026-08-09T06:00:00Z',
  hourly: fullHourly,
}, null, startMs, endMs);
assert.equal(sixPanelModel.panels.length, 6, 'een volledig verrijkte run moet alle zes panelen tonen');
assert.equal(sixPanelModel.panelStatus, '6 van 6 panelen');

const buildModel = functionSource('buildModel');
assert.match(buildModel, /exactCommonEnsemble\(hourly, requiredVariables\)/);
assert.match(buildModel, /N !== times\.length/);
assert.match(buildModel, /const requiredVariables = \['cloudcover', 'winddirection_10m'\]/);
assert.match(buildModel, /const optionalVariables = \['cape', 'temperature_850hPa', 'temperature_500hPa'\]/);
assert.match(buildModel, /optionalAlignHres/);
assert.match(buildModel, /if \(capeP\)[\s\S]*panels\.push/);
assert.match(buildModel, /if \(t850P\)[\s\S]*panels\.push/);
assert.match(buildModel, /if \(t500P\)[\s\S]*panels\.push/);
assert.match(buildModel, /panels\.length === 6[\s\S]*6 van 6 panelen/);
assert.doesNotMatch(buildModel, /find\([^)]*run|\|\|\s*runs\[0\]/,
  'buildModel bevat nog een runfallback');
assert.match(
  functionSource('fetchCycleMatchedData'),
  /fetchHres\([^;]+\.catch\(error =>/s,
  'een ontbrekende exacte Single Runs-overlay mag de ENS-run niet blokkeren',
);
assert.match(
  functionSource('fetchCycleMatchedData'),
  /SIX_PLUS_OPTIONAL_VARIABLES,[\s\S]*\.catch\(error =>/,
  'een fout in de optionele ENS-drukvlakcall mag de core-call niet blokkeren',
);

const inlineScripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[1]));
inlineScripts.forEach((match, index) => {
  assert.doesNotThrow(() => Function(match[2]), `inline script ${index + 1} parseert niet`);
});

console.log('6 pluim+: volledige 51-ledenset en exacte 00/06/12/18 ENS/HRES-run geborgd');
