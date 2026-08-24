const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bundles = [
  'landelijke-editor-assets/weerbewaking_landelijke_kaart-pc6L27QC.js',
  'regio-editor-assets/weerbewaking_regio_kaart-DCFOt_3t.js',
];

for (const file of bundles) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(source, /Array\.isArray\(A\.times_ms\)/, `${file}: echte tijdas ontbreekt`);
  assert.match(source, /rainP50:/, `${file}: neerslagmediaan ontbreekt`);
  assert.match(source, /\["rainP50"\]|line\("rainP50"/, `${file}: neerslaglijn gebruikt niet P50`);
  assert.match(source, /blauwe lijn = mediaan \(P50\)|lijn = mediaan in mm|mm: (?:lijn )?P50/, `${file}: onjuist neerslaglabel`);
  assert.match(source, /windP10:ne\(d,\.1\).*windP50:ne\(d,\.5\).*windP90:ne\(d,\.9\)/, `${file}: windpercentielen blijven niet in km\/u bewaard`);
  assert.match(source, /km\/u links · Beaufort \(Bft\) rechts/, `${file}: dubbele windeenheid ontbreekt`);
  assert.match(source, /" Bft"/, `${file}: Beaufort-rechteras ontbreekt`);
  assert.match(source, /km\/u links/, `${file}: km\/u-linkeras ontbreekt`);
  assert.match(source, /strokeWidth:(?:3|q\.gradient\?4\.5:3),strokeLinecap:(?:"butt"|q\.gradient\?"round":"butt")/, `${file}: windlijn is niet dun en hoekig`);
  assert.match(source, /(?:berekeningen|leden) · run /, `${file}: gekozen run ontbreekt in de kaartkop`);
  assert.match(source, /coverageHours/, `${file}: werkelijke looptijd ontbreekt in de kaartkop`);
  assert.doesNotMatch(source, /berekeningen · circa 15 dagen/, `${file}: vaste en onjuiste 15-daagse kaartkop is nog aanwezig`);
  assert.doesNotMatch(source, /\[1,5,11,19,28,38,49,61,74,88,102,117\]/, `${file}: oude Bft-grenzen aanwezig`);
}

const national = fs.readFileSync(path.join(root, bundles[0]), 'utf8');
for (const [variable, filename] of Object.entries({
  Fo: 'bg_nederland_dag.png',
  zw: 'bg_nederland_nacht.png',
  Lw: 'bg_nederland_grenzen_dag.png',
  Pw: 'bg_nederland_grenzen_nacht.png',
})) {
  const match = national.match(new RegExp(`${variable}="data:image/png;base64,([A-Za-z0-9+/=]+)"`));
  assert.ok(match, `landelijke editor: kaartachtergrond ${variable} ontbreekt`);
  assert.deepEqual(
    Buffer.from(match[1], 'base64'),
    fs.readFileSync(path.join(root, 'scripts/assets/nederlandkaart', filename)),
    `landelijke editor: kaartachtergrond ${filename} is niet bijgewerkt`,
  );
}
assert.match(national, /Zoek plaats voor pluim/, 'landelijke editor: plaatszoeker ontbreekt');
assert.match(national, /geocoding-api\.open-meteo\.com\/v1\/search/, 'landelijke editor: geocoding ontbreekt');
assert.match(national, /weerlabPlumeMemberKeys/, 'landelijke editor: validatie van ensembleleden ontbreekt');
assert.match(national, /exact 51 vereist/, 'landelijke editor: exact 51 leden wordt niet afgedwongen');
assert.match(national, /start_hour/, 'landelijke editor: geverifieerde start van de run ontbreekt');
assert.match(national, /end_hour/, 'landelijke editor: geverifieerd einde van de run ontbreekt');
assert.match(national, /ECMWF-run wisselde tijdens het laden/, 'landelijke editor: coherentiecontrole ontbreekt');
assert.match(national, /latitude:c\.lat,longitude:c\.lon/, 'landelijke editor: gekozen coördinaten ontbreken in het kaartobject');
assert.doesNotMatch(national, /children:"MOSMIX-plaats"/, 'landelijke editor: vaste pluimplaatsen zijn nog zichtbaar');
assert.doesNotMatch(national, /value:LA\.stationSlug/, 'landelijke editor: oude vaste pluimselectie is nog actief');
assert.match(national, /Samenstelling · vier van zeven/, 'landelijke editor: keuzelijsten voor vier pluimvakken ontbreken');
assert.match(national, /weerlabPlumePanelKeys/, 'landelijke editor: vier unieke pluimvakken worden niet bewaakt');
assert.match(national, /relative_humidity_2m/, 'landelijke editor: relatieve vochtigheid ontbreekt in de ECMWF-aanvraag');
assert.match(national, /wind_gusts_10m/, 'landelijke editor: windstoten ontbreken in de ECMWF-aanvraag');
assert.match(national, /WeerlabPlumeRuns\?\.ensureLocation\?\.\(e\.lat,e\.lon\)/,
  'landelijke editor: vrije pluimlocatie wordt niet eerst coherent naar live teruggezet');
assert.match(national, /weerlab_unavailable_variables/,
  'landelijke editor: optioneel ontbrekende runvelden worden niet herkend');
assert.match(national, /if\(v==null\)throw new Error/,
  'landelijke editor: nullwaarden kunnen nog stil als nul worden geïnterpreteerd');
assert.match(national, /rainCumP50/, 'landelijke editor: neerslagaccumulatie ontbreekt');
for (const field of [
  'tempMin', 'tempMax', 'windMin', 'windMax', 'gustMin', 'gustMax',
  'humidityMin', 'humidityMax', 'rainCumMin', 'rainCumMax', 'rainMin', 'rainMax',
]) {
  assert.match(national, new RegExp(`${field}:`), `landelijke editor: ${field} voor volledige ledenmarge ontbreekt`);
}
assert.match(national, /rainP10:ne\(O,.1\).*rainP25:ne\(O,.25\)/, 'landelijke editor: robuuste neerslagbanden ontbreken');
assert.match(national, /low:"tempMin".*high:"tempMax"/, 'landelijke editor: temperatuuras gebruikt niet alle 51 leden');
assert.match(national, /band\("rainP10","rainP90",H\)/, 'landelijke editor: middelste 80%-neerslagband wordt niet getekend');
assert.match(national, /band\("rainP25","rainP75",H\)/, 'landelijke editor: middelste 50%-neerslagband wordt niet getekend');
assert.match(national, /rain-extreme-/, 'landelijke editor: extreme neerslagleden worden niet gemarkeerd');
assert.match(national, /alle 51 leden \(min–max\)/, 'landelijke editor: volledige spreiding staat niet in de legenda');
assert.match(national, /middelste 50% · lijn P50/, 'landelijke editor: mediaanlijn staat niet in de bandlegenda');
assert.match(national, /y1:P-44,y2:P-44.*strokeDasharray:"4 3"/, 'landelijke editor: min-maxlijn staat niet in de bandlegenda');
assert.match(national, /cloud-legend-/, 'landelijke editor: bewolkingsklassen hebben geen legenda');
assert.match(national, /p=C\+u-68/, 'landelijke editor: rechteras heeft onvoldoende paneelmarge');
assert.ok((national.match(/legend:!0/g) || []).length >= 5, 'landelijke editor: niet ieder bandpaneel verklaart zijn marges');
assert.match(national, /panelKeys:\["temperature","precipitation","wind","cloud"\]/, 'landelijke editor: standaardvierluik ontbreekt');
assert.match(national, /weerlabOptionalNumber/, 'landelijke editor: ontbrekende extra waarden kunnen nog als nul worden gelezen');
assert.match(national, /weerlabMatrixHasValues/, 'landelijke editor: extra panelen worden niet op echte waarden gecontroleerd');
assert.match(national, /number=P=>\{if\(P==null\|\|P===""\)return null;/, 'landelijke editor: lege 6-uursposities worden in de renderer nog als nul gelezen');
assert.match(national, /BREDE BAND = ONZEKER/, 'landelijke editor: onzekerheidsuitleg ontbreekt uit de kaartkop');
assert.match(national, /plume-temp-/, 'landelijke editor: temperatuurkleurverloop ontbreekt');
assert.match(national, /weekday:"long",day:"numeric",month:"long"/, 'landelijke editor: datum van de ECMWF-run ontbreekt');
assert.match(national, /runHour\+" UTC"\+\(runDate\?" · "\+runDate/, 'landelijke editor: kaartkop toont de rundatum niet naast het runuur');
assert.match(national, /w=1320/, 'landelijke editor: pluim past niet volledig binnen het 1440px-canvas');
assert.match(national, /top=k\+200,panelHeight=165,gap=282/, 'landelijke editor: panelen gebruiken de beschikbare hoogte niet goed');
assert.match(national, /height:o\+108,rx:20/, 'landelijke editor: datumstrook valt nog buiten de paneelrand');
assert.match(national, /y:P\+o\+22,textAnchor:"middle"/, 'landelijke editor: dagnaam staat nog op de grafiekrand');
assert.match(national, /y:P\+o\+40,textAnchor:"middle"/, 'landelijke editor: datum heeft onvoldoende ruimte onder de dagnaam');
assert.match(national, /month:"short"/, 'landelijke editor: maand ontbreekt bij de datumlabels');
assert.match(national, /y:P-54,width:210,height:54/, 'landelijke editor: temperatuurlegenda staat nog over de pluimband');
assert.match(national, /!\["plume","knmi"\]\.includes\(Vg\)&&tn\.length>0/, 'landelijke editor: recente symbolen blijven zichtbaar bij pluim of KNMI-metingen');
assert.match(national, /!\["plume","knmi"\]\.includes\(Vg\)&&r\.jsxs\("div",\{style:\{display:"flex",alignItems:"center",gap:5,margin:"5px 0 6px"/, 'landelijke editor: symboolfilters blijven zichtbaar bij pluim of KNMI-metingen');
assert.match(national, /\["plume","knmi"\]\.includes\(Vg\)\?null:K==="alles"\?Ol\.map/, 'landelijke editor: symbolencatalogus blijft zichtbaar bij pluim of KNMI-metingen');
assert.match(national, /!\["plume","knmi"\]\.includes\(Vg\)&&r\.jsxs\("div",\{style:\{background:"#1a2436",borderBottom:[\s\S]{0,500}children:"TOEVOEGEN"/, 'landelijke editor: algemene toevoegbalk blijft zichtbaar bij pluim of KNMI-metingen');
assert.doesNotMatch(national, /(?:!\["plume","knmi"\]\.includes\(Vg\)&&){2}/, 'landelijke editor: zichtbaarheidsguard is dubbel gepatcht');
assert.doesNotMatch(national, /(?:\["plume","knmi"\]\.includes\(Vg\)\?null:){2}/, 'landelijke editor: catalogusguard is dubbel gepatcht');
assert.match(national, /children:"TOEVOEGEN"/, 'landelijke editor: onderste werkbalk heeft geen duidelijke functieaanduiding');
assert.doesNotMatch(national, /onClick:qo,style:qe\(g==="plumeNl"\)/, 'landelijke editor: Pluim staat nog dubbel in de onderste werkbalk');
assert.doesNotMatch(national, /onClick:hi,style:qe\(g==="knmiExtremes"\)/, 'landelijke editor: KNMI-metingen staat nog dubbel in de onderste werkbalk');
assert.doesNotMatch(national, /onClick:\(\)=>\{Se\("single"\),Zo\(\)\},style:qe\(g==="mosmixNl"/, 'landelijke editor: Verwachting staat nog dubbel in de onderste werkbalk');
assert.match(national, /weerbewaking_landelijke_meerdaagse\.html/, 'landelijke editor: aparte meerdaagse pagina ontbreekt in het hoofdmenu');
assert.match(national, /weerbewaking_landelijke_pluim\.html/, 'landelijke editor: aparte pluimpagina ontbreekt in het hoofdmenu');
assert.match(national, /weerbewaking_knmi_metingen\.html/, 'landelijke editor: aparte KNMI-meetpagina ontbreekt in het hoofdmenu');
assert.match(national, /history\.replaceState\(null,"",f\)/, 'landelijke editor: hoofdmenu herlaadt de pagina nog volledig en kan daardoor knipperen');
assert.doesNotMatch(national, /if\(c&&!window\.location\.pathname\.endsWith\("\/"\+c\)\)\{window\.location\.href=c;return\}/, 'landelijke editor: landelijke paginawissels veroorzaken nog een volledige herlading');
assert.match(national, /window\.parent\.postMessage\(\{type:"weerlab-editor-mode",mode:o\}/, 'landelijke editor: hoofdmenu opent de vijf losse websitepanelen niet');
assert.match(national, /window\.parent!==window&&!c/, 'landelijke editor: iframe kan zijn eigen paginamodus niet lokaal toepassen');
assert.match(national, /_o\(c,!0\)/, 'landelijke editor: wrappermodus valt nog terug op Kaart Landelijk');
assert.match(national, /weerlab:editor-mode-change/, 'landelijke editor: de runbalk volgt de gekozen editorpagina niet');
assert.match(national, /weerlab:plume-run-change/, 'landelijke editor: een runwissel ververst de gekozen pluim niet');
assert.match(national, /plumeElementRefresh/, 'landelijke editor: een geplaatste pluim blijft niet gekoppeld aan de nieuwe run');
assert.equal((national.match(/plumeRunRefresh=/g) || []).length, 1, 'landelijke editor: pluim-runlistener is dubbel ingevoegd');
assert.equal((national.match(/plumeElementRefresh=/g) || []).length, 1, 'landelijke editor: pluim-elementkoppeling is dubbel ingevoegd');
assert.match(national, /plumeInitialOpen=z\.useEffect/, 'landelijke editor: pluimpagina opent niet direct met de nieuwste pluim');
assert.match(national, /Vo\(\{name:"De Bilt",lat:52\.101,lon:5\.178\}\)/, 'landelijke editor: standaardpluim voor De Bilt ontbreekt');
assert.match(national, /plumeInitial\.current="placed",Yg\(\)/, 'landelijke editor: geladen standaardpluim wordt niet direct op het canvas geplaatst');
assert.match(national, /knmiInitialOpen=z\.useEffect/, 'landelijke editor: KNMI-pagina opent niet direct met de nieuwste metingen');
assert.match(national, /knmiInitial\.current=!0,bg\(\)/, 'landelijke editor: nieuwste KNMI-metingen worden niet direct op het canvas geplaatst');
assert.match(national, /n\(null\),x\("knmiExtremes"\);const M=v\.night===!0/, 'landelijke editor: KNMI-keuzepaneel sluit na het plaatsen van een meetkaart');
assert.match(national, /n\(null\),x\("plumeNl"\),S\("nederland"\),d\(!1\)/, 'landelijke editor: pluimkeuzepaneel sluit na het plaatsen van een pluim');
assert.match(national, /weekInitialOpen=z\.useEffect/, 'landelijke editor: meerdaagse pagina opent niet direct met de actuele zeven dagen');
assert.match(national, /TA==="week"&&o&&!weekInitial\.current&&\(weekInitial\.current=!0,mg\(weekStartOffset\)\)/, 'landelijke editor: geladen meerdaagse wordt niet direct met de gekozen startdag op het canvas geplaatst');
assert.match(national, /n\(null\),x\("mosmixNl"\),S\("nederland"\),d\(!1\),p\(dt\.nederland\.day\)\},\[hA,Z\.data,wA\.data,qA,weekStartOffset\]\)/, 'landelijke editor: meerdaagse keuzepaneel sluit na het plaatsen van de zeven dagen');
assert.match(national, /data-weerlab-hidden-mode-nav/, 'landelijke editor: dubbele interne paginanavigatie is nog zichtbaar');
assert.doesNotMatch(national, /gridTemplateColumns:"repeat\(5,minmax\(0,1fr\)\)"/, 'landelijke editor: vijfvoudige interne navigatie wordt nog opgebouwd');
const regional = fs.readFileSync(path.join(root, bundles[1]), 'utf8');
assert.doesNotMatch(regional, /Samenstelling · vier van zeven|weerlabPlumePanelKeys|rainCumP50/, 'regionale editor is onbedoeld aangepast');
assert.match(regional, /\(\(A==null\?void 0:A\.members\)\|\|\{\}\)\.temperature_2m\|\|\(A==null\?void 0:A\.temp_members\)/,
  'regionale editor: directe members-map valt nog terug op uitsluitend legacyvelden');
assert.match(regional, /data-weerlab-hidden-mode-nav/, 'regionale editor: dubbele interne paginanavigatie is nog zichtbaar');
assert.doesNotMatch(regional, /gridTemplateColumns:"repeat\(5,minmax\(0,1fr\)\)"/, 'regionale editor: vijfvoudige interne navigatie wordt nog opgebouwd');

const helperStart = national.indexOf('async function weerlabPlumeJson');
const helperEnd = national.indexOf('let lt=1;function Ah()', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'landelijke editor: pluimhelpers zijn niet isoleerbaar');
const plumeHelpers = new Function(
  `${national.slice(helperStart, helperEnd)};return {document:weerlabPlumeDocument,panelKeys:weerlabPlumePanelKeys}`,
)();
assert.deepEqual(
  plumeHelpers.panelKeys({}),
  ['temperature', 'precipitation', 'wind', 'cloud'],
  'landelijke editor: oude layouts krijgen niet automatisch het standaardvierluik',
);
assert.deepEqual(
  plumeHelpers.panelKeys({ panelKeys: ['humidity', 'humidity', 'gusts', 'accumulation'] }),
  ['humidity', 'gusts', 'accumulation', 'temperature'],
  'landelijke editor: dubbele keuzes worden niet geblokkeerd of aangevuld tot vier',
);
assert.deepEqual(
  plumeHelpers.panelKeys({
    panelKeys: ['humidity', 'gusts', 'wind', 'cloud'],
    availablePanels: ['temperature', 'precipitation', 'wind', 'cloud', 'gusts'],
  }),
  ['gusts', 'wind', 'cloud', 'temperature'],
  'landelijke editor: een ontbrekend optioneel paneel wordt niet door beschikbare pluimgrafieken vervangen',
);
const startMs = Date.UTC(2026, 7, 8, 12);
const valueTimes = Array.from({ length: 121 }, (_, index) => new Date(startMs + index * 3 * 3_600_000).toISOString().slice(0, 16));
const boundary = new Date(startMs + 121 * 3 * 3_600_000).toISOString().slice(0, 16);
const hourly = { time: [...valueTimes, boundary] };
for (const base of ['temperature_2m', 'precipitation', 'wind_speed_10m', 'cloud_cover', 'relative_humidity_2m', 'wind_gusts_10m']) {
  for (let member = 0; member < 51; member++) {
    const key = member === 0 ? base : `${base}_member${String(member).padStart(2, '0')}`;
    hourly[key] = Array.from({ length: 121 }, (_, index) => base === 'precipitation'
      ? (member === 50 && index === 2 ? 12 : 0)
      : member + index / 10);
  }
}
const dynamicDocument = plumeHelpers.document(
  { latitude: 52, longitude: 4.5, hourly },
  {
    last_run_initialisation_time: startMs / 1000,
    data_end_time: (startMs + 121 * 3 * 3_600_000) / 1000,
    last_run_modification_time: startMs / 1000,
  },
  { name: 'Bergschenhoek', lat: 51.99, lon: 4.49861 },
);
assert.equal(dynamicDocument.station, 'Bergschenhoek');
assert.equal(dynamicDocument.runs[0].temp_members.length, 51);
assert.equal(dynamicDocument.runs[0].precip_members.length, 51);
assert.equal(dynamicDocument.runs[0].humidity_members.length, 51);
assert.equal(dynamicDocument.runs[0].gust_members.length, 51);
assert.equal(dynamicDocument.runs[0].times_ms.length, 121);

const coreHourly = Object.fromEntries(
  Object.entries(hourly).filter(([key]) => !key.startsWith('relative_humidity_2m')),
);
const coreDocument = plumeHelpers.document(
  {
    latitude: 52,
    longitude: 4.5,
    hourly: coreHourly,
    weerlab_unavailable_variables: ['relative_humidity_2m'],
  },
  {
    last_run_initialisation_time: startMs / 1000,
    data_end_time: (startMs + 121 * 3 * 3_600_000) / 1000,
    last_run_modification_time: startMs / 1000,
  },
  { name: 'De Bilt', lat: 52.101, lon: 5.178 },
);
assert.deepEqual(coreDocument.runs[0].humidity_members, [],
  'landelijke editor: direct-core zonder vocht wordt niet als optioneel ontbrekend bewaard');

const summaryStart = national.indexOf('qw=e=>');
const summaryEnd = national.indexOf(',_w=async e=>', summaryStart);
assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, 'landelijke editor: pluimsamenvatting is niet isoleerbaar');
const summariseNationalPlume = new Function(`
  let qw;
  const Le = value => { const number = Number(value); return Number.isFinite(number) ? number : null; };
  const ne = (values, fraction) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position), upper = Math.ceil(position);
    return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };
  const Uw = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const jg = values => values;
  const au = 6;
  ${national.slice(summaryStart, summaryEnd)};
  return qw;
`)();
const previousPlumeRuns = globalThis.WeerlabPlumeRuns;
globalThis.WeerlabPlumeRuns = { selectedRunIso: () => dynamicDocument.runs[0].run };
const dynamicSummary = summariseNationalPlume(dynamicDocument);
globalThis.WeerlabPlumeRuns = previousPlumeRuns;
assert.ok(dynamicSummary.availablePanels.includes('humidity'), 'landelijke editor: relatieve vochtigheid wordt niet als beschikbaar gemarkeerd');
assert.ok(dynamicSummary.availablePanels.includes('gusts'), 'landelijke editor: windstoten worden niet als beschikbaar gemarkeerd');
assert.ok(dynamicSummary.points.some(point => Number.isFinite(point.humidityP50)), 'landelijke editor: vochtigheidslijn bevat geen numerieke waarden');
assert.ok(dynamicSummary.points.some(point => Number.isFinite(point.gustP50)), 'landelijke editor: windstotenlijn bevat geen numerieke waarden');
const wetOutlierPoint = dynamicSummary.points.find(point => point.rainMax === 12);
assert.ok(wetOutlierPoint, 'landelijke editor: 6-uursneerslag verliest het natte uitschieterlid');
assert.equal(wetOutlierPoint.rainP90, 0, 'landelijke editor: één nat lid vervormt de robuuste P90-band');
assert.ok(dynamicSummary.points.some(point => point.rainP50 == null), 'landelijke editor: niet-complete 6-uursvakken blijven niet leeg');
assert.deepEqual(
  [
    dynamicSummary.points[0].tempMin,
    dynamicSummary.points[0].tempP10,
    dynamicSummary.points[0].tempP25,
    dynamicSummary.points[0].tempP50,
    dynamicSummary.points[0].tempP75,
    dynamicSummary.points[0].tempP90,
    dynamicSummary.points[0].tempMax,
  ],
  [0, 5, 12.5, 25, 37.5, 45, 50],
  'landelijke editor: volledige temperatuurspreiding en middenbanden zijn niet uit dezelfde 51 leden berekend',
);

const directOnlyRun = { ...dynamicDocument.runs[0] };
directOnlyRun.members = {
  temperature_2m: directOnlyRun.temp_members,
  precipitation: directOnlyRun.precip_members,
  wind_speed_10m: directOnlyRun.wind_members,
  cloud_cover: directOnlyRun.cloud_members,
  wind_gusts_10m: directOnlyRun.gust_members,
};
delete directOnlyRun.temp_members;
delete directOnlyRun.precip_members;
delete directOnlyRun.wind_members;
delete directOnlyRun.cloud_members;
delete directOnlyRun.humidity_members;
delete directOnlyRun.gust_members;
const directOnlyDocument = { ...dynamicDocument, runs: [directOnlyRun] };
globalThis.WeerlabPlumeRuns = { selectedRunIso: () => directOnlyRun.run };
const directOnlySummary = summariseNationalPlume(directOnlyDocument);
globalThis.WeerlabPlumeRuns = previousPlumeRuns;
assert.equal(directOnlySummary.memberCount, 51, 'landelijke editor: directe members-map levert niet alle 51 leden');
assert.equal(directOnlySummary.points[0].tempMin, 0, 'landelijke editor: directe members-map verliest de minimumtemperatuur');
assert.equal(directOnlySummary.points[0].tempMax, 50, 'landelijke editor: directe members-map verliest de maximumtemperatuur');
assert.ok(!directOnlySummary.availablePanels.includes('humidity'),
  'landelijke editor: ontbrekend vocht wordt nog als beschikbaar paneel gemarkeerd');
assert.ok(directOnlySummary.points.every(point => point.humidityP50 == null),
  'landelijke editor: ontbrekend vocht wordt nog als 0% getekend');

const shortStartMs = Date.UTC(2026, 7, 8, 18);
const shortValueTimes = Array.from({ length: 49 }, (_, index) => new Date(shortStartMs + index * 3 * 3_600_000).toISOString().slice(0, 16));
const shortBoundary = new Date(shortStartMs + 49 * 3 * 3_600_000).toISOString().slice(0, 16);
const shortHourly = { time: [...shortValueTimes, shortBoundary] };
for (const base of ['temperature_2m', 'precipitation', 'wind_speed_10m', 'cloud_cover', 'relative_humidity_2m', 'wind_gusts_10m']) {
  for (let member = 0; member < 51; member++) {
    const key = member === 0 ? base : `${base}_member${String(member).padStart(2, '0')}`;
    shortHourly[key] = Array.from({ length: 49 }, (_, index) => base === 'precipitation' ? 0 : member + index / 10);
  }
}
const shortDocument = plumeHelpers.document(
  { latitude: 52, longitude: 4.5, hourly: shortHourly },
  {
    last_run_initialisation_time: shortStartMs / 1000,
    data_end_time: (shortStartMs + 49 * 3 * 3_600_000) / 1000,
    last_run_modification_time: shortStartMs / 1000,
  },
  { name: 'Rotterdam', lat: 51.9244, lon: 4.4777 },
);
assert.equal(shortDocument.runs[0].times_ms.length, 49, '18 UTC-tussenrun moet met zijn eigen kortere horizon geldig zijn');
assert.match(national, /shortRun=\[6,18\]/, 'editor maakt geen onderscheid tussen hoofd- en tussenruns');
assert.doesNotMatch(national, /geen volledige 15-daagse tijdas/, 'oude fout voor geldige 06\/18-tussenrun is nog aanwezig');

for (const page of [
  'pluim_interactief.html', 'weerbewaking_pluim.html', 'pluim_6_plus.html',
  'kleurpluim.html', 'pluim_6luik_debilt.html',
  'janvisser.html',
  'weerbewaking_ridderkerk_rhoon_dekuip.html',
]) {
  assert.match(fs.readFileSync(path.join(root, page), 'utf8'), /pluim_run_switcher_48ffbf926db6\.js/, `${page}: directe gezamenlijke 00\/06\/12\/18-runkeuze ontbreekt`);
}
for (const page of ['weerbewaking_landelijke_kaart.html', 'weerbewaking_landelijke_meerdaagse.html', 'weerbewaking_landelijke_pluim.html', 'weerbewaking_knmi_metingen.html', 'weerbewaking_regio_kaart.html']) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  assert.match(html, /pluim_run_switcher_48ffbf926db6\.js/, `${page}: directe pluimrunkeuze is niet cache-gebroken`);
  assert.match(html, /data-editor-mode-aware="true"/, `${page}: runbalk kan niet per editorpagina worden verborgen`);
  const required = html.match(/data-required="([^"]+)"/)?.[1] || '';
  assert.match(required, /temperature_2m,precipitation,wind_speed_10m,cloud_cover,wind_gusts_10m/,
    `${page}: directe kernvelden zijn niet als runvereiste vastgelegd`);
  assert.doesNotMatch(required, /relative_humidity_2m/,
    `${page}: optionele relatieve vochtigheid blokkeert nog historische kernruns`);
}
const simplePlumePage = fs.readFileSync(path.join(root, 'weerbewaking_landelijke_pluim.html'), 'utf8');
const simpleRequired = simplePlumePage.match(/data-required="([^"]+)"/)?.[1] || '';
assert.match(simpleRequired, /temperature_2m,precipitation,wind_speed_10m,cloud_cover,wind_gusts_10m/,
  'landelijke pluim: kernpanelen zijn niet als runvereiste vastgelegd');
assert.doesNotMatch(simpleRequired, /relative_humidity_2m/,
  'landelijke pluim: optionele relatieve vochtigheid blokkeert nog historische kernruns');
for (const page of ['weerbewaking_landelijke_kaart.html', 'weerbewaking_landelijke_meerdaagse.html', 'weerbewaking_landelijke_pluim.html', 'weerbewaking_knmi_metingen.html', 'weerbewaking_regio_kaart.html']) {
  const expectedVersion = page.includes('regio') ? /editor-pluim-v5/ : /windstandaarduit-v35/;
  assert.match(fs.readFileSync(path.join(root, page), 'utf8'), expectedVersion, `${page}: aangepaste editorbundel is niet cache-gebroken`);
}
assert.match(fs.readFileSync(path.join(root, 'weerbewaking_landelijke_meerdaagse.html'), 'utf8'), /WEERLAB_EDITOR_MODE = 'week'/, 'meerdaagse pagina opent niet rechtstreeks in de juiste modus');
assert.match(fs.readFileSync(path.join(root, 'weerbewaking_landelijke_pluim.html'), 'utf8'), /WEERLAB_EDITOR_MODE = 'plume'/, 'pluimpagina opent niet rechtstreeks in de juiste modus');
const knmiMeasurementsPage = fs.readFileSync(path.join(root, 'weerbewaking_knmi_metingen.html'), 'utf8');
assert.match(knmiMeasurementsPage, /WEERLAB_EDITOR_MODE = 'knmi'/, 'KNMI-pagina opent niet rechtstreeks in de juiste modus');
assert.match(knmiMeasurementsPage, /id="knmi-reload-button"/, 'KNMI-pagina mist de knop voor nieuwe metingen');
assert.match(knmiMeasurementsPage, /window\.location\.reload\(\)/, 'KNMI-herlaadknop vernieuwt het editorvenster niet');
assert.match(knmiMeasurementsPage, /MutationObserver\(syncVisibility\)/, 'KNMI-herlaadknop wordt niet na het ontgrendelen zichtbaar');
assert.match(fs.readFileSync(path.join(root, 'weerbewaking_regio_kaart.html'), 'utf8'), /WEERLAB_EDITOR_MODE = 'regio'/, 'regiopagina verbergt de pluimrunbalk niet');
const switcher = fs.readFileSync(path.join(root, 'pluim_run_switcher_48ffbf926db6.js'), 'utf8');
assert.match(switcher, /const CYCLES = \[0, 6, 12, 18\]/, 'runkeuze bevat niet alle vier IFS ENS-cycli');
assert.match(switcher, /weerlab_unavailable_variables/, 'oudere runs markeren nieuwe variabelen niet expliciet');
assert.match(switcher, /#weerlab-run-switcher~#root/, 'editorhoogte houdt geen rekening met de runkeuzebalk');
assert.match(switcher, /#weerlab-run-switcher\{position:sticky;top:0/, 'runkeuze blijft niet bovenin beeld tijdens het scrollen');
assert.match(switcher, /async function selectRunHour\(hour\)/, 'gezamenlijke runkeuze ontbreekt');
assert.match(switcher, /weerlab:plume-run-change/, 'runkeuze meldt de nieuwe run niet aan de pluimeditor');
assert.match(switcher, /if \(!editorModeAware && previousHour !== detail\.hour\)[\s\S]{0,160}location\.reload\(\)/, 'losse pluimpagina tekent een gekozen archiefrun niet opnieuw');
assert.match(switcher, /const MAX_ARCHIVE_AGE_MS = 24 \* HOUR_MS/, 'runkeuze begrenst oude cycli niet op de actuele reeks');
assert.match(switcher, /ageMs >= 0 && ageMs < MAX_ARCHIVE_AGE_MS/, 'een verouderde hoofdcyclus kan nog als actuele 00\/12-run worden aangeboden');
assert.match(switcher, /const fallback = newestSelectableRun\(state\.archive\)[\s\S]{0,180}state\.selectedHour = fallback \? fallback\.hour : liveHour\(\)/, 'een oude of verwijderde run-URL valt niet terug op de nieuwste cyclus');
assert.match(switcher, /weerlab:editor-mode-change/, 'runbalk reageert niet op een naadloze editorwissel');
assert.match(switcher, /state\.bar\.style\.display = visible \? 'flex' : 'none'/, 'runbalk wordt buiten de pluimpagina niet verborgen');
assert.doesNotMatch(switcher, /bar\.addEventListener\('click',[\s\S]{0,500}location\.href = url\.toString\(\)/, 'runkeuze herlaadt nog steeds de hele pluimpagina');
assert.match(switcher, /state\.metaReady = initialiseMeta\(\)/, 'actuele pluim wacht niet afzonderlijk op lichte metadata');
assert.match(switcher, /state\.archiveReady = state\.metaReady\.then\(initialiseArchive/, 'runarchief wordt niet los op de achtergrond gestart');
assert.match(switcher, /requestIdleCallback/, 'zwaar runarchief krijgt geen lagere prioriteit dan de actuele pluim');
assert.doesNotMatch(switcher, /Promise\.all\(\[\s*originalFetch[\s\S]{0,300}loadArchive/, 'actuele pluim wacht nog blokkerend op het runarchief');
const interceptedFetch = switcher.slice(switcher.indexOf('window.fetch = async function weerlabRunAwareFetch'));
assert.ok(
  interceptedFetch.indexOf('await state.metaReady') < interceptedFetch.indexOf('await state.archiveReady'),
  'actuele en gearchiveerde run hebben geen gescheiden laadpad',
);
assert.match(
  interceptedFetch,
  /await state\.archiveReady;[\s\S]{0,200}if \(!state\.selectedRun\)[\s\S]{0,500}return originalFetch\(input, init\)/,
  'terugval van een oude URL wordt na het archiefwachten niet opnieuw als live-aanvraag behandeld',
);
assert.match(switcher, /checkForNewRun/, 'controle op nieuwe 00\/06\/12\/18 UTC-runs ontbreekt');
assert.match(switcher, /window\.setInterval\(checkForNewRun, 60 \* 1000\)/, 'runcontrole loopt niet iedere minuut');

const plumeTrendPlist = fs.readFileSync(path.join(root, 'shell/nl.edaldus.pluimtrend.plist'), 'utf8');
assert.match(plumeTrendPlist, /<key>StartInterval<\/key>\s*<integer>60<\/integer>/, 'servercache controleert nieuwe runs niet iedere minuut');

const sixPanel = fs.readFileSync(path.join(root, 'pluim_6luik_debilt.html'), 'utf8');
assert.match(sixPanel, /const fmtRun = d => `\$\{DAGEN_KORT\[d\.getUTCDay\(\)\]\}/, '6-luik labelt niet de werkelijk geladen 00\/12 UTC-run');
assert.match(sixPanel, /runLabel: fmtRun\(init\)/, '6-luik koppelt het runlabel niet aan de geverifieerde initialisatie');
assert.doesNotMatch(sixPanel, /const synRun = beschikbareHoofdRun\(\)/, '6-luik toont nog een berekende hoofdcyclus in plaats van de werkelijke run');

const guardedSixPanel = fs.readFileSync(path.join(root, 'weerbewaking_pluim.html'), 'utf8');
assert.match(guardedSixPanel, /ongeldige cyclus/, 'hoofdpluim bewaakt de gekozen 00\/12 UTC-hoofdcyclus niet');
assert.match(guardedSixPanel, /window\.first !== 0 \|\| window\.lastExclusive !== times\.length/, 'hoofdpluim kan nog een gedeeltelijk geladen run tekenen');

const colourPlume = fs.readFileSync(path.join(root, 'kleurpluim.html'), 'utf8');
assert.match(colourPlume, /function clampPlumeRangeToRun\(meta\)/, 'kleurpluim begrenst de datumkeuze niet op de gekozen run');
assert.match(colourPlume, /clampPlumeRangeToRun\(meta\)/, 'kleurpluim past de runbegrenzing niet toe');
assert.match(colourPlume, /data_end_time \* 1000 - 1/, 'kleurpluim gebruikt het exclusieve einde van de gekozen run niet correct');
assert.match(colourPlume, /weerlab_unavailable_variables/, 'kleurpluim herkent ontbrekende velden in een oudere opgeslagen run niet');
assert.match(colourPlume, /results\.failedCount = failed/, '8-kleurpluim bewaart beschikbare panelen niet bij een gedeeltelijk oud archief');
assert.match(colourPlume, /Download \$\{results\.length\} beschikbare als ZIP/, 'kleurpluim biedt geen eerlijke gedeeltelijke ZIP bij een oude run');
assert.match(colourPlume, /cfg\.spatialAverage && !runMeta\?\.weerlab_archived_run/, 'oude kleurpluim mengt nog actuele omliggende roosterpunten bij');

const plumeExport = fs.readFileSync(path.join(root, 'weerbewaking_pluim_export.js'), 'utf8');
assert.match(plumeExport, /models\.unavailable = unavailable/, 'kleurpluimexport laat beschikbare 12 UTC-panelen nog samen uitvallen');
assert.match(plumeExport, /unavailable: models\.unavailable \|\| \[\]/, 'kleurpluimexport rapporteert ontbrekende oude-runvelden niet');

const mainIndex = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(
  mainIndex,
  /weerbewaking_landelijke_kaart\.html\?v=20260816-windstandaarduit-v39/,
  'hoofdpagina gebruikt nog een verouderde cacheversie van de landelijke editor',
);
for (const [panel, page, version] of [
  ['landelijkeeditor', 'weerbewaking_landelijke_kaart.html', '20260816-windstandaarduit-v39'],
  ['landelijkemeerdaagse', 'weerbewaking_landelijke_meerdaagse.html', '20260816-windstandaarduit-v43'],
  ['landelijkepluim', 'weerbewaking_landelijke_pluim.html', '20260816-windstandaarduit-v39'],
  ['regiokaart', 'weerbewaking_regio_kaart.html', '20260811-snel-v31'],
  ['knmimetingen', 'weerbewaking_knmi_metingen.html', '20260816-windstandaarduit-v7'],
]) {
  assert.match(mainIndex, new RegExp(`id="nav-${panel}"`), `hoofdpagina: menu-item ${panel} ontbreekt`);
  assert.match(mainIndex, new RegExp(`id="panel-${panel}"`), `hoofdpagina: apart paneel ${panel} ontbreekt`);
  assert.match(mainIndex, new RegExp(`${page.replace('.', '\\.')}\\?v=${version}`), `hoofdpagina: ${page} is niet als eigen pagina gekoppeld`);
}
assert.match(mainIndex, /KAARTEN_EDITOR_PANELEN/, 'hoofdpagina: berichtkoppeling voor de vijf editorpagina’s ontbreekt');
assert.match(mainIndex, /id="kaarten-editor-toggle"/, 'hoofdpagina: inklapbaar Kaarten Editor-tabblad ontbreekt');
assert.match(mainIndex, /aria-controls="kaarten-editor-menu"/, 'hoofdpagina: Kaarten Editor-tabblad is niet toegankelijk gekoppeld');
assert.match(mainIndex, /id="kaarten-editor-menu" hidden/, 'hoofdpagina: de vijf editorpagina’s staan niet samen in een inklapbaar menu');
assert.match(mainIndex, /KAARTEN_EDITOR_PANEL_IDS\.has\(panel\)\) openKaartenEditorMenu\(\)/, 'hoofdpagina: actieve editor opent zijn tabblad niet automatisch');
assert.match(mainIndex, /editorTab\.dataset\.searchWasOpen/, 'hoofdpagina: zoeken maakt de editorpagina’s niet tijdelijk zichtbaar');
assert.ok(
  mainIndex.indexOf('id="kaarten-editor-tab"') < mainIndex.indexOf('id="nav-weerbewaking"'),
  'hoofdpagina: Weerbewaking staat niet onderaan de afgeschermde tools',
);
assert.match(
  mainIndex,
  /kleurpluim\.html\?v=20260811-all-runs-v3/,
  'hoofdpagina gebruikt nog een verouderde cacheversie van de kleurpluim',
);
assert.match(
  fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
  /weerbewaking\.html\?v=20260810-pluim-runs-v10/,
  'hoofdpagina gebruikt nog een verouderde cacheversie van Weerbewaking',
);

console.log(`pluim-editors: ${bundles.length} productiebundels voldoen aan de reken- en stijlcontracten`);
