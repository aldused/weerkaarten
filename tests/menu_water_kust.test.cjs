const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');

assert.match(html, /id="subgroep-waterkust"/);
assert.match(html, /aria-expanded="true" onclick="toggleSubgroep\('waterkust'\)">Water &amp; kust/);
assert.match(html, /\.nav-subgroep\.dicht > \.nav-item \{ display: none !important; \}/);
assert.match(html, /function toggleSubgroep\(naam\)/);
assert.match(html, /marifoon:"waterkust", zeetemp:"waterkust", rijnlobith:"waterkust"/);
assert.match(html, /if \(subgroepNaam\) zetSubgroepOpen\(subgroepNaam, true\)/);
assert.match(html, /initSubgroepen\(\);/);

console.log('menu: Water & kust is zelfstandig invouwbaar');
