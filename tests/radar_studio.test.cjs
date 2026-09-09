// Real radar calculations and event handlers, using a small non-browser fixture.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'radar.html'),'utf8');
const body=html.slice(html.indexOf('<body'),html.lastIndexOf('<script>'));
const ids=[...body.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(ids.length,new Set(ids).size,'Every control ID is unique');
class Element {
 constructor(tag,attrs={}){this.tagName=tag.toUpperCase();this.attrs=attrs;this.dataset={};this.style={};this.events={};this.children=[];this.hidden='hidden' in attrs;this.disabled=false;this.textContent='';this.value=attrs.value||'';const classes=new Set((attrs.class||'').split(' '));this.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v),toggle:(v,force)=>{const yes=force===undefined?!classes.has(v):force;if(yes)classes.add(v);else classes.delete(v);return yes;}};}
 getAttribute(k){return this.attrs[k]??null;}setAttribute(k,v){this.attrs[k]=String(v);}addEventListener(k,f){(this.events[k]??=[]).push(f);}focus(){this.focused=true;}appendChild(el){this.children.push(el);el.parentNode=this;return el;}
 fire(event,extra={}){for(const fn of this.events[event]||[])fn.call(this,{target:this,preventDefault(){},stopPropagation(){},...extra});}
 querySelector(){return new Element('span');}querySelectorAll(){return [];}closest(){return null;}
}
const elements=[...body.matchAll(/<([a-z][\w-]*)\b([^>]*?)>/gi)].map(m=>new Element(m[1],Object.fromEntries([...m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(a=>[a[1],a[2]??'']))));
const byId=Object.fromEntries(elements.filter(e=>e.attrs.id).map(e=>[e.attrs.id,e]));
function matches(el,sel){if(sel.startsWith('.'))return el.classList.contains(sel.slice(1));if(sel.startsWith('#'))return el.attrs.id===sel.slice(1);const m=/^\[([^=\]]+)(?:="([^\]]*)")?\]$/.exec(sel);return m?m[1] in el.attrs&&(m[2]===undefined||el.attrs[m[1]]===m[2]):false;}
const document={getElementById:id=>byId[id]||null,querySelectorAll:sel=>elements.filter(e=>matches(e,sel)),querySelector:sel=>elements.find(e=>matches(e,sel))||null,createElement:tag=>new Element(tag),addEventListener(){},documentElement:{getAttribute:()=> 'light'}};
const storage=new Map();
const context={console,document,location:{hostname:'localhost',reload(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},performance:{now:()=>0},navigator:{},URL,Date,alert(){}};
context.window=context;context.addEventListener=()=>{};vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'radar-ui.js'),'utf8'),context);
const ui=context.RadarUI;
ui.init();
assert.equal(byId['btn-play'].disabled,true,'Data controls remain disabled during loading');
assert.equal(byId['tab-lagen'].disabled,false,'Menu remains usable during loading');
byId['tab-lagen'].fire('click');assert.equal(byId['panel-lagen'].hidden,false);assert.equal(byId['panel-locatie'].hidden,true);
let stopped=false;
byId['tab-lagen'].fire('keydown',{key:'ArrowRight',stopPropagation(){stopped=true;}});
assert.equal(byId['panel-extra'].hidden,false);assert.equal(byId['tab-extra'].focused,true);assert.ok(stopped);
const times=Array.from({length:61},(_,i)=>new Date(Date.UTC(2026,8,9,9)+i*300000).toISOString());
ui.ready(times,36);
assert.equal(byId['btn-play'].disabled,false);
for(const code of ['-3u','-2u','-1u','nu','+30m','+1u','+2u','radar'])assert.equal(ui.isWindowAvailable(times,36,code),true,code);
assert.equal(ui.isWindowAvailable(times.slice(0,43),36,'+1u'),false);
assert.equal(ui.isWindowAvailable(times,0,'-1u'),false);
assert.equal(ui.isWindowAvailable([],0,'nu'),false);
for(const width of [320,600,900,1800])assert.equal(12*ui.mapLabelScale(width,1800)*width/1800,12,'12px map labels stay 12 screen pixels');
ui.sync({mode:'instant',forecast:true,label:'14:00',layers:{steden:true},latest:times[36]});
assert.equal(byId['frame-kind'].textContent,'VERWACHTING · KNMI');assert.equal(byId.slider.attrs['aria-valuetext'],'14:00');
assert.equal(document.querySelectorAll('.layer-btn')[0].attrs['aria-pressed'],'true');
ui.sync({mode:'cum_+1u',forecast:true,label:'1 mm',layers:{}});assert.equal(byId['frame-kind'].dataset.kind,'sum');
const engine=html.slice(html.lastIndexOf('<script>')+8,html.lastIndexOf('</script>'));
const start=engine.indexOf('  // Start\n');assert.ok(start>0);
vm.runInContext(engine.slice(0,start)+`
  renderFrame=function(){}; bouwSliderOverlay=function(){}; bouwLegenda=function(){};
  startBliksemFetch=function(){};stopBliksemFetch=function(){};
  toonPunt=function(lat,lon,naam){globalThis.chosenPlace={lat:lat,lon:lon,naam:naam};};
  globalThis.radar={
    fixture:function(times){meta={tijden:times,interval_min:5};nLat=2;nLon=2;nFrames=times.length;nFramesNowcast=nFrames;tNowIndex=36;frameF=frameIdx=36;radarData=new Uint8Array(nFrames*4).fill(110);},
    window:zetWindow,range:getAnimRange,play:togglePlay,setupWindows:setupWindowKnoppen,setupLayers:setupLayerToggles,
    state:function(){return {frameIdx:frameIdx,frameF:frameF,playing:playing,mode:radarMode,layers:layers};},
    step:stapBinnenBereik,mm:pvToMmh,
    sum:function(mode){radarMode=mode;animWindow='nu';frameIdx=tNowIndex;bouwCumGrid();return cumGrid;},
    coords:function(){return STEDEN_LABEL;},setupSearch:setupZoek
  };
})();`,context);
const r=context.radar;r.fixture(times);
r.window('+1u');assert.equal(r.state().frameIdx,48);assert.equal(r.state().frameF,48);assert.equal(r.range().s,36);assert.equal(r.range().e,48);
r.window('nu');assert.equal(r.state().frameIdx,36);assert.equal(r.range().s,0);assert.equal(r.range().e,60,'Now must not lock the timeline to a single frame');
r.step(1);assert.equal(r.state().frameIdx,37);
r.play();assert.equal(r.state().playing,true);
r.setupWindows();elements.find(e=>e.attrs['data-window']==='+2u').fire('click');
assert.equal(r.state().playing,false,'Choosing a timestamp pauses to inspect that image');assert.equal(r.state().frameIdx,60);assert.equal(r.state().frameF,60);
r.setupLayers();const layer=elements.find(e=>e.attrs['data-layer']==='hagel');layer.fire('click');assert.equal(r.state().layers.hagel,true);layer.fire('click');assert.equal(r.state().layers.hagel,false);
assert.ok(Math.abs(r.mm(110)-1)<0.01);
for(const mode of ['cum_-1u','cum_+1u'])assert.ok(Math.abs(r.sum(mode)[0]-r.mm(110))<0.0001,'One hour sums retain physical rainfall values');
const lookup=JSON.parse(fs.readFileSync(path.join(root,'plaatsen_lookup.json'),'utf8')).plaatsen;
for(const name of ['Arnhem','Tilburg','Den Helder']){
 const correct=lookup.find(p=>p.naam===name&&p.land==='NL'),actual=r.coords().find(p=>p[2]===name);
 assert.ok(Math.abs(actual[0]-correct.lat)+Math.abs(actual[1]-correct.lon)<0.025,name+' label matches the place database');
}
r.setupSearch();
byId['plaats-zoek'].value='Onbekendeplaats123';byId['btn-plaats-toevoegen'].fire('click');assert.match(byId['zoek-status'].textContent,/niet gevonden/);
byId['plaats-zoek'].value='Arnhem';byId['plaats-zoek'].fire('change');assert.equal(byId['plaats-zoek'].value,'Arnhem','Blur does not swallow the search before button activation');
byId['btn-plaats-toevoegen'].fire('click');assert.equal(context.chosenPlace.naam,'Arnhem');assert.equal(byId['zoek-status'].textContent,'');assert.equal(storage.has('radarFavs'),false,'Searching does not silently save a favorite');
console.log('Radar: unique controls, keyboard tabs, loading states, available times, readable map labels, forecast distinction, time navigation/playback, layers, coordinates and rainfall sums passed.');
