/* One document renderer for screen, print and downloadable A4 PDF. Tables are
 * paginated as whole six-hour blocks, so rows never cross a page boundary. */
(function(root){
 'use strict';
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=(v,d=0)=>finite(v)?v.toFixed(d).replace('.',','):'—';
 const tableFmt=v=>finite(v)?String(Math.floor(v)):'—';
 const time=iso=>iso?new Date(iso).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam',dateStyle:'short',timeStyle:'short'}):'onbekend';
 const day=d=>new Date(d+'T12:00:00Z').toLocaleDateString('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'long',day:'numeric',month:'long',year:'numeric'});
 function documentDate(data){
  const date=data.context.documentDate||root.GalazoWeatherPro.dateKey(Date.parse(data.fetched));
  const label=new Date(date+'T12:00:00Z').toLocaleDateString('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'long',day:'numeric',month:'long'});
  const clock=data.context.documentTime||new Date(data.fetched).toLocaleTimeString('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  return label+' - '+clock+' uur';
 }
 function weather(code){
  if(!finite(code))return '—';
  const exact={[-8]:'Sluierbewolking',[-7]:'Sneeuwstorm',[-6]:'Storm',[-5]:'IJzel',[-4]:'Dichte mist',[-3]:'Zware sneeuw',[-2]:'Zware regen',[-1]:'Zware regen',0:'Helder',1:'Vrijwel helder',2:'Licht bewolkt',3:'Opklaringen',4:'Half bewolkt',5:'Wolkenvelden',6:'Veel bewolking',7:'Overwegend bewolkt',8:'Bewolkt',9:'Zicht op hemel ontbreekt',10:'Nevel',11:'Grondmist',12:'Grondmist',13:'Weerlicht',17:'Onweerskans',18:'Windstoten',19:'Windhoos',20:'Motregenkans',21:'Regenkans',22:'Sneeuwkans',23:'Natte sneeuw',24:'IJzelkans',25:'Lichte bui',26:'Sneeuwbui',27:'Korrelhagelbui',28:'Mistkans',29:'Onweerskans'};
  if(exact[code])return exact[code];
  if(code>=14&&code<=16)return 'Buien in omgeving';if(code>=30&&code<=35)return 'Zandstorm';if(code>=36&&code<=39)return 'Stuifsneeuw';if(code>=40&&code<=49)return 'Mist';if(code>=50&&code<=59)return 'Motregen';if(code>=60&&code<=65)return 'Regen';if(code===66||code===67)return 'IJzel';if(code===68||code===69)return 'Natte sneeuw';if(code>=70&&code<=79)return 'Sneeuw';if(code>=80&&code<=90)return 'Buien';if(code>=91&&code<=99)return 'Onweer';return 'Code '+code;
 }
 const ROWS=[['Temperatuur (°C)',h=>tableFmt(h.tt,1)],['WBGT* (°C)',h=>tableFmt(h.wbgt,1),'wbgt'],['Gevoelstemperatuur (°C)',h=>tableFmt(h.apparent,1)],['Luchtvochtigheid (%)',h=>tableFmt(h.rh)],['Windrichting',h=>finite(h.dd)?root.WeatherProSrc.kompas(h.dd):'—'],['Windsnelheid (Bft)',h=>Object.hasOwn(h,'bft')?tableFmt(h.bft):(finite(h.ff)?String(root.WeatherProSrc.bft(h.ff)):'—')],['Max. windstoot (km/u)',h=>tableFmt(h.ffg)],['Regen (mm/uur)',h=>tableFmt(h.rr,1)],['Kans op regen (%)',h=>tableFmt(h.pop)],['Kans op onweer (%)',h=>tableFmt(h.thunder)],['Zonneschijn (min/uur)',h=>tableFmt(h.sun)],['Zicht (m)',h=>tableFmt(h.visibility)]];
 function table(rows,date){return `<table class="uur"><thead><tr><th class="daglabel">${esc(day(date))}</th>${rows.map(h=>`<th scope="col">${esc(h.t.slice(11,16))}<small>${esc(h.offset)}</small></th>`).join('')}</tr></thead><tbody>${ROWS.map(([label,fn,cls],index)=>`<tr class="${cls||''}"><th scope="row" class="rij-label">${esc(label)}</th>${rows.map(h=>`<td data-hour-field="${root.GalazoEdits.FIELDS[index]}" data-iso="${esc(h.iso)}" data-display="${esc(fn(h))}" contenteditable="plaintext-only" role="textbox" aria-label="${esc(label)} ${esc(h.t)}"${cls==='wbgt'&&h.wbgtReason?` title="${esc(h.wbgtReason)}"`:''}>${esc(fn(h))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
 function ranges(rows,isos){const selected=new Set(isos),groups=[];let last=null;for(const h of rows){if(!selected.has(h.iso)){last=null;continue;}if(last&&Date.parse(last.endIso)===Date.parse(h.iso)&&last.offset===h.offset){last.end=h.t.slice(11,16);last.endIso=h.endIso;}else{last={start:h.t.slice(11,16),end:h.t.slice(11,16),offset:h.offset,endIso:h.endIso};groups.push(last);}}return groups.map(g=>g.start+(g.start!==g.end?'–'+g.end:'')+' '+g.offset).join(', ');}
 function warningHTML(w,rows){if(!w)return '';return `<aside class="daily-warning"><strong>Waarschuwing ${esc(day(w.date))}:</strong> ${w.triggers.map(t=>`${esc(t.label)} ${t.key==='visibility'?'min.':'max.'} ${fmt(t.extreme,t.key==='wbgt'||t.key==='rain'?1:0)} om ${esc(ranges(rows,t.hours))}`).join('; ')}.</aside>`;}
 function render(data,container,blockCount=2,singles=new Set()){
  const grouped=new Map();for(const h of data.hours){if(!grouped.has(h.date))grouped.set(h.date,[]);grouped.get(h.date).push(h);}
  const pages=[];let first=true;
  for(const [date,rows] of grouped){for(let start=0;start<rows.length;){const chunk=rows.slice(start,start+(singles.has(date+'_'+start)?6:6*blockCount)),warning=start===0?data.warnings.find(w=>w.date===date):null;
   const issued=data.issued.length?data.issued.map(time).join(' / '):'onbekend';
   const missing=rows.filter(h=>!h.available).length,wbgtMissing=rows.filter(h=>h.wbgt===null).length;
   const failures=data.diagnostics.filter(d=>d.code==='request-failed');
   const issues=[missing?`${missing} uurvakken zonder brondata.`:'',wbgtMissing?`WBGT ontbreekt in ${wbgtMissing} uurvakken.`:'',...failures.map(f=>`${f.period}: ${f.message}.`)].filter(Boolean).join(' ');
   const reasons=[...new Set(rows.map(h=>h.wbgtReason).filter(Boolean))];
   pages.push(`<section class="sheet pagina" data-key="${date}_${start}" data-hours="${chunk.length}"><header class="doc-header"><img src="weerbewaking_logo.png" alt="Weerbewaking"><div class="brand"><strong>GOLAZA</strong><span>WEER | HARDLOOPEVENEMENTEN</span></div></header><p class="metadata document-date">${esc(documentDate(data))}</p><div class="plaats-blok"><span class="label">LOCATIE</span><strong>${esc(data.context.location)}</strong><span class="coordinates">${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}</span></div><h1 class="titel">${esc(data.context.event)}</h1>${warningHTML(warning,rows)}${issues?`<p class="data-note">${esc(issues)}</p>`:''}${data.issued.some(i=>Date.parse(data.fetched)-Date.parse(i)>86400000)?'<p class="data-note">De bronuitgifte is ouder dan 24 uur.</p>':''}<div class="blocks">${table(chunk.slice(0,6),date)}${chunk.length>6?table(chunk.slice(6),date):''}</div><footer class="doc-footer"><p><strong>* WBGT: modelschatting buiten met zon.</strong> GGD/RIVM 2023: 0,7 × Tnw + 0,2 × Tg + 0,1 × Ta. Tnw en Tg via de bestaande Liljegren-warmtebalans; Tabelwaarden naar beneden afgerond op hele getallen; berekeningen gebruiken de onafgeronde waarden.</p><p class="source-links"><span class="page-number"></span></p></footer></section>`);first=false;start+=chunk.length;
  }}
  container.innerHTML=pages.join('');
  const intro=container.querySelector('.sheet')?.cloneNode(true);
  if(intro){
   intro.dataset.key='intro';intro.dataset.hours='0';intro.classList.add('intro-sheet');

   intro.querySelectorAll('.daily-warning,.data-note').forEach(el=>el.remove());
   const chosen=data.context.weatherDate||data.range.start;
   const heading=chosen===root.GalazoWeatherPro.dateKey(Date.parse(data.fetched))?'Vandaag':day(chosen);
   intro.querySelector('.blocks').outerHTML=`<div class="intro-text"><div class="weather-headline" data-text-field="headline" contenteditable="plaintext-only" role="textbox" aria-label="Koptekst weerbericht" data-placeholder="Bijvoorbeeld: RUSTIG EN DROOG">${esc(data.context.headline||'')}</div><h2 class="kop">De weersituatie nader beschreven</h2><div class="tekstvak" data-text-field="situation" contenteditable="plaintext-only" role="textbox" aria-label="Weersituatie" aria-multiline="true" data-placeholder="Beschrijf hier de weersituatie…">${esc(data.context.situation||'')}</div><h2 class="kop">${esc(heading)}</h2><div class="tekstvak tekstvak-groot" data-text-field="day-weather" contenteditable="plaintext-only" role="textbox" aria-label="Het weer voor de gekozen dag" aria-multiline="true" data-placeholder="Beschrijf hier het weer voor deze dag…">${esc(data.context.dayWeather||'')}</div>${data.context.report?`<h2 class="kop">Toelichting voor het evenement</h2><p class="report">${esc(data.context.report)}</p>`:''}</div>`;
   intro.querySelector('.doc-footer').innerHTML='<p>Weerbericht en weersituatie: redactioneel aanpasbaar. De uurlijkse verwachting en WBGT volgen op de volgende bladen.</p><p class="source-links"><span>GOLAZA · Hardloopevenementen</span><span class="page-number"></span></p>';
   container.prepend(intro);
  }
  container.querySelectorAll('.page-number').forEach((el,i)=>el.textContent=`Pagina ${i+1} van ${container.querySelectorAll('.sheet').length}`);
 }
 async function fit(data,container){
  const singles=new Set();render(data,container,2,singles);await document.fonts.ready;
  // Split only the blocks that overflow. Other days retain two tables per page.
  for(let attempt=0;attempt<4;attempt++){
   const overflow=[...container.querySelectorAll('.sheet')].filter(p=>p.scrollHeight>1122.5);
   if(!overflow.length)return;
   if(overflow.some(p=>Number(p.dataset.hours)<=6))throw Error('Documenttekst past niet op A4. Kort het weerbericht of de evenementnaam in.');
   overflow.forEach(p=>singles.add(p.dataset.key));render(data,container,2,singles);
  }
  throw Error('Documenttekst past niet op A4. Kort het weerbericht of de evenementnaam in.');
 }
 async function exportPdf(data){
  if(typeof root.html2canvas!=='function'||!root.jspdf?.jsPDF)throw Error('PDF-bibliotheken niet geladen; probeer opnieuw of gebruik Afdrukken');
  const holder=document.createElement('div');holder.className='galazo-export';document.body.append(holder);
  try{
   await fit(data,holder);holder.querySelectorAll('[contenteditable]').forEach(el=>el.removeAttribute('contenteditable'));await root.WBExport.prepareForCanvas(holder);
   const pdf=new root.jspdf.jsPDF({unit:'mm',format:'a4',orientation:'portrait'});
   const sheets=[...holder.querySelectorAll('.sheet')];
   for(let i=0;i<sheets.length;i++){
    if(i)pdf.addPage('a4','portrait');
    const canvas=await root.html2canvas(sheets[i],{scale:2,backgroundColor:'#fff',scrollX:0,scrollY:0,windowWidth:1200,windowHeight:1400,logging:false,useCORS:true});
    const height=canvas.height/canvas.width*210;
    if(height>297.1)throw Error('PDF-pagina valt buiten A4');
    pdf.addImage(canvas,'PNG',0,0,210,height,undefined,'FAST');
   }
   const name=data.context.event.replace(/[^\p{L}\p{N} _-]/gu,'').trim().slice(0,60)||'hardloopevenement';
   pdf.setProperties({title:`GOLAZA - ${data.context.event}`,subject:'Uurlijkse weerbewaking',author:'Weerlab'});pdf.save(`GOLAZA_${name}_${data.range.start}.pdf`);
  }finally{holder.remove();}
 }
 root.GalazoDocument={render,fit,exportPdf,weather,ROWS,fmt,tableFmt};
})(typeof window!=='undefined'?window:globalThis);
