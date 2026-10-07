/* UI only: delegate every selection to the existing record engine. */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const make=(tag,text,attrs={})=>{const n=document.createElement(tag);n.textContent=text;for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
const months=['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
const categories=[['Temperatuur','tx'],['Neerslag','rh'],['Wind','fx'],['Zon','sq'],['Luchtdruk','pg'],['Overige','dagen_warm']];
const regions={ 'Noord-Holland':['235','240','249','225','229','248','257'], 'Zuid-Holland':['215','210','330','344','343'], 'Utrecht':['260','265','348'], 'Zeeland':['310','319','323','324','331'], 'Noord-Brabant':['340','350','370','375'], 'Limburg':['130','170','377','380','391','392'], 'Gelderland':['275','283','20','356'], 'Overijssel':['278','290'], 'Drenthe':['279','280'], 'Groningen':['277','286'], 'Friesland':['242','251','267','270'], 'Flevoland':['258','269','273']};
let timer;
document.addEventListener('DOMContentLoaded',()=>{
 const filters=document.querySelector('.filters');
 const panel=make('section','',{class:'archive-command','aria-label':'Zoek in het weerarchief'});
 const form=make('form','',{class:'archive-search'});const label=make('label','Zoek een record',{for:'archive-query'});
 const input=make('input','',{id:'archive-query',type:'search',placeholder:'Rotterdam oktober temperatuur',autocomplete:'off'});
 const submit=make('button','Zoeken',{type:'submit'});const feedback=make('output','',{ 'aria-live':'polite'});
 form.append(label,input,submit,feedback);panel.append(form);
 const shortcuts=make('div','',{class:'archive-shortcuts'});
 function shortcut(text,fn){const b=make('button',text,{type:'button'});b.onclick=()=>{if(['Op deze dag','Absolute records','Dit jaar','Filters wissen'].includes(text)){input.value='';feedback.textContent='';}return fn();};shortcuts.append(b);}
 shortcut('Op deze dag',()=>{const now=knmiDatumDelen();wisselHoofdtab('records');wisselPeriode('dag');$('sel-dag-maand').value=now.maand;vulDagDagen();$('sel-dag-dag').value=now.dag;toon();});
 shortcut('Absolute records',()=>{wisselHoofdtab('records');wisselPeriode('alltime');});
 shortcut('Dit jaar',()=>{wisselHoofdtab('records');wisselPeriode('jaar');$('sel-jaar').value=knmiDatumDelen().jaar;toon();});
 shortcut('Filters wissen',async()=>{input.value='';feedback.textContent='';$('archive-region').value='';$('sel-station').value='260';wisselHoofdtab('records');wisselPeriode('alltime');wisselParam('tx');wisselRichting('hoog');$('record-calculation').value='daily';await wisselStation();});
 shortcut('CSV downloaden',()=>{const table=$('records-tabel');const rows=[...table.rows].filter(r=>!r.hidden);if(getComputedStyle(table).display==='none'||rows.length<2){feedback.textContent='Geen zichtbare ranglijst om te downloaden.';return;}const csv='\uFEFF'+rows.map(r=>[...r.cells].map(c=>'"'+c.textContent.trim().replaceAll('"','""')+'"').join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=make('a','',{href:url,download:'weerlab-recordselectie.csv'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 shortcut('Selectie delen',async()=>{const url=selectionURL();try{await navigator.clipboard.writeText(url);feedback.textContent='Link naar deze selectie gekopieerd.';}catch{feedback.replaceChildren(make('a','Open de link naar deze selectie',{href:url}));}});
 panel.append(shortcuts);filters.before(panel);
 const tabs=make('nav','',{class:'archive-categories','aria-label':'Recordcategorie'});
 categories.forEach(([title,param])=>{const b=make('button',title,{type:'button','data-param':param});b.onclick=()=>{wisselHoofdtab('records');wisselParam(param);};tabs.append(b);});
 const snow=make('button','Wintertemperatuur',{type:'button'});snow.onclick=()=>{wisselHoofdtab('records');wisselParam('tn');wisselRichting('laag');feedback.textContent='Wintertemperaturen. Sneeuwhoogte ontbreekt in deze recordbron.';};tabs.append(snow);filters.before(tabs);
 const regionLabel=make('label','Provincie · beschikbare stationreeksen',{class:'record-search'});const region=make('select','',{id:'archive-region','aria-label':'Provincie'});region.append(make('option','Alle provincies',{value:''}));
 const group=make('optgroup','',{label:'Provincies · stationreeksen'});
 for(const [name,ids] of Object.entries(regions)){const key='regio-'+name;GROEPEN[key]={naam:name,stns:ids};region.append(make('option',name,{value:key}));group.append(make('option',name+' · stationreeksen',{value:key}));}
 $('sel-station').append(group);region.onchange=()=>{if(region.value){$('sel-station').value=region.value;wisselStation();}else{$('sel-station').value='alle';wisselStation();}};regionLabel.append(region);filters.prepend(regionLabel);
 const filterFold=make('details','',{class:'archive-filter-fold'});const filterSummary=make('summary','Filters · station, periode en meetwaarde');filters.before(filterFold);filterFold.append(filterSummary,filters);const mobile=matchMedia('(max-width:700px)');const fold=()=>{filterFold.open=!mobile.matches;};fold();mobile.addEventListener('change',fold);
 $('sel-station').addEventListener('change',()=>{region.value=GROEPEN[$('sel-station').value]&&$('sel-station').value.startsWith('regio-')?$('sel-station').value:'';});
 // One command block: search, categories, filters and shortcuts.
 panel.append(tabs,filterFold);
 const overview=document.querySelector('.mobile-hoofdnav');
 if(overview)filterFold.append(overview);
 const secondary=make('div','',{class:'archive-secondary'});
 [...shortcuts.children].slice(4).forEach(b=>secondary.append(b));
 shortcuts.children[3].classList.add('archive-reset');
 document.querySelector('.record-results-actions')?.append(secondary);
 filters.querySelectorAll('.record-search:has(input[list])').forEach(n=>n.remove());
 const chips=make('div','',{class:'archive-active','aria-label':'Actieve selectie','aria-live':'polite'});panel.append(chips,shortcuts);
 document.querySelector('#breadcrumb-balk').classList.add('archive-legacy-breadcrumb');
 const notes=make('details','',{class:'archive-notes'});notes.append(make('summary','Brondekking en recordhistorie'));notes.append(make('p','Deze ranglijsten gebruiken de bestaande KNMI-bronnen. Provincies combineren alleen de genoemde stationreeksen; aanvullende losse historische meetplaatsen vallen buiten die selectie. Landelijke records behouden de volledige bestaande bronselectie. Een ranglijst is geen volledige geschiedenis van verbroken records. Vorig record, recordverschil en geldigheid kunnen pas betrouwbaar worden getoond met een geverifieerde recordhistorie. Sneeuwhoogte en luchtvochtigheid ontbreken in deze bron.'));document.querySelector('.content').append(notes);
 form.onsubmit=async e=>{e.preventDefault();const q=input.value.toLocaleLowerCase('nl').trim();if(!q)return;let recognized=false;wisselHoofdtab('records');wisselPeriode('alltime');
 const opts=[...$('sel-station').options].filter(o=>o.value&&!GROEPEN[o.value]);const matched=opts.filter(o=>q.includes(o.textContent.toLowerCase().replace(/\s*\(.*/,''))).sort((a,b)=>b.textContent.length-a.textContent.length);let st=matched[0];if(!st&&q.includes('rotterdam')){feedback.textContent='Kies Rotterdam Airport, Geulhaven of historisch Rotterdam met de stationsfilter.';return;}if(st){$('sel-station').value=st.value;recognized=true;}
 const m=months.findIndex(x=>q.includes(x));if(m>=0){wisselPeriode('maand');$('sel-maand').value=m+1;recognized=true;}
 const year=q.match(/\b(?:18|19|20)\d{2}\b/);if(year){wisselPeriode('jaar');$('sel-jaar').value=year[0];recognized=true;}
 let param=/koud|nacht|laagste temperatuur/.test(q)?'tn':/temperatuur|warm/.test(q)?'tx':/neerslag|natste|regen/.test(q)?'rh':/wind/.test(q)?'fx':/zon/.test(q)?'sq':/druk/.test(q)?'pg':null;
 if(param){wisselParam(param);recognized=true;}wisselRichting(/laagste|koud|minste/.test(q)?'laag':'hoog');
 if(!recognized){feedback.textContent='Geen herkenbare selectie. Gebruik een stationsnaam, maand, jaar of weerelement.';return;}if(st)await wisselStation();if(year){if(m>=0){wisselPeriode('periode');const y=Number(year[0]);$('sel-van').value=`${y}-${String(m+1).padStart(2,'0')}-01`;$('sel-tm').value=`${y}-${String(m+1).padStart(2,'0')}-${new Date(y,m+1,0).getDate()}`;}else{if(![...$('sel-jaar').options].some(o=>o.value===year[0])){feedback.textContent='Dit jaar ontbreekt voor deze stationselectie.';return;}$('sel-jaar').value=year[0];}}toon();feedback.textContent='Selectie toegepast. Controleer de actieve filters.';};
 const detail=make('aside','',{class:'archive-detail',hidden:'','aria-label':'Recorddetails'});const close=make('button','Sluiten',{type:'button'});close.onclick=()=>{detail.hidden=true;detail._trigger?.focus();};const body=make('div','');detail.append(close,body);$('tabel-wrapper-outer').after(detail);
 const resultGrid=make('div','',{class:'archive-results-grid'});const wrapper=$('tabel-wrapper-outer');wrapper.before(resultGrid);resultGrid.append(wrapper,detail);const localSearch=wrapper.querySelector('.record-table-tools label');if(localSearch?.firstChild?.nodeType===3)localSearch.firstChild.textContent='Filter zichtbare ranglijst';const localInput=localSearch?.querySelector('input');if(localInput)localInput.placeholder='Datum, jaar of station in deze rijen';
 const registryPromise=fetch('record-stations.json?v=20260928-3').then(r=>{if(!r.ok)throw Error();return r.json();}).catch(()=>null);
 const tbody=$('records-body');
 function decorate(){
  if(detail._trigger&&!tbody.contains(detail._trigger))detail.hidden=true;
  for(const row of tbody.rows){
   if(row.querySelector('[colspan]')||row.dataset.archiveDetail)continue;
   row.dataset.archiveDetail='1';row.tabIndex=0;row.setAttribute('aria-expanded','false');row.setAttribute('aria-controls','archive-record-detail');row.setAttribute('aria-label','Toon details: '+row.textContent.trim());
   const open=async()=>{
    tbody.querySelectorAll('[aria-expanded=true]').forEach(r=>r.setAttribute('aria-expanded','false'));row.setAttribute('aria-expanded','true');
    const headings=[...$('records-tabel').tHead.rows[0].cells].map(c=>c.textContent.replace(/[↕↑↓]/g,'').trim());
    const cell=(name)=>{const i=headings.findIndex(h=>name.test(h));return i>=0?row.cells[i]?.textContent.trim():'';};
    const station=cell(/^Station$/i)||(multiData?'Onbekend':data?.station)||$('sel-station').selectedOptions[0].textContent;
    const dataset=(multiData||[data]).find(d=>d?.station===station);
    const heading=make('h2',cell(/temp|neerslag|zon|wind|druk|waarde/i)||PARAM_LABELS[huidigeParam]||'Recorddetails');
    body.replaceChildren(heading,make('p',station,{class:'archive-detail-station'}));const dl=make('dl','');
    const add=(key,value)=>{if(value)dl.append(make('dt',key),make('dd',String(value)));};
    [...row.cells].forEach((c,i)=>{if(i>0)add(headings[i]||'Waarde',c.textContent.trim());});
    add('Meetwaarde',PARAM_LABELS[huidigeParam]||huidigeParam);add('Vergelijking',huidigeRichting==='hoog'?'Hoogste waarden':'Laagste waarden');
    add('Recorddefinitie',isPeriodeRanking(huidigePeriode,huidigeParam)?'Gemiddelde of som over de geselecteerde periode':'Afzonderlijke dagmeting');
    add('Selectie',periodeLabel()||$('sel-periode-mobile').selectedOptions[0].textContent);
    add('Meetstatus',row.textContent.includes('lopend')?'Voorlopige meting · lopende dag':'Geen lopend-meetlabel in deze ranglijst');add('Stationnummer',dataset?.station_nr);add('Beschikbare meetreeks',dataset?.van&&dataset?.tm?dataset.van+' t/m '+dataset.tm:'');add('Bron bijgewerkt',dataset?.gegenereerd);
    const pending=make('div','',{class:'archive-detail-metadata'});body.append(dl,pending);
    const caveat=make('details','',{class:'archive-detail-caveat'});caveat.append(make('summary','Meetstatus en ontbrekende informatie'),make('p','De rangpositie geldt voor de gekozen selectie en beschikbare bronnen. Een rangpositie bewijst niet dat een record historisch ononderbroken geldig was. Exacte meettijd, stationhoogte, vorig record en recordverschil ontbreken in deze bron.'));body.append(caveat);
    detail._trigger=row;detail.hidden=false;close.focus();
    const registry=await registryPromise;if(detail._trigger!==row)return;
    const entry=registry?.stations?.[station];
    if(entry){const meta=make('dl','');if(entry.coordinates){meta.append(make('dt','Locatie (lat, lon)'),make('dd',entry.coordinates[1].toFixed(3)+', '+entry.coordinates[0].toFixed(3)));}const province=Object.entries(regions).find(([,ids])=>ids.includes(String(entry.source)));if(province)meta.append(make('dt','Provincie'),make('dd',province[0]));if(entry.from||entry.through)meta.append(make('dt','Stationsregister'),make('dd',(entry.from||'onbekend')+' t/m '+(entry.through||'niet opgegeven')));pending.append(meta);}
    const source=entry?.source||(dataset?.station_nr?String(dataset.station_nr):null);
    if(source&&/^(\d+|nl_extreme|debilt)$/.test(source))pending.append(make('a','Open de gebruikte recordbron',{href:'https://data.weerlab.nl/records_'+source+'.json',target:'_blank',rel:'noopener'}));
    pending.append(make('p','Bron: KNMI · Weerlab-recordarchief',{class:'archive-detail-source'}));
   };
   row.onclick=open;row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};
  }
  document.dispatchEvent(new Event('weerlab-records-rendered'));
 }
 detail.id='archive-record-detail';close.addEventListener('click',()=>detail._trigger?.setAttribute('aria-expanded','false'));detail.addEventListener('keydown',e=>{if(e.key==='Escape')close.click();});
 new MutationObserver(decorate).observe(tbody,{childList:true});decorate();
 function selectionURL(){const url=new URL(location.href);url.search='';const values={station:$('sel-station').value,periode:huidigePeriode,param:huidigeParam,richting:huidigeRichting,tab:huidigeHoofdtab,calculation:$('record-calculation').value};for(const id of ['sel-maand','sel-jaar','sel-seizoen','sel-dag-maand','sel-dag-dag','sel-dec-maand','sel-dec-dec','sel-van','sel-tm'])values[id]=$(id).value;for(const [k,v]of Object.entries(values))url.searchParams.set(k,v);return url.href;}
 async function restore(){const p=new URLSearchParams(location.search);if(!p.has('station'))return;if([...$('sel-station').options].some(o=>o.value===p.get('station'))){$('sel-station').value=p.get('station');await wisselStation();}if([...$('sel-periode-mobile').options].some(o=>o.value===p.get('periode')))wisselPeriode(p.get('periode'));for(const id of ['sel-maand','sel-jaar','sel-seizoen','sel-dag-maand','sel-dec-maand','sel-dec-dec','sel-van','sel-tm']){if(p.has(id))$(id).value=p.get(id);}vulDagDagen();if(p.has('sel-dag-dag'))$('sel-dag-dag').value=p.get('sel-dag-dag');if([...$('sel-param-mobile').options].some(o=>o.value===p.get('param')))wisselParam(p.get('param'));if(['hoog','laag'].includes(p.get('richting')))wisselRichting(p.get('richting'));if(['daily','period'].includes(p.get('calculation')))$('record-calculation').value=p.get('calculation');if([...$('sel-hoofdtab-mobile').options].some(o=>o.value===p.get('tab')))wisselHoofdtab(p.get('tab'));toon();}
 async function waitForInit(){for(let i=0;i<300;i++){if($('sel-jaar').options.length && data)return;await new Promise(r=>setTimeout(r,100));}throw new Error('Bronnen laden duurt te lang');}
 waitForInit().then(restore).catch(()=>{feedback.textContent='Selectie kon niet volledig worden geladen.';});
 document.addEventListener('weerlab-records-rendered',()=>{clearTimeout(timer);timer=setTimeout(()=>{filterSummary.textContent='Filters aanpassen';region.value=$('sel-station').value.startsWith('regio-')?$('sel-station').value:'';chips.replaceChildren(...[$('sel-station').selectedOptions[0].textContent,periodeLabel()||$('sel-periode-mobile').selectedOptions[0].textContent,PARAM_LABELS[huidigeParam]||huidigeParam,huidigeRichting==='hoog'?'Hoogste':'Laagste'].map(t=>make('span',t))); tabs.querySelectorAll('[data-param]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.param===huidigeParam)));},0);});
});
})();
