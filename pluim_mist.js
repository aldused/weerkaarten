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
 return h.tijden_utc.map((t,i)=>({time:Date.parse(t),probability:finite(h.wwM[i])&&h.wwM[i]>=0&&h.wwM[i]<=100?h.wwM[i]:null})).filter(p=>finite(p.time)&&p.time>start&&p.time<=end);
}
function dailyMax(rows){
 const days=new Map();for(const p of rows){const key=dayKey(p.time-HOUR);if(!days.has(key))days.set(key,{key,time:p.time-HOUR,value:null});const day=days.get(key);if(finite(p.probability))day.value=day.value===null?p.probability:Math.max(day.value,p.probability);}
 return [...days.values()];
}
function render(rows,station,run,start,end){
 const left=90,top=180,w=1440,h=290,x=t=>left+(t-start)/(end-start)*w,y=p=>top+h-p*h/100;
 const label=t=>format(t,{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
 let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1580 740" role="img" aria-labelledby="fog-title fog-desc" font-family="Arial,sans-serif"><title id="fog-title">${esc(station)} · DWD-MOSMIX mistkans</title><desc id="fog-desc">Officiële mistkans per uur in procenten. Geen zelf berekende zichtdrempels. Lege uren zijn ontbrekende gegevens.</desc><rect width="1580" height="740" fill="white"/><text x="38" y="47" font-size="28" font-weight="700" fill="#20394d">${esc(station)} · Mistkans</text><text x="38" y="78" font-size="16" fill="#50687a">DWD-MOSMIX · officiële uurlijkse mistkans · statistisch nabewerkt op basis van ICON en ECMWF</text><text x="38" y="106" font-size="13" fill="#617789">Run ${esc(label(Date.parse(run)))} · alle tijden Nederlands · staafje = kans op mist in het betreffende uur</text><rect x="38" y="133" width="18" height="14" rx="2" fill="#437ca5"/><text x="64" y="146" font-size="14" fill="#20394d">Mistkans (DWD-parameter wwM)</text>`;
 for(let t=start;t<end;t+=HOUR){const hour=Number(format(t,{hour:'2-digit',hourCycle:'h23'}));if(hour<7||hour>=20)s+=`<rect x="${x(t)}" y="${top}" width="${w*HOUR/(end-start)}" height="${h}" fill="#f0f3f8"/>`;if(hour===0){s+=`<path d="M${x(t)},${top}v${h}" stroke="#d6e0e9"/><text x="${x(t)+4}" y="${top+h+25}" font-size="13" fill="#50687a">${esc(format(t,{weekday:'short',day:'2-digit',month:'2-digit'}))}</text>`;}}
 [0,25,50,75,100].forEach(p=>{s+=`<path d="M${left},${y(p)}h${w}" stroke="#dae3eb"/><text x="${left-12}" y="${y(p)+4}" text-anchor="end" font-size="13" fill="#50687a">${p}%</text>`;});
 s+=`<text x="${left}" y="${top-12}" font-size="12" fill="#617789">Donkere achtergrond: 20–07 uur</text>`;
 const bw=w*HOUR/(end-start)*.86;
 for(const p of rows){if(!finite(p.probability))continue;const xx=x(p.time-HOUR/2),title=label(p.time-HOUR)+' – '+format(p.time,{hour:'2-digit',minute:'2-digit'})+': '+p.probability+'% kans op mist';s+=p.probability>0?`<rect data-fog-bar="wwM" x="${xx-bw/2}" y="${y(p.probability)}" width="${bw}" height="${h*p.probability/100}" fill="#437ca5"><title>${esc(title)}</title></rect>`:`<circle data-fog-zero="true" cx="${xx}" cy="${y(0)}" r="1.5" fill="#437ca5"><title>${esc(title)}</title></circle>`;}
 if(!rows.some(p=>finite(p.probability)))s+=`<text x="800" y="330" text-anchor="middle" font-size="18" fill="#617789">Geen geldige uurlijkse mistkansen beschikbaar voor deze periode.</text>`;
 s+='<text x="38" y="545" font-size="17" font-weight="700" fill="#20394d">Hoogste uurlijkse mistkans per getoonde dag</text>';
 const days=dailyMax(rows),cw=Math.min(210,1500/Math.max(1,days.length));
 days.forEach((d,i)=>{const xx=38+i*cw;s+=`<rect x="${xx}" y="560" width="${cw-8}" height="78" rx="7" fill="#edf4f8"/><text x="${xx+12}" y="582" font-size="12" fill="#50687a">${esc(format(d.time,{weekday:'short',day:'2-digit',month:'2-digit'}))}</text><text x="${xx+12}" y="619" font-size="27" font-weight="700" fill="#24577a">${d.value===null?'—':d.value+'%'}</text>`;});
 return s+'<text x="38" y="666" font-size="12" fill="#617789">Dagwaarden zijn maxima van de getoonde uurkansen, niet de kans op minstens één mistmoment op de hele dag.</text><text x="38" y="690" font-size="12" fill="#617789">DWD levert hier een algemene mistkans; geen afzonderlijke kansen voor zicht onder 500, 250 of 50 meter.</text><text x="38" y="716" font-size="12" fill="#617789">Bron: Deutscher Wetterdienst, MOSMIX-L (wwM) · ontbrekende uren blijven leeg · Weerlab</text></svg>';
}
function init(){
 const $=id=>document.getElementById(id);let feed=null,station='De Bilt',svg='',controller,generation=0;
 document.title='Mistkans · DWD-MOSMIX · Weerlab';document.querySelector('[data-view="mist"]').setAttribute('aria-current','page');
 document.querySelector('.comparison-card').setAttribute('aria-label','DWD-MOSMIX mistkans per uur');document.querySelector('.comparison-note').innerHTML='Officiële DWD-kansen, rechtstreeks overgenomen uit MOSMIX-L. Dit product combineert statistisch nabewerkte ICON- en ECMWF-verwachtingen; het zijn geen afzonderlijke ensemblepluimen. <a href="https://www.dwd.de/EN/ourservices/met_application_mosmix/met_application_mosmix.html" target="_blank" rel="noopener">Over DWD-MOSMIX</a>.';
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
  try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=3160;canvas.height=1480;canvas.getContext('2d').drawImage(image,0,0,3160,1480);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error();const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download='weerlab-mist-DWD-'+name.replace(/[^a-z0-9-]/gi,'-')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}catch{$('status').textContent='Download mislukt. Probeer opnieuw.';}finally{URL.revokeObjectURL(url);$('download').disabled=!svg;}
 };load();
}
const api={points,dailyMax,render,init};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FogPlume=api;
})(typeof window==='undefined'?globalThis:window);
