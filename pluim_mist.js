/* Officiële DWD MOSMIX-L mistkans (wwM), rechtstreeks overgenomen per uur. */
(function(root){
'use strict';
const HOUR=3600000,DAY=24*HOUR,TZ='Europe/Amsterdam';
const finite=v=>typeof v==='number'&&Number.isFinite(v),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=(t,options)=>new Intl.DateTimeFormat('nl-NL',{timeZone:TZ,...options}).format(t);
const dayKey=t=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
function points(feed,station,start,end,now=Date.now()){
 const run=Date.parse(feed?.runs?.[station]||feed?.run);
 if(!finite(run)||now-run>30*HOUR||run>now+HOUR)throw new Error('De DWD-run ontbreekt of is te oud. Er wordt geen verouderde mistverwachting getoond.');
 const h=feed?.data?.[station];
 if(!Array.isArray(h?.tijden_utc)||!Array.isArray(h?.wwM))throw new Error('Uurlijkse DWD-mistkansen ontbreken voor dit station.');
 return h.tijden_utc.map((t,i)=>({time:Date.parse(t),visibility:finite(h.VV?.[i])&&h.VV[i]>=0?h.VV[i]:null,probability:finite(h.wwM[i])&&h.wwM[i]>=0&&h.wwM[i]<=100?h.wwM[i]:null})).filter(p=>finite(p.time)&&p.time>start&&p.time<=end);
}
function dailyMax(rows){
 const days=new Map();
 function day(t){const key=dayKey(t);if(!days.has(key))days.set(key,{key,time:t,value:null,minVisibility:null,visibilityTime:null});return days.get(key);}
 for(const p of rows){const d=day(p.time-HOUR);if(finite(p.probability))d.value=d.value===null?p.probability:Math.max(d.value,p.probability);
  if(finite(p.visibility)){const v=day(p.time);if(v.minVisibility===null||p.visibility<v.minVisibility){v.minVisibility=p.visibility;v.visibilityTime=p.time;}}
 }return [...days.values()].sort((a,b)=>a.key.localeCompare(b.key));
}
function render(rows,station,run,start,end){
 const left=100,w=1420,x=t=>left+(t-start)/(end-start)*w,top=170,h=240,vtop=525,vh=230;
 const y=p=>top+h-p*h/100,vy=v=>vtop+vh*(1-Math.log(Math.max(50,Math.min(10000,v))/50)/Math.log(200));
 const label=t=>format(t,{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}),clock=t=>format(t,{hour:'2-digit',minute:'2-digit'});
 let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1580 1060" role="img" aria-labelledby="fog-title fog-desc" font-family="Arial,sans-serif"><title id="fog-title">${esc(station)} · Mistkans en verwacht zicht</title><desc id="fog-desc">Boven: officiële DWD-mistkans per uur. Onder: verwacht zicht in meters op het tijdstip. Nederlandse tijden om de zes uur. Ontbrekende waarden blijven leeg.</desc><rect width="1580" height="1060" fill="white"/><text x="38" y="45" font-size="28" font-weight="700" fill="#20394d">${esc(station)} · Mistkans en verwacht zicht</text><text x="38" y="76" font-size="15" fill="#50687a">DWD-MOSMIX · officiële mistkans en zichtverwachting · statistisch nabewerkt op basis van ICON en ECMWF</text><text x="38" y="103" font-size="13" fill="#617789">Run ${esc(label(Date.parse(run)))} · alle tijden Nederlands · donkere achtergrond: 20–07 uur</text><text x="38" y="139" font-size="18" font-weight="700" fill="#20394d">Kans op mist per uur (%)</text>`;
 function axes(t,hh){
  let out='';const dates=new Map();for(let time=start;time<=end;time+=HOUR){const hour=Number(format(time,{hour:'2-digit',hourCycle:'h23'}));if(time<end){const key=dayKey(time);if(!dates.has(key))dates.set(key,{start:time,end:time+HOUR});else dates.get(key).end=time+HOUR;}if(time<end&&(hour<7||hour>=20))out+=`<rect x="${x(time)}" y="${t}" width="${w*HOUR/(end-start)}" height="${hh}" fill="#f0f3f8"/>`;
   if(hour%6===0&&x(time)>left+15&&x(time)<left+w-15)out+=`<path d="M${x(time)},${t}v${hh+5}" stroke="${hour===0?'#c5d3df':'#e5ebf0'}"/><text data-hour-tick="true" x="${x(time)}" y="${t+hh+20}" text-anchor="middle" font-size="11" fill="#50687a">${clock(time)}</text>`;
  }
  for(const d of dates.values())out+=`<text x="${x((d.start+d.end)/2)}" y="${t+hh+41}" text-anchor="middle" font-size="13" font-weight="700" fill="#50687a">${esc(format(d.start,{weekday:'short',day:'2-digit',month:'2-digit'}))}</text>`;
 return out;
 }
 s+=axes(top,h);[0,25,50,75,100].forEach(p=>{s+=`<path d="M${left},${y(p)}h${w}" stroke="#d9e2ea"/><text x="${left-12}" y="${y(p)+4}" text-anchor="end" font-size="13" fill="#50687a">${p}%</text>`;});
 const bw=w*HOUR/(end-start)*.86;
 for(const p of rows){if(!finite(p.probability))continue;const xx=x(p.time-HOUR/2),title=label(p.time-HOUR)+' – '+clock(p.time)+': '+p.probability+'% kans op mist';s+=p.probability>0?`<rect data-fog-bar="wwM" x="${xx-bw/2}" y="${y(p.probability)}" width="${bw}" height="${h*p.probability/100}" fill="#437ca5"><title>${esc(title)}</title></rect>`:`<circle data-fog-zero="true" cx="${xx}" cy="${y(0)}" r="1.5" fill="#437ca5"><title>${esc(title)}</title></circle>`;}
 s+='<text x="38" y="489" font-size="18" font-weight="700" fill="#20394d">Verwacht zicht (meters)</text><text x="38" y="511" font-size="12" fill="#617789">Logaritmische schaal · zicht ≤50 m onderaan, ≥10.000 m bovenaan · beweeg over een punt voor de exacte waarde en tijd</text>';
 s+=axes(vtop,vh);
 s+=`<rect x="${left}" y="${vy(1000)}" width="${w}" height="${vtop+vh-vy(1000)}" fill="#ead9b6" opacity=".28"/>`;
 [50,250,500,1000,5000,10000].forEach(v=>{s+=`<path d="M${left},${vy(v)}h${w}" stroke="${v<=1000?'#c7a677':'#d9e2ea'}" stroke-dasharray="${v<=1000?'4 4':'none'}"/><text x="${left-12}" y="${vy(v)+4}" text-anchor="end" font-size="12" fill="#50687a">${v===50?'≤50':v===10000?'≥10.000':v.toLocaleString('nl-NL')} m</text>`;});
 let path='',previous=null;for(const p of rows){if(!finite(p.visibility)){previous=null;continue;}path+=(previous!==null&&p.time-previous<=HOUR?'L':'M')+x(p.time)+','+vy(p.visibility);previous=p.time;}
 s+=`<path data-visibility-line="true" d="${path}" fill="none" stroke="#98551e" stroke-width="2"/>`;
 for(const p of rows){if(!finite(p.visibility))continue;s+=`<circle data-visibility-point="true" cx="${x(p.time)}" cy="${vy(p.visibility)}" r="3" fill="#98551e"><title>${esc(label(p.time))}: verwacht zicht ${p.visibility.toLocaleString('nl-NL')} meter</title></circle>`;}
 if(!rows.some(p=>finite(p.visibility)))s+='<text x="800" y="640" text-anchor="middle" font-size="18" fill="#617789">Geen zichtverwachting beschikbaar; mistkansen blijven hierboven zichtbaar.</text>';
 s+='<text x="38" y="841" font-size="17" font-weight="700" fill="#20394d">Per getoonde dag: hoogste uurkans en laagste zicht</text>';
 const days=dailyMax(rows),cw=Math.min(210,1500/Math.max(1,days.length));
 days.forEach((d,i)=>{const xx=38+i*cw;s+=`<rect x="${xx}" y="858" width="${cw-8}" height="105" rx="7" fill="#edf4f8"/><text x="${xx+12}" y="879" font-size="12" fill="#50687a">${esc(format(d.time,{weekday:'short',day:'2-digit',month:'2-digit'}))}</text><text x="${xx+12}" y="911" font-size="25" font-weight="700" fill="#24577a">${d.value===null?'—':d.value+'%'}</text><text x="${xx+12}" y="936" font-size="13" fill="#98551e">Zicht: ${d.minVisibility===null?'—':d.minVisibility.toLocaleString('nl-NL')+' m'}</text><text x="${xx+12}" y="952" font-size="10" fill="#617789">${d.visibilityTime===null?'':clock(d.visibilityTime)+' uur (laagste zicht)'}</text>`;});
 return s+'<text x="38" y="989" font-size="12" fill="#617789">De uurkans geldt voor het uur vóór het tijdstip; zicht is de verwachting óp het tijdstip. Piek in mistkans en laagste zicht kunnen verschillen.</text><text x="38" y="1013" font-size="12" fill="#617789">Zicht is geen kans op een zichtgrens en geen zichtverwachting uitsluitend tijdens mist. Ook neerslag kan het zicht beperken.</text><text x="38" y="1037" font-size="12" fill="#617789">Bron: DWD MOSMIX-L (wwM en VV) · dagpercentage = hoogste getoonde uurkans, geen etmaalkans · ontbrekende waarden blijven leeg · Weerlab</text></svg>';
}
function init(){
 const $=id=>document.getElementById(id);let feed=null,station='De Bilt',svg='',controller,generation=0;
 document.title='Mistkans · DWD-MOSMIX · Weerlab';document.querySelector('[data-view="mist"]').setAttribute('aria-current','page');
 document.querySelector('.comparison-card').setAttribute('aria-label','DWD-MOSMIX mistkans en verwacht zicht');document.querySelector('.comparison-note').innerHTML='Officiële DWD-mistkansen en verwacht zicht in meters, rechtstreeks overgenomen uit MOSMIX-L. Alle tijden zijn Nederlands; het zicht is geen afzonderlijke kans op dichte mist. Dit product combineert statistisch nabewerkte ICON- en ECMWF-verwachtingen; het zijn geen afzonderlijke ensemblepluimen. <a href="https://www.dwd.de/EN/ourservices/met_application_mosmix/met_application_mosmix.html" target="_blank" rel="noopener">Over DWD-MOSMIX</a>.';
 $('days').innerHTML='<option value="3">3 dagen</option><option value="7" selected>7 dagen</option><option value="10">10 dagen</option>';
 $('search').placeholder='Zoek MOSMIX-station';$('search').setAttribute('aria-label','Zoek MOSMIX-station');
 try{station=sessionStorage.getItem('weerlab-mist-station')||station;}catch{}
 function draw(){
  svg='';$('download').disabled=true;$('chart').replaceChildren();
  if(!feed)return;
  try{const now=Date.now(),start=Math.floor(now/HOUR)*HOUR,end=start+Number($('days').value)*DAY,run=feed.runs?.[station]||feed.run,rows=points(feed,station,start,end,now);
   if(!rows.some(p=>finite(p.probability)))throw new Error('Geen geldige mistkansen voor deze periode.');
   svg=render(rows,station,run,start,end);$('chart').innerHTML=svg;$('download').disabled=false;
   $('status').textContent=`${station} · DWD-MOSMIX · run ${format(Date.parse(run),{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} Nederlandse tijd · ${rows.filter(p=>finite(p.probability)).length} uurkansen · maximaal ${Math.max(...rows.filter(p=>finite(p.probability)).map(p=>p.probability))}% in de getoonde periode`;
  }catch(e){$('status').textContent=e.message;$('chart').textContent='Geen mistverwachting beschikbaar. Ontbrekende gegevens zijn geen 0%.';}
 }
 async function load(){const id=++generation;controller?.abort();controller=new AbortController();const active=controller,timeout=setTimeout(()=>active.abort(),30000);$('status').textContent='Officiële DWD-mistkansen laden…';$('download').disabled=true;svg='';$('chart').replaceChildren();document.querySelector('.comparison-card').setAttribute('aria-busy','true');
  try{const r=await fetch('https://data.weerlab.nl/mosmix_uurlijks_nl.json?mist='+Date.now(),{signal:controller.signal,cache:'no-store'});if(!r.ok)throw new Error('DWD-feed tijdelijk niet bereikbaar.');const d=await r.json();if(id!==generation)return;feed=d;
   const names=Object.keys(d.data||{}).sort((a,b)=>a.localeCompare(b,'nl'));if(!names.length)throw new Error('Geen MOSMIX-stations ontvangen.');if(!names.includes(station))station=names.includes('De Bilt')?'De Bilt':names[0];$('station').replaceChildren(...names.map(n=>new Option(n,n)));$('station').value=station;draw();
  }catch(e){if(id===generation){feed=null;$('status').textContent=e.name==='AbortError'?'Ophalen duurde te lang. Probeer Vernieuw.':e.message;$('chart').textContent='Geen actuele mistverwachting beschikbaar.';}}
  finally{clearTimeout(timeout);if(id===generation)document.querySelector('.comparison-card').setAttribute('aria-busy','false');}
 }
 function choose(name){station=name;$('station').value=name;try{sessionStorage.setItem('weerlab-mist-station',name);}catch{}$('search-results').hidden=true;draw();}
 $('station').onchange=()=>choose($('station').value);$('days').onchange=draw;$('refresh').onclick=load;
 $('controls').onsubmit=e=>{e.preventDefault();const q=$('search').value.trim().toLocaleLowerCase('nl');if(!q)return;const names=Object.keys(feed?.data||{}).filter(n=>n.toLocaleLowerCase('nl').includes(q));$('search-results').replaceChildren();$('search-results').hidden=false;if(!names.length)$('search-results').textContent='Geen MOSMIX-station gevonden. Kies een station uit de lijst.';for(const name of names){const b=document.createElement('button');b.type='button';b.textContent=name;b.onclick=()=>choose(name);$('search-results').append(b);}};
 $('download').onclick=async()=>{if(!svg)return;const source=svg,name=station,url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml'}));$('download').disabled=true;
  try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=3160;canvas.height=2120;canvas.getContext('2d').drawImage(image,0,0,3160,2120);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error();const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download='weerlab-mist-DWD-'+name.replace(/[^a-z0-9-]/gi,'-')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}catch{$('status').textContent='Download mislukt. Probeer opnieuw.';}finally{URL.revokeObjectURL(url);$('download').disabled=!svg;}
 };load();
}
const api={points,dailyMax,render,init};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FogPlume=api;
})(typeof window==='undefined'?globalThis:window);
