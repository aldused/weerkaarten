/* Shared clock axis: Dutch civil time, independent of forecast sampling. */
(function(root){
'use strict';
const H=3600000,formatter=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
function local(t){const p=formatter.formatToParts(new Date(t)),get=k=>p.find(v=>v.type===k).value;return {hour:Number(get('hour')),weekday:get('weekday').replace('.',''),date:get('day')+'-'+get('month'),key:get('year')+get('month')+get('day')};}
function bands(start,end){const out=[];if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return out;for(let t=start;t<end;){const next=Math.min(end,(Math.floor(t/H)+1)*H),p=local(t),day=p.hour>=6&&p.hour<18,last=out.at(-1);if(last&&last.day===day&&last.local.key===p.key)last.end=next;else out.push({start:t,end:next,day,local:p});t=next;}return out;}
function svg({start,end,x,y,width,large=false,labels=true}){
 if(!(end>start))return '';const rows=bands(start,end),px=t=>x+(t-start)/(end-start)*width;let s='';
 for(const b of rows)s+=`<rect class="axis-daynight-band" data-period="${b.day?'day':'night'}" x="${px(b.start).toFixed(2)}" y="${y+(large?5:3)}" width="${(px(b.end)-px(b.start)).toFixed(2)}" height="${large?6:3}" fill="${b.day?'#dc2626':'#1d4ed8'}"><title>${b.day?'Dag 06:00–18:00':'Nacht 18:00–06:00'} · Nederlandse tijd</title></rect>`;
 if(!labels)return s;
 const gap=large?76:45,needed=gap/width*(end-start)/H,interval=needed<=12?12:24;let last=-Infinity;
 for(let t=Math.ceil(start/H)*H;t<=end;t+=H){const p=local(t),xx=px(t);if(p.hour%interval||xx-last<gap)continue;last=xx;s+=`<text class="axis-time-label" data-hour-tick="true" x="${xx.toFixed(2)}" y="${y+(large?36:17)}" font-size="${large?18:9}" font-weight="600" text-anchor="middle" fill="#344054">${String(p.hour).padStart(2,'0')}</text>`;}
 const days=[];for(const b of rows){const last=days.at(-1);if(last&&last.local.key===b.local.key)last.end=b.end;else days.push({...b});}last=-Infinity;
 for(const d of days){const xx=px((d.start+d.end)/2);if(xx-last<gap)continue;last=xx;s+=`<text class="axis-day-label" x="${xx.toFixed(2)}" y="${y+(large?62:31)}" font-size="${large?23:11}" font-weight="700" text-anchor="middle" fill="#333">${d.local.weekday}</text><text class="axis-date-label" x="${xx.toFixed(2)}" y="${y+(large?85:43)}" font-size="${large?16:8}" text-anchor="middle" fill="#333">${d.local.date}</text>`;}
 return s;
}
const key='<span style="color:#dc2626">Rood: dag 06:00–18:00</span> · <span style="color:#1d4ed8">Blauw: nacht 18:00–06:00</span> · Nederlandse tijd (zomer-/wintertijd)';
const api={bands,svg,local,key};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.WeerlabDayNight=api;
if(root.document)root.document.addEventListener('DOMContentLoaded',()=>{const target=document.querySelector('.page-wrap,.comparison-card,.legend,#grafiek-wrap');if(target&&!document.querySelector('.daynight-key')){const el=document.createElement('div');el.className='daynight-key';el.style.cssText='padding:8px 20px;font:600 12px/1.6 Arial,sans-serif;color:#344054';el.innerHTML=key;target.before(el);}});
})(typeof globalThis!=='undefined'?globalThis:this);
