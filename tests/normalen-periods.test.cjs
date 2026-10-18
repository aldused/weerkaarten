const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../normalen.html'),'utf8');
const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('let DATA = null')).replace(/\binit\(\);\s*$/,'');
let scrolls=0;
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{style:{},innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},scrollIntoView(){scrolls++}});return elements.get(id)}
const context=vm.createContext({document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){}},fixture:JSON.parse(fs.readFileSync(path.join(__dirname,'../normalen_1991_2020.json'),'utf8')),console});
vm.runInContext(script,context);
vm.runInContext("DATA=fixture;selectedStationFilter='344';openDetail('344');",context);
assert.equal(scrolls,1);
for(const [period,count] of [['year',1],['seasons',4],['months',12],['decades',36]]){
 vm.runInContext(`setPeriod('${period}')`,context);
 const detail=element('detailContent').innerHTML;
 assert(detail.includes('<table'),'station detail still has data');
 const headers=detail.match(/<thead>([\s\S]*?)<\/thead>/)[1];
 assert.equal((headers.match(/<th\b/g)||[]).length,count+1,period+' must refresh the open detail columns');
 assert.equal(scrolls,1,'changing period must not scroll back to the details');
}
vm.runInContext("setPeriod('months');setCategory('neerslag');",context);
assert(!element('detailContent').innerHTML.includes('Gemiddelde temperatuur (TG)'),'category change replaces temperature details');
assert(element('detailContent').innerHTML.includes('<table'));
vm.runInContext('closeDetail();setPeriod("year");',context);
assert.equal(vm.runInContext('selectedStation',context),null,'closed detail stays closed');
console.log('PASS: four periods refresh Rotterdam details; category updates; no scroll jumps; closing remains effective.');
