const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bundle = fs.readFileSync(
  path.join(root, 'landelijke-editor-assets/weerbewaking_landelijke_kaart-pc6L27QC.js'),
  'utf8',
);

assert.match(
  bundle,
  /\[weekStartOffset,setWeekStartOffset\]=z\.useState\(0\)/,
  'de landelijke editor bewaart geen startkeuze voor de meerdaagse',
);
assert.match(
  bundle,
  /Array\.from\(\{length:7\},\(D,H\)=>ye\(H\+weekOffset\)\)/,
  'de zeven datums schuiven niet mee met de startkeuze',
);
assert.equal(
  (bundle.match(/ye\(M\+weekOffset\+1\)/g) || []).length,
  3,
  'de minimumtemperaturen van MOSMIX en WeatherPro volgen de gekozen dag niet volledig',
);
assert.match(
  bundle,
  /\[\["Vandaag",0\],\["Morgen",1\]\]/,
  'de gebruiker kan niet tussen vandaag en morgen kiezen',
);
assert.match(
  bundle,
  /onClick:\(\)=>\{setWeekStartOffset\(c\),Ne\.data&&mg\(c\)\}/,
  'een nieuwe startkeuze bouwt de kaart niet meteen opnieuw op',
);
assert.match(
  bundle,
  /children:lA\[0\]&&lA\[0\]\.date===ye\(1\)\?Ss\(\(IA==null\?void 0:IA\.weekday\)\|\|""\)\.toUpperCase\(\)\+" \+ 6":"VANDAAG \+ 6"/,
  'de badge op de kaart noemt de echte weekdag niet',
);
assert.match(
  bundle,
  /children:se===0&&tA\.date===ye\(0\)\?"VANDAAG":Ss/,
  'de eerste rij op een kaart vanaf morgen krijgt niet de echte weekdag',
);
assert.match(
  bundle,
  /children:\[c===0&&o\.date===ye\(0\)\?"Vandaag":Ss/,
  'het eigenschappenpaneel noemt de echte eerste weekdag niet',
);
assert.doesNotMatch(bundle, /"MORGEN \+ 6"/, 'de kaartbadge gebruikt nog het relatieve label Morgen');
assert.match(
  bundle,
  /weekEditDay===0&&weekDay\.date===ye\(0\)\?"Vandaag":Ss/,
  'de dagbewerking gebruikt bij een verschoven start niet de echte weekdag',
);
assert.match(
  bundle,
  /children:"Bijgewerkt"\}\),r\.jsx\(OA,\{value:E\.updated\|\|"",onChange:o=>V\(E\.id,\{updated:o\.target\.value\}\)/,
  'de tekst Bijgewerkt op kan niet handmatig worden aangepast',
);
assert.match(
  bundle,
  /children:\["Bijgewerkt op ",o\.updated\]/,
  'de aangepaste bijgewerkttekst wordt niet op de kaart getoond',
);
assert.match(
  bundle,
  /children:"Bijgewerkt op \(datum en tijd\)"\}\),r\.jsx\("input",\{"aria-label":"Bijgewerkt op datum en tijd",type:"text",value:E\.updated\|\|"",onChange:o=>V\(E\.id,\{updated:o\.target\.value\}\)/,
  'datum en tijd zijn niet zichtbaar aanpasbaar in de snelle dagbewerking',
);
assert.equal(
  new Intl.DateTimeFormat('nl-NL', { weekday: 'long', timeZone: 'Europe/Amsterdam' })
    .format(new Date('2026-08-16T12:00:00Z')),
  'zondag',
  'één dag na zaterdag 15 augustus 2026 moet zondag heten',
);
assert.match(
  bundle,
  /\[weekEditDay,setWeekEditDay\]=z\.useState\(null\)/,
  'de geselecteerde dag voor snelbewerking wordt niet bewaard',
);
assert.match(
  bundle,
  /weekDayEvent=>\{weekDayEvent\.stopPropagation\(\),ai\.current=!0,n\(o\.id\),setWeekEditDay\(se\)\},onClick:weekDayClick=>weekDayClick\.stopPropagation\(\)/,
  'een dagrij opent de snelbewerking niet',
);
assert.match(
  bundle,
  /width:970,height:1250,rx:32,fill:"none",\.\.\.He\}\),r\.jsxs\("g",\{style:\{pointerEvents:"all"\}/,
  'de dagrijen blijven door de kaartlaag onaanklikbaar',
);
assert.match(
  bundle,
  /aria-label":"Meerdaagse dag snel bewerken"/,
  'de meerdaagse heeft geen eigen snelbewerkingsvenster',
);
assert.match(
  bundle,
  /\[\["Maximum laag","maxTempLow",-50,60\],\["Maximum hoog","maxTempHigh",-50,60\],\["Minimum laag","minTempLow",-50,60\],\["Minimum hoog","minTempHigh",-50,60\]\]/,
  'de landelijke temperatuurbandbreedte is niet snel aanpasbaar',
);
assert.match(
  bundle,
  /\[\["Bft minimum","windBftMin"\],\["Bft maximum","windBftMax"\]\]/,
  'de windbandbreedte is niet snel aanpasbaar',
);
assert.match(
  bundle,
  /Kies \$\{WA\[o\]\} voor meerdaagse dag/,
  'de compacte weersymboolknoppen ontbreken bij de meerdaagse',
);
assert.match(
  bundle,
  /Alle weersymbolen voor meerdaagse dag/,
  'de volledige symboolkeuze ontbreekt bij de meerdaagse',
);

console.log('meerdaagse-editor: start op vandaag of morgen is volledig gekoppeld');
