/* Question-led view, with station and national historical observations. */
(() => {
'use strict';
const C=window.ThresholdQuestions,$=id=>document.getElementById(id),el=$('threshold-questions');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=t=>t===null?'—':new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).format(t);
const short=md=>md?new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',day:'numeric',month:'long'}).format(C.boundary(2000,md)):'—';
const number=n=>Number(n).toLocaleString('nl-NL',{maximumFractionDigits:2}),symbols={lt:'<',le:'≤',gt:'>',ge:'≥',eq:'=',between:'van'};
const questions={first:'Eerste optreden per jaar of seizoen',last:'Laatste optreden per jaar of seizoen',recent:'Meest recente waargenomen optreden',meanFirst:'Gemiddelde datum van het eerste optreden',meanLast:'Gemiddelde datum van het laatste optreden',earlyFirst:'Vroegste datum van een eerste optreden',lateFirst:'Laatste datum van een eerste optreden',earlyLast:'Vroegste datum van een laatste optreden',lateLast:'Laatste datum van een laatste optreden',count:'Aantal dagen dat aan de grens voldoet',streak:'Langste aaneengesloten reeks'};
const frostClasses=[
 {key:'light',label:'Lichte vorst',threshold:0},
 {key:'moderate',label:'Matige vorst',threshold:-5},
 {key:'severe',label:'Strenge vorst',threshold:-10},
 {key:'very-severe',label:'Zeer strenge vorst',threshold:-15}
].map(frost=>({...frost,range:`Onder ${number(frost.threshold).replace('-','−')} °C`}));
const presets=[
 ['custom','Zelf een vraag samenstellen','TX','ge',20,'01-01','12-31','first'],
 ['autumn','Eerste vorst in het winterjaar','TN','lt',0,'08-01','07-31','first'],
 ['spring','Laatste vorst in het winterjaar','TN','lt',0,'08-01','07-31','last'],
 ['ground-first','Eerste grondvorst in het winterjaar','T10N','lt',0,'08-01','07-31','first'],
 ['ground-last','Laatste grondvorst in het winterjaar','T10N','lt',0,'08-01','07-31','last'],
 ...frostClasses.flatMap(({key,label,threshold})=>[
  ['frost-'+key+'-first','Eerste dag met '+label.toLowerCase(),'TN','lt',threshold,'08-01','07-31','first'],
  ['frost-'+key+'-last','Laatste dag met '+label.toLowerCase(),'TN','lt',threshold,'08-01','07-31','last']
 ]),
 ['warm-first','Eerste warme dag (20 °C)','TX','ge',20,'01-01','12-31','first'],
 ['warm-last','Laatste warme dag (20 °C)','TX','ge',20,'01-01','12-31','last'],
 ['summer-first','Eerste zomerse dag (25 °C)','TX','ge',25,'01-01','12-31','first'],
 ['summer-last','Laatste zomerse dag (25 °C)','TX','ge',25,'01-01','12-31','last'],
 ['tropical-first','Eerste tropische dag (30 °C)','TX','ge',30,'01-01','12-31','first'],
 ['tropical-last','Laatste tropische dag (30 °C)','TX','ge',30,'01-01','12-31','last'],
 ['ice','IJsdag (maximum onder 0 °C)','TX','lt',0,'08-01','07-31','first'],
 ['rain','Natte dag (minstens 10 mm)','RH','ge',10,'01-01','12-31','first'],
 ['dry','Droge dagen (minder dan 0,1 mm)','RH','lt',.1,'01-01','12-31','streak'],
 ['gust','Windstoot van minstens 90 km/u','FXX','ge',90,'01-01','12-31','first'],
 ['sun','Minstens 10 uur zon','SQ','ge',10,'01-01','12-31','first'],
 ['sunless','Minder dan 0,1 uur zon','SQ','lt',.1,'01-01','12-31','streak']
];
let current=null,version=0,loadedStation=null,lastStation='260';
const stationList=Object.entries(STATIONS).filter(([id,s])=>!s.historisch&&/^\d+$/.test(id));
const cache=new Map();
const params=new URLSearchParams(location.search);
let viewMode=params.get('view')==='year'?'year':'all',focusYear=params.get('year')||null;
el.innerHTML=`<header><p class="q-eyebrow">Eerste & laatste</p><h2>Wanneer viel de eerste of laatste dag?</h2><p>Bekijk vorst, warme, zomerse en tropische dagen, neerslag, windstoten en zon. Kies een snelkeuze of stel zelf een grens in.</p></header>
<form id="q-form">
<section class="q-weather-choices" aria-labelledby="q-weather-title"><h3 id="q-weather-title">Wat wil je bekijken?</h3>
<div class="q-weather-shortcuts" role="group" aria-label="Andere weerdagen">${[
 ['warm-first','Warme dag · ≥ 20 °C'],['summer-first','Zomerse dag · ≥ 25 °C'],['tropical-first','Tropische dag · ≥ 30 °C'],['ice','IJsdag · maximum < 0 °C'],['rain','Natte dag · ≥ 10 mm'],['gust','Windstoot · ≥ 90 km/u'],['sun','Zonnige dag · ≥ 10 uur']
].map(([key,label])=>`<button type="button" data-weather-preset="${key}" aria-pressed="false">${esc(label)}</button>`).join('')}</div>
<div class="q-grid"><label>Snelkeuze<select id="q-preset">${presets.map(p=>`<option value="${p[0]}">${p[1]}</option>`).join('')}</select></label><label>Welke vraag wil je beantwoorden?<select id="q-question">${Object.entries(questions).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label></div></section>
<section id="vorst" class="q-frost" aria-labelledby="q-frost-title">
<h3 id="q-frost-title">Of kies een vorstklasse</h3>
<div class="q-frost-grid" role="group" aria-label="Vorstklasse">${frostClasses.map(f=>`<button type="button" class="q-frost-card" data-frost-class="${f.key}" aria-pressed="false"><strong>${f.label}</strong><span>${f.range}</span></button>`).join('')}</div>
<p class="q-frost-note">Een dag met zwaardere vorst telt ook mee bij de lichtere vorstklassen.</p>
</section>
<section class="q-simple-scope" aria-labelledby="q-scope-title"><h3 id="q-scope-title">Waar?</h3>
<div class="q-scope" role="group" aria-label="Stationsbereik"><button type="button" id="q-scope-all" aria-pressed="true">Alle stations · ook historisch</button><button type="button" id="q-scope-station" aria-pressed="false">Eén station</button></div>
<label id="q-station-label" hidden>KNMI-station<select id="q-station"></select></label>
</section>
<section id="q-simple-period" aria-labelledby="q-view-title"><h3 id="q-view-title">Welke jaren?</h3>
<div class="q-scope" role="group" aria-label="Jaren vergelijken"><button type="button" id="q-view-all" aria-pressed="true">Alle jaren vergelijken</button><button type="button" id="q-view-year" aria-pressed="false">Eén winterjaar</button></div>
<label id="q-year-label" hidden>Seizoen<select id="q-year"></select></label>
<label>Analyseperiode<select id="q-simple-window"></select></label>
<p class="q-frost-note">Winterjaar / volledig vorstseizoen: 1 augustus t/m 31 juli. Ook vorst in september, mei en juni telt mee. Meteorologische winter: 1 december t/m de laatste dag van februari.</p>
</section>
<details class="q-advanced" id="q-advanced"><summary>Grens en analyseperiode zelf instellen</summary>

<details class="q-settings" open><summary>Grens en analyseperiode aanpassen</summary>
<div class="q-grid"><label>Weervariabele<select id="q-field">${Object.entries(C.variables).slice(0,5).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></label><label>Vergelijking<select id="q-op"><option value="ge">≥ Minstens</option><option value="gt">&gt; Meer dan</option><option value="le">≤ Hoogstens</option><option value="lt">&lt; Minder dan</option><option value="eq">= Precies</option><option value="between">Van … t/m …</option></select></label><label><span>Grens (<span id="q-unit">°C</span>)</span><input id="q-threshold" type="number" step="any" required value="20"></label>
<label id="q-upper-label" hidden>Bovengrens (<span id="q-upper-unit">°C</span>)<input id="q-upper" type="number" step="any" value="-0.1"></label>
<label>Periode<select id="q-window"><option value="year">Heel kalenderjaar</option><option value="winterjaar">Winterjaar: 1 augustus t/m 31 juli</option><option value="octapr">Beperkte periode: oktober t/m april</option><option value="autumn">Na de zomer: september t/m februari</option><option value="spring">Vóór de zomer: januari t/m juni</option><option value="winter">Meteorologische winter: december t/m februari</option><option value="summer">Zomer: juni t/m augustus</option><option value="custom">Eigen begin en einde</option></select></label>
<label>Begin (dag-maand)<input id="q-start" value="01-01" placeholder="01-09" pattern="[0-9]{2}-[0-9]{2}" required></label><label>Einde, inclusief (dag-maand)<input id="q-end" value="31-12" placeholder="28-02" pattern="[0-9]{2}-[0-9]{2}" required></label>
<label>Eerste beginjaar<input id="q-from" type="number" min="1700" max="2200" placeholder="Begin meetreeks"></label><label>Laatste beginjaar<input id="q-to" type="number" min="1700" max="2200" placeholder="Tot nu"></label><button type="submit" class="q-submit">Beantwoord mijn vraag</button></div>
<p id="q-period-help"></p><p id="q-definition"></p>
</details></details></form>
<p id="q-status" role="status" aria-live="polite"></p>
<div id="q-output" hidden></div>
<details class="q-method"><summary>Hoe rekenen we? Bron, ontbrekende dagen en gemiddelde datums</summary><p>Per station gebruikt deze analyse de KNMI-dagreeks. ‘Alle stations’ combineert de beschikbare dagreeksen, inclusief gesloten stations, met de volledige beschikbare historische dagreeksen van Winterswijk, Epen en Oost-Maarland en het historische TX/TN-recordarchief. Een landelijke dag telt één keer zodra minstens één station aan de ingestelde grens voldoet; alle passende stations op de eerste en laatste datum worden getoond. Historische recordnoteringen vormen geen volledige dagreeks: landelijke datums zijn uiterste beschikbare waarnemingen. Nationale gemiddelden en definitieve aantallen worden daarom niet berekend. De kalender wordt dag voor dag gecontroleerd voor de gekozen variabele en grens. Een ontbrekende dag is geen dag zonder overschrijding. Landelijke datumvergelijkingen nemen alle afgesloten perioden met gevonden metingen mee, ook bij meetgaten; dit zijn gevonden grensdatums en geen bewezen volledige landelijke reeks. De lopende periode telt niet mee in deze vergelijking. Per station vereisen definitieve records en gemiddelden wel volledige perioden. Aantallen en reeksen zijn dan ondergrenzen.</p><p>Gemiddelde datums gebruiken alleen volledige perioden mét een overschrijding. Perioden zonder overschrijding worden apart geteld. Datums worden op een vaste schrikkelkalender gezet ten opzichte van het gekozen begin: 1 maart blijft ieder jaar op dezelfde positie en 29 februari heeft een eigen positie. Het gemiddelde wordt afgerond op een dag. Zo komen december en januari in de juiste volgorde. Een grensdatum van 29 februari geldt in niet-schrikkeljaren als 28 februari.</p><p>Bij neerslag en zon betekent broncode −1 minder dan 0,05 mm of uur. Een grens die binnen dit interval valt, kan voor die dag niet met zekerheid worden beoordeeld; die periode telt dan niet mee als volledig. De windstoot wordt zonder afronding naar km/u omgerekend. Gemeten waarden worden alleen voor de weergave afgerond.</p><p><a href="https://www.daggegevens.knmi.nl/klimatologie/daggegevens" target="_blank" rel="noopener">KNMI: definities van de dagwaarden</a>. Het betreft stationsmetingen: meetopstellingen en meetreeksen kunnen in de tijd veranderen. Dit zijn beschrijvende statistieken, geen trendcorrectie of voorspelling.</p></details>`;
$('q-simple-window').innerHTML=$('q-window').innerHTML;
$('q-station').add(new Option('Alle stations (ook historisch)','all'));
for(const [id,s]of stationList.slice().sort((a,b)=>a[1].naam.localeCompare(b[1].naam))){const o=new Option((id==='344'?'Rotterdam Airport':s.naam)+' ('+id+')',id);$('q-station').add(o);}
const initialStation=new URLSearchParams(location.search).get('station');
$('q-station').value=initialStation==='all'||stationList.some(([id])=>id===initialStation)?initialStation:'all';
function mdInput(id){const s=$(id).value.trim();if(!/^\d{2}-\d{2}$/.test(s))throw Error('Vul begin en einde in als dag-maand, bijvoorbeeld 01-09.');return s.slice(3)+'-'+s.slice(0,2);}
const inputDate=s=>s.slice(3)+'-'+s.slice(0,2);
function today(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return C.day(p.year+p.month+p.day);}
function syncScope(){const all=$('q-station').value==='all';$('q-scope-all').setAttribute('aria-pressed',String(all));$('q-scope-station').setAttribute('aria-pressed',String(!all));$('q-station-label').hidden=all;if(!all)lastStation=$('q-station').value;}
function syncFrost(){
 const selected=$('q-preset').value;
 for(const button of el.querySelectorAll('[data-weather-preset]'))button.setAttribute('aria-pressed',String(button.dataset.weatherPreset===selected||button.dataset.weatherPreset.replace(/-first$/,'-last')===selected));
 for(const button of el.querySelectorAll('[data-frost-class]'))button.setAttribute('aria-pressed',String(selected.startsWith('frost-'+button.dataset.frostClass+'-')));
}
function frostFor(a){
 if(a.field!=='TN'||a.op!=='lt'||['autumn','spring'].includes($('q-preset').value))return null;
 return frostClasses.find(f=>a.threshold===f.threshold);
}
function definition(){syncFrost();$('q-simple-window').value=$('q-window').value; $('q-upper-label').hidden=$('q-op').value!=='between';$('q-upper').required=$('q-op').value==='between';const v=C.variables[$('q-field').value];if(!v)return;$('q-unit').textContent=v.unit;$('q-upper-unit').textContent=v.unit;$('q-definition').textContent=v.definition||v.label+' · KNMI-dagwaarde.';
 try{const s=mdInput('q-start'),e=mdInput('q-end');C.boundary(2000,s);C.boundary(2000,e);$('q-period-help').textContent=`Iedere periode loopt van ${short(s)} t/m ${short(e)}${e<s?' in het volgende kalenderjaar. Het beginjaar 2021 heet dan seizoen 2021/2022.':'. Het beginjaar is het kalenderjaar.'} Daggegevens van vandaag blijven voorlopig en tellen nog niet mee.`;}catch{$('q-period-help').textContent='Vul een geldige begin- en einddatum in.';}}
function setWindow(s,e){$('q-start').value=inputDate(s);$('q-end').value=inputDate(e);const windows={year:['01-01','12-31'],winterjaar:['08-01','07-31'],octapr:['10-01','04-30'],autumn:['09-01','02-29'],spring:['01-01','06-30'],winter:['12-01','02-29'],summer:['06-01','08-31'],frostseason:['08-01','07-31']};$('q-window').value=Object.keys(windows).find(k=>windows[k][0]===s&&windows[k][1]===e)||'custom';definition();}
function options(){return {field:$('q-field').value,op:$('q-op').value,threshold:Number($('q-threshold').value),upper:$('q-op').value==='between'?Number($('q-upper').value):undefined,start:mdInput('q-start'),end:mdInput('q-end'),from:$('q-from').value?Number($('q-from').value):undefined,to:$('q-to').value?Number($('q-to').value):undefined,today:today()};}
function stationLabel(hit){return esc(hit.station)+(hit.source?` (${esc(hit.source)})`:hit.historical?' (historisch)':'');}
function value(hit,a){if(hit?.observations)return hit.observations.map(h=>stationLabel(h)+': '+value(h,a)).join('<br>');return hit?hit.trace?'&lt; 0,05 '+esc(a.variable.unit):number(hit.value)+' '+esc(a.variable.unit):'—';}
function limitTies(sorted,key){return sorted.filter((p,i)=>i<10||key(p)===key(sorted[9]));}
function syncView(a){
 $('q-view-all').setAttribute('aria-pressed',String(viewMode==='all'));
 $('q-view-year').setAttribute('aria-pressed',String(viewMode==='year'));
 $('q-year-label').hidden=viewMode!=='year';
 if(a){
  const winter=a.start==='12-01'&&a.end==='02-29',fullFrost=a.start==='08-01'&&a.end==='07-31';el.querySelector('#q-simple-period .q-frost-note').textContent=a.start==='01-01'&&a.end==='12-31'?'Kalenderjaar: 1 januari t/m 31 december.':'Winterjaar / volledig vorstseizoen: 1 augustus t/m 31 juli. Ook vorst in september, mei en juni telt mee. Meteorologische winter: 1 december t/m de laatste dag van februari.';$('q-view-year').textContent=winter?'Eén winter':fullFrost?'Eén winterjaar':a.cross?'Eén winterjaar':'Eén jaar';$('q-year-label').firstChild.textContent=winter?'Meteorologische winter':fullFrost?'Winterjaar':a.cross?'Winterjaar':'Jaar';
  if(a.start==='10-01'&&a.end==='04-30')el.querySelector('#q-simple-period .q-frost-note').textContent='Beperkte periode: 1 oktober t/m 30 april. Vorst in september, mei en juni valt buiten deze selectie. Kies Winterjaar (1 augustus t/m 31 juli) om die metingen ook te zien.';
  focusYear=a.periods.some(p=>p.label===focusYear)?focusYear:a.periods.at(-1)?.label||null;
  $('q-year').innerHTML=a.periods.slice().reverse().map(p=>`<option value="${p.label}" ${p.label===focusYear?'selected':''}>${p.label}${p.running?' (lopend)':''}</option>`).join('');
 }
}
function shareSelection(){
 const url=new URL(location.href);url.searchParams.set('station',$('q-station').value);url.searchParams.set('preset',$('q-preset').value);url.searchParams.set('view',viewMode);url.searchParams.set('window',$('q-window').value);
 if(viewMode==='year'&&focusYear)url.searchParams.set('year',focusYear);else url.searchParams.delete('year');
 history.replaceState(null,'',url);
}
function stationValues(hit,a){
 if(!hit)return '<span class="q-muted">Niet gevonden in de beschikbare metingen</span>';
 const observations=hit.observations||[{...hit,station:$('q-station').selectedOptions[0].textContent}];
 const row=h=>`<span class="q-observation"><span>${stationLabel(h)}</span><strong>${value(h,a)}</strong></span>`;
 return observations.slice(0,2).map(row).join('')+(observations.length>2?`<details class="q-tied-stations"><summary>Alle ${observations.length} stations op deze dag</summary>${observations.slice(2).map(row).join('')}</details>`:'');
}
function simpleDate(hit){return hit?new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',day:'numeric',month:'long'}).format(hit.time):'Niet gevonden';}
function renderFirstLast(a,event){
 syncView(a);shareSelection();
 const place=a.national?(a.field==='T10N'?'Alle stations met dagmetingen op 10 cm':'Alle stations in Nederland, inclusief historische stations'):$('q-station').selectedOptions[0].textContent;
 const periodName=a.start==='08-01'&&a.end==='07-31'?'winterjaar':a.start==='10-01'&&a.end==='04-30'?'oktober–aprilperiode':a.start==='12-01'&&a.end==='02-29'?'meteorologische winter':a.cross?'seizoen':'jaar';
 const windowLabel=`${short(a.start)} t/m ${short(a.end)}`;
 const defs=[['earlyFirst','Eerste dag: het vroegst','first',false],['lateFirst','Eerste dag: het laatst','first',true],['earlyLast','Laatste dag: het vroegst','last',false],['lateLast','Laatste dag: het laatst','last',true]];
 const recordCards=defs.map(([key,label,side,descending])=>{
  const entries=a.rank(side,descending,1).filter(p=>p.rank===1),best=entries[0],hit=best?.[side];
  return `<article class="q-date-card" data-record="${key}"><h4>${esc(a.national?label.replace('dag:','gevonden dag:'):label)}</h4><p class="q-big-date">${simpleDate(hit)}</p>${best?`<p class="q-record-year">${best.label} · ${date(hit.time)}</p>${stationValues(hit,a)}${a.national&&!best.dailyComplete?'<p class="q-coverage-note">Meetgaten in de stationsreeksen; dit is de gevonden grensdatum.</p>':''}${entries.length>1?`<details class="q-other-years"><summary>Ook in ${entries.length-1} andere ${entries.length===2?periodName:periodName==='winterjaar'?'winterjaren':periodName+'en'}</summary>${entries.slice(1).map(p=>`<p><strong>${p.label} · ${date(p[side].time)}</strong></p>${stationValues(p[side],a)}${a.national&&!p.dailyComplete?'<p class="q-coverage-note">Meetgaten in de stationsreeksen.</p>':''}`).join('')}</details>`:''}`:'<p>Geen afgesloten periode met voldoende dagdekking en een passende meting beschikbaar.</p>'}</article>`;
 }).join('');
 const selected=a.periods.find(p=>p.label===focusYear);
 const emptyPeriod=p=>p.complete?'Geen dag die aan deze grens voldoet':p.valid||p.uncertain?'Geen passende dag in de beschikbare metingen':'Geen meetgegevens';
 const yearCards=selected?['first','last'].map(side=>`<article class="q-date-card"><h4>${side==='first'?'Eerste':'Laatste'} dag</h4><p class="q-big-date">${simpleDate(selected[side])}</p>${selected[side]?`<p class="q-record-year">${date(selected[side].time)}</p>${stationValues(selected[side],a)}`:`<p>${emptyPeriod(selected)}.</p>`}</article>`).join(''):'';
 const tableRows=a.periods.slice().reverse().map(p=>`<tr><th scope="row">${p.label}${p.running?'<span class="q-running">lopend</span>':p.startsBeforeDailySeries?'<span class="q-running">begon vóór meetreeks</span>':a.national&&!p.dailyComplete?'<span class="q-running">meetgaten</span>':''}</th>${['first','last'].map(side=>`<td>${p[side]?`<strong>${date(p[side].time)}</strong>${stationValues(p[side],a)}`:emptyPeriod(p)}</td>`).join('')}</tr>`).join('');
 const nationalCoverage=viewMode==='year'
  ? selected?.startsBeforeDailySeries?'Deze periode begon vóór de beschikbare dagreeksen. De gevonden metingen staan alleen in het jaaroverzicht.':'Dit zijn de eerste en laatste gevonden metingen. Historische meetreeksen zijn niet altijd volledig.'
  : `${a.comparisonPeriodCount} afgesloten perioden met gevonden metingen vergeleken. Perioden die vóór de eerste dagreeks beginnen, staan alleen in het jaaroverzicht. Gemarkeerde meetgaten kunnen de gevonden datums veranderen.`;
 $('q-output').innerHTML=`<section class="q-simple-results" aria-labelledby="q-simple-title"><header class="q-simple-heading"><p class="q-eyebrow">${esc(place)}</p><h3 id="q-simple-title">${event.label} · ${viewMode==='all'?'alle jaren vergeleken':selected?.label||'geen jaar beschikbaar'}</h3><p class="q-range">${esc(event.range)} · ${periodName}: ${windowLabel}</p></header>
 ${viewMode==='all'?`<p class="q-compare-intro">De eerste en laatste dag worden vergeleken op dag en maand, over alle beschikbare jaren.</p><div class="q-record-grid">${recordCards}</div>`:`<div class="q-record-grid q-year-cards">${yearCards}</div>${selected?.running?'<p class="q-coverage-note">Deze periode loopt nog. Er kunnen nog nieuwe metingen bijkomen.</p>':''}`}
 <p class="q-coverage-note">${a.national?nationalCoverage:viewMode==='year'?(selected?.complete?'Volledige dagreeks voor deze periode.':'Deze periode mist meetdagen of loopt nog; dit zijn de gevonden grensdatums.'):`Records vergelijken volledige, afgesloten perioden. ${a.excluded} onvolledige of lopende perioden tellen niet mee voor de records; hun gevonden datums staan wel in de tabel.`}</p>
 <section class="q-simple-year-table"><h3>Overzicht per ${periodName}</h3><div class="q-scroll"><table><thead><tr><th scope="col">${periodName==='winterjaar'?'Winterjaar':'Jaar / seizoen'}</th><th scope="col">Eerste dag</th><th scope="col">Laatste dag</th></tr></thead><tbody>${tableRows||'<tr><td colspan="3">Geen jaren beschikbaar.</td></tr>'}</tbody></table></div></section>
 </section>`;
 $('q-output').hidden=false;
}
function render(a){
 const frost=frostFor(a);
 const simple=['first','last'].includes($('q-question').value);$('q-simple-period').hidden=!simple;
 if(simple){
  const key=$('q-preset').value.replace(/-(first|last)$/,''),labels={warm:'Warme dag',summer:'Zomerse dag',tropical:'Tropische dag',autumn:'Vorstdag',spring:'Vorstdag',ground:'Grondvorst',ice:'IJsdag',rain:'Natte dag',gust:'Windstoot',sun:'Zonnige dag'};
  const measurement=a.field==='T10N'?'Minimum op 10 cm ':key==='ice'?'TX ':'';
  const range=a.op==='between'?`${measurement}${number(a.threshold)} t/m ${number(a.upper)} ${a.variable.unit}`:`${measurement}${symbols[a.op]} ${number(a.threshold)} ${a.variable.unit}`;
  renderFirstLast(a,frost||{label:labels[key]||a.variable.label,range});return;
 }
 const q=$('q-question').value,condition=frost?`${frost.label} · ${frost.range}`:a.op==='between'?`${a.variable.label} van ${number(a.threshold)} t/m ${number(a.upper)} ${a.variable.unit}`:`${a.variable.label} ${symbols[a.op]} ${number(a.threshold)} ${a.variable.unit}`,complete=a.periods.filter(p=>p.complete),chosen=a.periods.find(p=>p.label===document.getElementById('q-focus')?.value)||a.periods.at(-1);
 const map={earlyFirst:['first',false],lateFirst:['first',true],earlyLast:['last',false],lateLast:['last',true]},rankInfo=map[q],rank=rankInfo?a.rank(...rankInfo):[],side=q==='last'?'last':'first';
 let answer='';
 if(q==='recent'){const p=a.periods.filter(p=>p.last).sort((x,y)=>y.last.time-x.last.time)[0];answer=p?`Het meest recente waargenomen optreden binnen de gekozen perioden was op ${date(p.last.time)} (${value(p.last,a)}), in ${p.label}.${p.complete?'':' Deze periode is '+p.status+'; ontbrekende dagen kunnen een recentere overschrijding bevatten.'}`:'Er is geen overschrijding waargenomen binnen de gekozen perioden. Controleer ook de ontbrekende en nog lopende perioden.';}
 else if((q==='meanFirst'||q==='meanLast'||q==='count'||q==='streak')&&a.national)answer='Landelijke gemiddelden, definitieve aantallen en reeksen zijn niet vastgesteld: het historische archief bevat losse recordnoteringen. Bekijk de eerste en laatste waargenomen datums per jaar of seizoen.'; else if((q==='meanFirst'||q==='meanLast')&&!a.eventCount)answer='Er kan geen gemiddelde datum worden berekend: er zijn geen volledige perioden met een overschrijding.';
 else if(q==='meanFirst'||q==='meanLast')answer=`De gemiddelde datum van het ${q==='meanFirst'?'eerste':'laatste'} optreden is ${short(q==='meanFirst'?a.meanFirst:a.meanLast)}. Er tellen ${a.eventCount} volledige perioden met een overschrijding mee.`;

 else if(rankInfo){const best=rank[0];answer=best?`${questions[q]}: ${date(best[rankInfo[0]].time)}, in ${best.label} (${value(best[rankInfo[0]],a)}).${rank.filter(p=>p.rank===1).length>1?' Deze recordplaats wordt gedeeld.':''}`:a.national?'Er is geen waargenomen overschrijding voor deze ranglijst.':'Er is geen volledige periode met een overschrijding voor deze ranglijst.';}
 else if(q==='count'||q==='streak'){const prop=q==='count'?'hits':'longest',sorted=complete.slice().sort((x,y)=>y[prop]-x[prop]||x.year-y.year),best=sorted[0];answer=best?`Het hoogste ${q==='count'?'aantal dagen':'aantal aaneengesloten dagen'} is ${best[prop]} in ${best.label}.${sorted.filter(p=>p[prop]===best[prop]).length>1?' Deze recordplaats wordt gedeeld.':''}`:'Er zijn geen volledige perioden voor een definitief aantal of een definitieve reeks.';}
 else if(chosen){const hit=chosen[side];answer=hit?`In ${chosen.label} was het ${side==='first'?'eerste':'laatste'} ${chosen.complete?'optreden':'waargenomen optreden'} op ${date(hit.time)} (${value(hit,a)}).${chosen.complete?'':' Dit is voorlopig: de periode is '+chosen.status+'.'}`:`In ${chosen.label} ${chosen.complete?'was er geen overschrijding.':'is nog geen overschrijding waargenomen; de periode is '+chosen.status+'. Ontbrekende of nog komende dagen kunnen het antwoord veranderen.'}`;}
 if(!a.periods.length)answer='Er zijn geen begonnen perioden binnen deze selectie.';
 const cards=[['Gemiddelde eerste datum',short(a.meanFirst)],['Gemiddelde laatste datum',short(a.meanLast)],['Perioden met overschrijding',a.eventCount],['Volledig, zonder overschrijding',a.noEvent]];
 const rankTable=(title,s,descending)=>{const rows=a.rank(s,descending);return `<details class="q-rank" ${map[q]?.[0]===s&&map[q]?.[1]===descending?'open':''}><summary>${title}</summary><div class="q-scroll"><table><thead><tr><th>Plaats</th><th>Jaar / seizoen</th><th>Datum ${s==='first'?'eerste':'laatste'} optreden</th><th>Gemeten waarde</th></tr></thead><tbody>${rows.map(p=>`<tr><td>${p.rank}</td><td>${p.label}</td><td>${date(p[s].time)}</td><td>${value(p[s],a)}</td></tr>`).join('')||`<tr><td colspan="4">${a.national?'Geen waargenomen overschrijding.':'Geen volledige perioden met een overschrijding.'}</td></tr>`}</tbody></table></div></details>`;};
 const quantitative=!a.national&&(q==='count'||q==='streak');let extra='';if(quantitative){const prop=q==='count'?'hits':'longest',sorted=complete.slice().sort((x,y)=>y[prop]-x[prop]||x.year-y.year);extra=`<div class="q-scroll"><table><caption>${questions[q]} · hoogste aantallen</caption><thead><tr><th>Plaats</th><th>Jaar / seizoen</th><th>Dagen</th><th>Begin</th><th>Einde</th></tr></thead><tbody>${limitTies(sorted,p=>p[prop]).map((p,i)=>`<tr><td>${sorted.findIndex(r=>r[prop]===p[prop])+1}</td><td>${p.label}</td><td>${p[prop]}</td><td>${q==='streak'?(p.longestRuns.map(r=>date(r.start)).join('<br>')||'—'):date(p.first?.time??null)}</td><td>${q==='streak'?(p.longestRuns.map(r=>date(r.end)).join('<br>')||'—'):date(p.last?.time??null)}</td></tr>`).join('')}</tbody></table></div>`;}
 $('q-output').innerHTML=`<section class="q-answer" aria-labelledby="q-answer-title"><p class="q-eyebrow">${esc($('q-station').selectedOptions[0].textContent)} · ${esc(condition)}</p><h3 id="q-answer-title">${answer}</h3>${q==='first'||q==='last'?`<label>Antwoord voor jaar / seizoen<select id="q-focus">${a.periods.slice().reverse().map(p=>`<option value="${p.label}" ${p===chosen?'selected':''}>${p.label} · ${p.status}</option>`).join('')}</select></label>`:''}<p>Periode: ${short(a.start)} t/m ${short(a.end)}${a.cross?' van het volgende jaar':''}. Gekozen beginjaren: ${a.from}–${a.to}.</p></section>
 <div class="q-cards" ${a.national?'hidden':''}>${cards.map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join('')}</div>
 <p class="q-coverage" ${a.national?'hidden':''}>Gemiddelden: ${a.eventCount} perioden mét overschrijding; ${a.noEvent} volledige perioden zonder overschrijding tellen niet mee in gemiddelde datums. Van ${a.periods.length} begonnen perioden zijn ${a.completeCount} volledig en ${a.excluded} uitgesloten wegens ontbrekende gegevens of een lopende periode. Dateringen zijn afgerond op een dag.</p>
 ${a.national?'<p class="q-coverage">Alle beschikbare stations, inclusief gesloten stations en historische recordnoteringen. De ranglijsten vergelijken afgesloten perioden vanaf de start van de dagreeksen. Ontbrekende stations of meetdagen kunnen de gevonden datums veranderen. Aantallen en reeksen zijn ondergrenzen. Iedere kalenderdag telt eenmaal, ook als meerdere stations aan de grens voldoen.</p>':''}
 <p>${a.national?'Beschikbare waarnemingen':'Beschikbare dagreeks'}: ${date(a.sourceFirst)} t/m ${date(a.sourceLast)}. Alleen waarden vóór vandaag worden als afgeronde dag gebruikt. Definitie: ${esc(a.variable.definition||a.variable.label)} Grens: ${esc(condition)}.</p>
 ${extra}<h3>Vier verschillende datumvragen${a.national?' · beschikbare waarnemingen':''}</h3><p>Een laatste vorstdag is het laatste optreden binnen één seizoen. Het jaar waarin de eerste vorst het laatst kwam, staat in de ranglijst ‘Laatste datum van een eerste optreden’.</p><div class="q-ranks">${rankTable('Vroegste datum van een eerste optreden','first',false)}${rankTable('Laatste datum van een eerste optreden','first',true)}${rankTable('Vroegste datum van een laatste optreden','last',false)}${rankTable('Laatste datum van een laatste optreden','last',true)}</div>
 <details class="q-periods"><summary>Alle jaren en seizoenen · inclusief ontbrekende en lopende perioden</summary><div class="q-scroll"><table><thead><tr><th>Jaar / seizoen</th><th>Status</th><th>Eerste waargenomen optreden</th><th>Laatste waargenomen optreden</th><th>Aantal dagen</th><th>Langste reeks</th><th>Geldige dagen / verwacht</th><th>Ontbrekend / onzeker, verstreken dagen</th></tr></thead><tbody>${a.periods.slice().reverse().map(p=>`<tr class="q-${p.status.replace(' ','-')}"><th>${p.label}</th><td><span class="q-badge">${p.status}</span>${p.complete&&!p.first?'<br>Geen overschrijding':''}</td><td>${p.first?date(p.first.time)+'<br>'+value(p.first,a):p.complete?'Geen overschrijding':'Niet vastgesteld'}</td><td>${p.last?date(p.last.time)+'<br>'+value(p.last,a):p.complete?'Geen overschrijding':'Niet vastgesteld'}</td><td>${p.complete?'':'≥ '}${p.hits}</td><td>${p.complete?'':'≥ '}${p.longest}</td><td>${p.valid} / ${p.expected}</td><td>${p.missing} / ${p.uncertain}</td></tr>`).join('')}</tbody></table></div></details>`;
 $('q-output').hidden=false;$('q-focus')?.addEventListener('change',()=>render(a));
}
function loadFile(key,site=false){
 const cacheKey=(site?'site:':'')+key;
 if(!cache.has(cacheKey)){const local=site||location.protocol==='file:'||['localhost','127.0.0.1'].includes(location.hostname),url=(local?'':'https://data.weerlab.nl/')+key+'?v='+Math.floor(Date.now()/300000);
 cache.set(cacheKey,fetch(url,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Bron niet bereikbaar');return r.json();}).catch(e=>{cache.delete(cacheKey);throw e;}));}return cache.get(cacheKey);
}
function groundRowFilter(json){
 const index=json.kolommen.indexOf('T10N');
 return row=>C.decode(row[index],C.variables.T10N)!==null;
}
async function run(){const token=++version;current=null;syncScope();$('q-status').dataset.state='loading';$('q-status').textContent='Dagreeks laden en perioden controleren…';$('q-output').hidden=true;
 try{const o=options(),station=$('q-station').value;if(!station)throw Error('Kies een station.');let data,failures=[],sources=[],historical=[];
 if(station==='all'){
  let next=0,done=0;
  async function worker(){while(next<stationList.length&&token===version){const [id,s]=stationList[next++];try{sources.push({id:s.naam,json:await loadFile('dagdata_'+id+'.json')});}catch{failures.push(s.naam);}done++;if(token===version)$('q-status').textContent=`Dagreeksen laden: ${done}/${stationList.length}…`;}}
  await Promise.all(Array.from({length:4},worker));if(token!==version)return;
  try{sources.push(...C.historicalSources(await loadFile('historische-dagwaarden.json',true)));}catch{cache.delete('site:historische-dagwaarden.json');failures.push('volledige historische dagreeksen');}
  if(['TX','TN'].includes(o.field)){
   try{historical=StationRecords.historicalRecords(await loadFile('records_nl_extreme.json'));}catch{failures.push('historisch recordarchief');}
   try{historical.push(...StationRecords.historicalRecords(await loadFile('historische-grenswaarnemingen.json',true)));}catch{failures.push('aanvullende historische waarnemingen');}
  }
  if(!sources.length)throw Error('Geen dagreeksen bereikbaar. Probeer opnieuw.');
  data={kolommen:[...new Set(sources.flatMap(s=>s.json.kolommen))]};
 }else data=await loadFile('dagdata_'+station+'.json');
 if(token!==version)return;
 if(o.field==='T10N'){
  if(station==='all'){
   if(!sources.some(({json})=>json.data.some(groundRowFilter(json))))throw Error('Er zijn nog geen dagmetingen op 10 cm beschikbaar.');
  }else{
   data={...data,data:data.data.filter(groundRowFilter(data))};
   if(!data.data.length)throw Error('Voor dit station zijn geen dagmetingen op 10 cm beschikbaar. Kies een ander station of ‘Alle stations’.');
  }
 }
 if(loadedStation!==station){const selected=$('q-field').value;$('q-field').innerHTML=Object.entries(C.variables).filter(([k])=>data.kolommen.includes(k)).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('');if(data.kolommen.includes(selected))$('q-field').value=selected;loadedStation=station;if(!data.kolommen.includes(o.field))throw Error('Deze variabele ontbreekt bij dit station. Kies een andere variabele.');}
 current=station==='all'?C.analyzeNetwork(sources,historical,o):C.analyze(data,o);if(current.national&&failures.length){current.rank=()=>[];current.recordPeriodCount=0;current.comparisonPeriodCount=0;}definition();render(current);window.weerlabClimateStatus?.(current.national?{fixed:o.field==='T10N'?'Alle stations · grondvorst op 10 cm':'Alle stations · inclusief historische recordnoteringen'}:{through:new Date(current.sourceLast).toISOString().slice(0,10).replaceAll('-','')});
 $('q-status').dataset.state=failures.length?'error':'ready';$('q-status').textContent=failures.length?'Resultaten onvolledig. Niet geladen: '+failures.join(', ')+'. Klik opnieuw op ‘Beantwoord mijn vraag’ om te herproberen.':current.national?'Analyse gereed. Landelijke datums zijn uiterste beschikbare waarnemingen.':'Analyse gereed. Records en gemiddelden gebruiken uitsluitend volledige, afgesloten perioden.';
 }catch(e){if(token===version){$('q-status').dataset.state='error';$('q-status').textContent=e.message;$('q-output').hidden=true;}}}
$('q-form').addEventListener('submit',e=>{e.preventDefault();run();});
$('q-question').addEventListener('change',()=>{
 const key=$('q-preset').value,side=$('q-question').value;
 if(/-(first|last)$/.test(key)){
  const candidate=key.replace(/-(first|last)$/,'-'+side);
  $('q-preset').value=presets.some(p=>p[0]===candidate)?candidate:'custom';
 }
 syncFrost();if(current)render(current);
});
$('q-station').addEventListener('change',run);
$('q-scope-all').addEventListener('click',()=>{$('q-station').value='all';run();});
$('q-scope-station').addEventListener('click',()=>{$('q-station').value=lastStation;run();});
function applyPreset(key,calculate=true){
 const p=presets.find(p=>p[0]===key);if(!p)return;
 $('q-preset').value=key;
 if(![...$('q-field').options].some(o=>o.value===p[2]))$('q-field').add(new Option(C.variables[p[2]].label,p[2]));
 $('q-field').value=p[2];$('q-op').value=p[3];$('q-threshold').value=p[4];$('q-upper').value=0;$('q-question').value=p[7];setWindow(p[5],p[6]);el.querySelector('.q-settings').open=p[0]==='custom';
 syncFrost();$('q-advanced').open=key==='custom';if(calculate)run();
}
$('q-preset').addEventListener('change',()=>applyPreset($('q-preset').value));
for(const button of el.querySelectorAll('[data-weather-preset]'))button.addEventListener('click',()=>applyPreset(button.dataset.weatherPreset));
for(const button of el.querySelectorAll('[data-frost-class]'))button.addEventListener('click',()=>applyPreset('frost-'+button.dataset.frostClass+'-first'));
for(const mode of ['all','year'])$('q-view-'+mode).addEventListener('click',()=>{viewMode=mode;syncView(current);if(current)render(current);});
$('q-year').addEventListener('change',()=>{focusYear=$('q-year').value;if(current)render(current);});
$('q-window').addEventListener('change',()=>{const windows={year:['01-01','12-31'],winterjaar:['08-01','07-31'],octapr:['10-01','04-30'],autumn:['09-01','02-29'],spring:['01-01','06-30'],winter:['12-01','02-29'],summer:['06-01','08-31'],frostseason:['08-01','07-31']},w=windows[$('q-window').value];if(w)setWindow(...w);});
$('q-simple-window').addEventListener('change',()=>{const windows={year:['01-01','12-31'],winterjaar:['08-01','07-31'],octapr:['10-01','04-30'],autumn:['09-01','02-29'],spring:['01-01','06-30'],winter:['12-01','02-29'],summer:['06-01','08-31'],frostseason:['08-01','07-31']},w=windows[$('q-simple-window').value];if(w){setWindow(...w);run();}else{$('q-window').value='custom';$('q-advanced').open=true;el.querySelector('.q-settings').open=true;definition();}});
for(const id of ['q-field','q-op','q-threshold','q-upper'])$(id).addEventListener('change',()=>{$('q-preset').value='custom';definition();});
for(const id of ['q-start','q-end'])$(id).addEventListener('change',()=>{$('q-window').value='custom';definition();});
// Keep old results visibly tied to their settings: editing a condition requires a fresh calculation.
for(const id of ['q-field','q-op','q-threshold','q-upper','q-window','q-start','q-end','q-from','q-to'])$(id).addEventListener('input',()=>{version++;$('q-output').hidden=true;current=null;$('q-status').dataset.state='draft';$('q-status').textContent='Instellingen gewijzigd. Klik op ‘Beantwoord mijn vraag’.';});
$('q-legacy').addEventListener('toggle',()=>{if($('q-legacy').open){chart1Instance?.resize();chart2Instance?.resize();}});
const linkedPreset=new URLSearchParams(location.search).get('preset');
applyPreset(presets.some(p=>p[0]===linkedPreset)?linkedPreset:'frost-moderate-first',false);
const linkedWindow=params.get('window'),linkedRanges={year:['01-01','12-31'],frostseason:['08-01','07-31'],winterjaar:['08-01','07-31'],octapr:['10-01','04-30'],winter:['12-01','02-29'],spring:['01-01','06-30'],autumn:['09-01','02-29'],summer:['06-01','08-31']};
if(linkedRanges[linkedWindow])setWindow(...linkedRanges[linkedWindow]);
syncView();
syncScope();definition();run();
})();
