const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('europa-maxima.html', 'utf8');
const generator = fs.readFileSync('scripts/maak_europa_maxima.py', 'utf8');
const updater = fs.readFileSync('upload_mosmix_json.sh', 'utf8');

assert.match(html, /fetch\(dataUrl, \{ cache: "no-store" \}\)/);
assert.match(html, /setInterval\(refreshData, 10 \* 60 \* 1000\)/);
assert.match(html, /document\.visibilityState === "visible"/);
assert.match(html, /payload\.dates\.today !== expectedDates\.today/);
assert.match(html, /connect-src 'self' blob: data:/);
assert.match(html, /data-run-summary>Modelrun laden/);
assert.match(html, /Modelrun: \$\{runText\} UTC · feed bijgewerkt: \$\{generatedText\} UTC/);
assert.match(html, /hour: "2-digit", minute: "2-digit"/);
assert.match(generator, /ThreadPoolExecutor\(max_workers=10\)/);
assert.match(generator, /os\.replace\(tmp, OUT\)/);
assert.match(generator, /if age_hours > 30:/);
assert.match(updater, /maak_europa_maxima\.py/);
assert.match(updater, /europa_maxima\.json europa-maxima\.html/);

console.log('europa-maxima: dynamische verversing en stale-beveiliging OK');
