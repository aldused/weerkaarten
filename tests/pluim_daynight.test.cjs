const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../pluim_6_plus.html'),'utf8');
const code=source.slice(source.indexOf('function localTimeBands('),source.indexOf('\nfunction buildPanelSvg'));
const ctx={HOUR_MS:3600000,Date,Math,WeerlabCloudProbability:require('../pluim_cloud_probability.js')};vm.createContext(ctx);vm.runInContext(code,ctx);
test('day/night uses exact Dutch clock hours, including incomplete edges',()=>{
 const start=Date.parse('2026-10-04T01:30:00Z'),end=Date.parse('2026-10-05T08:00:00Z'),bands=ctx.localTimeBands(start,end);
 assert.equal(bands[0].day,false);assert.equal(bands[0].start,start);assert.equal(bands.at(-1).end,end);
 assert.equal(bands.find(b=>b.day).start,Date.parse('2026-10-04T04:00:00Z'));
 assert.equal(bands.find(b=>b.day).end,Date.parse('2026-10-04T16:00:00Z'));
 assert(bands.every((b,i)=>i===0||b.start===bands[i-1].end));
});
test('winter-time transition keeps the full 13-hour night and local labels',()=>{
 const start=Date.parse('2026-10-24T16:00:00Z'),end=Date.parse('2026-10-25T06:00:00Z'),bands=ctx.localTimeBands(start,end);
 assert.equal(bands.filter(b=>!b.day).reduce((n,b)=>n+b.end-b.start,0),13*3600000);
 const ticks=ctx.axisTimeTicks(start,end,1300);assert(ticks.every(t=>t.local.hour%12===0));
 assert(ticks.some(t=>t.time===Date.parse('2026-10-24T22:00:00Z')&&t.local.hour===0));
});

const common=require('../pluim-dag-nacht.js');
test('shared axis has only 00/12 labels and a continuous real-time day/night strip',()=>{
 const start=Date.parse('2026-10-24T15:30:00Z'),end=Date.parse('2026-10-26T13:00:00Z');
 const bands=common.bands(start,end);assert(bands.every((b,i)=>b.end>b.start&&(i===0||b.start===bands[i-1].end)));
 const svg=common.svg({start,end,x:0,y:200,width:1200});assert(svg.includes('#dc2626'));assert(svg.includes('#1d4ed8'));
 const labels=[...svg.matchAll(/class="axis-time-label"[^>]*>([^<]+)/g)].map(m=>m[1]);assert(labels.includes('00'));assert(labels.includes('12'));assert(labels.every(t=>['00','12'].includes(t)));
});
