/* Zichtkansen uit echte ensembleleden, zonder omzetting van RV naar zicht. */
(function(root){
'use strict';
const THRESHOLDS=[1000,500,250,50],COLORS=['#a9d4e2','#5ca9c5','#316aa5','#553776'];
const finite=v=>typeof v==='number'&&Number.isFinite(v),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function probabilities(data,start,end){
 const h=data?.hourly||{},units=data?.hourly_units||{},keys=Object.keys(h).filter(k=>/^visibility(?:_member\d+)?$/.test(k)&&Array.isArray(h[k])&&units[k]==='m');
 return (h.time||[]).map((t,i)=>{
  const time=Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(t)?t:t+'Z');
  const values=keys.map(k=>h[k][i]).filter(v=>finite(v)&&v>=0),n=values.length;
  // One deterministic value is not an ensemble probability.
  return {time,n,chances:THRESHOLDS.map(limit=>n>=2?100*values.filter(v=>v<limit).length/n:null)};
 }).filter(p=>finite(p.time)&&p.time>=start&&p.time<=end);
}
function render(results,place,start,days){
 const end=start+days*86400000,stamp=t=>new Date(t).toISOString().slice(5,16).replace('T',' ')+' UTC';
 let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1580 1080" role="img" aria-labelledby="fog-title fog-desc" font-family="Arial,sans-serif"><title id="fog-title">${esc(place)} · Mistkans / zichtkans</title><desc id="fog-desc">Drie modellen met kansen op zicht onder 1000, 500, 250 en 50 meter. Overlappende staafjes, geen optelling. Ontbrekende waarden zijn geen nul procent.</desc><rect width="1580" height="1080" fill="white"/><text x="38" y="46" font-size="27" font-weight="700" fill="#20394d">${esc(place)} · Mistkans / zichtkans</text><text x="38" y="76" font-size="14" fill="#617789">Percentage geldige ensembleleden onder de zichtgrens · ${days} dagen · tijdas UTC</text>`;
 THRESHOLDS.forEach((v,i)=>{s+=`<rect x="${38+i*260}" y="96" width="18" height="14" rx="2" fill="${COLORS[i]}"/><text x="${64+i*260}" y="108" font-size="14" fill="#20394d">Zicht &lt; ${v} meter</text>`;});
 results.forEach((r,row)=>{
  const y0=140+row*285,left=96,top=y0+55,w=1435,h=172,x=t=>left+(t-start)/(end-start)*w,y=p=>top+h-p/100*h;
  const points=probabilities(r.data,start,end),valid=points.filter(p=>p.n>=2);
  s+=`<text x="38" y="${y0+14}" font-size="19" font-weight="700" fill="#20394d">${esc(r.name)}</text><text x="180" y="${y0+14}" font-size="12" fill="#617789">${esc(r.runLabel||'Runtijd niet beschikbaar')}</text>`;
  [0,25,50,75,100].forEach(p=>{s+=`<path d="M${left},${y(p)}h${w}" stroke="#dce5eb"/><text x="${left-12}" y="${y(p)+4}" text-anchor="end" font-size="12" fill="#617789">${p}%</text>`;});
  for(let d=0;d<=days;d++){const t=start+d*86400000,xx=x(t);s+=`<path d="M${xx},${top}v${h}" stroke="#edf1f4"/><text x="${xx}" y="${top+h+21}" text-anchor="middle" font-size="12" fill="#617789">${new Date(t).toLocaleDateString('nl-NL',{day:'2-digit',month:'2-digit',timeZone:'UTC'})}</text>`;}
  s+=`<defs><clipPath id="fog-clip-${row}"><rect x="${left}" y="${top}" width="${w}" height="${h+2}"/></clipPath></defs><g clip-path="url(#fog-clip-${row})">`;
  points.forEach((p,i)=>{
   if(p.n<2)return;
   const gap=Math.min(i? p.time-points[i-1].time:Infinity,i+1<points.length?points[i+1].time-p.time:Infinity),bw=Math.max(.7,Math.min(20,(finite(gap)?gap:3600000)/(end-start)*w*.8));
   const title=stamp(p.time)+' · '+p.n+' geldige leden\n'+THRESHOLDS.map((v,k)=>'< '+v+' m: '+p.chances[k].toFixed(1)+'%').join('\n');
   // Draw the cumulative probabilities over each other, broad to strict.
   p.chances.forEach((pcent,k)=>{if(pcent>0)s+=`<rect data-fog-bar="${THRESHOLDS[k]}" x="${x(p.time)-bw/2}" y="${y(pcent)}" width="${bw}" height="${h*pcent/100}" fill="${COLORS[k]}"><title>${esc(title)}</title></rect>`;});
   s+=`<circle data-fog-point="true" cx="${x(p.time)}" cy="${y(p.chances[0])}" r="1.5" fill="#316a85"><title>${esc(title)}</title></circle><rect x="${x(p.time)-bw/2}" y="${top}" width="${bw}" height="${h}" fill="transparent"><title>${esc(title)}</title></rect>`;
  });
  s+='</g>';
  if(!valid.length)s+=`<rect x="${left+260}" y="${top+52}" width="910" height="67" rx="8" fill="#f0f4f7"/><text x="${left+w/2}" y="${top+79}" text-anchor="middle" font-size="17" fill="#50687a">${esc(r.error||'Geen zicht per ensemblelid beschikbaar in deze bron')}</text><text x="${left+w/2}" y="${top+101}" text-anchor="middle" font-size="12" fill="#617789">Geen kans berekend; ontbrekende gegevens betekenen geen 0%.</text>`;
  const counts=valid.map(p=>p.n),min=Math.min(...counts),max=Math.max(...counts);
  s+=`<text x="${left}" y="${top+h+43}" font-size="12" fill="#617789">${valid.length?`${min===max?min:min+'–'+max} geldige leden per tijdstip · laatste zichtgegevens: ${stamp(valid.at(-1).time)} · nulpunten zijn 0%, lege perioden onbekend`:'Zichtkansen worden getoond zodra de bron ensemblezicht in meters levert.'}</text>`;
 });
 return s+'<text x="38" y="1030" font-size="13" fill="#50687a">Kans = 100 × leden met zicht strikt onder de grens / leden met geldig zicht. Grenzen overlappen; kansen niet optellen.</text><text x="38" y="1053" font-size="12" fill="#617789">Ruwe ensemblekansen, niet lokaal gekalibreerd. Slecht zicht kan ook door neerslag ontstaan; dichte lokale mist kan worden gemist.</text><text x="38" y="1073" font-size="11" fill="#617789">Weerlab · ECMWF / NOAA / DWD via Open-Meteo · oorspronkelijke modelstappen · geen schatting uit luchtvochtigheid</text></svg>';
}
const api={probabilities,render,THRESHOLDS};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FogPlume=api;
})(typeof window==='undefined'?globalThis:window);
