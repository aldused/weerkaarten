const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function functionSource(source, name) {
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

const sixPlus = fs.readFileSync(path.join(root, 'pluim_6_plus.html'), 'utf8');
const sixContext = { console: { warn() {} } };
vm.runInNewContext([
  functionSource(sixPlus, 'membersOf'),
  functionSource(sixPlus, 'fillNaN'),
  functionSource(sixPlus, 'boundedMembersOf'),
  functionSource(sixPlus, 'trimTrailingMissing'),
  functionSource(sixPlus, 'requireMemberMatrix'),
  functionSource(sixPlus, 'exactEnsembleMembers'),
  functionSource(sixPlus, 'optionalMemberMatrix'),
  functionSource(sixPlus, 'rangeOf'),
  functionSource(sixPlus, 'cutoffLengthForDataEnd'),
].join('\n'), sixContext);

assert.deepEqual(
  Array.from(sixContext.trimTrailingMissing([[null, null], [Number.NaN, undefined]])),
  [],
  'een volledig lege membermatrix moet naar een lege matrix trimmen',
);
assert.deepEqual(
  Array.from(sixContext.trimTrailingMissing([[1, 2, null], [3, null, null]]), row => Array.from(row)),
  [[1, 2], [3, null]],
  'alleen gezamenlijk ontbrekende staartwaarden mogen verdwijnen',
);
assert.throws(
  () => sixContext.requireMemberMatrix([], 'bewolkings'),
  /Geen geldige bewolkingsensembledata beschikbaar: 0 van 51 leden in deze modelrun\./,
  'buildModel moet een duidelijke Nederlandse datamelding kunnen geven',
);
assert.throws(
  () => sixContext.requireMemberMatrix(Array.from({length:50}, () => [1]), 'bewolkings'),
  /50 van 51 leden/,
  'een onvolledige ENS-set mag niet als 51-ledige pluim worden getoond',
);
assert.deepEqual(
  Array.from(sixContext.rangeOf([[null, Number.NaN]], [undefined])),
  [0, 1],
  'een leeg bereik mag geen Infinity of NaN opleveren',
);
assert.deepEqual(
  Array.from(sixContext.rangeOf([[4, -2, null]], [9])),
  [-2, 9],
  'een geldig bereik moet behouden blijven',
);
assert.equal(
  sixContext.cutoffLengthForDataEnd(
    ['2026-08-08T00:00:00Z', '2026-08-08T03:00:00Z', '2026-08-08T06:00:00Z', '2026-08-08T09:00:00Z'],
    Date.parse('2026-08-08T06:00:00Z'),
  ),
  3,
  'tijdstappen na metadata.data_end_time moeten hard worden afgesneden',
);
assert.deepEqual(
  Array.from(
    sixContext.boundedMembersOf(
      {cloudcover:[999, 10, 20, 30, 999], cloudcover_member01:[999, 11, 21, 31, 999]},
      'cloudcover',
      1,
      3,
    ),
    row => Array.from(row),
  ),
  [[10, 20, 30], [11, 21, 31]],
  'waarden vóór de runinitialisatie en na de cutoff mogen geen enkele ENS-reeks bereiken',
);
assert.match(sixPlus, /series\.slice\(startIndex, startIndex \+ cutoffLength\)/, 'alle ENS-memberreeksen moeten hetzelfde metadata-runvenster krijgen');
assert.match(sixPlus, /rawTimes\.findIndex\(time => time\.getTime\(\) >= verifiedRunStartMs\)/, 'tijdstappen vóór last_run_initialisation_time moeten worden verwijderd');
assert.match(sixPlus, /const alignHres = arr => useTimes\.map\(/, 'HRES moet exact dezelfde afgekapte targettijdas gebruiken');
assert.match(sixPlus, /requireMemberMatrix\(trimTrailingMissing\(boundedMembersOf\(hourly, 'cloudcover', startIndex, cutoffLength\)/);
assert.match(
  sixPlus,
  /const t500Members = optionalMemberMatrix\([\s\S]*optionalVariables\[2\]/,
  '500 hPa moet een geheel optioneel paneel zijn en mag de kernpluim niet blokkeren',
);
assert.match(
  sixPlus,
  /verifiedRunStartFromMeta\(runMeta\),\s*verifiedDataEndFromMeta\(runMeta\)/,
  'buildModel moet uitsluitend het geverifieerde metadata-runvenster gebruiken',
);
assert.match(sixPlus, /tussenrun .*actuele dekking .*kan korter zijn/, '06/18-tussenruns moeten hun kortere dekking transparant melden');
assert.doesNotMatch(sixPlus, /Control 9 km|control 9 km apart/);
assert.match(sixPlus, /HRES 9 km/);
const fetchHresSource = functionSource(sixPlus, 'fetchHres');
assert.match(
  fetchHresSource,
  /https:\/\/single-runs-api\.open-meteo\.com\/v1\/forecast/,
  '6+ moet de aparte HRES uit de Single Runs API halen',
);
assert.match(
  fetchHresSource,
  /run=\$\{encodeURIComponent\(runInitialization\)\}/,
  '6+ moet HRES expliciet op dezelfde initialisatiecyclus vastzetten',
);
assert.doesNotMatch(
  fetchHresSource,
  /https:\/\/api\.open-meteo\.com\/v1\/forecast/,
  'de seamless forecast-API mag niet als HRES worden gebruikt',
);
assert.doesNotMatch(
  sixPlus,
  /['"]https:\/\/api\.open-meteo\.com\/v1\/forecast/,
  '6+ mag nergens meer een seamless forecast als deterministische HRES-bron aanbieden',
);
assert.match(
  sixPlus,
  /Number\(metaAfter\?\.last_run_initialisation_time\) === Number\(runMeta\.last_run_initialisation_time\)/,
  'een ENS-cycluswissel tijdens het laden moet worden gedetecteerd',
);
assert.match(
  sixPlus,
  /fetchEnsemble\(lat, lon, runMeta, retryFresh, true, SIX_PLUS_CORE_VARIABLES\)/,
  'de niet-selecteerbare ENS-core-endpoint moet zonder oude browser- of edgecache worden opgehaald',
);
const fetchSixEnsembleSource = functionSource(sixPlus, 'fetchEnsemble');
assert.match(fetchSixEnsembleSource, /start_date=\$\{startDate\}&end_date=\$\{endDate\}/, '6+ moet ook na middernacht vanaf de echte runstart ophalen');
assert.doesNotMatch(fetchSixEnsembleSource, /forecast_days=/, 'forecast_days snijdt een run van de vorige UTC-dag af');

const watchPlume = fs.readFileSync(path.join(root, 'weerbewaking_pluim.html'), 'utf8');
const watchContext = {
  console: { warn() {} },
  PLUME_MATH: {
    markUtcTimes: value => value,
    perturbedMemberKeys(hourly, key) {
      return Object.keys(hourly).filter(name => name.startsWith(`${key}_member`)).sort();
    },
    ensembleMemberKeys(hourly, key) {
      return [key, ...this.perturbedMemberKeys(hourly, key)].filter(name => Array.isArray(hourly[name]));
    },
  },
};
vm.runInNewContext([
  functionSource(watchPlume, 'verifiedRunMeta'),
  functionSource(watchPlume, 'runMetaSentinel'),
  functionSource(watchPlume, 'sameRunMeta'),
  functionSource(watchPlume, 'runDateBoundsFromMeta'),
  functionSource(watchPlume, 'trimHourlyToRunWindow'),
  functionSource(watchPlume, 'completeMemberWindow'),
  functionSource(watchPlume, 'fillNaN'),
  functionSource(watchPlume, 'ensembleVariable'),
  functionSource(watchPlume, 'optionalEnsembleVariable'),
].join('\n'), watchContext);

assert.doesNotMatch(watchPlume.match(/data-required="([^"]+)"/)?.[1] || '', /cape/,
  'CAPE mag de primaire live 6-luik-run niet blokkeren');
assert.match(watchPlume, /Geen nulwaarden of gegevens uit een andere cyclus ingevuld/);
const watchNullCape = { time: ['2026-08-08T06:00:00Z', '2026-08-08T09:00:00Z'] };
watchNullCape.cape = [null, null];
for (let member = 1; member <= 50; member++) {
  watchNullCape[`cape_member${String(member).padStart(2, '0')}`] = [null, null];
}
assert.equal(watchContext.optionalEnsembleVariable(watchNullCape, 'cape', new Set()), null,
  'de primaire 6-luikroute mag 51 null-CAPE-reeksen niet als nulpluim tekenen');

const watchRunStart = Date.parse('2026-08-08T06:00:00Z');
const watchRunEnd = Date.parse('2026-08-08T12:00:00Z');
const watchMeta = {
  last_run_initialisation_time: watchRunStart / 1000,
  data_end_time: watchRunEnd / 1000,
  last_run_modification_time: 123,
};
const midnightBounds = watchContext.runDateBoundsFromMeta({
  last_run_initialisation_time: Date.parse('2026-08-08T12:00:00Z') / 1000,
  data_end_time: Date.parse('2026-08-23T15:00:00Z') / 1000,
});
assert.equal(midnightBounds.startDate, '2026-08-08');
assert.equal(midnightBounds.endDate, '2026-08-23');
assert.equal(midnightBounds.startHour, '2026-08-08T12:00');
assert.equal(midnightBounds.endHour, '2026-08-23T15:00');
const watchBounded = watchContext.trimHourlyToRunWindow({
  hourly: {
    time: [
      '2026-08-08T03:00:00Z',
      '2026-08-08T06:00:00Z',
      '2026-08-08T09:00:00Z',
      '2026-08-08T12:00:00Z',
      '2026-08-08T15:00:00Z',
    ],
    temperature_2m: [999, 10, 20, 30, 888],
    temperature_2m_member01: [777, 11, 21, 31, 666],
  },
}, watchMeta, 'Test');
assert.deepEqual(
  Array.from(watchBounded.hourly.time),
  ['2026-08-08T06:00:00Z', '2026-08-08T09:00:00Z', '2026-08-08T12:00:00Z'],
  'weerbewaking-hoofdpluim moet prefix en stitched staart hard buiten het metavenster houden',
);
assert.deepEqual(Array.from(watchBounded.hourly.temperature_2m), [10, 20, 30]);
assert.deepEqual(Array.from(watchBounded.hourly.temperature_2m_member01), [11, 21, 31]);
const exclusiveBoundary = watchContext.trimHourlyToRunWindow({
  hourly: {
    time: [
      '2026-08-08T06:00:00Z',
      '2026-08-08T09:00:00Z',
      '2026-08-08T12:00:00Z',
      '2026-08-08T15:00:00Z',
    ],
    temperature_2m: [10, 20, 30],
    temperature_2m_member01: [11, 21, 31],
  },
}, {
  ...watchMeta,
  data_end_time: Date.parse('2026-08-08T15:00:00Z') / 1000,
}, 'Test');
assert.deepEqual(
  Array.from(exclusiveBoundary.hourly.time),
  ['2026-08-08T06:00:00Z', '2026-08-08T09:00:00Z', '2026-08-08T12:00:00Z'],
  'een exclusieve Open-Meteo-eindgrens moet geldig blijven zonder lege extra waarde',
);
assert.throws(
  () => watchContext.trimHourlyToRunWindow({
    hourly: {
      time: ['2026-08-08T06:00:00Z', '2026-08-08T09:00:00Z'],
      temperature_2m: [10, 20],
    },
  }, watchMeta, 'Test'),
  /dekt niet exact/,
  'een respons zonder het officiële data_end_time mag niet als complete run worden gelabeld',
);
const shorterHres = watchContext.trimHourlyToRunWindow({
  hourly: {
    time: ['2026-08-08T06:00:00Z', '2026-08-08T09:00:00Z'],
    temperature_2m: [10, 20],
  },
}, watchMeta, 'HRES', false);
assert.deepEqual(
  Array.from(shorterHres.hourly.time),
  ['2026-08-08T06:00:00Z', '2026-08-08T09:00:00Z'],
  'de exacte HRES mag na zijn eigen 10-daagse horizon stoppen terwijl ENS 15 dagen doorloopt',
);
assert.equal(
  watchContext.sameRunMeta(watchMeta, { ...watchMeta, last_run_modification_time: 124 }),
  false,
  'ook een metadatawijziging binnen dezelfde initialisatie moet de batch afkeuren',
);
const watchComplete = watchContext.completeMemberWindow(
  ['t0', 't1', 't2', 't3'],
  [Array.from({length:51}, (_, member) => [1, 2, member === 50 ? null : 3, 4])],
);
assert.equal(watchComplete.first, 0);
assert.equal(watchComplete.lastExclusive, 2, 'de hoofdpluim moet vóór de eerste onvolledige 51-ledentijdstap stoppen');
assert.match(
  functionSource(watchPlume, 'buildModel'),
  /completeMemberWindow\(times, Object\.values\(raw\)\.filter\(Boolean\)\.map\(variable => variable\.statistics\)\)/,
  'alle voor de gekozen archiefrun beschikbare hoofdpanelen moeten hetzelfde volledig gevulde 51-ledentijdvenster gebruiken',
);
assert.match(functionSource(watchPlume, 'buildModel'), /weerlab_unavailable_variables/, 'oudere archiefruns moeten ontbrekende nieuwe panelen expliciet herkennen');

const watchFetchHres = functionSource(watchPlume, 'fetchHres');
const watchFetchEnsemble = functionSource(watchPlume, 'fetchEnsemble');
assert.match(watchFetchEnsemble, /start_hour=\$\{encodeURIComponent\(startHour\)\}&end_hour=\$\{encodeURIComponent\(endHour\)\}/, 'ENS-aanvraag moet de exacte UTC-runuren uit metadata gebruiken');
assert.doesNotMatch(watchFetchEnsemble, /forecast_days=/, 'ENS-aanvraag mag na middernacht niet vanzelf op vandaag beginnen');
assert.doesNotMatch(watchFetchEnsemble, /throw new Error\("Ensemble " \+ e\.message\)/, 'de foutmelding mag Ensemble niet dubbel tonen');
assert.match(watchFetchHres, /https:\/\/single-runs-api\.open-meteo\.com\/v1\/forecast/);
assert.match(watchFetchHres, /run=\$\{encodeURIComponent\(runInitialization\)\}/);
assert.doesNotMatch(watchFetchHres, /https:\/\/api\.open-meteo\.com\/v1\/forecast/);
assert.match(watchFetchHres, /fetchJson\(url, 45000, 3, force, true, `hres:\$\{sentinel\}`\)/, 'exacte HRES moet tijdens ingest browsercachevrij worden geladen');
assert.match(watchFetchHres, /trimHourlyToRunWindow\([^;]+, 'HRES', false\)/, 'HRES moet zijn eigen kortere horizon mogen behouden');
assert.match(
  functionSource(watchPlume, 'fetchEnsemble'),
  /fetchJson\(url, 30000, 3, force, force, `ens:\$\{sentinel\}`\)/,
  'de exacte run-URL mag alleen bij expliciet vernieuwen de proxy-edge omzeilen',
);
assert.match(watchPlume, /loadAndRender\(false\);/, 'de eerste opening mag de rungebonden edgecache niet omzeilen');
assert.match(
  functionSource(watchPlume, 'fetchCoherentPlumeBatch'),
  /const metaBefore = await fetchRunMeta\(\);[\s\S]*const metaAfter = await fetchRunMeta\(\);[\s\S]*sameRunMeta\(metaBefore, metaAfter\)/,
  'de volledige ENS/HRES-batch moet tussen twee identieke officiële metadata-sentinels vallen',
);
assert.match(functionSource(watchPlume, 'runMetaTeksten'), /runLabel: fmtRun\(init\)/, 'het zichtbare runlabel moet rechtstreeks uit de officiële initialisatietijd komen');
assert.match(functionSource(watchPlume, 'runMetaTeksten'), /één-run-dekking \$\{coverageHours\} uur t\/m/, 'de actuele geverifieerde dekking moet zichtbaar zijn');
assert.doesNotMatch(watchPlume, /beschikbareHoofdRun|Hoofdpluim/, 'de actieve hoofdpluim mag geen run uit de klok gokken');
assert.match(watchPlume, /PLUME_MATH\.aggregatePrecedingHours\(useTimes, rain\.statistics, 6, \{ keepInitialZero:false \}\)/);
assert.match(watchPlume, /const thresholds = \[0, 1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118\]/);

const colorPlume = fs.readFileSync(path.join(root, 'kleurpluim.html'), 'utf8');
const colorContext = {
  WeerlabPlumeMath: {
    ensembleMemberKeys(hourly, base) { return hourly[base] || []; },
  },
};
vm.runInNewContext([
  functionSource(colorPlume, 'verifiedEnsRunMeta'),
  functionSource(colorPlume, 'ensMetaSentinel'),
  functionSource(colorPlume, 'requireEnsembleMemberKeys'),
  functionSource(colorPlume, 'completeMemberWindow'),
].join('\n'), colorContext);
const colorMeta = {
  last_run_initialisation_time: watchMeta.last_run_initialisation_time,
  data_end_time: watchMeta.data_end_time,
  last_run_modification_time: 123,
};
assert.notEqual(
  colorContext.ensMetaSentinel(colorMeta),
  colorContext.ensMetaSentinel({ ...colorMeta, last_run_modification_time: 124 }),
  'een modification-only update moet ook de kleurpluimcache vernieuwen',
);
assert.throws(
  () => colorContext.requireEnsembleMemberKeys({ precipitation: Array(50).fill('lid') }, 'precipitation'),
  /exact 51 vereist/,
  'de kleurpluim mag een gedeeltelijk binnengekomen ledenset niet accepteren',
);
const colorComplete = colorContext.completeMemberWindow(
  ['t0', 't1', 't2', 't3'],
  [Array.from({length:51}, (_, member) => [1, 2, member === 7 ? null : 3, 4])],
);
assert.equal(colorComplete.lastExclusive, 2, 'de kleurpluim mag geen statistiek over een onvolledige ingeststaart maken');
assert.match(colorPlume, /if \(keys\.length !== 51\) throw new Error\(`Slechts \$\{keys\.length\} gemeenschappelijke ensembleleden/);
assert.match(colorPlume, /vals\.length === results\.length && vals\.every\(Number\.isFinite\)/, 'ruimtelijke gemiddelden vereisen ieder geladen roosterpunt');

const harm = fs.readFileSync(path.join(root, 'pluim_harmoneps.html'), 'utf8');
const harmContext = {};
vm.runInNewContext(functionSource(harm, 'isVolledigUtcNeerslagEtmaal'), harmContext);

const dayStart = Date.parse('2026-08-08T00:00:00Z');
const completeTimes = Array.from({length:24}, (_, index) => new Date(dayStart + (index + 1) * 3600000));
const completeInfo = {idxs:Array.from({length:24}, (_, index) => index)};
assert.equal(
  harmContext.isVolledigUtcNeerslagEtmaal(completeTimes, completeInfo, '2026-08-08'),
  true,
  '01 UTC t/m 00 UTC van de volgende dag is een volledig neerslagetmaal',
);
assert.equal(
  harmContext.isVolledigUtcNeerslagEtmaal(completeTimes.slice(5), {idxs:Array.from({length:19}, (_, index) => index)}, '2026-08-08'),
  false,
  'een gedeeltelijke eerste modeldag mag niet als etmaalsom verschijnen',
);
const gappedTimes = completeTimes.slice();
gappedTimes[12] = new Date(gappedTimes[12].getTime() + 3600000);
assert.equal(
  harmContext.isVolledigUtcNeerslagEtmaal(gappedTimes, completeInfo, '2026-08-08'),
  false,
  'een etmaal met een ontbrekend uurvak is niet volledig',
);
assert.match(harm, /if \(isPrecip && !isVolledigUtcNeerslagEtmaal\(times, info, key\)\) continue;/);
assert.doesNotMatch(
  harm,
  /wind50_kmh:\s*"[^"]*(?:Beaufort|Bft)/,
  'wind op 50 meter mag niet als Beaufort worden gepresenteerd',
);
assert.match(
  harm,
  /return showBft && vName === 'wind_kmh'/,
  'alleen gemiddelde wind op 10 meter mag de Beaufort-notatie krijgen',
);

console.log('pluim-randgevallen: UTC-neerslagdagen en lege 6+-data zijn afgedekt');
