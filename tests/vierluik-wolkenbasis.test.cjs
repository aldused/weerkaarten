const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const root=require('path').join(__dirname,'..');
const html=fs.readFileSync(root+'/demo_vierluik_neerslag.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const core=require(root+'/vierluik-core.js');
const c=vm.createContext({VierluikCore:core,activeVar:'wolkenbasis',neerslagBronrooster:()=>false,modelData:{},TEGEL_VAR:'wolkenkaart'});
for(const name of ['sampleComponent','hoverValue','laagBeschikbaar','veldSleutel','wolkenbasisTekst']){const start=script.indexOf('function '+name+'(');vm.runInContext(script.slice(start,script.indexOf('\n}',start)+2),c);}
vm.runInContext(script.match(/function wolkenvrij\(value,pd\) \{[^\n]+/)[0],c);
const pd={data:Float32Array.from([100,9999,NaN,-1]),nLat:2,nLon:2,nSteps:1,nComp:1,schaal:1,grid:{lat_min:0,lat_max:1,lon_min:0,lon_max:1}};
assert.equal(c.hoverValue(pd,0,0,.49),'100 m boven grond (wolkenbasis)');
assert.equal(c.hoverValue(pd,0,0,.51),'Wolkenvrij');
assert.equal(c.hoverValue(pd,0,1,0),null);
assert.equal(c.hoverValue(pd,0,1,1),null);
assert.equal(c.hoverValue(pd,0,2,0),null);
assert.equal(c.laagBeschikbaar({meta:{parameters:{wolkenbasis:{}}}},'wolkenbasis','harmonie'),true);
assert.equal(c.laagBeschikbaar({meta:{parameters:{bewolking:{}}}},'wolkenbasis','icond2'),false);
console.log('Wolkenbasis: bronrooster, wolkenvrij, ontbrekende waarden en modelbeschikbaarheid correct');

assert.equal(c.hoverValue({...pd,info:{kind:'ceiling',clear_sky_value:null}},0,0,1),'≥5000 m boven grond (ceiling >50%)');
assert.equal(c.hoverValue({...pd,info:{kind:'ecmwf_cbh',clear_sky_value:9999}},0,0,1),'Geen wolkenbasis gediagnosticeerd (mist niet uitgesloten)');
