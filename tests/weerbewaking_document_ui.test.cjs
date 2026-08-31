const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const documenten = [
  ['weerbewaking_rijnmond.html', 'wb-document-vijfdaags'],
  ['weerbewaking_uurlijks.html', 'wb-document-uurlijks'],
  ['weerbewaking_ridderkerk_rhoon_dekuip.html', 'wb-document-ridderkerk'],
  ['weerbewaking_gladheid.html', 'wb-document-gladheid'],
  ['weerbewaking_rr.html', 'wb-document-rijnmond-kort'],
  ['weerbewaking_fey.html', 'wb-document-feyenoord'],
  ['vlaggenweer.html', 'wb-document-vlaggenweer'],
];

for (const [bestand, variant] of documenten) {
  const html = fs.readFileSync(path.join(root, bestand), 'utf8');
  assert.match(html, /weerbewaking_document_ui\.css\?v=20260823-v1/, `${bestand}: gedeelde stijl ontbreekt`);
  const uiVersie = bestand === 'vlaggenweer.html' ? '20260823-v1' : '20260829-opgesteld-v1';
  assert.match(html, new RegExp(`weerbewaking_document_ui\\.js\\?v=${uiVersie}`), `${bestand}: gedeelde UI-logica ontbreekt`);
  assert.match(html, new RegExp(`<body class="[^"]*wb-document-ui[^"]*${variant}`), `${bestand}: documentvariant ontbreekt`);
}

for (const bestand of documenten.slice(0, 6).map(([naam]) => naam)) {
  const html = fs.readFileSync(path.join(root, bestand), 'utf8');
  assert.match(html, />PDF maken<|exporteerPDF\(\)/, `${bestand}: PDF-actie ontbreekt`);
  assert.match(html, /class="btn-instellingen"/, `${bestand}: inklapbare opties ontbreken`);
  assert.match(html, /onclick="zetNu\(\)"[^>]*>Opgesteld: nu</, `${bestand}: losse opsteltijdknop ontbreekt`);
  assert.match(html, /onclick="herlaadTabel\(\)"[^>]*>Tabel opnieuw instellen</, `${bestand}: expliciete tabelknop ontbreekt`);
  const zetNu = html.match(/function zetNu\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(zetNu, `${bestand}: zetNu ontbreekt`);
  assert.doesNotMatch(zetNu[1], /doc-datum|dispatchEvent|herlaadTabel|laadData/, `${bestand}: opsteltijdknop mag de tabel niet verversen`);
}

const rrdk = fs.readFileSync(path.join(root, 'weerbewaking_ridderkerk_rhoon_dekuip.html'), 'utf8');
for (const param of ['temp', 'cloud', 'wind', 'rainmm']) {
  assert.match(rrdk, new RegExp(`data-pluim-param="${param}"`), `RRDK: pluimkeuze ${param} ontbreekt`);
}
assert.match(rrdk, /id="pluim-run-slot"/, 'RRDK: ECMWF-run heeft geen plek binnen de pluimopties');
assert.match(rrdk, /params:\s*params/, 'RRDK: gekozen pluimtypes worden niet aan de export doorgegeven');

const css = fs.readFileSync(path.join(root, 'weerbewaking_document_ui.css'), 'utf8');
assert.match(css, /@media\(max-width:700px\)/, 'mobiele documentstijl ontbreekt');
assert.match(css, /@media print/, 'afdrukregels ontbreken');

console.log('weerbewaking-documenten: 7 editors delen één UI en RRDK biedt 4 pluimkeuzes');
