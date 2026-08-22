const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

const vakPos = html.indexOf('id="groep-vak"');
const tvxPos = html.indexOf('id="groep-tvx"');
const afgeschermdPos = html.indexOf('id="groep-afgeschermd"');

assert.ok(vakPos >= 0 && tvxPos > vakPos && afgeschermdPos > tvxPos,
  'TV - X Kaarten hoort direct tussen Vakmatig en Afgeschermde tools');
assert.match(html, /id="groep-tvx"[\s\S]*?>TV - X Kaarten<\/button>/);
assert.match(html, /id="nav-europamaxima" onclick="openPanel\('europamaxima'\)"/);
assert.match(html, /id="nav-fototool" onclick="openPanel\('fototool'\)"/);
assert.match(html, /id="panel-europamaxima"[\s\S]*?data-src="https:\/\/data\.weerlab\.nl\/europa-maxima\.html"/);
assert.match(html, /europamaxima:"tvx", fototool:"tvx"/);
assert.doesNotMatch(html, /id="groep-fotowerk"|>Fotowerk</);

console.log('menu: TV - X Kaarten bevat Europa-maxima en Foto voorbereiden');
