const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'records_debilt.html'), 'utf8');
const start = html.indexOf('function klimaatdagPeriodeSelectie(');
const end = html.indexOf('function toonKlimaatdagRecords(');
assert(start > 0 && end > start);

const dagen = [29.9, 30.2, 32.5, 29.8, 30.4, 32.1, 28.0, 27.5, 32.6, 29.0]
  .map((tx, index) => ({dag:index + 11, tx}));
const controls = {
  'sel-dec-maand': {value:'9'},
  'sel-dec-dec': {value:'2'},
};
const context = vm.createContext({
  huidigePeriode:'decade',
  multiData:[
    {station:'Maastricht', station_nr:'380', maanddetail:{'1947':{'9':{dagen}}}},
    {station:'De Bilt', station_nr:'260', maanddetail:{'1947':{'9':{dagen:dagen.map(dag => ({...dag, tx:dag.tx - 4}))}}}},
  ],
  data:null,
  document:{getElementById:id => controls[id]},
  knmiDatumDelen:() => ({jaar:2026, maand:9, dag:24}),
  ktSeizoenVan:() => 0,
  ktSeizoenJaar:jaar => jaar,
  ktSeizoenLabel:(_index, jaar) => String(jaar),
});
vm.runInContext(html.slice(start, end), context);

const resultaat = context.klimaatdagRecordRijen({key:'tx', drempel:30});
assert.equal(resultaat.rijen[0].periode, '1947');
assert.equal(resultaat.rijen[0].station, 'Maastricht');
assert.equal(resultaat.rijen[0].aantal, 5);
assert.equal(resultaat.rijen[0].piek, 32.6);
console.log('OK: klimaatdagtelling volgt maand en decade.');
