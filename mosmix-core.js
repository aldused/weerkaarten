/* Shared checks for MOS/MIX maps. Daily and hourly values are already converted
 * by scripts/mosmix_json.py: °C, km/h and Europe/Amsterdam wall-clock hours. */
(function(root){
  'use strict';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const dayKey = (date=new Date()) => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  function nextDay(day){return new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);}
  function validateDaily(data){
    if(!data || !Array.isArray(data.dagen) || !data.dagen.length || !data.stations || !Object.keys(data.stations).length || !data.data)throw Error('De bron bevat geen bruikbare kaartgegevens.');
    if(data.dagen.some((d,i)=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||!data.data[d]||(i>0&&d<=data.dagen[i-1])))throw Error('De datums in de bron zijn niet geldig.');
    return data;
  }
  function runWarning(data, now=Date.now()){
    const run=Date.parse(data.run);
    if(!Number.isFinite(run))return 'Modelrun onbekend: de actualiteit is niet te controleren.';
    if(run>now+3600000)return 'Modelrun ligt in de toekomst: controleer de bron.';
    if(now-run>18*3600000)return 'Let op: deze modelrun is ouder dan 18 uur. Er is mogelijk nog geen nieuwere verwachting beschikbaar.';
    return '';
  }
  function probabilityIssues(data){
    const issues=[];
    for(const day of data.dagen||[])for(const name of Object.keys(data.stations||{}))for(const suffix of ['','_D','_N']){
      const values=['R101','R110','R130','R150'].map(p=>data.data?.[day]?.[p+suffix]?.[name]);
      if(values.every(finite)&&values.some((v,i)=>i>0&&v>values[i-1]))issues.push({day,name,suffix,values});
    }
    return issues;
  }
  function showQuality(data){
    if(typeof document==='undefined')return;
    let box=document.getElementById('mosmix-quality');
    if(!box){box=document.createElement('aside');box.id='mosmix-quality';box.setAttribute('aria-label','Bron en betrouwbaarheid');document.querySelector('.header')?.after(box);}
    box.replaceChildren();
    const warning=runWarning(data);
    if(warning){const p=document.createElement('p');p.className='mosmix-warning';p.setAttribute('role','status');p.textContent=warning;box.append(p);}
    const issues=probabilityIssues(data);
    if(issues.length){const p=document.createElement('p');p.className='mosmix-warning';p.textContent='Broncontrole: '+issues.length+' combinaties van station en tijdvak bevatten tegenstrijdige neerslagkansen (een hogere drempel heeft een grotere kans). DWD-bronwaarden zijn ongewijzigd; vergelijk deze drempels met voorzichtigheid.';box.append(p);}
    const p=document.createElement('p');
    const run=Date.parse(data.run);
    p.textContent='DWD MOS/MIX · '+(Number.isFinite(run)?'Run '+new Date(run).toISOString().slice(0,16).replace('T',' ')+' UTC':'Run onbekend')+' · Kaarttijden: Nederland (zomer-/wintertijd).';box.append(p);
    const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Over deze gegevens';details.append(summary);
    const note=document.createElement('p');note.textContent='Stationsverwachtingen, geen metingen. Kaartkleuren tussen stations zijn interpolaties. Ontbrekende waarden zijn geen nul. De lopende dag kan onvolledig zijn; ochtendwaarden kunnen uit een eerdere run zijn aangevuld. De genoemde run is de nieuwste stationsrun in het bronbestand. Zonuren kunnen zijn geschat uit bewolking.';details.append(note);box.append(details);
    const nav=document.createElement('nav');nav.setAttribute('aria-label','MOS/MIX kaarten');
    for(const [route,label] of [['minikaarten','9 dagen'],['parameter','Per element'],['neerslagkans','Neerslagkansen']]){const a=document.createElement('a');a.href='index.html#mosmix-'+route;a.target='_top';a.textContent=label;nav.append(a);}box.append(nav);
  }
  async function fetchJSON(url){const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('De gegevensbron is tijdelijk niet beschikbaar (HTTP '+response.status+').');return response.json();}
  async function loadDaily(url){const data=validateDaily(await fetchJSON(url));showQuality(data);return data;}
  function assertSameRun(daily,hourly){
    if(!hourly?.data || !daily.run || !hourly.run || Date.parse(daily.run)!==Date.parse(hourly.run))throw Error('Dag- en uurgegevens horen nog niet bij dezelfde modelrun. Probeer het over enkele minuten opnieuw.');
  }
  function hourlyIndex(hourly){
    const index={};
    for(const [name,s] of Object.entries(hourly.data||{})){
      index[name]=new Map();
      for(let i=0;i<(s.tijden||[]).length;i++){
        // Keep both occurrences during the autumn clock change.
        const key=s.tijden[i].slice(0,16), values=index[name].get(key)||[];
        values.push({ttt:s.TTT?.[i],ff:s.FF?.[i],dd:s.DD?.[i]});index[name].set(key,values);
      }
    }
    return index;
  }
  function hours(index,name,day,start,end,field){
    const rows=[];
    for(let h=start;h<=end;h++){
      const values=index?.[name]?.get(day+'T'+String(h).padStart(2,'0')+':00');
      // The missing 02:00 on the spring transition is not a missing forecast.
      const springGap=h===2 && day.slice(5,7)==='03' && new Date(day+'T12:00Z').getUTCDay()===0 && Number(day.slice(8))>=25;
      if(!values && springGap)continue;
      if(!values?.length || values.some(v=>!finite(v[field])))return [];
      rows.push(...values);
    }
    return rows;
  }
  function minTemp(index,name,day,start,end){const rows=hours(index,name,day,start,end,'ttt');return rows.length?Math.min(...rows.map(v=>v.ttt)):null;}
  function meanWind(index,name,day,start,end){
    const rows=hours(index,name,day,start,end,'ff');if(!rows.length)return {ff:null,dir:null};
    const ff=rows.reduce((sum,v)=>sum+v.ff,0)/rows.length;
    let dir=null;
    if(rows.every(v=>finite(v.dd))){const sin=rows.reduce((s,v)=>s+Math.sin(v.dd*Math.PI/180),0),cos=rows.reduce((s,v)=>s+Math.cos(v.dd*Math.PI/180),0);if(Math.hypot(sin,cos)>1e-6)dir=(Math.atan2(sin,cos)*180/Math.PI+360)%360;}
    return {ff,dir};
  }
  function legendLabel(param,value){return typeof value==='number'?value+(param.bft?' km/h':param.eenheid||''):value;}
  const api={finite,dayKey,nextDay,validateDaily,runWarning,probabilityIssues,fetchJSON,loadDaily,assertSameRun,hourlyIndex,minTemp,meanWind,legendLabel};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MosmixCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
