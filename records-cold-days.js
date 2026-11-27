/* Koude dagen: cumulative cold thresholds, winter-year counts and records per station. */
const KD_LABELS=ColdDays.categories.map(c=>c.label),KD_DESC=ColdDays.categories.map(c=>c.description),KD_COLORS=ColdDays.categories.map(c=>c.color),KD_VAR=ColdDays.categories.map(c=>c.field),KD_TEST=ColdDays.categories.map(c=>c.test);
let kdCat=0,kdView='jaar',kdPeriod='winteryear',kdCache=null,kdCacheRef=null,kdCacheTag='',kdStationCache=null,kdStationTag='',kdStationRef=null,kdStationsLoading=false;
function kdToday(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;}
function kdSources(){return (Array.isArray(multiData)&&multiData.length?multiData:(data?[data]:[])).filter(d=>d?.maanddetail);}
function kdPeriodLabel(y){return ColdDays.label(y,kdPeriod);}
function kdPeriodName(){return kdPeriod==='winteryear'?'winterjaar':'kalenderjaar';}
function kdPeriodPlural(){return kdPeriod==='winteryear'?'winterjaren':'kalenderjaren';}
function kdCompute(){
 const sources=kdSources();if(!sources.length)return null;
 const ref=multiData||data,tag=kdPeriod+':'+kdToday();
 if(kdCache&&kdCacheRef===ref&&kdCacheTag===tag)return kdCache;
 kdCache=ColdDays.compute(sources,{mode:kdPeriod,today:kdToday()});kdCacheRef=ref;kdCacheTag=tag;
 if(kdCache)kdCache.bron=sources.length>1?'alle geladen stations':sources[0].station;
 return kdCache;
}
function kdCountText(c,year,category=kdCat){
 const meta=c.coverage[year];if(!meta?.valid[category])return '—';
 return (meta.valid[category]<(meta.running?meta.elapsed:meta.expected)?'≥ ':'')+c.perYear[year][category];
}
function kdRememberSelection(){const url=new URL(location.href);url.searchParams.set('tab','koudedagen');url.searchParams.set('station',document.getElementById('sel-station').value);url.searchParams.set('coldcategory',kdCat);url.searchParams.set('coldperiod',kdPeriod);url.searchParams.set('coldview',kdView);const year=document.getElementById('kd-selected-year')?.value;if(year&&kdView!=='stations')url.searchParams.set('coldyear',year);else url.searchParams.delete('coldyear');history.replaceState(null,'',url);}
function kdSetView(view){kdView=view;kdRender();kdRememberSelection();}
async function kdShowStationRecords(){
 if(kdStationsLoading)return;kdStationsLoading=true;kdView='stations';
 try{const select=document.getElementById('sel-station');if(select.value!=='alle'){select.value='alle';await wisselStation();}kdRender();kdRememberSelection();}finally{kdStationsLoading=false;}
}
function kdRender(){
 document.querySelectorAll('#sectie-koudedagen .wd-vbtn').forEach(b=>b.classList.toggle('actief',b.dataset.view===kdView));
 const season=kdPeriodName();
 document.querySelector('#sectie-koudedagen [data-view="jaar"]').textContent=kdPeriod==='winteryear'?'Per winterjaar':'Per kalenderjaar';
 document.getElementById('kd-year-heading').textContent=kdPeriod==='winteryear'?'Winterjaar':'Kalenderjaar';
 document.getElementById('kd-year-summary').textContent=`Toon volledige ${season}tabel`;
 const tabs=document.getElementById('kd-catTabs');
 if(!tabs.children.length)KD_LABELS.forEach((label,i)=>{const b=document.createElement('button');b.type='button';b.className='wd-thr-tab';b.dataset.i=i;b.innerHTML=`<span class="tlabel">${wdEsc(label)}</span><span class="tdesc">${wdEsc(KD_DESC[i])}</span>`;b.onclick=()=>{kdCat=i;kdRender();};tabs.append(b);});
 tabs.querySelectorAll('[data-i]').forEach(b=>{const active=+b.dataset.i===kdCat;b.classList.toggle('actief',active);b.style.background=active?KD_COLORS[kdCat]:'';});
 const reeksen=kdView==='reeksen';tabs.style.display=reeksen?'none':'';document.getElementById('kd-uitleg').parentElement.style.display=reeksen?'none':'';
 document.getElementById('kd-uitleg').textContent=`${KD_LABELS[kdCat]}: ${KD_DESC[kdCat]}. ${kdCat===3?'Ook strenge en zeer strenge vorst tellen mee. ':''}${kdPeriod==='winteryear'?'Een winterjaar loopt van 1 augustus t/m 31 juli.':'Een kalenderjaar loopt van 1 januari t/m 31 december.'} Alleen waargenomen dagen tellen; ontbrekende dagen worden niet als nul ingevuld.`;
 for(const [key,id]of [['jaar','kd-viewJaar'],['seizoen','kd-viewSeizoen'],['maand','kd-viewMaand'],['reeksen','kd-viewReeksen'],['stations','kd-viewStations']])document.getElementById(id).style.display=key===kdView?'':'none';
 if(typeof updateBreadcrumb==='function')updateBreadcrumb();
 if(reeksen){kdRenderReeksen();return;}
 const c=kdCompute();document.getElementById('kd-leeg').style.display=c?'none':'';
 if(!c)return;
 if(kdView==='jaar')kdRenderJaar(c);else if(kdView==='maand')kdRenderMaand(c);else if(kdView==='seizoen')kdRenderSeizoen(c);else kdRenderStationRecords();
}
function kdRenderJaar(c){
 const years=Object.keys(c.perYear).map(Number).sort((a,b)=>a-b),ranking=ColdDays.rankYears(c,kdCat).filter(r=>r.count>0),noun=ColdDays.categories[kdCat].noun;
 const podium=document.getElementById('kd-podium');podium.replaceChildren();
 ranking.slice(0,3).concat(Array(Math.max(0,3-ranking.length)).fill(null)).forEach((row,i)=>{
  const card=document.createElement('div');card.className='wd-pcard'+(i===0?' p1':'');
  card.innerHTML=`<div class="wd-medal">${['🥇','🥈','🥉'][i]}</div><div class="rang">${i===0?'Hoogste telling':i+1+'e plek'}</div><div class="jaar">${row?kdPeriodLabel(row.year):'—'}</div><div class="aantal">${row?'<b>'+kdCountText(c,row.year)+'</b> dagen':'geen'}</div>${row&&row.valid<row.expected?'<div class="hsub">onvolledige meetdekking</div>':''}`;
  podium.append(card);
 });
 const old=years.filter(y=>y+(kdPeriod==='winteryear'?1:0)<=1999),recent=years.filter(y=>!old.includes(y));
 document.getElementById('kd-eeuw').innerHTML=[old,recent].map((ys,i)=>`<div class="wd-ecard${i?' e21':''}"><div class="etitel">${i?'Deze eeuw':'Vorige eeuw'} · ${kdPeriod==='winteryear'?'eindjaar ':''}${i?'vanaf 2000':'t/m 1999'}</div><div class="ebig">${ys.filter(y=>c.perYear[y][kdCat]>0).length} <small>van ${ys.length} ${kdPeriodPlural()}</small></div><div class="emeta">met minstens één dag in deze categorie</div></div>`).join('');
 const maximum=Math.max(1,...years.map(y=>c.perYear[y][kdCat])),record=ranking[0]?.year,bars=document.getElementById('kd-bars');bars.replaceChildren();
 for(const year of years){const count=c.perYear[year][kdCat],bar=document.createElement('div');bar.className='wd-bar'+(year===record?' hl':'');bar.style.height=count/maximum*100+'%';bar.style.background=count?KD_COLORS[kdCat]:'var(--kaart2)';bar.innerHTML=`<span class="bt">${kdPeriodLabel(year)}: ${kdCountText(c,year)} dagen${c.coverage[year].running?' · lopend':''}</span>`;bars.append(bar);}
 document.getElementById('kd-axis').innerHTML=[years[0],years[Math.floor(years.length/2)],years.at(-1)].map(y=>`<span>${kdPeriodLabel(y)}</span>`).join('');
 document.getElementById('kd-barTitel').textContent=`${KD_LABELS[kdCat]} per ${kdPeriodName()} — ${c.bron}`;
 document.getElementById('kd-barSub').textContent=ranking.length?`Hoogste waargenomen telling in een afgesloten ${kdPeriodName()}: ${ranking[0].count} ${noun}, ${kdPeriodLabel(record)}. Meetgaten zijn gemarkeerd; het lopende ${kdPeriodName()} telt niet mee voor de ranglijst.`:'Geen afgesloten periode met dagen in deze categorie gevonden.';
 document.getElementById('kd-jaarTbody').innerHTML=years.slice().reverse().map(y=>{const meta=c.coverage[y];return `<tr${c.perYear[y][kdCat]?'':' class="z0"'}><td>${kdPeriodLabel(y)}${meta.running?' · lopend':''}</td><td>${kdCountText(c,y)}</td><td>${meta.valid[kdCat]} / ${meta.running?meta.elapsed:meta.expected}${meta.valid[kdCat]<(meta.running?meta.elapsed:meta.expected)?' · meetgaten':''}</td></tr>`;}).join('');
}
function kdRenderStationRecords(){
 const sources=(multiData||[data]).filter(Boolean),tag=kdCat+':'+kdPeriod+':'+kdToday(),ref=multiData||data;
 const el=document.getElementById('kd-viewStations');
 if(document.getElementById('sel-station').value!=='alle'||!sources.length){el.replaceChildren();return;}
 if(kdStationTag!==tag||kdStationRef!==ref){kdStationCache=ColdDays.stationRecords(sources,kdCat,{mode:kdPeriod,today:kdToday()});kdStationTag=tag;kdStationRef=ref;}
 const rows=kdStationCache||[],top=rows[0],category=ColdDays.categories[kdCat];
 const leaders=top?rows.filter(r=>r.count===top.count):[];
 const rankedStationIds=new Set(rows.map(row=>row.stationNr));
 const withoutMeasurements=sources.filter(source=>!rankedStationIds.has(String(source.station_nr)))
  .sort((a,b)=>a.station.localeCompare(b.station,'nl'));
 const measurements=category.field==='tn'?'dagminima':'dagmaxima';
 const rankedRows=rows.map(row=>`<tr><th scope="row">${wdEsc(row.station)}</th><td>${row.valid<row.expected?'≥ ':''}${row.count}</td><td>${row.ties.slice(0,5).map(r=>kdPeriodLabel(r.year)).join(', ')}${row.ties.length>5?`<details><summary>En ${row.ties.length-5} andere perioden</summary>${row.ties.slice(5).map(r=>kdPeriodLabel(r.year)).join(', ')}</details>`:''}</td><td>${row.valid} / ${row.expected}${row.valid<row.expected?' · meetgaten':''}</td></tr>`).join('');
 const unrankedRows=withoutMeasurements.map(source=>`<tr><th scope="row">${wdEsc(source.station)}</th><td>—</td><td>—</td><td>Geen ${measurements} in afgesloten ${kdPeriodPlural()}</td></tr>`).join('');
 el.innerHTML=`<div class="wd-blok"><h3>Hoogste telling per station · alle ${kdPeriodPlural()}</h3><p class="hsub">${rows.length} van de ${sources.length} geladen stations hebben ${measurements} in afgesloten ${kdPeriodPlural()}. Historische stations met dagreeksen tellen mee. Losse recordnoteringen volstaan niet voor een telling.</p>${top?`<div class="kd-station-record" role="status"><strong>${top.count} ${wdEsc(category.noun)}</strong><span>${leaders.map(r=>`${wdEsc(r.station)} · ${kdPeriodLabel(r.year)}`).join('<br>')}</span></div>`:''}<div class="kd-station-table"><table class="wd-tabel" data-record-row-limit="all"><thead><tr><th>Station</th><th>Hoogste aantal</th><th>${kdPeriod==='winteryear'?'Winterjaar':'Kalenderjaar'}</th><th>Meetdagen</th></tr></thead><tbody>${rankedRows}${unrankedRows}</tbody></table></div><p class="hsub">Bij meetgaten is het aantal een ondergrens (≥).</p></div>`;
}
function kdRenderMaand(c){
 const totals=c.monthTotal[kdCat],best=c.monthBest[kdCat],max=Math.max(1,...totals),el=document.getElementById('kd-mbars');el.replaceChildren();document.getElementById('kd-mTitel').textContent=`${KD_LABELS[kdCat]} per kalendermaand — ${c.bron}`;
 for(let month=1;month<=12;month++){const col=document.createElement('div');col.className='wd-mbar-col';col.innerHTML=`<div class="wd-mbar-val">${totals[month]||''}</div><div class="wd-mbar" style="height:${totals[month]/max*150}px;background:${KD_COLORS[kdCat]}"></div><div class="wd-mbar-lbl">${NL_MAANDEN[month]}</div><div class="wd-mbar-best">${best[month]?'record: '+best[month][0]+' in '+best[month][1]:''}</div>`;el.append(col);}
}
function kdRenderSeizoen(c){
 const totals=c.seasonTotal[kdCat],best=c.seasonBest[kdCat],max=Math.max(1,...totals),el=document.getElementById('kd-sbars');el.replaceChildren();document.getElementById('kd-sTitel').textContent=`${KD_LABELS[kdCat]} per meteorologisch seizoen — ${c.bron}`;
 KT_SEIZOENEN.forEach((name,i)=>{const col=document.createElement('div');col.className='wd-mbar-col';col.innerHTML=`<div class="wd-mbar-val">${totals[i]||''}</div><div class="wd-mbar" style="width:75%;height:${totals[i]/max*150}px;background:${KD_COLORS[kdCat]}"></div><div class="wd-mbar-lbl">${name}</div><div class="wd-mbar-best">${best[i]?'record: '+best[i][0]+' in '+ktSeizoenLabel(i,best[i][1]):''}</div>`;el.append(col);});
}
