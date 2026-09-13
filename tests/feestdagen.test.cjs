const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), html=fs.readFileSync(path.join(root,'feestdagen_weer.html'),'utf8');
for(const [,attrs,body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if(!/\bsrc=/.test(attrs))new vm.Script(body);
const DATA=JSON.parse(fs.readFileSync(path.join(root,'feestdagen_data.json'),'utf8'));
const dom={
 'periode-select':{value:'all'},'jaar-enkel':{value:'2026'},'jaar-van':{value:'2025'},'jaar-tot':{value:'1901'},
 'stat-grid':{innerHTML:'',children:[],appendChild(x){this.children.push(x)}},
 'extra-stat-grid':{innerHTML:'',children:[],appendChild(x){this.children.push(x)}},'station-banner':{},'extra-stats':{}
};
const context=vm.createContext({DATA,Date,Intl,huidigStation:'__alle__',huidigFeestdag:'Prinsjesdag',huidigParam:'TX',document:{getElementById:id=>dom[id],createElement:()=>({style:{setProperty(){}}})}});
for(const [start,end] of [['function vandaag()', 'function msToBft('],['function msToBft(', 'const FEESTDAG_META'],['function getJaarRange()', '// ── Station select'],['function verversStats()', '// ── Ranking'],['function formatDatum(', '// ── Jaarwisseling middernacht']])vm.runInContext(html.slice(html.indexOf(start),html.indexOf(end)),context);
for(let year=1901;year<2401;year++){
 const d=new Date(context.kalenderDatum('Prinsjesdag',year)+'T12:00:00Z');assert.equal(d.getUTCDay(),2);assert(d.getUTCDate()>=15&&d.getUTCDate()<=21);
}
assert.equal(context.kalenderDatum('Prinsjesdag',2026),'2026-09-15');
context.verversStats();const original=dom['stat-grid'].children.map(c=>c.innerHTML);
assert(original[0].includes('35,1°C'));assert(original[1].includes('-1,2°C'));
dom['stat-grid'].children=[];context.huidigParam='FX';context.verversStats();assert.deepEqual(dom['stat-grid'].children.map(c=>c.innerHTML),original,'National records are independent of selected ranking parameter');
dom['periode-select'].value='custom';assert.equal(context.getJaarRange().join(','),'1901,2025');
dom['jaar-van'].value='';dom['jaar-tot'].value='garbage';assert.equal(context.getJaarRange().join(','),'1901,'+new Date().getFullYear());
dom['periode-select'].value='jaar';assert.equal(context.alleSelectieRijen().length,0,'Future holiday is never shown as an observation');
console.log('OK: scripts parse, 500 years of third Tuesdays, national records, invalid periods and future dates.');
