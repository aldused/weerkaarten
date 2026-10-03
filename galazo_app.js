(function(){
 'use strict';
 const $=id=>document.getElementById(id),src=GalazoWeatherPro,core=GalazoCore;let raw=null,processed=null,busy=false;const edits=new Map();
 const today=src.dateKey(Date.now());$('start').min=today;$('start').max=src.addDate(today,6);$('start').value=today;$('weather-date').value=today;$('document-date').value=today;$('document-time').value=new Date().toLocaleTimeString('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const textIds=['headline','situation','day-weather','weather-date','report','document-date','document-time'],draftKey='wb_galazo_text_v1';
 try{const saved=JSON.parse(localStorage.getItem(draftKey)||'{}');for(const id of textIds)if(typeof saved[id]==='string')$(id).value=saved[id];}catch{}
 function saveText(){try{localStorage.setItem(draftKey,JSON.stringify(Object.fromEntries(textIds.map(id=>[id,$(id).value]))));}catch{}}
 for(const c of core.CRITERIA){const label=document.createElement('label');label.textContent=c.label;const input=document.createElement('input');input.type='number';input.id='criterion-'+c.key;input.min=c.min;input.max=c.max;input.step='any';input.placeholder=c.key==='wbgt'?'Eigen evenementprotocol':'Leeg = uit';if(c.defaultValue!==null)input.value=c.defaultValue;label.append(input);$('criteria').append(label);}
 const numeric=id=>$(id).value.trim()===''?null:Number($(id).value);
 function settings(){return core.validateCriteria(Object.fromEntries(core.CRITERIA.map(c=>[c.key,numeric('criterion-'+c.key)])));}
 function context(){return {headline:$('headline').value.trim(),documentDate:$('document-date').value,documentTime:$('document-time').value,event:$('event').value.trim(),location:$('location').value.trim(),report:$('report').value.trim(),situation:$('situation').value.trim(),dayWeather:$('day-weather').value.trim(),weatherDate:$('weather-date').value,elevation:numeric('elevation'),lat:numeric('latitude'),lon:numeric('longitude')};}
 function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
 function buttons(){const valid=!!processed&&!busy;$('download').disabled=!valid;$('print').disabled=!valid;$('load').disabled=busy;document.querySelectorAll('#galazo-form input,#galazo-form select,#galazo-form textarea').forEach(el=>el.disabled=busy);document.querySelectorAll('[data-text-field],[data-hour-field]').forEach(el=>el.contentEditable=busy?'false':'plaintext-only');}
 function clear(){edits.clear();raw=null;processed=null;$('documents').replaceChildren();$('diagnostics').textContent='Nog geen actuele gegevens geladen.';buttons();}
 async function refresh(){if(!raw)return;try{processed=null;buttons();processed=GalazoEdits.finish(core.process(GalazoEdits.apply(src.selectHours(raw,Number($('start-hour').value),Number($('end-hour').value)),edits),context(),settings()),edits,core);await GalazoDocument.fit(processed,$('documents'));$('diagnostics').textContent=JSON.stringify({source:processed.source,issued:processed.issued,requestedHours:processed.hours.length,availableHours:processed.hours.filter(h=>h.available).length,wbgtHours:processed.hours.filter(h=>h.wbgt!==null).length,diagnostics:processed.diagnostics},null,2);const noWBGT=processed.hours.filter(h=>h.wbgt===null).length;status(`${processed.hours.filter(h=>h.available).length} van ${processed.hours.length} uurvakken beschikbaar · ${processed.warnings.length} dagwaarschuwing(en).${edits.size?' Handmatige correcties in '+edits.size+' uurvak(ken).':''}${noWBGT?' WBGT ontbreekt in '+noWBGT+' uurvakken; zie gegevenscontrole.':''}`);buttons();}catch(e){processed=null;$('documents').replaceChildren();status(e.message,true);buttons();}}
 $('galazo-form').addEventListener('submit',async e=>{e.preventDefault();if(busy||!$('galazo-form').reportValidity())return;clear();busy=true;buttons();status('WeatherPro laden…');try{const c=context();if(!c.event||!c.location)throw Error('Vul evenementnaam en locatie in');settings();
 if(c.lat===null&&c.lon===null){
  status('Coördinaten zoeken voor '+c.location+'…');const matches=await src.resolveLocation(c.location);
  if(!matches.length)throw Error('Plaats niet gevonden. Controleer de plaatsnaam of vul coördinaten in.');
  if(matches.length>1){const select=$('location-choice');select.replaceChildren(new Option('Kies een plaats…',''));matches.forEach(m=>{const option=new Option(m.name,JSON.stringify(m));select.add(option);});$('location-choice-label').hidden=false;status('Meerdere plaatsen gevonden: kies de juiste plaats.');return;}
  c.lat=matches[0].lat;c.lon=matches[0].lon;$('latitude').value=c.lat;$('longitude').value=c.lon;
 }else if(c.lat===null||c.lon===null)throw Error('Vul beide coördinaten in of laat beide leeg om op plaatsnaam te zoeken.');
 if(numeric('elevation')===null){status('Locatiehoogte ophalen…');try{$('elevation').value=await src.resolveElevation(c.lat,c.lon);$('elevation-status').textContent='Hoogte automatisch opgehaald (Copernicus DEM via Open-Meteo; uitsluitend terreinhoogte).';}catch(e){$('elevation-status').textContent=e.message+'; vul de hoogte zelf in, anders blijft WBGT leeg.';}}
 status('WeatherPro laden voor '+c.location+'…');const range=src.windowFor($('start').value,Number($('days').value));raw=await src.fetch(c.lat,c.lon,range);await refresh();}catch(err){clear();status('Ophalen mislukt: '+err.message,true);}finally{busy=false;buttons();}});
 // Editing the weather request invalidates it, so a stale location can never
 // silently label another forecast. Metadata, elevation and criteria recompute.
 $('location').addEventListener('input',()=>{$('latitude').value='';$('longitude').value='';$('elevation').value='';$('elevation-status').textContent='';$('location-choice-label').hidden=true;clear();status('Plaats gewijzigd: klik op WeatherPro ophalen om de coördinaten en verwachting op te halen.');});
 $('location-choice').addEventListener('change',()=>{if(!$('location-choice').value)return;const chosen=JSON.parse($('location-choice').value);$('latitude').value=chosen.lat;$('longitude').value=chosen.lon;$('location').value=chosen.name;$('location-choice-label').hidden=true;$('galazo-form').requestSubmit();});
 for(const id of ['latitude','longitude','start','days'])$(id).addEventListener('input',()=>{if(id==='latitude'||id==='longitude'){$('elevation').value='';$('elevation-status').textContent='';}clear();status('Locatie/periode gewijzigd: haal WeatherPro opnieuw op.');});
 for(const id of ['start-hour','end-hour'])$(id).addEventListener('input',()=>refresh());
 for(const id of ['headline','document-date','document-time','event','report','situation','day-weather','weather-date','elevation',...core.CRITERIA.map(c=>'criterion-'+c.key)])$(id).addEventListener('input',()=>{saveText();refresh();});
 $('documents').addEventListener('input',e=>{
  if(e.target.closest('[data-hour-field]')){$('download').disabled=true;$('print').disabled=true;return;}
  const el=e.target.closest('[data-text-field]');if(!el||busy)return;
  const field=$(el.dataset.textField),text=el.innerText.replace(/\r/g,'').slice(0,field.maxLength);
  field.value=text;if(el.innerText.length>field.maxLength)el.textContent=text;
  if(processed)processed.context=context();saveText();
 });
 let tabbing=false;
 async function commitCell(cell){
  if(!cell||busy||!raw)return;
  const field=cell.dataset.hourField,iso=cell.dataset.iso;
  if(cell.textContent===cell.dataset.display){buttons();return;}
  try{
   const value=GalazoEdits.parse(field,cell.textContent),changes={...(edits.get(iso)||{}),[field]:value};
   // A new meteorological correction replaces an earlier manual WBGT estimate.
   if(['tt','rh','ff'].includes(field))delete changes.wbgt;
   edits.set(iso,changes);await refresh();
  }catch(err){cell.textContent=cell.dataset.display;status(err.message,true);buttons();}
 }
 $('documents').addEventListener('focusout',e=>{if(!tabbing)commitCell(e.target.closest('[data-hour-field]'));});
 $('documents').addEventListener('keydown',async e=>{
  const cell=e.target.closest('[data-hour-field]');if(!cell||busy||tabbing)return;
  if(e.key==='Enter'){e.preventDefault();cell.blur();return;}
  if(e.key!=='Tab')return;
  e.preventDefault();
  const cells=[...$('documents').querySelectorAll('[data-hour-field]')],next=cells[cells.indexOf(cell)+(e.shiftKey?-1:1)];
  const target=next?{field:next.dataset.hourField,iso:next.dataset.iso}:null;
  tabbing=true;
  try{
   await commitCell(cell);
   const focus=target?[...$('documents').querySelectorAll('[data-hour-field]')].find(el=>el.dataset.hourField===target.field&&el.dataset.iso===target.iso):$(e.shiftKey?'load':'reset-table');
   if(focus){focus.focus();if(target){const range=document.createRange();range.selectNodeContents(focus);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}}
  }finally{tabbing=false;}
 });
 $('reset-table').addEventListener('click',()=>{if(busy)return;edits.clear();refresh();});
 $('download').addEventListener('click',async()=>{if(!processed||busy)return;busy=true;buttons();status('GOLAZA PDF maken…');try{await GalazoDocument.exportPdf(processed);status('GOLAZA PDF gedownload.');}catch(e){status('PDF maken mislukt: '+e.message,true);}finally{busy=false;buttons();}});
 $('print').addEventListener('click',()=>{if(processed&&!busy)window.print();});
})();
