// node --test tests/stationsanalyse-records.test.cjs (offline; real source data).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const dataRoot = process.env.RECORDS_DATA_ROOT || root;
const Records = require('../stationsanalyse-records.js');
const html = fs.readFileSync(path.join(root,'stationsanalyse.html'),'utf8');
const code = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>!m[1].includes('src='))[0][2].replace(/init\(\);\s*$/, '');
const historical = JSON.parse(fs.readFileSync(path.join(root,'records_nl_extreme.json')));
function harness() {
  class Element {
    constructor(){this.children=[];this.style={};this.value='';this.textContent='';this._html='';this.parentElement=this;}
    set innerHTML(v){this._html=v;this.children=[];} get innerHTML(){return this._html;}
    appendChild(e){this.children.push(e);} querySelector(){return this;} querySelectorAll(){return [];} getContext(){return {};}
  }
  const elements = {};
  const el = id=>elements[id] ||= new Element();
  const ctx = vm.createContext({console, StationRecords:Records, Date, Intl,
    document:{getElementById:el,createElement:()=>new Element()},
    window:{weerlabClimateStatus(){}},location:{hostname:'localhost',protocol:'http:'},
    setTimeout:f=>f(),Chart:class{destroy(){}},
    fetch:async url=>{const name=url.split('?')[0]; const file=path.join(name.startsWith('dagdata_')?dataRoot:root,name);
      return {ok:fs.existsSync(file),json:async()=>JSON.parse(fs.readFileSync(file))};}
  });
  vm.runInContext(code,ctx);
  const run = code=>vm.runInContext(code,ctx);
  return {ctx,el,run,analyse:(data,type='temp',season='heel',from=1921,to=1921,threshold=300,direction='boven',columns={YYYYMMDD:0,TX:1,TN:2}) =>
    ctx.analyseerStation(data,ctx.seizoenInfo(season),from,to,run(`KOLOM_INFO.${type}`),direction,threshold,columns)};
}
function json(value){return JSON.parse(JSON.stringify(value));}
test('first, middle and last dates are inclusive for TX and TN; outside dates excluded',()=>{
  const h=harness(), data=[['19201231',310,-110],['19210101',301,-101],['19210715',302,-102],['19211231',303,-103],['19220101',310,-110]];
  for (const [type,limit,direction] of [['temp',300,'boven'],['temp_min',-100,'onder']]) {
    const r=h.analyse(data,type,'heel',1921,1921,limit,direction);
    assert.equal(r.alleWaarden.length,3);
    assert.equal(r.resultaten[0].eersteDag.raw,'19210101');
    assert.equal(r.resultaten[0].laatsteDag.raw,'19211231');
    assert.equal(r.resultaten[0].aantal,null,'sparse records do not pretend to be complete counts');
  }
});
test('months, seasons, winter year boundary and multiple selected years',()=>{
  const h=harness();
  for(const [season,dates] of [['m10',['19211001','19211015','19211031']],['herfst',['19210901','19211010','19211130']],['winter',['19201201','19210115','19210228']]]) {
    const r=h.analyse(dates.map(d=>[d,301]),'temp',season);
    assert.equal(r.alleWaarden.length,3);assert.equal(r.resultaten[0].eersteDag.raw,dates[0]);assert.equal(r.resultaten[0].laatsteDag.raw,dates[2]);
  }
  assert.deepEqual(json(h.analyse([['19200101',301],['19211231',301]],'temp','heel',1920,1921).resultaten.map(r=>r.sJaar)),[1920,1921]);
});
test('strict temperature threshold for frost stays strict, >= warm threshold stays inclusive',()=>{
  const h=harness();
  assert.equal(h.analyse([['19210101',300]],'temp').resultaten[0].eersteDag.waarde,300);
  assert.equal(h.analyse([['19210101',0,0]],'temp_min','heel',1921,1921,0,'onder').resultaten[0].eersteDag,null);
});
test('duplicate source rows count once; conflicting measurements are reported',()=>{
  const h=harness();
  const r=h.analyse([['19211010',301,null],['19211010',301,-10],['19211010',301,-10]]);
  assert.equal(r.alleWaarden.length,1);
  assert.throws(()=>h.analyse([['19211010',301],['19211010',302]]),/Tegenstrijdige/);
  assert.throws(()=>Records.mergeRows([['19211010',301]],{YYYYMMDD:0,TX:1},[{datum:'1921-10-10',parameter:'TX',station:'Test',waarde:30.2}]),/Tegenstrijdige bronnen/);
});
test('equal dates preserve every station and tie at rank ten',()=>{
  const records=Array.from({length:12},(_,i)=>({sDag:10,raw:'19211010',waarde:301,jaar:1921,mm:10,dd:10,stationNaam:'Station '+i}));
  assert.equal(Records.boundary(records,'first').length,12);
  assert.equal(Records.boundary(records,'last').length,12);
  assert.equal(Records.top(records,true).length,12);
  assert.equal(Records.top(records,false).length,12);
});
test('leap and ordinary years compare the same calendar day; UTC and DST are stable',()=>{
  const h=harness();
  assert.equal(h.ctx.seizoensDag(1920,10,10,h.ctx.seizoenInfo('heel')),h.ctx.seizoensDag(1921,10,10,h.ctx.seizoenInfo('heel')));
  assert.equal(h.ctx.seizoensDagNaarDatum(h.ctx.seizoensDag(1921,10,10,h.ctx.seizoenInfo('heel')),h.ctx.seizoenInfo('heel')),'10 okt');
  assert.equal(Records.calendar('2024-03-31').epoch-Records.calendar('2024-03-30').epoch,86400000);
  assert.equal(Records.calendar('2024-10-28').epoch-Records.calendar('2024-10-27').epoch,86400000);
  assert.equal(Records.calendar('1921-02-29'),null);
  assert.equal(Records.windowDays({raw:'19210228'},{raw:'19210301'}),2);
  assert.equal(Records.windowDays({raw:'19200228'},{raw:'19200301'}),3);
  assert.equal(Records.periodDays(2024,h.ctx.seizoenInfo('heel')),366);
  assert.equal(Records.periodDays(2024,h.ctx.seizoenInfo('winter')),91);
});
test('full January counts and consecutive runs; missing observations break runs and flag coverage',()=>{
  const h=harness(), rows=Array.from({length:31},(_,i)=>['192101'+String(i+1).padStart(2,'0'),i<3?301:0]);
  const full=h.analyse(rows,'temp','m1').resultaten[0];
  assert.equal(full.aantal,3);assert.equal(full.langsteReeks,3);assert.equal(full.volledig,true);
  const partial=h.analyse(rows.filter((_,i)=>i!==1),'temp','m1').resultaten[0];
  assert.equal(partial.volledig,false);assert.equal(partial.aantal,null);assert.equal(partial.laatsteDag.raw,'19210103');
});
test('Sittard source → loader → analysis → summary, detail and top table',async()=>{
  const h=harness();await h.ctx.laadHistorischeRecords();
  assert(Records.historicalRecords(historical).some(r=>r.station==='Sittard'&&r.datum==='1921-10-10'&&r.waarde===30.1&&r.parameter==='TX'));
  h.el('sel-station').value='hist:Sittard';
  const rows=await h.ctx.laadCSV('hist:Sittard');
  for(const season of ['heel','herfst','m10']) for (const [from,to] of [[1921,1921],[1921,1930],[1910,1921]]) {
    const r=h.analyse(rows,'temp',season,from,to);
    assert(r.alleWaarden.some(d=>d.jaar===1921&&d.mm===10&&d.dd===10&&d.waarde===301));
    const year=r.resultaten.find(r=>r.sJaar===1921);
    assert.equal(year.laatsteDag.raw,'19211010');
  }
  Object.entries({'sel-analyse':'temp','sel-richting':'boven','inp-drempel':'30','inp-van':'1921','inp-tot':'1921','sel-seizoen':'m10'}).forEach(([id,value])=>h.el(id).value=value);
  await h.ctx.startAnalyse();
  assert.equal(h.el('val-laatste').textContent,'10 okt');
  assert.match(h.el('sub-laatste').textContent,/30,1 °C/);
  assert.match(h.el('tabel-body').children[0].innerHTML,/10 okt.*30,1 °C/s);
  assert.match(h.el('top10-hoog-body').children[0].innerHTML,/10 okt 1921.*30,1 °C/s);
  assert.equal(h.el('val-aantal').textContent,'–');
});
test('all stations preserves same-date TX and TN records through rendering and sorting',async()=>{
  const h=harness();await h.ctx.laadHistorischeRecords();
  // Three distinct stations, different column layouts, duplicate input row.
  h.run(`for (const key of Object.keys(STATIONS)) delete STATIONS[key];
    Object.assign(STATIONS,{a:{naam:'Alfa'},b:{naam:'Beta'},c:{naam:'Gamma'}});
    csvCache={a:{columns:{YYYYMMDD:0,TX:1,TN:2},rows:[['19211001',301,-100],['19211015',320,-200],['19211031',301,-100]]},
    b:{columns:{TX:0,TN:1,YYYYMMDD:2},rows:[[302,-110,'19211001'],[303,-120,'19211031'],[303,-120,'19211031']]},
    c:{columns:{YYYYMMDD:0,TX:1,TN:2},rows:[['19211001',303,-120],['19211031',304,-130]]}};`);
  h.el('sel-station').value='all';
  for (const [type,direction,threshold] of [['temp','boven',30],['temp_min','onder',0]]) {
    await h.ctx.startAnalyseAlle(type,direction,threshold,threshold*10,1921,1921,h.ctx.seizoenInfo('m10'),h.run(`KOLOM_INFO.${type}`));
    const result=h.run('detailState.resultaten[0]');
    assert.equal(result.eersteDagen.length,3);assert.equal(result.laatsteDagen.length,3);
    for(const name of ['Alfa','Beta','Gamma']){
      assert.match(h.el('sub-eerste').textContent,new RegExp(name));assert.match(h.el('sub-laatste').textContent,new RegExp(name));
      assert.equal((h.el('tabel-body').children[0].innerHTML.match(new RegExp(name,'g'))||[]).length>=2,true);
    }
    h.ctx.sorteerDetail('laatste');assert.equal(h.run('detailState.resultaten[0].laatsteDagen.length'),3);
    assert.equal(h.el('top10-hoog-body').children.length,7,'only true duplicates removed, other station records retained');
  }
});
test('all historical TX/TN observations reach the actual station loader and analysis with exact dates/values',async()=>{
  const h=harness();await h.ctx.laadHistorischeRecords();
  const expected=Records.historicalRecords(historical);assert.equal(expected.length,historical.waarnemingen.length);
  for(const [id,records] of Object.entries(h.run('historischeRecords'))) {
    const rows=await h.ctx.laadCSV(id),cols=h.run(`csvCache[${JSON.stringify(id)}].columns`);
    for(const [type,param] of [['temp','TX'],['temp_min','TN']]) {
      const result=h.analyse(rows,type,'heel',1800,2100,0,'boven',cols);
      const actual=new Map(result.alleWaarden.map(r=>[`${r.jaar}-${String(r.mm).padStart(2,'0')}-${String(r.dd).padStart(2,'0')}`,r.waarde]));
      for(const r of records.filter(r=>r.parameter===param))assert.equal(actual.get(r.datum),Math.round(r.waarde*10),`${id} ${param} ${r.datum}`);
    }
  }
});
test('real daily source files: all station TX/TN period values and endpoints match independent inclusive filtering',()=>{
  const h=harness();let checked=0;
  for(const file of fs.readdirSync(dataRoot).filter(f=>/^dagdata_\d+\.json$/.test(f))) {
    const source=JSON.parse(fs.readFileSync(path.join(dataRoot,file))), columns=Object.fromEntries(source.kolommen.map((k,i)=>[k,i]));
    for(const [from,to,season,months] of [[1901,1921,'heel',null],[1940,1950,'m10',[10]],[2000,2024,'herfst',[9,10,11]]]) {
      for(const [type,param] of [['temp','TX'],['temp_min','TN']]) {
        const expected=source.data.filter(row=>{const d=String(row[columns.YYYYMMDD]),year=+d.slice(0,4),month=+d.slice(4,6);return year>=from&&year<=to&&(!months||months.includes(month))&&Number.isFinite(row[columns[param]]);});
        const result=h.analyse(source.data,type,season,from,to,-9999,'boven',columns);
        assert.equal(result.alleWaarden.length,expected.length,`${file} ${param} ${from}–${to}`);
        for(const year of result.resultaten){const dates=expected.map(r=>String(r[columns.YYYYMMDD])).filter(d=>+d.slice(0,4)===year.sJaar).sort();assert.equal(year.eersteDag.raw,dates[0]);assert.equal(year.laatsteDag.raw,dates.at(-1));}
        checked++;
      }
    }
  }
  assert(checked>=264);console.log(`${checked} real station/parameter/period comparisons passed`);
});
