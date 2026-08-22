const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const files = [
  'kleurpluim.html',
  'weerbewaking_pluim.html',
  'pluim_interactief.html',
  'demo_pluim6_trend.html',
  'pluim_6_plus.html',
  'pluim_harmoneps.html',
  'janvisser.html',
  'weerbewaking_ridderkerk_rhoon_dekuip.html',
];

for (const file of files) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]))
    .filter(match => !/\btype\s*=\s*["'](?:application\/ld\+json|application\/json)["']/i.test(match[1]));
  assert.ok(scripts.length, `${file}: geen inline JavaScript gevonden`);
  scripts.forEach((match, index) => {
    try {
      Function(match[2]);
    } catch (error) {
      throw new Error(`${file}: inline script ${index + 1} parseert niet: ${error.message}`);
    }
  });
}

const interactive = fs.readFileSync(path.join(root, 'pluim_interactief.html'), 'utf8');
assert.match(interactive, /const eRain6=agg6h\(pAE,ensE\.hourly\.time,bereik\.van,bereik\.tot\)/, 'ECMWF-modelvergelijking aggregeert niet over de volledige bronreeks');
assert.match(interactive, /const iRain6=agg6h\(pAI,ensI\.hourly\.time,bereik\.van,bereik\.tot\)/, 'tweede model gebruikt geen gelijke volledige 6-uursneerslagvakken');
assert.match(interactive, /const rainTimes=intersectTimes\(eRain6\.ts6,iRain6\.ts6\)/, 'modelvergelijking gebruikt geen gemeenschappelijke 6-uursas');
assert.match(interactive, /const daily=aggEtmaalUtc\(pA,allTimes,bereik\.van,bereik\.tot\)/, 'dagneerslag gebruikt geen volledige UTC-etmalen');
assert.doesNotMatch(interactive, /Object\.keys\([^\n]+_member/, 'actieve subpluim sluit de controleberekening nog uit');
assert.doesNotMatch(interactive, /xAxisID:\s*['"](?:xH|xI|xWI)['"]|\bxH\s*:/, 'een deterministische overlay gebruikt nog een niet-uitgelijnde tweede tijdas');
assert.match(interactive, /const hTemp=alignSeriesToTimes\(ts,hTs/, 'deterministische temperatuur is niet op de ENS-tijdas uitgelijnd');
assert.match(interactive, /afterDatasetsUpdate\(chart\)/, 'variabele 3/6-uursstaafbreedtes worden niet tijdsevenredig gecorrigeerd');

const sixPlus = fs.readFileSync(path.join(root, 'pluim_6_plus.html'), 'utf8');
assert.match(sixPlus, /const timeToPx = value =>/, '6+ gebruikt geen werkelijke tijdas');
assert.doesNotMatch(sixPlus, /STEPS_PER_DAY|MODEL_STEP/, '6+ gebruikt nog vaste modelstappen');

const sixPanel = fs.readFileSync(path.join(root, 'weerbewaking_pluim.html'), 'utf8');
for (const [name, html] of [['6-luik', sixPanel], ['6+', sixPlus]]) {
  assert.match(html, /u\.searchParams\.set\('lat', String\(currentStation\.lat\)\)/,
    `${name}: vrije plaats bewaart de breedtegraad niet bij een runherlaad`);
  assert.match(html, /u\.searchParams\.set\('lon', String\(currentStation\.lon\)\)/,
    `${name}: vrije plaats bewaart de lengtegraad niet bij een runherlaad`);
  assert.match(html, /STATIONS\.push\(\{ name: wantedStationName, lat: wantedLat, lon: wantedLon \}\)/,
    `${name}: vrije plaats wordt na een runherlaad niet uit de URL hersteld`);
  assert.match(html, /urlParams\.has\('lat'\) && urlParams\.has\('lon'\)/,
    `${name}: een oude URL zonder coördinaten mag niet stilzwijgend op 0,0 uitkomen`);
  assert.match(html, /\.replace\(\/\[<>&\]\/g, ''\)\.trim\(\)\.slice\(0, 80\)/,
    `${name}: een vrije plaatsnaam uit de URL wordt onveilig in HTML overgenomen`);
  assert.match(html, /selectedRunMs === liveRunMs[\s\S]*ensureVariables\?\.\(\['cape'\]\)/,
    `${name}: actuele snelle cyclus schakelt niet door naar de complete CAPE-bron`);
}

const trend = fs.readFileSync(path.join(root, 'demo_pluim6_trend.html'), 'utf8');
assert.match(trend, /sourceTimes\[i\]<=AX0\+1\) return 0/, 'runtrend begint niet expliciet op nul');
assert.match(trend, /\[0,6,12,18\]\.includes/, 'runtrend toont niet alle vier ECMWF-cycli');
assert.match(trend, /\.slice\(0,8\)/, 'runtrend bewaart niet de laatste acht runs in beeld');
assert.match(trend, /\$\{runs\.length\}\/8 runs/, 'runtrendstatus gebruikt nog de oude zes-runlimiet');

const color = fs.readFileSync(path.join(root, 'kleurpluim.html'), 'utf8');
assert.match(color, /const MAX_FORECAST_DAYS = 15;/, 'kleurpluim-UI is niet begrensd op 15 dagen');
assert.match(color, /const SOURCE_FORECAST_DAYS = MAX_FORECAST_DAYS \+ 1;/, 'kleurpluim haalt geen extra brondag op voor het laatste neerslagvak');
assert.match(color, /start_date=\$\{startDate\}&end_date=\$\{endDate\}/, 'kleurpluim gebruikt niet het expliciete UTC-runvenster');
assert.doesNotMatch(extractFunction(color, 'buildDataUrl'), /forecast_days=/, 'kleurpluim mag na middernacht niet vanzelf op vandaag beginnen');
assert.ok((color.match(/stats\.precedingHours = 6;/g) || []).length >= 3, 'niet alle 6-uursneerslagreeksen dragen intervalmetadata');
assert.match(color, /Date\.parse\(`\$\{endIso\}T00:00:00Z`\) \+ MS_DAY/, 'kleurpluim neemt het rechts-gelabelde laatste 18–24 UTC-vak niet mee');
assert.match(color, /hasPrecedingIntervals\s*\? new Date\(times\[last\]\)\.getTime\(\) <= endMs/, 'kleurpluim trimt neerslag niet op de gekozen kalendergrens');
assert.doesNotMatch(color, /Hoofdpluim|beschikbareHoofdRun/, 'kleurpluim mag geen 00/12-hoofdpluim uit de klok gokken');
assert.match(color, /plumeRunShort = `ENS-run \$\{fmtEnsRun\(verified\.last_run_initialisation_time\)\}`/, 'kleurpluim toont niet de werkelijke ECMWF ENS-run');
assert.match(color, /actuele dekking \$\{coverageHours\} uur t\/m/, 'kleurpluim vermeldt de geverifieerde actuele dekking niet');
assert.match(color, /const metaBefore = await fetchEnsRunMeta\(\);[\s\S]*const value = await loader\(metaBefore,[\s\S]*const metaAfter = await fetchEnsRunMeta\(\);/, 'ECMWF-meta wordt niet vóór en na de datapointbatch gecontroleerd');
assert.match(color, /if \(sameEnsCycle\(metaBefore, metaAfter\)\)/, 'een cycluswissel tijdens de kleurpluimbatch wordt niet gedetecteerd');
assert.match(color, /ensMetaSentinel\(runMeta\)/, 'de kleurpluimcache is niet aan het geverifieerde runvenster gekoppeld');
assert.match(color, /boundHourlyToRunMeta\(data\.hourly, runMeta\)/, 'API-data wordt niet hard tot het metavenster begrensd');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} ontbreekt`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} is niet volledig`);
}

const exactHresRunsSource = extractFunction(interactive, 'fetchExactHresRuns');
assert.match(exactHresRunsSource, /haalModelMetaVers\(ECMWF_ENS_META_URL\)/, 'exacte HRES leest de officiële ENS-runmetadata niet');
assert.match(exactHresRunsSource, /exactHresUrl\(lat,lon,hourly,spec\.bronDagen,spec\.run\)/, 'HRES wordt niet per expliciete run uit Single Runs geladen');
assert.match(exactHresRunsSource, /trimHourlyToRunvenster\(runs\[currentIndex\],after\)/, 'de huidige HRES wordt niet hard op het geverifieerde ENS-runvenster begrensd');
assert.match(exactHresRunsSource, /zelfdeEcmwfRunvenster\(before,after\)/, 'een ECMWF-cycluswissel tijdens de HRES-calls wordt niet afgekeurd');

const hresSource = extractFunction(interactive, 'laadHres');
assert.match(hresSource, /fetchExactHresRuns\([\s\S]*\[0,-6\]/, 'de operationele HRES vergelijkt niet met exact de vorige cyclus van zes uur eerder');
assert.doesNotMatch(hresSource, /api\.open-meteo\.com\/v1\/forecast|previous-runs-api|previous_day/, 'de operationele HRES gebruikt nog een stitched of previous-runs respons');

const historySource = extractFunction(interactive, 'laadRunHistorie');
assert.match(historySource, /Array\.from\(\{length:8\},\(_,index\)=>-24\*index\)/, 'de runhistorie kiest de huidige en zeven exacte etmaalruns niet expliciet');
assert.match(historySource, /fetchExactHresRuns\(lat,lon,paramCfg\.key,dagen,offsets\)/, 'de runhistorie gebruikt de Single Runs-helper niet');
assert.doesNotMatch(historySource, /previous-runs-api|previous_day/, 'de runhistorie gebruikt nog afgeleide Previous Runs-velden');

const compareHresSource = extractFunction(interactive, 'laadVergHres');
assert.match(compareHresSource, /fetchExactHresRuns\(lat,lon,hourly,dagen,\[0,-6\]\)/, 'de HRES-kaarteneditor gebruikt niet de exacte huidige en vorige cyclus');
assert.match(compareHresSource, /type==='cloud'\?'cloudcover'/, 'bewolking in de HRES-kaarteneditor gebruikt de exacte runroute niet');
assert.doesNotMatch(compareHresSource, /api\.open-meteo\.com\/v1\/forecast|previous-runs-api|previous_day/, 'de HRES-kaarteneditor bevat nog een stitched HRES-call');

assert.doesNotMatch(interactive, /https:\/\/api\.open-meteo\.com\/v1\/forecast[^`\n]*models=ecmwf_ifs/, 'een seamless Forecast API-call wordt nog als ECMWF HRES gebruikt');
assert.doesNotMatch(interactive, /_previous_day\d+/, 'een pluim gebruikt nog samengestelde previous-run-velden');
assert.match(interactive, /const hresD=await fetchExactDeterministic\(/, 'de dauwpuntkaart gebruikt geen cyclusvaste operationele overlay');
const coherentEnsSource = extractFunction(interactive, 'fetchEnsembleCoherent');
assert.match(coherentEnsSource, /fetchT\(ensembleUrlForRun\(url,before\)/, 'alle ECMWF\/AIFS-tabs moeten expliciete run-datums gebruiken');

const runStartMs = Date.parse('2026-08-08T06:00:00Z');
const runEndMs = Date.parse('2026-08-08T12:00:00Z');
const sentinelContext = {};
vm.runInNewContext([
  extractFunction(color, 'verifiedEnsRunMeta'),
  extractFunction(color, 'ensRunDateBounds'),
  extractFunction(color, 'boundHourlyToRunMeta'),
].join('\n'), sentinelContext);
const sentinelHourly = {
  time: [
    '2026-08-08T03:00:00Z',
    '2026-08-08T06:00:00Z',
    '2026-08-08T09:00:00Z',
    '2026-08-08T12:00:00Z',
    '2026-08-08T15:00:00Z',
  ],
  temperature_2m: [999, 10, 20, 30, 888],
  temperature_2m_member01: [777, 11, 21, 31, 666],
};
const colorMidnightBounds = sentinelContext.ensRunDateBounds({
  last_run_initialisation_time: Date.parse('2026-08-08T12:00:00Z') / 1000,
  data_end_time: Date.parse('2026-08-23T15:00:00Z') / 1000,
});
assert.equal(colorMidnightBounds.startDate, '2026-08-08');
assert.equal(colorMidnightBounds.endDate, '2026-08-23');
const boundedHourly = sentinelContext.boundHourlyToRunMeta(sentinelHourly, {
  last_run_initialisation_time: runStartMs / 1000,
  data_end_time: runEndMs / 1000,
});
assert.deepEqual(
  Array.from(boundedHourly.time),
  ['2026-08-08T06:00:00Z', '2026-08-08T09:00:00Z', '2026-08-08T12:00:00Z'],
  'prefix- en suffixtijdstappen buiten het officiële runvenster moeten verdwijnen',
);
assert.deepEqual(Array.from(boundedHourly.temperature_2m), [10, 20, 30], 'prefix/suffix-sentinels bereikten de controlereeks');
assert.deepEqual(Array.from(boundedHourly.temperature_2m_member01), [11, 21, 31], 'prefix/suffix-sentinels bereikten een perturbed member');

const startMs = Date.parse('2026-08-01T00:00:00Z');
const rainTimes = Array.from({ length: 64 }, (_, index) => new Date(startMs + (index + 1) * 6 * 3600000).toISOString());
const rainStats = rainTimes.map(t => ({ t, p10: 0, p50: 0, p90: 0 }));
rainStats.precedingHours = 6;
const rangeContext = {
  Date,
  MS_DAY: 24 * 3600000,
  Number,
  times: rainTimes,
  stats: rainStats,
  selectedRange: () => ({
    start: new Date('2026-08-01T00:00:00Z'),
    endExclusive: new Date('2026-08-16T00:00:00Z'),
    startIso: '2026-08-01',
    endIso: '2026-08-15',
  }),
};
vm.runInNewContext(`${extractFunction(color, 'sliceForSelectedRange')}\nresult = sliceForSelectedRange(times, stats);`, rangeContext);
assert.equal(rangeContext.result.times.length, 60, '15 dagen bevatten niet exact 60 complete 6-uursvakken');
assert.equal(rangeContext.result.times[0], '2026-08-01T06:00:00.000Z', 'eerste complete 6-uursvak is onjuist');
assert.equal(rangeContext.result.times.at(-1), '2026-08-16T00:00:00.000Z', 'laatste vak 18–24 UTC ontbreekt');

console.log(`pluim HTML: ${files.length} pagina's parseerden zonder syntaxfouten`);
