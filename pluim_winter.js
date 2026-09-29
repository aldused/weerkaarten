(function(root){
'use strict';
const H=3600000,D=24*H,valid=n=>typeof n==='number'&&Number.isFinite(n);
const configs=[
 {title:'Kans sneeuw',detail:'≥ 0,1 cm verse sneeuw per etmaal',field:'snowfall',kind:'sum',test:v=>v>=.1},
 {title:'Kans sneeuwdek',detail:'≥ 1 cm sneeuwdek op enig moment',field:'snow_depth',kind:'max',test:v=>v>=.01},
 {title:'Kans ijsdag',detail:'Maximumtemperatuur < 0 °C',field:'temperature_2m',kind:'dailyMax',test:v=>v<0},
 {title:'Kans lichte vorst of kouder',detail:'Minimumtemperatuur < 0 °C',field:'temperature_2m',kind:'dailyMin',test:v=>v<0},
 {title:'Kans matige vorst of kouder',detail:'Minimumtemperatuur < −5 °C',field:'temperature_2m',kind:'dailyMin',test:v=>v< -5},
 {title:'Kans strenge vorst of kouder',detail:'Minimumtemperatuur < −10 °C',field:'temperature_2m',kind:'dailyMin',test:v=>v< -10}
];
function probabilities(data,start,days){
 const h=data?.hourly||{},daily=data?.daily||{},times=h.time||[],utc=s=>Date.parse(s.endsWith('Z')?s:s+'Z'),index=new Map(times.map((t,i)=>[utc(t),i]));
 return configs.map(c=>{
  const keys=Object.keys(h).filter(k=>(k===c.field||new RegExp('^'+c.field+'_member\\d+$').test(k))&&Array.isArray(h[k]));
  return {...c,points:Array.from({length:days},(_,day)=>{
   const t=start+day*D,dayKey=new Date(t).toISOString().slice(0,10),di=(daily.time||[]).indexOf(dayKey);let count=0,hits=0;
   for(const key of keys){
    const values=Array.from({length:24},(_,i)=>h[key][index.get(t+(i+(c.kind==='sum'?1:0))*H)]);
    if(!values.every(valid))continue;
    let value=c.kind==='sum'?values.reduce((a,b)=>a+b,0):Math.max(...values);
    if(c.kind.startsWith('daily')){const field=c.kind==='dailyMax'?'temperature_2m_max':'temperature_2m_min';value=daily[field+key.slice(c.field.length)]?.[di];if(!valid(value))continue;}
    count++;if(c.test(value))hits++;
   }
   return {time:t,count,hits,chance:count?100*hits/count:null};
  })};
 });
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(result,place,start,days){
 const panels=probabilities(result.data,start,days),date=t=>new Date(t).toLocaleDateString('nl-NL',{day:'2-digit',month:'2-digit',timeZone:'UTC'});
 let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1580 1080" role="img" aria-labelledby="winter-title winter-desc" font-family="Arial,sans-serif"><title id="winter-title">Winterpluim ${esc(place)}</title><desc id="winter-desc">Zes dagelijkse ensemblekansen van ECMWF: sneeuw, sneeuwdek, ijsdag en vorst. Lege dagen hebben onvoldoende gegevens.</desc><rect width="1580" height="1080" fill="white"/><text x="38" y="46" font-size="27" font-weight="700" fill="#20394d">${esc(place)} · Winterpluim</text><text x="38" y="74" font-size="14" fill="#445">ECMWF · ${esc(result.runLabel||'Runtijd niet beschikbaar')} · ${date(start)} – ${date(start+(days-1)*D)}</text><text x="38" y="101" font-size="12" fill="#555">Kans per etmaal (00–24 UTC) · percentage ensembleleden · vorstkansen zijn inclusief koudere temperaturen</text>`;
 // Links: sneeuw, sneeuwdek, ijsdag. Rechts: de drie vorstkansen.
 [0,3,1,4,2,5].forEach((panelIndex,i)=>{
  const c=panels[panelIndex];
  const ox=38+(i%2)*760,oy=130+Math.floor(i/2)*296,left=46,top=56,pw=652,ph=154,bw=pw/days,x=j=>left+j*bw,y=v=>top+ph-v/100*ph;
  s+=`<g transform="translate(${ox},${oy})"><rect width="744" height="278" fill="white" stroke="#aaa"/><text x="372" y="23" text-anchor="middle" font-size="18" font-weight="700" fill="#222">${esc(c.title)}</text><text x="372" y="42" text-anchor="middle" font-size="12" fill="#555">${esc(c.detail)}</text>`;
  for(let v=0;v<=100;v+=20){s+=`<path d="M${left} ${y(v)}h${pw}" stroke="#e0e4e8"/>`;for(const [tx,a] of [[left-6,'end'],[left+pw+6,'start']])s+=`<text x="${tx}" y="${y(v)+4}" text-anchor="${a}" font-size="11" fill="#444">${v}%</text>`;}
  c.points.forEach((p,j)=>{
   const cx=x(j+.5),width=Math.max(4,bw*.6),d=new Date(p.time),show=days<=10||j%2===0;
   s+=`<path d="M${x(j)} ${top}v${ph}" stroke="#e4e7ea" stroke-width=".6"/>`;
   if(p.chance!==null){s+=`<rect data-probability="${p.chance}" x="${cx-width/2}" y="${y(p.chance)}" width="${width}" height="${Math.max(1,ph*p.chance/100)}" fill="${panelIndex<2?'#3488b5':'#7258ae'}"><title>${date(p.time)}: ${p.chance.toFixed(1)}% (${p.hits}/${p.count} leden)</title></rect><text x="${cx}" y="${Math.max(top+11,y(p.chance)-5)}" text-anchor="middle" font-size="11" fill="#273f54">${Math.round(p.chance)}%</text>`;}
   else s+=`<text x="${cx}" y="${top+ph-5}" text-anchor="middle" font-size="12" fill="#7a8790">—</text>`;
   if(show)s+=`<text x="${cx}" y="${top+ph+15}" text-anchor="middle" font-size="11" fill="#333">${['zo','ma','di','wo','do','vr','za'][d.getUTCDay()]}</text><text x="${cx}" y="${top+ph+28}" text-anchor="middle" font-size="10" fill="#333">${date(p.time)}</text>`;
  });
  const counts=c.points.map(p=>p.count).filter(n=>n>0);const coverage=counts.length?`${Math.min(...counts)}–${Math.max(...counts)} geldige leden per etmaal`:'Geen volledige ensemblegegevens';
  s+=`<rect x="${left}" y="${top}" width="${pw}" height="${ph}" fill="none" stroke="#444" stroke-width=".8"/><text x="15" y="263" font-size="10" fill="#667">${esc(result.error||coverage)} · ontbrekende dagen blijven leeg</text></g>`;
 });
 return s+'<text x="38" y="1040" font-size="12" fill="#617789">Weerlab · ECMWF ensemble via Open-Meteo · dagelijkse minimum- en maximumtemperatuur uit de bron</text><text x="38" y="1061" font-size="11" fill="#617789">Sneeuw: etmaalsom. Sneeuwdek: hoogste uurwaarde. Alleen leden met een compleet etmaal tellen mee. Ruwe modelkansen, niet gekalibreerd.</text></svg>';
}
const api={probabilities,render};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WinterPlume=api;
})(typeof window==='undefined'?globalThis:window);
