// Dutch commands are parsed separately from microphone capture and editor state.
import {WEATHER_ICON_LABELS} from './weather-icons.js?v=20260913-rain1';
export const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/−/g, '-').replace(/·|(?<!\d),|,(?!\d)/g, ' ').replace(/[.!?;:]+$/g, '').replace(/\s+/g, ' ').trim();
const days = 'maandag dinsdag woensdag donderdag vrijdag zaterdag zondag'.split(' ');
const units = 'nul een twee drie vier vijf zes zeven acht negen tien elf twaalf dertien veertien vijftien zestien zeventien achttien negentien'.split(' ');
const numbers = new Map(units.map((word, n) => [word, n]));
for (const [tens, word] of [[20,'twintig'],[30,'dertig'],[40,'veertig'],[50,'vijftig']]) {
  numbers.set(word, tens);
  for (let i=1;i<10;i++) numbers.set(`${units[i]}en${word}`, tens+i);
}
const symbolKey = text => normalize(text).replace(/\b(nul|een|twee|drie|vier)\b/g, word => String(units.indexOf(word)));
const symbols = new Map(Object.entries(WEATHER_ICON_LABELS).map(([type, label]) => [symbolKey(label), type]));
for (const [type, names] of Object.entries({zon:['zon','zonnig'],sluierbewolking:['zon met hoge bewolking','zon met sluiersbewolking','zon met sluierbewolking'],zon_achter_wolk:['half bewolkt','halfbewolkt','zon met wolk','gedeeltelijk bewolkt'],bewolkt:['bewolkt','wolk'],regen:['regen','regenwolk'],zon_wolk_regen:['bui','buien','regenbui'],onweer:['onweer','onweersbui'],mist3:['mist','nevel'],sneeuw:['sneeuw','sneeuwval']})) for (const name of names) symbols.set(symbolKey(name),type);
export const voicePlaces = [
 ['Gouda',4.7111,52.0116],['Den Haag',4.3007,52.0705],['Amsterdam',4.9041,52.3676],['Utrecht',5.1214,52.0907],['Delft',4.3571,52.0116],['Leiden',4.497,52.1601],['Zoetermeer',4.4931,52.0575],['Maassluis',4.2492,51.9233],['Brielle',4.1627,51.9017],['Krimpen aan den IJssel',4.6021,51.9167],['Papendrecht',4.6872,51.8316],['Zwijndrecht',4.6418,51.8173],['Capelle aan den IJssel',4.5778,51.9292]
].map(([name,lon,lat])=>({name,lon,lat}));
const extraPlaces = ['Rotterdam','Dordrecht','Gouda','Den Haag','Amsterdam','Utrecht','Delft','Leiden','Zoetermeer','Schiedam','Vlaardingen','Maassluis','Hoek van Holland','Hellevoetsluis','Brielle','Spijkenisse','Ridderkerk','Barendrecht','Capelle aan den IJssel','Krimpen aan den IJssel','Papendrecht','Zwijndrecht','Sliedrecht','Gorinchem'];
export function parseCommand(transcript, places=[]) {
  const explicitPlace = /^(?:(?:voeg|zet)\s+)?(?:plaats(?:naam)?|label)\s+/i.test(transcript);
  let text = normalize(transcript).replace(/^(?:voeg|zet)\s+(?:een\s+)?/, '').replace(/\s+toe$/, '');
  const sea = text.match(/^(?:zeewatertemperatuur|zeewater temperatuur|zeewater|watertemperatuur)(?:\s+(.+))?$/);
  if (sea) {
    if (!sea[1]) return {type:'seatemp'};
    const parsed = parseCommand(/(?:graden?|°c?)$/.test(sea[1]) ? sea[1] : `${sea[1]} graden`);
    return parsed?.type==='temp' && Number(parsed.value)>=-2 && Number(parsed.value)<=40 ? {...parsed,type:'seatemp'} : null;
  }
  if (/^(?:zonsop(?:komst)?|zon op(?:komst)?|zonsondergang|zon onder(?:gang)?|zontijden|zonsop(?:komst)? (?:en|&) (?:zonsondergang|ondergang)|zonsop en ondergang|zon op en onder)$/.test(text)) return {type:'zontijden'};
  const strength = text.match(/^windkracht\s+(\d{1,2}|[a-z]+)(?:\s+(?:bft|beaufort))?$/);
  if (strength) {
    const value=/^\d+$/.test(strength[1])?Number(strength[1]):numbers.get(strength[1]);
    return Number.isInteger(value)&&value>=0&&value<=12 ? {type:'wind',bft:String(value)} : null;
  }
  const direction = text.match(/^windrichting\s+(.+)$/);
  if (direction && !/\d|kracht|beaufort|bft/.test(direction[1])) {
    const parsed=parseCommand(`${direction[1]} 0`);
    if(parsed?.type==='wind') return {type:'wind',dir:parsed.dir};
  }
  const uv=text.match(/^(?:uv|uv index|zonkracht)\s+(\d{1,2}|[a-z]+)$/);
  if(uv) {
    const value=/^\d+$/.test(uv[1])?Number(uv[1]):numbers.get(uv[1]);
    return Number.isInteger(value)&&value>=0&&value<=15 ? {type:'uv',value:String(value)} : null;
  }
  const wind = text.match(/^(?:wind(?:richting)?\s+)?([a-z\s-]+?)\s+(?:windkracht\s+|kracht\s+)?(\d{1,2}|[a-z]+)(?:\s+(?:beaufort|bft))?$/);
  if (wind) {
    const names=['noord','noordnoordoost','noordoost','oostnoordoost','oost','oostzuidoost','zuidoost','zuidzuidoost','zuid','zuidzuidwest','zuidwest','westzuidwest','west','westnoordwest','noordwest','noordnoordwest'];
    const dirs=['N','NNO','NO','ONO','O','OZO','ZO','ZZO','Z','ZZW','ZW','WZW','W','WNW','NW','NNW'];
    const raw=wind[1].replace(/[ -]/g,''), index=names.indexOf(raw), dir=index>=0?dirs[index]:dirs.find(d=>d.toLowerCase()===raw);
    const bft=/^\d+$/.test(wind[2])?Number(wind[2]):numbers.get(wind[2]);
    if(dir && Number.isInteger(bft) && bft>=0 && bft<=12) return {type:'wind',dir,bft:String(bft)};
  }
  text = text.replace(/^(?:temperatuur|symbool|weersymbool|dag)\s+/, '');
  const temp = text.match(/^((?:min(?:us)?\s*|negatief\s*|-|plus\s*|\+)?)([\p{L}\d\s,.]+?)\s*(?:graden?(?: celsius)?|°(?:c)?)$/u);
  if (temp) {
    const raw = temp[2].replace(/\s/g,'');
    const value = /^\d{1,2}(?:[,.]\d)?$/.test(raw) ? Number(raw.replace(',','.')) : numbers.get(raw);
    if (value !== undefined && value <= 59) return {type:'temp',value:String((/^(?:min|negatief|-)/.test(temp[1])?-1:1)*value)};
    return null;
  }
  if(days.includes(text)) return {type:'day', value:text[0].toUpperCase()+text.slice(1)};
  if(symbols.has(symbolKey(text))) return {type:symbols.get(symbolKey(text))};
  text = text.replace(/^(?:plaats(?:naam)?|label)\s+/, '');
  const placeKey = name => normalize(name).replace(/a\/d/g,'aan den').replace(/[ -]/g,'');
  const geo = [...places,...voicePlaces].find(p => typeof p==='object' && placeKey(p.name)===placeKey(text));
  if(geo) return {type:'label',value:geo.name.toUpperCase(),place:geo};
  const known = [...extraPlaces,...places.map(p=>typeof p==='string'?p:p.name)].find(name=>name && normalize(name)===text);
  if(known) return {type:'label',value:known.toUpperCase()};
  // Explicit label commands allow places outside the regional catalogue.
  const place = explicitPlace && text.match(/^([\p{L}][\p{L} '\-]{1,59})$/u);
  if(place) return {type:'label',value:place[1].toUpperCase()};
  return null;
}
export const commandLabel = command => command.type==='wind' ? `Wind ${command.dir || ''}${command.bft!==undefined ? ' '+command.bft+' Bft' : ''}`.trim() : command.type==='seatemp' ? `Zeewater${command.value ? ' '+command.value+'°' : ''}` : command.type==='zontijden' ? 'Zonsopkomst en zonsondergang' : command.type==='uv' ? `Zonkracht ${command.value}` : command.type==='temp' ? `${command.value}°` : command.value || WEATHER_ICON_LABELS[command.type];

export function createVoiceController({Recognition, onState, onCommand, getPlaces=()=>[], schedule=setTimeout, cancel=clearTimeout}) {
  let recognition=null, wanted=false, timer=null, generation=0, restarts=0;
  const publish = (status, message, transcript='') => onState({status,message,transcript});
  function stop(message='Microfoon uit.') {
    wanted=false; generation++; cancel(timer); timer=null;
    const old=recognition; recognition=null;
    if(old) { old.onend=null; old.onresult=null; old.onerror=null; old.onstart=null; try { old.abort(); } catch {} }
    publish('idle',message);
  }
  function run() {
    const token=++generation;
    let seen=new Set();
    try {
      recognition=new Recognition();
      recognition.lang='nl-NL'; recognition.continuous=true; recognition.interimResults=true; recognition.maxAlternatives=5;
      recognition.onstart=()=>{if(wanted&&token===generation) publish('listening','Ik luister. Spreek één opdracht tegelijk.');};
      recognition.onresult=event=>{
        if(!wanted||token!==generation) return;
        for(let i=event.resultIndex;i<event.results.length;i++) {
          const result=event.results[i];
          if(!result.isFinal) { publish('listening','Aan het luisteren…',result[0].transcript); continue; }
          if(seen.has(i)) continue;
          seen.add(i); restarts=0;
          const alternatives=Array.from(result);
          const match=alternatives.map(a=>({a,command:parseCommand(a.transcript,getPlaces())})).find(x=>x.command);
          if(match && !(match.a.confidence>0 && match.a.confidence<0.35)) {
            onCommand(match.command);
            publish('listening',`${commandLabel(match.command)} ${match.command.place ? 'op de geografische plek geplaatst.' : 'klaargezet · sleep naar de juiste plek.'}`,match.a.transcript);
          } else publish('listening','Niet duidelijk herkend. Herhaal je opdracht, of typ hem hieronder.',result[0].transcript);
        }
      };
      recognition.onerror=event=>{
        if(token!==generation||!wanted) return;
        if(event.error==='no-speech') { publish('listening','Nog niets gehoord. Spreek je opdracht uit.'); return; }
        const messages={'not-allowed':'Microfoontoegang geweigerd. Sta de microfoon toe in je browser en probeer opnieuw.','service-not-allowed':'Spraakherkenning is niet toegestaan in deze browser.','audio-capture':'Geen microfoon gevonden. Controleer je microfoon.','network':'Verbinding met spraakherkenning mislukt. Controleer je internet en probeer opnieuw.','language-not-supported':'Nederlandse spraakherkenning is niet beschikbaar in deze browser.'};
        stop(messages[event.error]||'Spraakherkenning gestopt. Klik om opnieuw te proberen.');
      };
      recognition.onend=()=>{
        if(!wanted||token!==generation) return;
        if(++restarts>4) { stop('Geen spraak ontvangen. Klik op de microfoon om opnieuw te luisteren.'); return; }
        publish('starting','Luisteren hervatten…');
        timer=schedule(run,400);
      };
      publish('starting','Microfoon starten…'); recognition.start();
    } catch { stop('Microfoon kon niet starten. Probeer opnieuw of gebruik het tekstveld.'); }
  }
  return {start(){if(wanted)return;if(!Recognition){publish('idle','Spraakherkenning ontbreekt in deze browser. Gebruik Chrome of Edge, of typ je opdracht.');return;}wanted=true;restarts=0;run();},stop,dispose(){stop();}};
}

export function useRegioVoice(React, enabled, actions, places) {
  const [state,setState]=React.useState({status:'idle',message:'Zeg bijvoorbeeld “16 graden”, “half bewolkt” of “Rotterdam”.',transcript:''});
  const [draft,setDraft]=React.useState('');
  const latest=React.useRef({actions,places}); latest.current={actions,places};
  const controller=React.useRef(null);
  const Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;
  React.useEffect(()=>{
    if(!enabled) return;
    const control=createVoiceController({Recognition,onState:setState,onCommand:command=>latest.current.actions.voiceAdd(command),getPlaces:()=>latest.current.places||[]});
    controller.current=control;
    const hide=()=>{if(document.hidden)control.stop('Microfoon uit omdat de kaart niet zichtbaar is.');};
    const leave=()=>control.stop();
    document.addEventListener('visibilitychange',hide); globalThis.addEventListener('pagehide',leave);
    // A product panel can be hidden without changing document.visibilityState.
    const observers=[];
    try {
      let child=globalThis;
      while(child.frameElement) {
        const frame=child.frameElement, parent=child.parent;
        const observer=new parent.MutationObserver(()=>{if(!frame.getClientRects().length)control.stop('Microfoon uit omdat de kaart niet zichtbaar is.');});
        for(let node=frame;node;node=node.parentElement)observer.observe(node,{attributes:true,attributeFilter:['style','class','hidden']});
        observers.push(observer);child=parent;
      }
    } catch { /* Cross-origin hosts still have pagehide and visibility cleanup. */ }

    return ()=>{observers.forEach(observer=>observer.disconnect());document.removeEventListener('visibilitychange',hide);globalThis.removeEventListener('pagehide',leave);control.dispose();controller.current=null;};
  },[enabled,Recognition]);
  return {state,draft,setDraft,supported:!!Recognition,toggle(){state.status==='idle'?controller.current?.start():controller.current?.stop();},submit(event){event.preventDefault();const command=parseCommand(draft,places);if(command){actions.voiceAdd(command);setState(old=>({...old,message:`${commandLabel(command)} ${command.place ? 'op de geografische plek geplaatst.' : 'klaargezet · sleep naar de juiste plek.'}`,transcript:draft}));setDraft('');}else setState(old=>({...old,message:'Opdracht niet herkend. Gebruik bijvoorbeeld “16 graden” of “plaats Gouda”.',transcript:draft}));}};
}
