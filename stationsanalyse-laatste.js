/* Most recent TX match: full calendar dates, complete daily source only. */
(() => {
  'use strict';
  const DAY = 86400000;
  const ops = {ge:(a,b)=>a>=b, gt:(a,b)=>a>b, le:(a,b)=>a<=b, lt:(a,b)=>a<b, eq:(a,b)=>a===b};
  const symbols = {ge:'≥',gt:'>',le:'≤',lt:'<',eq:'='};
  function calendar(value) {
    const raw=String(value).trim(); if(!/^\d{8}$/.test(raw))return null;
    const jaar=+raw.slice(0,4),mm=+raw.slice(4,6),dd=+raw.slice(6,8),epoch=Date.UTC(jaar,mm-1,dd),d=new Date(epoch);
    return d.getUTCFullYear()===jaar && d.getUTCMonth()===mm-1 && d.getUTCDate()===dd ? {raw,jaar,mm,dd,epoch}:null;
  }
  function todayEpoch(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
    return Date.UTC(+parts.year,+parts.month-1,+parts.day);
  }
  function search(json, threshold, op, today) {
    const dateIndex=json.kolommen.indexOf('YYYYMMDD'), txIndex=json.kolommen.indexOf('TX');
    if(dateIndex<0 || txIndex<0)throw new Error('Geen TX-dagreeks beschikbaar');
    const dates=new Set(); let match=null, first=null, last=null;
    for(const row of json.data) {
      const date=calendar(row[dateIndex]);
      const value=row[txIndex];
      if(!date || date.epoch>=today || value===null || value===undefined || String(value).trim()==='' || !Number.isFinite(Number(value)))continue;
      const tx=Number(value); dates.add(date.epoch);
      first=first===null?date.epoch:Math.min(first,date.epoch);
      last=last===null?date.epoch:Math.max(last,date.epoch);
      if(ops[op](tx,Math.round(threshold*10*1e8)/1e8) && (!match || date.epoch>match.epoch))match={...date,tx:tx/10,days:(today-date.epoch)/DAY};
    }
    const start=match?match.epoch:first;
    const checked=[...dates].filter(d=>d>=start).length;
    const gaps=start!==null && checked!==(today-start)/DAY;
    return {match,first,last,gaps};
  }
  if(typeof module!=='undefined') {module.exports={search,todayEpoch};return;}
  const $=id=>document.getElementById(id);
  const stations=Object.entries(STATIONS).filter(([,s])=>!s.historisch).sort((a,b)=>a[1].naam.localeCompare(b[1].naam));
  for(const [id,s] of stations){const o=document.createElement('option');o.value=id;o.textContent=`${s.naam} (${id})`;o.selected=id==='260';$('last-tx-station').append(o);}
  const formatDate=epoch=>new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).format(epoch);
  let version=0;
  $('last-tx-form').addEventListener('submit',async event=>{
    event.preventDefault(); const current=++version;
    const input=$('last-tx-value').value.trim().replace(',','.');
    const threshold=Number(input), op=$('last-tx-op').value;
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input) || !Number.isFinite(threshold)){$('last-tx-status').textContent='Vul een geldige temperatuur in, bijvoorbeeld −8 of 18,5.';return;}
    const selection=$('last-tx-station').value;
    const ids=selection==='all'?stations.map(([id])=>id):[selection];
    const today=todayEpoch(); const results=new Map();let done=0;
    $('last-tx-results').replaceChildren();
    $('last-tx-caption').textContent=`Laatste dag vóór vandaag met TX ${symbols[op]} ${threshold.toLocaleString('nl-NL')} °C`;
    const button=event.target.querySelector('button'); button.disabled=true;
    $('last-tx-status').textContent=`Dagreeksen laden: 0/${ids.length}`;
    // Limit concurrent downloads of long station series.
    let next=0;
    async function worker(){
      while(next<ids.length && current===version){const id=ids[next++];
        try{const response=await fetch(R2_BASE+`dagdata_${id}.json?t=${Date.now()}`);if(!response.ok)throw new Error('Dagreeks niet geladen');results.set(id,search(await response.json(),threshold,op,today));}
        catch(error){results.set(id,{error:error.message});}
        done++;if(current===version)$('last-tx-status').textContent=`Dagreeksen laden: ${done}/${ids.length}`;
      }
    }
    try{
      await Promise.all(Array.from({length:Math.min(4,ids.length)},worker));
      if(current!==version)return;
      for(const id of ids){const r=results.get(id),m=r.match;
        const coverage=r.error?r.error:r.first===null?'Geen geldige TX-waarnemingen':`${formatDate(r.first)} t/m ${formatDate(r.last)}${r.gaps?' · onvolledig tot gisteren':''}`;
        const cells=[STATIONS[id].naam,r.error?'Niet beschikbaar':m?formatDate(m.epoch):'Niet gevonden in beschikbare dagreeks',m?m.tx.toLocaleString('nl-NL',{minimumFractionDigits:1})+' °C':'–',m?String(m.days):'–',coverage];
        const tr=document.createElement('tr');for(const text of cells){const td=document.createElement('td');td.textContent=text;tr.append(td);}$('last-tx-results').append(tr);
      }
      $('last-tx-status').textContent=`${ids.length} stations verwerkt. Vandaag is uitgesloten; uitkomsten gelden voor de beschikbare TX-waarnemingen.`;
    }finally{if(current===version)button.disabled=false;}
  });
})();
