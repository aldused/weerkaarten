(function(root){
'use strict';
function explanation(cfg){
 if(cfg.hourly==='cloud_cover')return 'Elke kleur toont het aandeel ensembleleden in een bewolkingsklasse. Dit is geen percentage zonneschijnduur.';
 if(cfg.hourly==='cape')return 'De staven tonen buienenergie (P90). De lijn toont het aandeel leden met CAPE ≥500 J/kg én neerslag ≥0,1 mm/uur: een onweersignaal, geen gekalibreerde kans.';
 if(cfg.unit==='%')return 'De lijn toont het aandeel leden met minstens 0,1 mm in het voorafgaande 6-uursvak. De onderrand toont het aandeel met minstens 1 mm. Tijd in UTC.';
 return 'Donkere lijn: mediaan. Kleurband: middelste 80% van de leden (P10–P90); donkerdere kern: middelste 50% (P25–P75). Breder betekent meer onzekerheid. Tijd in UTC.';
}
function details(t,s,cfg){
 const time=new Date(t).toLocaleString('nl-NL',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' UTC';
 const val=v=>Number.isFinite(v)?v.toLocaleString('nl-NL',{maximumFractionDigits:1})+cfg.unit:'—';
 if(cfg.hourly==='cloud_cover')return time+' · '+cfg.stackItems.map((c,i)=>c.label+' '+Math.round(s.extra.stack[i])+'%').join(' · ');
 if(cfg.hourly==='cape')return time+' · CAPE P90 '+val(s.p90)+' · '+Math.round(s.extra.thunderChance)+'% van de leden met onweersignaal';
 if(cfg.unit==='%')return time+' · voorafgaande 6 uur: ≥0,1 mm '+val(s.p50)+' · ≥1 mm '+val(s.p10);
 return time+(cfg.hourly==='precipitation'?' · '+(cfg.rebaseCumulative?'som vanaf gekozen begindatum':'voorafgaande 6 uur'):'')+' · Mediaan '+val(s.p50)+' · P10–P90 '+val(s.p10)+' – '+val(s.p90)+(Number.isFinite(s.p25)?' · P25–P75 '+val(s.p25)+' – '+val(s.p75):'');
}
function attach(svg,times,stats,cfg,axis){
 svg.setAttribute('tabindex','0');svg.setAttribute('aria-label',cfg.title+'. Gebruik links en rechts om modeltijdstappen af te lezen.');
 const ns='http://www.w3.org/2000/svg',g=document.createElementNS(ns,'g'),line=document.createElementNS(ns,'line');g.dataset.inspector='true';g.setAttribute('pointer-events','none');g.setAttribute('visibility','hidden');g.appendChild(line);svg.appendChild(g);
 line.setAttribute('stroke','#173b55');line.setAttribute('stroke-width','1');line.setAttribute('stroke-dasharray','4 3');line.setAttribute('y1',axis.top);line.setAttribute('y2',axis.bottom);
 let i=0;
 let output=svg.closest('.multi-card')?.querySelector('.grafiek-aflezen');
 if(!output&&svg.closest('.multi-card')){output=document.createElement('div');output.className='grafiek-aflezen';output.setAttribute('aria-live','polite');svg.closest('.chart-wrap').after(output);}
 output=output||document.getElementById('grafiek-aflezen');
 if(output)output.textContent='Wijs een tijdstip aan, tik op de grafiek of gebruik links/rechts om exacte modelwaarden af te lezen.';
 const show=index=>{i=Math.max(0,Math.min(times.length-1,index));g.setAttribute('visibility','visible');line.setAttribute('x1',axis.xF(i));line.setAttribute('x2',axis.xF(i));if(output)output.textContent=details(times[i],stats[i],cfg);};
 svg.onpointermove=svg.onpointerdown=e=>{const matrix=svg.getScreenCTM();if(!matrix)return;const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());if(point.x<axis.left||point.x>axis.right)return;let best=0;for(let n=1;n<times.length;n++)if(Math.abs(axis.xF(n)-point.x)<Math.abs(axis.xF(best)-point.x))best=n;show(best);};
 svg.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();show(e.key==='Home'?0:e.key==='End'?times.length-1:i+(e.key==='ArrowRight'?1:-1));}};
 svg.onfocus=()=>show(i);svg.onpointerleave=()=>g.setAttribute('visibility','hidden');
 syncPeriods();
}
function syncPeriods(){const a=document.getElementById('range-start'),b=document.getElementById('range-end');if(!a||!b)return;const days=Math.round((Date.parse(b.value)-Date.parse(a.value))/864e5)+1;document.querySelectorAll('[data-days]').forEach(btn=>{btn.setAttribute('aria-pressed',String(days===+btn.dataset.days));btn.disabled=Date.parse(a.value)+(+btn.dataset.days-1)*864e5>Date.parse(b.max);});}
function bindPeriods(change){document.querySelectorAll('[data-days]').forEach(btn=>btn.addEventListener('click',()=>{const start=document.getElementById('range-start'),end=document.getElementById('range-end');end.value=new Date(Date.parse(start.value)+(+btn.dataset.days-1)*864e5).toISOString().slice(0,10);change();syncPeriods();}));}
root.KleurpluimUI={attach,explanation,details,bindPeriods,syncPeriods};
})(globalThis);
