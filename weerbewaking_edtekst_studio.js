const $=id=>document.getElementById(id),clone=o=>JSON.parse(JSON.stringify(o));
let state=clone(EDtekst.sample),valid=true,fontReady=false,importing=false,tableChanged=0;
const storageKey='edtekst-studio-v3';
try{const saved=localStorage.getItem(storageKey);if(saved){EDtekst.validate(JSON.parse(saved));state=JSON.parse(saved);if(state.region.trim().toUpperCase()==='REGIO ROTTERDAM')state.region='Rijnmondgebied';}}catch{}
const needsInitialImport=state.demo&&!state.source&&JSON.stringify(state.days)===JSON.stringify(EDtekst.sample.days)&&state.summary===EDtekst.sample.summary;
const rows=[['day','Weekdag',648,62,MOSMIX.weekdays],['sun','Zonuren',727,54,0,24],['rain','Hoogste uurkans regen (%)',798,54,0,100],['min','Minimum (°C)',891,54,-40,50],['max','Maximum (°C)',968,54,-40,50],['dir','Windrichting',1062,54,[...MOSMIX.directions,'VAR']],['force','Windkracht (Bft)',1133,54,0,12]];
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function sourceStatus(){
  if(!state.source){$('source-status').textContent='Nog geen MOSMIX ingeladen.';return;}
  const run=new Date(state.source.run),stamp=run.toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  const old=Date.now()-run>86400000;
  $('source-status').textContent=`Modelrun ${stamp} uur · ${state.source.edited?'met eigen aanpassingen':'MOSMIX ingeladen'}.${old?' Deze modelrun is ouder dan 24 uur. Laad nieuwe gegevens.':''}`;
  $('source-status').classList.toggle('source-error',old);
}
function changeCell(index,key,raw){
  const row=rows.find(r=>r[0]===key),isSelect=Array.isArray(row[4]);
  state.days[index][key]=raw===''?null:isSelect?raw:Number(raw);
  if(key==='day')delete state.days[index].date;
  if(state.source)state.source.edited=true;
  tableChanged++;render();
}
function renderTable(){
  $('table-edit').replaceChildren(...rows.map(([key,label,y,height,range,max,step=1])=>{
    const row=document.createElement('div');row.className=`edit-row ${key}-row`;row.setAttribute('role','row');row.style.top=((y-(key==='day'?12:9))/1350*100)+'%';row.style.height=height/1350*100+'%';
    state.days.forEach((day,i)=>{
      const cell=document.createElement('div');cell.className='edit-cell';cell.setAttribute('role',key==='day'?'columnheader':'cell');
      const isSelect=Array.isArray(range),input=document.createElement(isSelect?'select':'input');
      input.className='table-input';input.dataset.day=i;input.dataset.key=key;input.setAttribute('aria-label',`${label}, ${day.date||day.day}, dag ${i+1}`);
      if(isSelect){if(key!=='day'){const empty=document.createElement('option');empty.value='';empty.textContent='-';input.append(empty);}for(const option of range){const el=document.createElement('option');el.value=option;el.textContent=option;input.append(el);}}
      else{input.type='number';input.inputMode='decimal';input.min=range;input.max=max;input.step=String(step);input.placeholder='-';}
      input.value=day[key]??'';
      input.addEventListener('input',()=>{input.setAttribute('aria-invalid',String(!input.validity.valid));changeCell(i,key,input.value);});
      input.addEventListener('focus',()=>{if(!isSelect)input.select();});
      input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();input.blur();}});
      cell.append(input);row.append(cell);
    });return row;
  }));
}
function render(){
  $('count').textContent=`${state.summary.length}/200 tekens · ${EDtekst.wrap(state.summary).length}/5 regels`;
  try{
    EDtekst.validate(state);EDtekst.draw($('screen').getContext('2d'),state,{editable:true});valid=true;
    $('accessibleForecast').textContent=state.heading+'. '+state.summary+' '+state.days.map(d=>`${d.date||d.day}: ${d.sun??'onbekend'} zonuren, regenkans ${d.rain??'onbekend'}%, minimum ${d.min??'onbekend'}, maximum ${d.max??'onbekend'}, wind ${d.dir??'onbekend'} ${d.force??'onbekend'} Bft.`).join(' ');
    try{localStorage.setItem(storageKey,JSON.stringify(state));message('Concept bewaard op dit apparaat.');}catch{message('Download je afbeelding voordat je afsluit; bewaren is niet beschikbaar.');}
  }catch(e){valid=false;message(e.message,true);}
  $('download').disabled=!valid||!fontReady||importing;sourceStatus();
}
function populate(){for(const k of ['date','time','region','heading','summary'])$(k).value=state[k];for(const k of ['demo','crt'])$(k).checked=state[k];renderTable();render();}
for(const k of ['date','time','region','heading','summary'])$(k).addEventListener('input',()=>{state[k]=$(k).value;render();});
for(const k of ['demo','crt'])$(k).addEventListener('change',()=>{state[k]=$(k).checked;render();});
$('editor').addEventListener('submit',e=>e.preventDefault());
$('forecast-start').value=MOSMIX.addDays(MOSMIX.localDate(),1);
async function importMOSMIX(){
  if(importing)return;const start=$('forecast-start').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||start<MOSMIX.localDate()){message('Kies vandaag of een komende datum.',true);return;}
  importing=true;const revision=tableChanged;$('import-mosmix').disabled=true;$('import-mosmix').textContent='MOSMIX ophalen…';$('download').disabled=true;
  try{
    const response=await fetch('https://data.weerlab.nl/mosmix_nl.json?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(20000)});const feed=await response.json();if(!response.ok)throw Error(feed.error||'MOSMIX ophalen is niet gelukt.');const data=MOSMIX.mapFeed(feed);
    if(revision!==tableChanged)throw Error('Je hebt tijdens het laden cijfers aangepast. Klik opnieuw op MOSMIX inladen om die te vervangen.');
    const days=MOSMIX.selectDays(data,start),now=new Date(),next=clone(state);
    next.days=days;next.demo=false;next.date=MOSMIX.localDate(now);next.time=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
    next.heading='Tot en met '+MOSMIX.fullDays[new Date(days[4].date+'T12:00:00Z').getUTCDay()];
    if(next.summary===EDtekst.sample.summary){const temps=days.map(d=>d.max).filter(Number.isFinite);next.summary=temps.length?`Vooruitzichten voor het Rijnmondgebied. De maximumtemperaturen liggen tussen ${Math.min(...temps)} en ${Math.max(...temps)} graden.`:'Vooruitzichten voor het Rijnmondgebied. De beschikbare MOSMIX-waarden staan in de tabel.';}
    next.source={type:'MOSMIX',station:'06344',run:data.run,retrievedAt:data.retrievedAt,edited:false};EDtekst.validate(next);state=next;populate();
    message('MOSMIX ingeladen. Klik in de tabel om cijfers aan te passen. Controleer ook je weerschets.');
  }catch(e){message(e.message||'MOSMIX ophalen is niet gelukt; je bestaande waarden zijn behouden.',true);}
  finally{importing=false;$('import-mosmix').disabled=false;$('import-mosmix').textContent='↓  MOSMIX inladen';$('download').disabled=!valid||!fontReady;}
}
$('import-mosmix').addEventListener('click',importMOSMIX);
$('download').addEventListener('click',()=>{
  if(!valid||!fontReady||importing)return;
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;EDtekst.draw(canvas.getContext('2d'),state);
  const fileDate=state.date;canvas.toBlob(blob=>{if(!blob){message('Downloaden is niet gelukt. Probeer het opnieuw.',true);return;}const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='edtekst-'+fileDate+'.png';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);message('Afbeelding klaar — je download is gestart.');},'image/png');
});
$('reset').onclick=()=>{tableChanged++;state=clone(EDtekst.sample);populate();};populate();
document.fonts.load('40px "EDtekst Mono"').then(fonts=>{if(!fonts.length)throw Error('Font ontbreekt');fontReady=true;render();}).catch(()=>message('Het lettertype kon niet laden. Vernieuw de pagina voordat je downloadt.',true));
if(needsInitialImport)importMOSMIX();
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'update_edtekst_forecast',title:'Werk de EDtekst-verwachting bij',description:'Werk het volledige weerbericht en de bewerkbare tabel bij. Bewaart het concept op dit apparaat; downloadt of publiceert niets.',inputSchema:{type:'object',properties:{forecast:{type:'object',description:'Volledig bericht: date, time, region, heading, summary, demo, crt en vijf days (day, sun in uren, rain, min, max, dir, force).'}},required:['forecast'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute(input){if(!input||typeof input.forecast!=='object')throw Error('Een volledig weerbericht is vereist.');EDtekst.validate(input.forecast);state=clone(input.forecast);tableChanged++;if(state.source)state.source.edited=true;populate();return {updated:true,date:state.date,days:state.days.length};}})).catch(()=>{});}catch{}}
