const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const documenten = [
  'weerbewaking_rijnmond.html',
  'weerbewaking_uurlijks.html',
  'weerbewaking_ridderkerk_rhoon_dekuip.html',
  'weerbewaking_gladheid.html',
  'weerbewaking_rr.html',
  'weerbewaking_fey.html',
  'vlaggenweer.html',
];

for (const bestand of documenten) {
  const html = fs.readFileSync(path.join(root, bestand), 'utf8');
  assert.match(
    html,
    /weerbewaking_export\.js\?v=20260823-cors-v1/,
    `${bestand}: veilige gedeelde PDF-module ontbreekt`,
  );
}

const exporter = fs.readFileSync(path.join(root, 'weerbewaking_export.js'), 'utf8');
assert.match(exporter, /async function safeImageDataUrl/, 'afbeeldingen worden niet veilig ingesloten');
assert.match(exporter, /await fetch\(/, 'externe afbeeldingen worden niet als blob opgehaald');
assert.match(exporter, /async function prepareForCanvas/, 'canvasvoorbereiding ontbreekt');
assert.match(exporter, /await prepareForCanvas\(element\)/, 'PDF-routes gebruiken de canvasvoorbereiding niet');
assert.match(exporter, /canvas\.toDataURL\('image\/png'\)/, 'canvascontrole ontbreekt');

for (const bestand of ['weerbewaking_gladheid.html', 'weerbewaking_fey.html', 'vlaggenweer.html']) {
  const html = fs.readFileSync(path.join(root, bestand), 'utf8');
  assert.match(html, /WBExport\.html2pdfSave/, `${bestand}: omzeilt de veilige exportmodule`);
}

console.log('PDF-export: alle 7 documenten gebruiken de CORS-veilige exportmodule');
