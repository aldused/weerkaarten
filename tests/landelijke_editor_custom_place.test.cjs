'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bundlePath = path.join(root, 'landelijke-editor-assets/weerbewaking_landelijke_kaart-pc6L27QC.js');
const source = fs.readFileSync(bundlePath, 'utf8');

assert.match(source, /\[customPoint,setCustomPoint\]=z\.useState\(\{label:"",value:"",dir:"ZW",bft:"3",icon:"zon"\}\)/,
  'de invoerstatus voor een eigen weerpunt ontbreekt');
assert.match(source, /aria-label":"Eigen plaats toevoegen"/,
  'het formulier voor een eigen plaats ontbreekt');
for (const label of [
  'Plaatsnaam eigen weerpunt',
  'Temperatuur eigen weerpunt',
  'Windkracht eigen weerpunt',
  'Windrichting eigen weerpunt',
  'Weersymbool eigen weerpunt',
]) {
  assert.match(source, new RegExp(label), `${label} ontbreekt`);
}
assert.match(source, /customPointAdd=z\.useCallback/,
  'de plaatsactie voor een eigen weerpunt ontbreekt');
assert.match(source, /type:"mosmixPoint",source:"Handmatig",custom:!0/,
  'een eigen plaats gebruikt niet hetzelfde samengestelde kaartpunt als de landelijke stations');
assert.match(source, /children:"＋ Plaats eigen weerpunt"/,
  'de knop om het eigen weerpunt te plaatsen ontbreekt');
assert.match(source, /Plaatsnaam eigen weerpunt bewerken/,
  'de plaatsnaam is na plaatsing niet meer aanpasbaar');
assert.match(source, /transform:`translate\(\$\{D\+24\},0\) rotate\(\$\{Gi\(o\.dir\)\+180\}\)`/,
  'de stationspijl toont niet de stroming van herkomst naar bestemming');
assert.match(source, /const Y=\(\(Gi\(o\.dir\)\+180\)%360-90\)\*Math\.PI\/180/,
  'de losse windpijl toont niet de stroming van herkomst naar bestemming');
assert.match(source, /aria-label":"Wind tonen bij dit station"/,
  'wind kan niet per MOSMIX-station worden verborgen');
assert.match(source, /aria-label":"Wind tonen in eigenschappen"/,
  'de windkeuze ontbreekt in het eigenschappenpaneel');
assert.match(source, /o\.dir&&o\.showWind===!0&&r\.jsxs\("g"/,
  'stationswind wordt niet uitsluitend na expliciet inschakelen getekend');
assert.ok((source.match(/showWind:!1/g) || []).length >= 3,
  'MOSMIX-, WeatherPro- en eigen punten starten niet allemaal zonder wind');
assert.equal((source.match(/checked:E\.showWind===!0/g) || []).length, 2,
  'de windschakelaars starten niet uit');
assert.match(source, /x:D,y:-29,width:160,height:58/,
  'het windvak heeft niet de extra breedte en hoogte');
assert.match(source, /translate\(\$\{D\+24\},0\).*x:D\+84.*x:D\+143/s,
  'pijl, windrichting en Bft hebben niet voldoende onderlinge afstand');
assert.match(source, /station:"Vlissingen",weatherPro:"vlissingen",label:"VLISSINGEN",rdX:30475\.2,rdY:385185\.5,badgeSide:"right"/,
  'het bredere windvak van Vlissingen staat niet aan de binnenzijde van de kaart');
assert.match(source, /station:"Enschede",weatherPro:"enschede",label:"ENSCHEDE",rdX:257493,rdY:477394\.1,badgeSide:"left"/,
  'het bredere windvak van Enschede staat niet aan de binnenzijde van de kaart');
assert.match(source, /\[mapHeaderText,setMapHeaderText\]=z\.useState/,
  'de koptekststatus voor de landelijke kaart ontbreekt');
assert.match(source, /aria-label":"Koptekst landelijke kaart"/,
  'het invoerveld voor de koptekst ontbreekt');
assert.match(source, /line2:mapHeaderText/,
  'de koptekst wordt niet direct onder de datum getekend');
assert.match(source, /Math\.max\(pA\.line1\.length.*\(pA\.line2\|\|""\)\.length\*17\.2\)/,
  'het kopvlak past zich niet aan een langere koptekst aan');
assert.match(source, /height:pA\.line2\?98:52/,
  'het kopvlak biedt niet meer verticale ruimte voor de koptekst');
assert.match(source, /pA\.line2&&r\.jsx\("text",\{x:34,y:89/,
  'de koptekst staat niet met extra afstand onder de datum');
assert.match(source, /\[showSymbolCatalog,setShowSymbolCatalog\]=z\.useState\(!1\)/,
  'de symbolencatalogus start niet ingeklapt');
assert.match(source, /children:showSymbolCatalog\?"🖼 Symbolen verbergen":"🖼 Symbolen tonen"/,
  'de knop om symbolen te tonen of verbergen ontbreekt');
assert.match(source, /showSymbolCatalog&&!\["plume","knmi"\]\.includes\(Vg\)&&tn\.length>0/,
  'recente symbolen blijven zichtbaar wanneer de catalogus is ingeklapt');
assert.equal((source.match(/aria-label":"Wind tonen bij dit station"/g) || []).length, 1,
  'de windschakelaar is meer dan één keer ingevoegd');

console.log('landelijke editor: eigen plaats en windpijlrichting zijn volledig gekoppeld');
