const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib');
const html=fs.readFileSync(__dirname+'/../modelkaarten-benelux.html','utf8');
const script=html.slice(html.indexOf("<script>'use strict';")+8,html.lastIndexOf('</script>'));
function fn(name){const start=script.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0,name);return script.slice(start,script.indexOf('\n}',start)+2);}
const c=vm.createContext({Float32Array,Uint8Array,Blob,Response,DecompressionStream,atob});
for(const name of ['jagtiTemperature','addWindchill','interpolateFrame','decodeFrame','sunHours'])vm.runInContext(fn(name),c);
test('Dewpoint is decoded in degrees Celsius, including a real zero and missing-data sentinel',async()=>{
 const bytes=Uint8Array.of(61,101,125,0);
 c.models={a:{grid:{w:2,h:2}}};c.intensity=[];
 c.stepData=async()=>zlib.gzipSync(bytes).toString('base64');
 const f=await c.decodeFrame({keys:['td2m'],lead:3},{modelKey:'a',enc:{td2m:{kind:'linear',offset:-50.5,scale:.5,lo:1}}});
 assert.deepEqual(Array.from(f.td2m).slice(0,3),[-20,0,12]);
 assert.ok(Number.isNaN(f.td2m[3]));
});
test('Intermediate hours interpolate dewpoint and never borrow it from an unavailable endpoint',async()=>{
 const left={td2m:Float32Array.of(-4,NaN)},right={td2m:Float32Array.of(0,5)};
 c.load=async step=>step;
 const step={interpolation:{left,right,fraction:.25}};
 let f=await c.interpolateFrame(step,{});
 assert.equal(f.td2m[0],-3);assert.ok(Number.isNaN(f.td2m[1]));
 delete right.td2m;
 f=await c.interpolateFrame(step,{});assert.equal(f.td2m,undefined);
});
test('Local dewpoint values include air temperature and explain missing source data',()=>{
 Object.assign(c,{state:{layer:'td2m'},grid:{lon0:0,lat0:0,dx:1,dy:1,w:2,h:2},
  clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),bftBounds:[0,1,6,12,20,29,39,50,62,75,89,103,118],
  num:(x,d=0)=>x.toLocaleString('nl-NL',{minimumFractionDigits:d,maximumFractionDigits:d})});
 for(const name of ['index','gridPoint','bilinear','beaufort','valuesAt','noticeFor'])vm.runInContext(fn(name),c);
 const f={td2m:Float32Array.of(0,4,0,4),t2m:Float32Array.of(6,6,6,6)};
 assert.deepEqual(Array.from(c.valuesAt(.5,.5,f)),['Dauwpunt: 2,0 °C','Temperatuur: 6,0 °C']);
 assert.equal(c.noticeFor(f,{lead:1}),'');
 delete f.td2m;
 assert.match(c.valuesAt(.5,.5,f)[0],/Geen dauwpunttemperatuur/);
 assert.match(c.noticeFor(f,{lead:1}),/geen dauwpunttemperatuur/);
});
