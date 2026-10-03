import assert from 'node:assert/strict';
import {parseCommand,createVoiceController} from '../editor-src/regio-voice.js';
for(const [phrase,type,value] of [
 ['16 graden','temp','16'],['20 graden','temp','20'],['min 3 graden','temp','-3'],['minus drie graden','temp','-3'],['−3 graden','temp','-3'],['tweeëntwintig graden','temp','22'],['min vijf en twintig graden','temp','-25'],['16,5 graden','temp','16.5'],['zon','zon'],['zonnig','zon'],['zon met sluierbewolking','sluierbewolking'],['zon met hoge bewolking','sluierbewolking'],['half bewolkt','zon_achter_wolk'],['bewolkt','bewolkt'],['regen','regen'],['bui','zon_wolk_regen'],['onweer','onweer'],['mist','mist3'],['sneeuw','sneeuw'],['Rotterdam','label','ROTTERDAM'],['Dordrecht','label','DORDRECHT'],['Gouda','label','GOUDA'],['plaats Bergen op Zoom','label','BERGEN OP ZOOM'],['Voeg 16 graden toe','temp','16'],['dank je',null],['geen regen',null],['16 graden en regen',null],['100 graden',null],['zon met sneeuw',null]]) {
 const actual=parseCommand(phrase);assert.equal(actual?.type||null,type,phrase);if(value!==undefined)assert.equal(actual.value,value,phrase);
}
for(const day of 'maandag dinsdag woensdag donderdag vrijdag zaterdag zondag'.split(' '))assert.equal(parseCommand(day).type,'day');
assert.equal(parseCommand('Ouddorp',[{name:'Ouddorp',lat:50,lon:4}]).value,'OUDDORP');
let current,commands=[],states=[],queue=[];
class Recognition {constructor(){current=this;}start(){this.onstart();}abort(){this.aborted=true;}}
const c=createVoiceController({Recognition,onState:s=>states.push(s),onCommand:c=>commands.push(c),schedule:f=>{queue.push(f);return f;},cancel:f=>{queue=queue.filter(x=>x!==f);}});
const result=(words,final=true)=>Object.assign(words.map(([transcript,confidence=0.9])=>({transcript,confidence})),{isFinal:final});
c.start();assert.equal(current.lang,'nl-NL');assert.equal(current.maxAlternatives,5);
const first=current;
first.onresult({resultIndex:0,results:[result([['16 graden']],false)]});assert.equal(commands.length,0);
first.onresult({resultIndex:0,results:[result([['16 graden']])]});assert.equal(commands.length,1);
first.onresult({resultIndex:0,results:[result([['16 graden']])]});assert.equal(commands.length,1);
first.onresult({resultIndex:1,results:[result([['16 graden']]),result([['16 graden']])]});assert.equal(commands.length,2,'Intentional repetition adds a second temperature');
first.onresult({resultIndex:2,results:[null,null,result([['onbekend'],['Gouda']])]});assert.equal(commands.at(-1).value,'GOUDA');
first.onresult({resultIndex:3,results:[null,null,null,result([['regen',0.1]])]});assert.equal(commands.length,3);
first.onend();assert.equal(queue.length,1);queue.shift()();assert.notEqual(current,first);
const late=current.onresult;c.stop();late({resultIndex:0,results:[result([['regen']])]});assert.equal(commands.length,3);
c.start();current.onerror({error:'not-allowed'});assert.equal(states.at(-1).status,'idle');assert.match(states.at(-1).message,/geweigerd/);assert.equal(queue.length,0);
c.start();current.onerror({error:'network'});assert.match(states.at(-1).message,/internet/);
c.start();for(let n=0;n<5;n++){current.onend();if(queue.length)queue.shift()();}assert.equal(states.at(-1).status,'idle');
c.start();current.onend();c.dispose();assert.equal(queue.length,0);
console.log('Dutch parsing, alternatives, interim/final deduplication, intentional repeats, low confidence, restarts, permission/network errors, stop and cleanup passed.');

for (const [phrase,expected] of [
 ['zuidwest 2',{type:'wind',dir:'ZW',bft:'2'}],['wind noordoost vijf',{type:'wind',dir:'NO',bft:'5'}],['windrichting noord noord west kracht twaalf beaufort',{type:'wind',dir:'NNW',bft:'12'}],['ZW 0',{type:'wind',dir:'ZW',bft:'0'}],['zeewatertemperatuur achttien graden',{type:'seatemp',value:'18'}],['zeewater 18,5',{type:'seatemp',value:'18.5'}],['zeewatertemperatuur',{type:'seatemp'}],['zonsopkomst',{type:'zontijden'}],['zonsondergang',{type:'zontijden'}],['zonsop en ondergang',{type:'zontijden'}],['wind noord 13',null],['zeewater 80 graden',null]
]) assert.deepEqual(parseCommand(phrase),expected,phrase);
for(const phrase of ['Capelle aan den IJssel','plaats Capelle aan den IJssel','Capelle a/d IJssel']) assert.equal(parseCommand(phrase,[{name:'Capelle a/d IJssel',lon:4.5778,lat:51.9292}]).place.lon,4.5778);
const {regionalSunTimes}=await import('../editor-src/regio-sun.js');
for(const [date,op,under] of [['2026-06-21T12:00:00Z','05:','22:'],['2026-12-21T12:00:00Z','08:','16:']]) {
 const times=regionalSunTimes(new Date(date));assert.ok(times.opkomst.startsWith(op));assert.ok(times.ondergang.startsWith(under));
}
assert.deepEqual(regionalSunTimes(new Date('2026-10-02T22:30:00Z')),regionalSunTimes(new Date('2026-10-03T12:00:00Z')),'Use Amsterdam calendar day');
console.log('Wind, sea temperature, sun commands, place aliases and offline seasonal/DST sun times passed.');

assert.deepEqual(parseCommand('windkracht vijf'),{type:'wind',bft:'5'});
assert.deepEqual(parseCommand('windrichting zuidwest'),{type:'wind',dir:'ZW'});
assert.deepEqual(parseCommand('zonkracht vier'),{type:'uv',value:'4'});
assert.equal(parseCommand('zonsop en zonsondergang').type,'zontijden');
