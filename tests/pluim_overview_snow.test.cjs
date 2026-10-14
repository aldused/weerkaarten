const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
for(const name of ['weerbewaking_pluim.html','pluim_6luik_debilt.html']){
 const source=fs.readFileSync(path.join(__dirname,'..',name),'utf8');
 function extract(name){const start=source.indexOf('function '+name+'('),brace=source.indexOf('{',start);let depth=0;for(let i=brace;i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&!--depth)return source.slice(start,i+1);}throw Error(name);}
 const context={PLUME_MATH:require('../pluim_math.js'),Date,Number,Array,Map};vm.createContext(context);
 vm.runInContext(['fillNaN','alignSeries','buildSnowSeries'].map(extract).join('\n'),context);
 const times=[0,3,6].map(h=>new Date(Date.UTC(2026,9,14,h)));
 const result=context.buildSnowSeries({statistics:[[0,1,2],[0,2,1],[0,.5,.5]]},times,[0,.5,1],times);
 assert.deepEqual(Array.from(result.statistics,values=>Array.from(values)),[[0,1,3],[0,2,3],[0,.5,1]],'sneeuwsom moet per lid worden berekend in broncentimeters');
 assert.deepEqual(Array.from(result.hres),[0,.5,1.5]);
 assert.equal(context.buildSnowSeries(null,times,[],times),null,'ontbrekende sneeuw blijft ontbrekend');
 const missing=context.buildSnowSeries({statistics:[[0,0,0]]},times,[],times);assert(missing.hres.every(v=>!Number.isFinite(v)),'ontbrekende HRES mag geen nul-sneeuwlijn krijgen');
 assert(source.includes('Sneeuwsom (cm)'));assert(!source.includes('CAPE/Onweer'));
 console.log(name+': cumulatieve sneeuw in cm, exacte HRES-as en ontbrekende bronwaarden OK');
}
