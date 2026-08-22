const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'pluim_6luik_debilt.html'), 'utf8');

function extractFunction(name) {
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

assert.match(source, /pluim_run_switcher_032667819e3a\.js/, '6-luik gebruikt niet de directe gezamenlijke runkeuze');
assert.match(source, /data-required="temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m"/, 'early-kernvelden worden niet vooraf bewaakt');
assert.doesNotMatch(source.match(/data-required="([^"]+)"/)?.[1] || '', /cape/,
  'ontbrekende CAPE mag de overige vijf panelen niet blokkeren');
assert.match(source, /pluim_math\.js/, 'gedeelde pluimwiskunde ontbreekt');
assert.match(source, /single-runs-api\.open-meteo\.com\/v1\/forecast/, 'HRES komt niet uit Single Runs');
assert.match(source, /&models=ecmwf_ifs&run=\$\{encodeURIComponent\(runInitialization\)\}/, 'HRES krijgt niet exact de gekozen run mee');
assert.doesNotMatch(source, /https:\/\/api\.open-meteo\.com\/v1\/forecast/, 'seamless Forecast API mag niet als operationele HRES worden getekend');
assert.match(source, /start_hour=\$\{encodeURIComponent\(startHour\)\}&end_hour=\$\{encodeURIComponent\(endHour\)\}/, 'ENS wordt niet op het officiële runvenster aangevraagd');
assert.match(source, /temporal_resolution=native&timezone=GMT/, 'bronnen gebruiken geen gedeelde native UTC-tijdas');

const coherentBatch = extractFunction('fetchCoherentPlumeBatch');
assert.match(coherentBatch, /const metaBefore = await fetchRunMeta\(\)/, 'metadata vóór de databatch ontbreekt');
assert.match(coherentBatch, /const metaAfter = await fetchRunMeta\(\)/, 'metadata na de databatch ontbreekt');
assert.match(coherentBatch, /sameRunMeta\(metaBefore, metaAfter\)/, 'cycluswissel tijdens laden wordt niet afgekeurd');
assert.match(coherentBatch, /ECMWF ENS-run wisselde tijdens het laden/, 'expliciete fout bij een cycluswissel ontbreekt');

const buildModel = extractFunction('buildModel');
assert.match(buildModel, /ensembleVariable\(hourly, 'temperature_2m'\)/, 'temperatuur wordt niet als complete ensemblematrix gelezen');
assert.match(buildModel, /completeMemberWindow\(times, Object\.values\(raw\)\.filter\(Boolean\)\.map/, 'één gemeenschappelijk venster voor alle beschikbare panelen ontbreekt');
assert.match(buildModel, /window\.first !== 0 \|\| window\.lastExclusive !== times\.length/, 'een gedeeltelijk geladen run kan nog worden getekend');
assert.match(buildModel, /alignSeries\(useTimes, hresTimes/, 'HRES wordt niet op timestamp aan ENS gekoppeld');
assert.match(buildModel, /alignSeries\(rrTimes6, hresRain6\.endDates/, '6-uurs-HRES-neerslag wordt niet op timestamp gekoppeld');
assert.doesNotMatch(buildModel, /slice\(0,\s*N\)|const sliceN/, 'HRES wordt nog per index aan ENS gekoppeld');
assert.match(buildModel, /er wordt niets uit een andere run gemengd/, 'onvolledige gekozen run heeft geen expliciete stopmelding');
assert.match(buildModel, /cape: optionalEnsembleVariable\(hourly, 'cape', unavailable\)/,
  'CAPE wordt niet als optioneel same-run-paneel behandeld');
assert.match(buildModel, /unavailableText:true/,
  'ontbrekende CAPE krijgt geen eerlijk leeg paneel');

const context = {
  Date, Number, Array, Map, Set, Math,
  console: { warn() {} },
  PLUME_MATH: {
    perturbedMemberKeys(hourly, key) {
      return Object.keys(hourly).filter(name => name.startsWith(`${key}_member`)).sort();
    },
    ensembleMemberKeys(hourly, key) {
      return [key, ...this.perturbedMemberKeys(hourly, key)].filter(name => Array.isArray(hourly[name]));
    },
  },
};
vm.runInNewContext([
  extractFunction('verifiedRunMeta'),
  extractFunction('runMetaSentinel'),
  extractFunction('sameRunMeta'),
  extractFunction('completeMemberWindow'),
  extractFunction('alignSeries'),
  extractFunction('fillNaN'),
  extractFunction('ensembleVariable'),
  extractFunction('optionalEnsembleVariable'),
].join('\n'), context);

const start = Date.parse('2026-08-09T00:00:00Z') / 1000;
const meta00 = { last_run_initialisation_time:start, data_end_time:start+3600*360, last_run_modification_time:start+10 };
const meta18 = { ...meta00, last_run_initialisation_time:start-6*3600 };
assert.equal(context.sameRunMeta(meta00, { ...meta00 }), true, 'identieke metacontext wordt afgekeurd');
assert.equal(context.sameRunMeta(meta00, meta18), false, '00 en 18 UTC worden als dezelfde run gezien');
assert.throws(
  () => context.verifiedRunMeta({ ...meta00, last_run_initialisation_time:start+3600 }),
  /ongeldige cyclus/,
  'een niet-operationele cyclus wordt niet afgekeurd',
);

const times = Array.from({ length:5 }, (_, index) => new Date((start+index*3*3600)*1000));
const full = Array.from({ length:51 }, (_, member) => times.map((_, index) => member+index));
assert.deepEqual(
  { ...context.completeMemberWindow(times, [full]) },
  { first:0, lastExclusive:5 },
  'volledige 51-ledenset krijgt een verkeerd venster',
);

const allNullCape = { time: ['2026-08-09T00:00:00Z', '2026-08-09T03:00:00Z'] };
allNullCape.cape = [null, null];
for (let member = 1; member <= 50; member++) {
  allNullCape[`cape_member${String(member).padStart(2, '0')}`] = [null, null];
}
assert.equal(context.optionalEnsembleVariable(allNullCape, 'cape', new Set()), null,
  '51 volledig-null CAPE-reeksen mogen niet tot nulwaarden worden omgezet');
full[17][3] = null;
assert.deepEqual(
  { ...context.completeMemberWindow(times, [full]) },
  { first:0, lastExclusive:3 },
  'eerste onvolledige tijdstap stopt het gemeenschappelijke venster niet',
);

const hresTimes = [times[0], new Date(times[0].getTime()+3600_000), times[1], times[2]];
assert.deepEqual(
  Array.from(context.alignSeries(times.slice(0, 3), hresTimes, [10, 999, 20, 30])),
  [10, 20, 30],
  'HRES wordt per index in plaats van per exact timestamp gekoppeld',
);

const inlineScripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[1]));
assert.ok(inlineScripts.length, 'inline JavaScript ontbreekt');
inlineScripts.forEach((match, index) => {
  assert.doesNotThrow(() => Function(match[2]), `inline script ${index+1} parseert niet`);
});

console.log('6-luik: exacte 00/06/12/18 ENS/HRES-runcoherentie en timestamp-alignment geborgd');
