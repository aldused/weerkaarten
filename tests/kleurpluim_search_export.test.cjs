const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const color = fs.readFileSync(path.join(root, 'kleurpluim.html'), 'utf8');
const ridderkerk = fs.readFileSync(path.join(root, 'weerbewaking_ridderkerk_rhoon_dekuip.html'), 'utf8');
const exportModule = fs.readFileSync(path.join(root, 'weerbewaking_pluim_export.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const menu = fs.readFileSync(path.join(root, 'menu.js'), 'utf8');
const host = fs.readFileSync(path.join(root, 'product-host.html'), 'utf8');

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

assert.match(color, /role="combobox"[^>]+aria-controls="zoek-resultaten"[^>]+aria-expanded="false"/,
  'de plaatszoeker is niet als bedienbare keuzelijst gemarkeerd');
assert.match(color, /id="zoek-resultaten" role="listbox"/,
  'de plaatsresultaten zijn geen expliciete keuzelijst');
assert.match(color, /knop\.setAttribute\('role', 'option'\)/,
  'zoekresultaten worden niet als kiesbare knoppen opgebouwd');
assert.match(color, /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/,
  'de plaatskeuze mist pijltjestoetsbediening');
assert.doesNotMatch(color, /zoekPlaats\(true\)/,
  'Zoek of Enter kiest nog stilzwijgend het eerste wereldwijde resultaat');

const searchContext = {};
vm.runInNewContext([
  extractFunction(color, 'normaliseerZoektekst'),
  extractFunction(color, 'sorteerZoekTreffers'),
].join('\n'), searchContext);
const sorted = searchContext.sorteerZoekTreffers('Nieuw', [
  { naam: 'Nieuw Taipei', landcode: 'TW' },
  { naam: 'Nieuwegein', landcode: 'NL' },
  { naam: 'Nieuwrode', landcode: 'BE' },
]);
assert.deepEqual(Array.from(sorted, item => item.naam), ['Nieuwegein', 'Nieuwrode', 'Nieuw Taipei'],
  'Nederlandse en Belgische zoekresultaten staan niet boven wereldwijde treffers');

assert.match(ridderkerk, /weerbewaking_pluim_export\.js\?v=20260921-nieuwe-kleurpluim-v2/,
  'Ridderkerk laadt niet de vernieuwde kleurpluimexport');
assert.match(exportModule, /colourBand:\s*true/,
  'de Ridderkerk-export gebruikt de nieuwe kleurband niet');
assert.match(exportModule, /innerBandFill:\s*'rgba\(18,49,70,0\.22\)'/,
  'de Ridderkerk-export mist de middelste 50%-band');
assert.match(exportModule, /p25:\s*percentiel\(vals, 25\)/,
  'de Ridderkerk-export berekent P25 niet');
assert.match(exportModule, /p75:\s*percentiel\(vals, 75\)/,
  'de Ridderkerk-export berekent P75 niet');
assert.match(exportModule, /ctx\.fillStyle = '#edf2f6'/,
  'de Ridderkerk-export mist de lichte actuele kleurpluimachtergrond');

assert.match(shell, /menu\.js\?v=20260923-pluimnav/,
  'de hoofdpagina haalt het vernieuwde routemenu niet op');
assert.match(menu, /product-host\.html\?v=20260923-pluimnav/,
  'het routemenu haalt de vernieuwde producthost niet op');
assert.match(host, /kleurpluim\.html\?v=20260921-plaatszoeker-v1/,
  'de kleurenpluimroute gebruikt nog de oude cacheversie');
assert.match(host, /weerbewaking_ridderkerk_rhoon_dekuip\.html\?v=20260921-kleurpluim-v2/,
  'de Ridderkerk-route gebruikt nog de oude cacheversie');

console.log('kleurpluim zoeken + Ridderkerk-export: in orde');
