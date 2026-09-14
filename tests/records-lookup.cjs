// Focused checks for record lookup; data is the same data served to the pages.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
for(const name of ['records_debilt','dagrecords_jaar','dagrecords_6dagen','extremen','neerslag_records','p13_records','hittegolven','stationsanalyse','feestdagen_weer','normalen','normalen_vergelijk','beta_landelijk_maand','maandoverzicht','zomerstatistieken','droogtemonitor','historisch']){
 const html=read(name+'.html');
 for(const [,attrs,body]of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc=|application\/ld\+json/.test(attrs))new vm.Script(body,{filename:name+'.html'});
 assert(html.includes('records-ui.css?v=20260914-1')&&html.includes('records-ui.js?v=20260914-1'));
}
const helper=read('records-ui.js');new vm.Script(helper);
const sorter=helper.slice(helper.indexOf('  function sortValue('),helper.indexOf('  const enhanced='));
const sort=vm.createContext({});vm.runInContext(sorter,sort);
assert(sort.sortValue('-12,4°')<sort.sortValue('2,8°'));
assert(sort.sortValue('18-02-1950')<sort.sortValue('01-01-2000'));
assert(sort.sortValue('26 jun')<sort.sortValue('4 aug'));
assert.equal(sort.sortValue('19,6'),19.6);
const html=read('records_debilt.html');
const calculation={value:'daily'};
const controls={'record-calculation':calculation,'sel-dec-maand':{value:'2'},'sel-dec-dec':{value:'2'},'sel-maand':{value:'2'}};
const ctx=vm.createContext({document:{getElementById:id=>controls[id]},huidigeRichting:'hoog',huidigePeriode:'decade',huidigeParam:'tx',multiData:null,data:JSON.parse(read('records_nl_extreme.json'))});
vm.runInContext(html.slice(html.indexOf('function isAbsoluutDecadeMinimum('),html.indexOf('function periodeLabel(')),ctx);
assert.equal(ctx.isPeriodeRanking('decade','tx'),false);
assert(ctx.haalRecords().some(r=>r[0]===19.6&&r[1]==='1950-02-18'&&r[2]==='Maastricht Caberg'));
calculation.value='period';assert.equal(ctx.isPeriodeRanking('decade','tx'),true);
assert.equal(ctx.isPeriodeRanking('decade','tn','laag'),true);
assert.equal(ctx.isPeriodeRanking('dag','tx'),false);
assert.equal(ctx.isPeriodeRanking('maand','fx'),false);
ctx.data=JSON.parse(read('records_260.json'));ctx.huidigePeriode='maand';
assert.deepEqual(ctx.haalRecords(),ctx.data.maandranking['2'].tx_hoog);
calculation.value='daily';assert.deepEqual(ctx.haalRecords(),ctx.data.maand['2'].tx_hoog);
const dayHtml=read('dagrecords_6dagen.html');
const rendered=[];
const dayContext=vm.createContext({
 chosen:{rec:{B:{t:20,d:'2000-01-01'},A:{t:20,d:'2001-01-01'},C:{t:19,d:'2002-01-01'}}},
 rows:{append:row=>rendered.push(row.cells.map(cell=>cell.textContent))},
 document:{createElement:()=>({cells:[],append(cell){this.cells.push(cell);}})}
});
vm.runInContext(dayHtml.slice(dayHtml.indexOf('  let vorigeDagTemp='),dayHtml.indexOf('  document.getElementById("status").textContent="";')),dayContext);
assert.deepEqual(rendered.map(row=>row[0]),[1,1,3]);
assert.deepEqual(rendered.map(row=>row[1]),['A','B','C']);
console.log('Records lookup: 16 pages parse; historical extremes, aggregate/daily choice, numeric/date sorting and tied ranks passed.');

assert(!read("extremen.html").includes("initPinGate"));
