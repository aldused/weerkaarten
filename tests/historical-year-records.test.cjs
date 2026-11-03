const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.RECORDS_TEST_ROOT||path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const api=require(path.join(root,'record-stations.js'));
const raw=JSON.parse(read('records_nl_extreme.json'));
const source=api.normalize(raw,'nl_extreme',{});
const expected=[-15.9,'1921-12-05','Warnsveld'];
assert(source.jaar['1921'].tn_laag.some(r=>JSON.stringify(r)===JSON.stringify(expected)));
const count=source.jaar['1921'].tn_laag.length;
api.normalize(source,'nl_extreme',{});assert.equal(source.jaar['1921'].tn_laag.length,count);
const legacy={station:source.station,dag:source.dag,jaar:{}};
assert(api.normalize(legacy,'nl_extreme',{}).jaar['1921'].tn_laag.some(r=>r[2]==='Warnsveld'));
const html=read('records_debilt.html');
const controls={'sel-station':{value:'alle'},'sel-jaar':{value:'1921'},'sel-van':{value:'1921-12-01'},'sel-tm':{value:'1921-12-31'}};
const ctx=vm.createContext({document:{getElementById:id=>controls[id]},huidigePeriode:'jaar',allData:{nl_extreme:source},SEIZOEN_MAP:{1:'winter',2:'winter',3:'lente',4:'lente',5:'lente',6:'zomer',7:'zomer',8:'zomer',9:'herfst',10:'herfst',11:'herfst',12:'winter'}});
vm.runInContext(html.slice(html.indexOf('function samenvoegPeriodeRecords('),html.indexOf('function samenvoegPeriodeRanking(')),ctx);
vm.runInContext(html.slice(html.indexOf('function filterRecordsByStation('),html.indexOf('const HIST_MERGE')),ctx);
const debilt={station:'De Bilt',jaar:{1921:{tn_laag:[[-15.9,'1921-12-05']]}}};
for(const period of ['jaar','periode']){
 ctx.huidigePeriode=period;
 const rows=ctx.samenvoegPeriodeRecords([debilt],'tn_laag');
 assert(rows.some(r=>r[0]===-15.9&&r[1]==='1921-12-05'&&r[2]==='Warnsveld'));
 assert.equal(rows.filter(r=>r[1]==='1921-12-05'&&r[2]==='De Bilt').length,1);
}
const warnsveld=ctx.filterRecordsByStation(source,'Warnsveld','hist_warnsveld');
assert(warnsveld.jaar['1921'].tn_laag.some(r=>r[0]===-15.9&&r[1]==='1921-12-05'));
controls['sel-station'].value='5hoofd';ctx.huidigePeriode='jaar';
assert(!ctx.samenvoegPeriodeRecords([debilt],'tn_laag').some(r=>r[2]==='Warnsveld'));
console.log('Historical years: Warnsveld 1921, tied De Bilt, date ranges, historical station, legacy exports and group isolation passed.');
