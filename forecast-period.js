/* Shared forecast/export period: whole 24-hour blocks from the first available hour. */
(()=>{
 const MAX_DAYS=7,KEY='weerlab-platen-dagen';
 const valid=v=>Number.isInteger(Number(v))&&Number(v)>=1&&Number(v)<=MAX_DAYS;
 let days=7;try{const v=new URLSearchParams(location.search).get('dagen')||localStorage.getItem(KEY);if(valid(v))days=Number(v)}catch{}
 function hours(available){return Math.min(Math.max(0,available),days*24)}
 function sync(available){
  const select=document.getElementById('periode-dagen');if(!select)return;
  const max=Math.min(MAX_DAYS,Math.ceil(available/24));
  select.replaceChildren(...Array.from({length:max},(_,i)=>{const n=i+1,h=Math.min(n*24,available),o=new Option(n+' '+(n===1?'dag':'dagen')+' · '+h+' uur',n);o.selected=n===Math.min(days,max);return o}));
  select.disabled=!max;
 }
 function bind(onChange){
  const select=document.getElementById('periode-dagen');
  select.addEventListener('change',()=>{if(!valid(select.value))return;days=Number(select.value);try{localStorage.setItem(KEY,String(days))}catch{}const u=new URL(location.href);params(u.searchParams);history.replaceState(null,'',u);onChange()});
 }
 function params(p){p.set('dagen',String(days));return p}
 window.ForecastPeriod={hours,sync,bind,params,get days(){return days}};
})();
