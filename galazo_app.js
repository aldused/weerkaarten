(function(){
 'use strict';
 const $=id=>document.getElementById(id),src=GalazoWeatherPro,core=GalazoCore;let raw=null,processed=null,busy=false;
 const today=src.dateKey(Date.now());$('start').min=today;$('start').max=src.addDate(today,6);$('start').value=today;$('weather-date').value=today;
 const textIds=['situation','day-weather','weather-date','report'],draftKey='wb_galazo_text_v1';
 try{const saved=JSON.parse(localStorage.getItem(draftKey)||'{}');for(const id of textIds)if(typeof saved[id]==='string')$(id).value=saved[id];}catch{}
 function saveText(){try{localStorage.setItem(draftKey,JSON.stringify(Object.fromEntries(textIds.map(id=>[id,$(id).value]))));}catch{}}
 for(const c of core.CRITERIA){const label=document.createElement('label');label.textContent=c.label;const input=document.createElement('input');input.type='number';input.id='criterion-'+c.key;input.min=c.min;input.max=c.max;input.step='any';input.placeholder=c.key==='wbgt'?'Eigen evenementprotocol':'Leeg = uit';if(c.defaultValue!==null)input.value=c.defaultValue;label.append(input);$('criteria').append(label);}
 const numeric=id=>$(id).value.trim()===''?null:Number($(id).value);
 function settings(){return core.validateCriteria(Object.fromEntries(core.CRITERIA.map(c=>[c.key,numeric('criterion-'+c.key)])));}
 function context(){return {event:$('event').value.trim(),location:$('location').value.trim(),report:$('report').value.trim(),situation:$('situation').value.trim(),dayWeather:$('day-weather').value.trim(),weatherDate:$('weather-date').value,elevation:numeric('elevation'),lat:numeric('latitude'),lon:numeric('longitude')};}
 function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
 function buttons(){const valid=!!processed&&!busy;$('download').disabled=!valid;$('print').disabled=!valid;$('load').disabled=busy;document.querySelectorAll('#galazo-form input,#galazo-form select,#galazo-form textarea').forEach(el=>el.disabled=busy);document.querySelectorAll('[data-text-field]').forEach(el=>el.contentEditable=busy?'false':'plaintext-only');}
 function clear(){raw=null;processed=null;$('documents').replaceChildren();$('diagnostics').textContent='Nog geen actuele gegevens geladen.';buttons();}
 async function refresh(){if(!raw)return;try{processed=null;buttons();processed=core.process(raw,context(),settings());await GalazoDocument.fit(processed,$('documents'));$('diagnostics').textContent=JSON.stringify({source:processed.source,issued:processed.issued,requestedHours:processed.hours.length,availableHours:processed.hours.filter(h=>h.available).length,wbgtHours:processed.hours.filter(h=>h.wbgt!==null).length,diagnostics:processed.diagnostics},null,2);const noWBGT=processed.hours.filter(h=>h.wbgt===null).length;status(`${processed.hours.filter(h=>h.available).length} van ${processed.hours.length} uurvakken beschikbaar · ${processed.warnings.length} dagwaarschuwing(en).${noWBGT?' WBGT ontbreekt in '+noWBGT+' uurvakken; zie gegevenscontrole.':''}`);buttons();}catch(e){processed=null;$('documents').replaceChildren();status(e.message,true);buttons();}}
 $('galazo-form').addEventListener('submit',async e=>{e.preventDefault();if(busy||!$('galazo-form').reportValidity())return;clear();busy=true;buttons();status('WeatherPro laden…');try{const c=context();if(!c.event||!c.location)throw Error('Vul evenementnaam en locatie in');settings();const range=src.windowFor($('start').value,Number($('days').value));raw=await src.fetch(c.lat,c.lon,range);await refresh();}catch(err){clear();status('Ophalen mislukt: '+err.message,true);}finally{busy=false;buttons();}});
 // Editing the weather request invalidates it, so a stale location can never
 // silently label another forecast. Metadata, elevation and criteria recompute.
 for(const id of ['latitude','longitude','start','days'])$(id).addEventListener('input',()=>{clear();status('Locatie/periode gewijzigd: haal WeatherPro opnieuw op.');});
 for(const id of ['event','location','report','situation','day-weather','weather-date','elevation',...core.CRITERIA.map(c=>'criterion-'+c.key)])$(id).addEventListener('input',()=>{saveText();refresh();});
 $('documents').addEventListener('input',e=>{
  const el=e.target.closest('[data-text-field]');if(!el||busy)return;
  const field=$(el.dataset.textField),text=el.innerText.replace(/\r/g,'').slice(0,field.maxLength);
  field.value=text;if(el.innerText.length>field.maxLength)el.textContent=text;
  if(processed)processed.context=context();saveText();
 });
 $('download').addEventListener('click',async()=>{if(!processed||busy)return;busy=true;buttons();status('GALAZO PDF maken…');try{await GalazoDocument.exportPdf(processed);status('GALAZO PDF gedownload.');}catch(e){status('PDF maken mislukt: '+e.message,true);}finally{busy=false;buttons();}});
 $('print').addEventListener('click',()=>{if(processed&&!busy)window.print();});
})();
