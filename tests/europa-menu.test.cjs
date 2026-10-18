const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../weerkaarten_europa.html'),'utf8');
const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('let META=null'))[1];
function fn(name){const start=script.indexOf('function '+name+'(');let end=script.indexOf('\nfunction ',start+1);const comment=script.indexOf('\n// ─',start+1);if(end<0||comment>=0&&comment<end)end=comment;const handler=script.indexOf("\n$('now')",start);if(handler>=0&&(end<0||handler<end))end=handler;return script.slice(start,end<0?undefined:end)}
function node(){return {children:[],attributes:{},offsetLeft:0,offsetWidth:70,clientWidth:300,append(n){this.children.push(n)},replaceChildren(){this.children=[]},setAttribute(k,v){this.attributes[k]=v},querySelector(){return null}}}
test('15-day forecast builds every real UTC day and only hours for that day',()=>{
 const frames=Array.from({length:60},(_,i)=>({lead:(i+1)*6,valid_utc:new Date(Date.UTC(2026,9,17,12)+(i+1)*21600000).toISOString()}));
 const elements={'time-days':node(),'time-hours':node()},clicked=[];
 const ctx=vm.createContext({R:()=>({frames}),firstAllowedIndex:()=>0,idx:59,playing:false,$:id=>elements[id],document:{createElement:()=>node()},show:i=>clicked.push(i),Date,Intl});
 vm.runInContext(fn('buildTimeChoices'),ctx);ctx.buildTimeChoices();
 assert.equal(elements['time-days'].children.length,16);assert.deepEqual(elements['time-hours'].children.map(b=>b.textContent),['00:00','06:00','12:00']);
 elements['time-hours'].children[2].onclick();assert.equal(clicked.pop(),59);
 elements['time-days'].children[1].onclick();assert.equal(frames[clicked.pop()].valid_utc,'2026-10-18T12:00:00.000Z');
});
test('rain totals omit times before +24 and short runs have no invented future days',()=>{
 const frames=Array.from({length:24},(_,i)=>({lead:(i+1)*6,valid_utc:new Date(Date.UTC(2026,9,17,18)+(i+1)*21600000).toISOString()}));
 const elements={'time-days':node(),'time-hours':node()};const ctx=vm.createContext({R:()=>({frames}),firstAllowedIndex:()=>3,idx:3,playing:false,$:id=>elements[id],document:{createElement:()=>node()},Date,Intl});vm.runInContext(fn('buildTimeChoices'),ctx);ctx.buildTimeChoices();
 assert.equal(elements['time-days'].children.length,6);assert.deepEqual(elements['time-hours'].children.map(b=>b.textContent),['18:00']);
});
