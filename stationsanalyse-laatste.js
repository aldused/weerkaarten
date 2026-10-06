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
  function search(json, threshold, op, today, margin = 0) {
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
      if((op==='eq' ? tx>=Math.round((threshold-margin)*10*1e8)/1e8 && tx<=Math.round((threshold+margin)*10*1e8)/1e8 : ops[op](tx,Math.round(threshold*10*1e8)/1e8)) && (!match || date.epoch>match.epoch))match={...date,tx:tx/10,days:(today-date.epoch)/DAY};
    }
    const start=match?match.epoch:first;
    const checked=[...dates].filter(d=>d>=start).length;
    const gaps=start!==null && checked!==(today-start)/DAY;
    const monthRows=[];
    if(match)for(const row of json.data){
      const d=calendar(row[dateIndex]),value=row[txIndex];
      if(d && d.jaar===match.jaar && d.mm===match.mm && d.epoch<today && value!==null && value!==undefined && String(value).trim()!=='' && Number.isFinite(Number(value)))monthRows.push({day:d.dd,tx:Number(value)/10});
    }
    monthRows.sort((a,b)=>a.day-b.day);
    return {match,first,last,gaps,monthRows,margin};
  }
  if(typeof module!=='undefined') {module.exports={search,todayEpoch};return;}
  const $=id=>document.getElementById(id);
  const stations=Object.entries(STATIONS).filter(([,s])=>!s.historisch).sort((a,b)=>a[1].naam.localeCompare(b[1].naam));
  for(const [id,s] of stations){const o=document.createElement('option');o.value=id;o.textContent=`${s.naam} (${id})`;o.selected=id==='260';$('last-tx-station').append(o);}
  const formatDate=epoch=>new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).format(epoch);
  const phrase={ge:'minstens',gt:'meer dan',le:'hoogstens',lt:'minder dan',eq:'exact'};
  const section=$('last-tx-form').closest('section');
  const style=document.createElement('style');
  style.textContent=`#laatste-temperatuur{margin:20px;padding:24px;background:#fff;border:2px solid #2563eb;border-radius:14px}#laatste-temperatuur h2{font-size:1.4rem;margin-bottom:10px}#laatste-temperatuur p{line-height:1.6;margin:12px 0}#laatste-temperatuur .controls{flex-wrap:wrap;padding:16px 0}#last-tx-answer{padding:20px;background:#eff6ff;border-radius:10px;margin:16px 0}#last-tx-answer h3{font-size:1.25rem;line-height:1.5;color:#123b77}#laatste-temperatuur table{width:100%;border-collapse:collapse}#laatste-temperatuur th,#laatste-temperatuur td{padding:12px;text-align:left;border-bottom:1px solid #dbe3ef}#laatste-temperatuur .detail-scroll{overflow-x:auto}#last-tx-answer[hidden]{display:none}`;
  document.head.append(style);
  const chartHeader=document.createElement('th');chartHeader.scope='col';chartHeader.textContent='Grafiek';$('last-tx-results').closest('table').querySelector('thead tr').append(chartHeader);
  const answer=document.createElement('div');answer.id='last-tx-answer';answer.hidden=true;answer.setAttribute('role','region');answer.setAttribute('aria-label','Antwoord op uw temperatuurvraag');answer.tabIndex=-1;
  $('last-tx-status').after(answer);
  const marginGroup=document.createElement('div');marginGroup.className='ctrl-group';
  const marginLabel=document.createElement('label');marginLabel.htmlFor='last-tx-margin';marginLabel.textContent='Marge (± °C)';
  const marginInput=document.createElement('input');marginInput.id='last-tx-margin';marginInput.type='text';marginInput.inputMode='decimal';marginInput.value='0,5';marginInput.className='ctrl-input';
  marginGroup.append(marginLabel,marginInput);$('last-tx-form').querySelector('button').before(marginGroup);
  const exactOption=$('last-tx-op').querySelector('option[value="eq"]');exactOption.textContent='≈ Rond deze temperatuur';$('last-tx-op').value='eq';
  function syncMargin(){marginGroup.hidden=$('last-tx-op').value!=='eq';} $('last-tx-op').addEventListener('change',syncMargin);syncMargin();
  const help=document.createElement('p');help.textContent='Bij 15 °C en een marge van ±0,5 °C zoeken we dagmaxima van 14,5 tot en met 15,5 °C. Stel de marge in op 0 voor exact 15,0 °C. De marge geldt alleen bij Rond deze temperatuur.';$('last-tx-form').after(help);
  function conditionText(threshold,op,margin){const n=v=>v.toLocaleString('nl-NL',{maximumFractionDigits:6});return op==='eq' && margin>0 ? `rond ${n(threshold)} °C (${n(threshold-margin)} t/m ${n(threshold+margin)} °C)` : `${phrase[op]} ${n(threshold)} °C`;}
  const figure=document.createElement('figure');figure.hidden=true;figure.id='last-tx-figure';figure.style.cssText='margin:20px 0;width:min(100%,680px)!important;max-width:680px!important;min-width:0;overflow:hidden';
  const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=800;canvas.style.cssText='display:block;width:100%!important;max-width:680px!important;height:auto!important;min-width:0;aspect-ratio:7/4;background:white;border:1px solid #dbe3ef;border-radius:10px';canvas.setAttribute('role','img');
  const caption=document.createElement('figcaption');caption.style.cssText='line-height:1.6;margin:10px 0';
  const download=document.createElement('button');download.type='button';download.className='btn-analyseer';download.textContent='Download maandgrafiek (PNG)';
  const copyright=document.createElement('p');copyright.textContent='© Weerlab.nl · Ed Aldus';copyright.style.cssText='font-size:12px;color:#64748b;margin:8px 0';
  figure.append(canvas,caption,download,copyright);answer.after(figure);
  let chartFile='';
  download.addEventListener('click',()=>canvas.toBlob(blob=>{
    if(!blob)return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=chartFile;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },'image/png'));
  function showMonth(id,result,threshold,op){
    const m=result.match;if(!m)return;
    const c=canvas.getContext('2d'),name=STATIONS[id].naam,month=new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',month:'long',year:'numeric'}).format(m.epoch);
    const condition=conditionText(threshold,op,result.margin);
    const title=`${name} · ${month}`,subtitle=`Voor het laatst ${condition}: ${formatDate(m.epoch)}`;
    canvas.setAttribute('aria-label',`${title}. ${subtitle}. Dagmaximumtemperaturen per dag; de gevonden dag is oranje gemarkeerd.`);
    chartFile=`weerlab-TX-${id}-${m.jaar}-${String(m.mm).padStart(2,'0')}.png`;
    c.fillStyle='#fff';c.fillRect(0,0,1400,800);c.textAlign='left';
    c.fillStyle='#142e50';c.font='bold 34px system-ui';c.fillText(title,90,60);c.font='24px system-ui';c.fillText(subtitle,90,102);
    const left=100,right=1300,top=175,bottom=640,days=new Date(Date.UTC(m.jaar,m.mm,0)).getUTCDate();
    const values=[threshold-result.margin,threshold+result.margin,...result.monthRows.map(r=>r.tx)];
    const low=Math.floor((Math.min(...values)-2)/5)*5,high=Math.ceil((Math.max(...values)+2)/5)*5;
    const x=day=>left+(day-0.5)*(right-left)/days,y=t=>bottom-(t-low)*(bottom-top)/(high-low);
    c.font='20px system-ui';
    for(let i=0;i<=5;i++){const t=low+(high-low)*i/5;c.strokeStyle='#e2e8f0';c.lineWidth=1;c.beginPath();c.moveTo(left,y(t));c.lineTo(right,y(t));c.stroke();c.textAlign='right';c.fillStyle='#475569';c.fillText(t.toLocaleString('nl-NL',{maximumFractionDigits:1})+' °C',left-14,y(t)+7);}
    c.textAlign='center';for(let day=1;day<=days;day++){c.fillStyle='#475569';c.fillText(String(day),x(day),bottom+32);}
    if(op==='eq' && result.margin>0){c.fillStyle='rgba(124,58,237,0.12)';c.fillRect(left,y(threshold+result.margin),right-left,y(threshold-result.margin)-y(threshold+result.margin));}
    c.strokeStyle='#7c3aed';c.lineWidth=3;c.setLineDash([10,7]);c.beginPath();c.moveTo(left,y(threshold));c.lineTo(right,y(threshold));c.stroke();c.setLineDash([]);
    const rows=new Map(result.monthRows.map(r=>[r.day,r]));
    const base=y(Math.max(low,Math.min(high,0))),width=(right-left)/days*0.6;
    for(let day=1;day<=days;day++){const r=rows.get(day);if(!r){c.fillStyle='#94a3b8';c.fillText('×',x(day),bottom-10);continue;}
      c.fillStyle=day===m.dd?'#ea580c':'#2563eb';const py=y(r.tx);c.fillRect(x(day)-width/2,Math.min(base,py),width,Math.max(2,Math.abs(base-py)));
      if(day===m.dd){c.fillStyle='#9a3412';c.font='bold 21px system-ui';c.fillText(r.tx.toLocaleString('nl-NL',{minimumFractionDigits:1})+' °C',x(day),py-14);c.font='20px system-ui';}
    }
    c.textAlign='left';c.font='22px system-ui';c.fillStyle='#2563eb';c.fillText('■ Dagmaximum (TX)',100,715);c.fillStyle='#ea580c';c.fillText('■ Laatste passende dag',400,715);c.fillStyle='#7c3aed';c.fillText('┄ Gekozen temperatuur',770,715);
    c.fillStyle='#64748b';c.font='19px system-ui';c.fillText('Bron: KNMI · © Weerlab.nl / Ed Aldus · × = ontbrekend of nog niet beschikbaar · vandaag uitgesloten',100,760);
    caption.textContent=`${subtitle}. Blauw: dagmaximum; oranje: gevonden dag; paarse stippellijn: ${threshold.toLocaleString('nl-NL')} °C.${op==='eq' && result.margin>0?' Het paarse vlak toont het zoekbereik.':''} De grafiek toont de maand van de gevonden dag. Ontbrekende en toekomstige dagen zijn met × aangegeven.`;
    figure.hidden=false;
  }
  let version=0;
  $('last-tx-form').addEventListener('submit',async event=>{
    event.preventDefault(); const current=++version;
    const input=$('last-tx-value').value.trim().replace(',','.');
    const threshold=Number(input), op=$('last-tx-op').value;
    const marginText=marginInput.value.trim().replace(',','.');
    const margin=op==='eq'?Number(marginText):0;
    if(op==='eq' && (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(marginText) || !Number.isFinite(margin) || margin<0)){$('last-tx-status').textContent='Vul een geldige marge van 0 of hoger in.';return;}
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input) || !Number.isFinite(threshold)){$('last-tx-status').textContent='Vul een geldige temperatuur in, bijvoorbeeld −8 of 18,5.';return;}
    const selection=$('last-tx-station').value;
    const ids=selection==='all'?stations.map(([id])=>id):[selection];
    const today=todayEpoch(); const results=new Map();let done=0;
    $('last-tx-results').replaceChildren(); answer.hidden=true; answer.replaceChildren(); figure.hidden=true;
    $('last-tx-caption').textContent=`Laatste dag vóór vandaag met TX ${conditionText(threshold,op,margin)}`;
    const button=event.target.querySelector('button'); button.disabled=true;
    $('last-tx-status').textContent=`Dagreeksen laden: 0/${ids.length}`;
    // Limit concurrent downloads of long station series.
    let next=0;
    async function worker(){
      while(next<ids.length && current===version){const id=ids[next++];
        try{const response=await fetch((['localhost','127.0.0.1'].includes(location.hostname) ? '' : 'https://data.weerlab.nl/')+`dagdata_${id}.json?t=${Date.now()}`);if(!response.ok)throw new Error('Dagreeks niet geladen');results.set(id,search(await response.json(),threshold,op,today,margin));}
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
        const tr=document.createElement('tr');for(const text of cells){const td=document.createElement('td');td.textContent=text;tr.append(td);}if(m){const cell=document.createElement('td'),btn=document.createElement('button');btn.type='button';btn.textContent='Maandgrafiek';btn.setAttribute('aria-label',`Maandgrafiek ${STATIONS[id].naam}`);btn.addEventListener('click',()=>{showMonth(id,r,threshold,op);figure.scrollIntoView({behavior:'smooth',block:'start'});});cell.append(btn);tr.append(cell);}else{tr.append(document.createElement('td'));}$('last-tx-results').append(tr);
      }
      answer.hidden=false;
      const title=document.createElement('h3'),detail=document.createElement('p');
      const condition=conditionText(threshold,op,margin);
      if(selection!=='all'){
        const r=results.get(selection),m=r.match,name=STATIONS[selection].naam;
        title.textContent=r.error?`${name}: de daggegevens konden niet worden geladen.`:m?`${name}: voor het laatst ${condition} op ${formatDate(m.epoch)}.`:`${name}: geen dagmaximum van ${condition} gevonden.`;
        detail.textContent=r.error?r.error:m?`Maximumtemperatuur die dag: ${m.tx.toLocaleString('nl-NL',{minimumFractionDigits:1})} °C · ${m.days} ${m.days===1?'dag':'dagen'} geleden.`:'Er is gezocht in alle beschikbare TX-daggegevens vóór vandaag.';
        if(r.gaps)detail.textContent+=' Er ontbreken meetdagen; dit is de laatste gevonden waarneming.';
      }else{
        title.textContent=`Wanneer was het voor het laatst ${condition}?`;
        detail.textContent=`Hieronder staat het antwoord afzonderlijk voor elk station. ${[...results.values()].filter(r=>r.match).length} van de ${ids.length} stations hebben een passende dag.`;
      }
      answer.append(title,detail);
      if(selection!=='all' && results.get(selection).match)showMonth(selection,results.get(selection),threshold,op);
      $('last-tx-status').textContent='Zoekopdracht voltooid. Vandaag is uitgesloten.';
      answer.focus({preventScroll:true});answer.scrollIntoView({behavior:'smooth',block:'nearest'});
    }finally{if(current===version)button.disabled=false;}
  });
})();
