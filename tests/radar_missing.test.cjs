const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../radar.html'), 'utf8');
const scope = vm.createContext({radarData: new Uint8Array([0, 255, 100]), meta:{interval_min:5}, nLat:1, nLon:1, nFrames:3, tNowIndex:0, latlonToGridIdx:()=>({row:0,col:0}), pvToMmh:()=>1, pvToDbz:()=>18});
for (const name of ['reeksVoorPunt','bouwSamenvatting']) {
  const source = html.match(new RegExp('  function '+name+'\\([^]*?\\n  }'));
  assert.ok(source, name);
  vm.runInContext(source[0], scope);
}
const rows = scope.reeksVoorPunt(52,5);
assert.equal(rows[0].mmh,0);
assert.equal(rows[1].mmh,null);
assert.equal(rows[2].cum,1/12);
assert.equal(rows[2].complete,false);
assert.match(scope.bouwSamenvatting(rows),/onvolledig/);
assert.match(scope.bouwSamenvatting([rows[0]]),/Geen nowcast beschikbaar/);
console.log('Missing radar pixels do not become dry observations or complete rainfall sums.');
