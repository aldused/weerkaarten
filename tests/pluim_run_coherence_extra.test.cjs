const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const color = fs.readFileSync(path.join(root, 'kleurpluim.html'), 'utf8');
const interactive = fs.readFileSync(path.join(root, 'pluim_interactief.html'), 'utf8');
const rrdk = fs.readFileSync(path.join(root, 'weerbewaking_ridderkerk_rhoon_dekuip.html'), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name}: functie ontbreekt`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name}: functie-einde ontbreekt`);
}

const startMs = Date.parse('2026-08-09T06:00:00Z');
const endMs = Date.parse('2026-08-09T12:00:00Z');
const meta = {
  last_run_initialisation_time: startMs / 1000,
  data_end_time: endMs / 1000,
  last_run_modification_time: 123,
};
const times = [
  '2026-08-09T06:00:00Z',
  '2026-08-09T09:00:00Z',
  '2026-08-09T12:00:00Z',
];

const colorContext = {};
vm.runInNewContext([
  functionSource(color, 'verifiedEnsRunMeta'),
  functionSource(color, 'boundHourlyToRunMeta'),
  functionSource(color, 'completeMemberWindow'),
].join('\n'), colorContext);

const earlyRunRequired = 'temperature_2m,precipitation,wind_speed_10m,cloud_cover,wind_gusts_10m';
assert.match(color, new RegExp(`data-required="${earlyRunRequired}"`),
  'kleurpluim laat een vroege opgeslagen run met de zes beschikbare kernvelden niet toe');
assert.match(rrdk, new RegExp(`data-required="${earlyRunRequired}"`),
  'RRDK laat een vroege opgeslagen run met de beschikbare kernvelden niet toe');
for (const [name, html] of [['kleurpluim', color], ['RRDK', rrdk]]) {
  const required = html.match(/data-required="([^"]+)"/)?.[1] || '';
  assert.doesNotMatch(required, /(?:^|,)cape(?:,|$)/,
    `${name}: CAPE blokkeert nog de vroege opgeslagen run`);
}
assert.match(color, /niet beschikbaar in deze opgeslagen run/,
  'kleurpluim meldt een ontbrekend vroeg veld nog als een oudere run');
assert.doesNotMatch(color, /oudere opgeslagen run/,
  'kleurpluimteksten zijn nog alleen op historische runs gericht');

const colorInclusive = colorContext.boundHourlyToRunMeta({
  time: times,
  temperature_2m: [10, 11, 12],
}, meta);
assert.deepEqual(Array.from(colorInclusive.time), times, 'kleurpluim verliest een inclusieve data_end-stap');
assert.throws(
  () => colorContext.verifiedEnsRunMeta({
    last_run_initialisation_time: Date.parse('2026-08-09T05:00:00Z') / 1000,
    data_end_time: endMs / 1000,
  }),
  /ongeldige cyclus/,
  'kleurpluim accepteert een initialisatie buiten 00/06/12/18 UTC',
);

const colorExclusive = colorContext.boundHourlyToRunMeta({
  time: times,
  temperature_2m: [10, 11],
}, meta);
assert.deepEqual(
  Array.from(colorExclusive.time),
  times.slice(0, 2),
  'kleurpluim herkent een exclusieve Open-Meteo-eindgrens niet',
);
assert.throws(
  () => colorContext.boundHourlyToRunMeta({
    time: times.slice(1),
    temperature_2m: [11, 12],
  }, meta),
  /dekt niet exact/,
  'kleurpluim accepteert ten onrechte een respons die na de runstart begint',
);
assert.throws(
  () => colorContext.boundHourlyToRunMeta({
    time: times.slice(0, 2),
    temperature_2m: [10, 11],
  }, meta),
  /dekt niet exact/,
  'kleurpluim accepteert ten onrechte een respons zonder data_end-grens',
);
assert.throws(
  () => colorContext.completeMemberWindow(
    times,
    [Array.from({ length: 51 }, () => times.map(() => null))],
  ),
  /te weinig tijdstappen met alle 51 leden compleet/,
  '51 volledig lege CAPE-reeksen worden ten onrechte als echte nulwaarden geaccepteerd',
);
assert.match(
  functionSource(color, 'loadPointRawForParam'),
  /window\.first !== 0 \|\| window\.lastExclusive !== boundedHourly\.time\.length/,
  'kleurpluim accepteert nog een intern of aan het einde onvolledig 51-ledentijdvenster',
);

const PM = require(path.join(root, 'pluim_math.js'));
const interactiveContext = { URL, Object, Number, Date, Set, PM };
vm.runInNewContext([
  functionSource(interactive, 'verifiedModelRunMeta'),
  functionSource(interactive, 'useCanonicalVariables'),
  functionSource(interactive, 'immutableRunContext'),
  functionSource(interactive, 'canonicalEnsembleBase'),
  functionSource(interactive, 'requestedEnsembleBases'),
  functionSource(interactive, 'unavailableEnsembleBases'),
  functionSource(interactive, 'markEnsembleBaseUnavailable'),
  functionSource(interactive, 'ensembleBaseAvailable'),
  functionSource(interactive, 'exactMemberIdentities'),
  functionSource(interactive, 'assertExactCommonEnsemble'),
  functionSource(interactive, 'trimHourlyToRunvenster'),
].join('\n'), interactiveContext);

const interactiveInclusive = {
  hourly: { time: times, temperature_2m: [10, 11, 12] },
};
interactiveContext.trimHourlyToRunvenster(interactiveInclusive, meta, true);
assert.deepEqual(Array.from(interactiveInclusive.hourly.time), times);

const interactiveExclusive = {
  hourly: { time: times, temperature_2m: [10, 11] },
};
interactiveContext.trimHourlyToRunvenster(interactiveExclusive, meta, true);
assert.deepEqual(Array.from(interactiveExclusive.hourly.time), times.slice(0, 2));
assert.throws(
  () => interactiveContext.trimHourlyToRunvenster({
    hourly: { time: times.slice(1), temperature_2m: [11, 12] },
  }, meta, true),
  /dekt niet exact/,
);
assert.throws(
  () => interactiveContext.trimHourlyToRunvenster({
    hourly: { time: times.slice(0, 2), temperature_2m: [10, 11] },
  }, meta, true),
  /dekt niet exact/,
);

const exactHourly = { time: times.slice() };
for (const base of ['temperature_2m', 'precipitation']) {
  exactHourly[base] = [1, 2, 3];
  for (let member = 1; member <= 50; member++) {
    exactHourly[`${base}_member${String(member).padStart(2, '0')}`] = [member, member + 1, member + 2];
  }
}
const exactConfig = { label: 'ECMWF IFS', expectedMembers: 51 };
const exactUrl = 'https://ensemble-api.open-meteo.com/v1/ensemble?hourly=temperature_2m,precipitation&models=ecmwf_ifs025';
assert.equal(
  interactiveContext.assertExactCommonEnsemble({ hourly: exactHourly }, exactUrl, exactConfig).length,
  51,
);
const missingMember = structuredClone(exactHourly);
delete missingMember.precipitation_member50;
assert.throws(
  () => interactiveContext.assertExactCommonEnsemble({ hourly: missingMember }, exactUrl, exactConfig),
  /exact 51 vereist/,
);
const incompleteMember = structuredClone(exactHourly);
incompleteMember.temperature_2m_member17[2] = null;
assert.throws(
  () => interactiveContext.assertExactCommonEnsemble({ hourly: incompleteMember }, exactUrl, exactConfig),
  /nog niet volledig geladen/,
);

const optionalHourly = { time: times.slice() };
for (const base of ['cape', 'lifted_index']) {
  optionalHourly[base] = [1, 2, 3];
  for (let member = 1; member <= 50; member++) {
    optionalHourly[`${base}_member${String(member).padStart(2, '0')}`] = [member, member + 1, member + 2];
  }
}
for (const key of Object.keys(optionalHourly).filter(key => key === 'lifted_index' || key.startsWith('lifted_index_member'))) {
  optionalHourly[key] = optionalHourly[key].map(() => null);
}
const optionalData = {
  hourly: optionalHourly,
  weerlab_unavailable_variables: ['lifted_index'],
};
const onweerUrl = 'https://ensemble-api.open-meteo.com/v1/ensemble?hourly=cape,lifted_index&models=ecmwf_ifs025';
assert.equal(
  interactiveContext.assertExactCommonEnsemble(optionalData, onweerUrl, exactConfig, ['lifted_index']).length,
  51,
  'ontbrekende Lifted Index blokkeert de complete CAPE-kernpluim',
);
assert.equal(
  interactiveContext.ensembleBaseAvailable(optionalData, 'lifted_index'),
  false,
  'een met nulls gevulde Lifted Index mag niet als beschikbare 0-reeks gelden',
);
assert.throws(
  () => interactiveContext.assertExactCommonEnsemble(optionalData, onweerUrl, exactConfig),
  /niet beschikbaar/,
  'zonder expliciete optional-markering blijft een ontbrekend veld terecht hard',
);

const frozen = interactiveContext.immutableRunContext('meta-url', meta);
assert.equal(Object.isFrozen(frozen), true, 'runcontext zelf is niet immutable');
assert.equal(Object.isFrozen(frozen.meta), true, 'metadata-snapshot in runcontext is niet immutable');
assert.equal(frozen.meta.last_run_initialisation_time, meta.last_run_initialisation_time);
assert.throws(
  () => interactiveContext.verifiedModelRunMeta({
    last_run_initialisation_time: Date.parse('2026-08-09T07:00:00Z') / 1000,
    data_end_time: endMs / 1000,
  }),
  /ongeldige cyclus/,
  'interactieve pluim accepteert een initialisatie buiten 00/06/12/18 UTC',
);

assert.match(color, /pluim_run_switcher_48ffbf926db6\.js/);
assert.match(interactive, /pluim_run_switcher_48ffbf926db6\.js/);
assert.match(
  functionSource(interactive, 'fetchEnsembleCoherent'),
  /assertExactCommonEnsemble\(data,url,config,optionalBases\)/,
  'interactieve pluim controleert niet ieder gekoppeld ECMWF-veld op exact dezelfde 51 leden',
);
assert.match(functionSource(interactive, 'laadOnweer'), /\['lifted_index'\]/,
  'de gewone onweerpluim markeert Lifted Index niet als optioneel');
assert.match(functionSource(interactive, 'laadVergPluim'), /\['lifted_index'\]/,
  'het vierluik markeert Lifted Index niet als optioneel');
assert.match(functionSource(interactive, 'laadBewolking'), /zonder HRES-lagen/,
  'bewolking meldt niet eerlijk dat exacte HRES-lagen ontbreken');
assert.match(
  functionSource(interactive, 'laadVergelijkingModel'),
  /fetchEnsembleCoherent\([^;]+ecmwfRunContext\)/s,
  'ECMWF temperatuur/neerslag en wind delen geen immutable runcontext',
);
assert.match(
  functionSource(interactive, 'laadVergelijking'),
  /laadVergPluim\([^;]+sharedRunContext\)/s,
  'de vier vergelijkingspluimen kunnen nog tussen ECMWF-cycli omschakelen',
);
assert.match(
  functionSource(interactive, 'laadVergHres'),
  /fetchExactHresRuns\([^;]+runContext\)/s,
  'gekoppelde HRES-vergelijkingen gebruiken geen gedeelde runcontext',
);

console.log('extra runcoherentie: kleurpluim en interactieve pluim zijn hard begrensd');
