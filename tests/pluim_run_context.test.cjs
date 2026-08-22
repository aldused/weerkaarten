const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const switcher = fs.readFileSync(path.join(root, 'pluim_run_switcher_032667819e3a.js'), 'utf8');
const exporter = fs.readFileSync(path.join(root, 'weerbewaking_pluim_export.js'), 'utf8');

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

const withRun = extractFunction(switcher, 'withRunHour');
assert.match(switcher, /async function createRunContext\(hour\)/,
  'een export krijgt geen onveranderlijke runcontext');
assert.match(switcher, /Object\.freeze\(\{[\s\S]*runId:[\s\S]*fetch: contextFetch/,
  'run-ID en contextgebonden fetch worden niet samen vastgezet');
assert.doesNotMatch(withRun, /state\.selected(?:Hour|Run)\s*=/,
  'export muteert nog de zichtbare globale run tijdens parallelle fetches');
assert.match(switcher, /find\(item => item\.run === selectedRun\.run\)/,
  'contextfetch vereist niet de volledige exacte station-run');
assert.doesNotMatch(switcher, /find\(item => item\.run === selectedRun\.run\)\s*\|\|/,
  'contextfetch kan nog op een andere cyclus of datum terugvallen');

assert.match(exporter, /const transport = runContext\?\.fetch \|\| window\.fetch\.bind\(window\)/,
  'export gebruikt niet uitsluitend de contextgebonden fetch voor een vaste run');
assert.match(exporter, /withRequestedRun\(runHour, runContext => fetchStableEnsembleBatch/,
  'de vaste exportcontext wordt niet door de hele ensemblebatch doorgegeven');
assert.match(exporter, /fetchRunMeta\(runContext\)/,
  'de meta-sentinel hoort niet bij dezelfde exportcontext');

console.log('Pluim-runcontext: parallelle exports kunnen de zichtbare run niet meer wijzigen');
