/* Datum- en bronlogica, gedeeld door de weergave en regressiecontroles. */
(function(root){
  'use strict';
  const elementNames={bewolking:'Bewolking',neerslag:'Neerslag',wind:'Wind',temperatuur:'Temperatuur',zicht:'Zicht & mist'};
  const dayPattern=/^\d{4}-\d{2}-\d{2}$/;
  function isoDay(value){
    const s=String(value||'').slice(0,10);
    if(!dayPattern.test(s))return '';
    const parsed=new Date(s+'T12:00:00Z');
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===s?s:'';
  }
  function today(now=new Date()){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;
  }
  function numeric(value){return (typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))?Number(value):null;}
  function chartDate(chart,feed,kind){
    if(chart.valid_utc)return isoDay(chart.valid_utc);
    // ECMWF day is an index into this edition, never into the filtered visible days.
    const index=numeric(chart.day);
    if(kind==='ecmwf'&&index!==null&&Number.isInteger(index)&&index>=0){
      const direct=feed.days[index];if(direct)return isoDay(direct.date);
    }
    if(kind==='ecmwf'&&numeric(chart.lead)!==null&&chart.lead>=0){
      const run=Date.parse(feed.ecmwf_run_utc);
      if(Number.isFinite(run))return new Date(run+Number(chart.lead)*3600000).toISOString().slice(0,10);
    }
    // A UKMO file step is not a validated forecast date. Keep undated charts separate.
    return '';
  }
  function validate(feed){
    if(!feed||!Array.isArray(feed.days)||!feed.days.length||!Number.isFinite(Date.parse(feed.generated_utc))||typeof feed.intro!=='string'||!feed.intro.trim())throw new Error('Onvolledige editie');
    const seen=new Set();
    for(const d of feed.days){
      if(!d||!isoDay(d.date)||seen.has(d.date)||typeof d.weertype!=='string'||!d.weertype.trim()||typeof (d.synoptiek||d.text)!=='string')throw new Error('Onvolledige dagbespreking');
      seen.add(d.date);
    }
    if(feed.bronregister!==undefined&&(!Array.isArray(feed.bronregister)||feed.bronregister.some(b=>!b||typeof b.id!=='string'||typeof b.naam!=='string'||typeof b.status!=='string')))throw new Error('Ongeldig bronregister');
    if(feed.modelbeoordeling!==undefined){
      if(!Array.isArray(feed.modelbeoordeling)||!feed.modelbeoordeling.length||feed.modelbeoordeling.length>4)throw new Error('Onvolledige modelbeoordeling');
      const ids=new Set((feed.bronregister||[]).filter(b=>b.status==='beschikbaar').map(b=>b.id));
      for(const item of feed.modelbeoordeling){
        if(!item||['onderwerp','periode','vergelijking','betekenis'].some(k=>typeof item[k]!=='string'||!item[k].trim())||!Array.isArray(item.bron_ids)||!item.bron_ids.length||item.bron_ids.some(id=>!ids.has(id)))throw new Error('Onvolledige modelbeoordeling');
      }
    }
    if(feed.schema_version>=3 || feed.korte_termijn!==undefined){
      const short=feed.korte_termijn;
      if(!short||Date.parse(short.geldig_tot)-Date.parse(short.geldig_van)!==48*3600000)throw new Error('Ongeldig kortetermijntijdvak');
      if(!Array.isArray(short.elementen)||short.elementen.length!==5)throw new Error('Onvolledige korte termijn');
      const ids=new Set((feed.bronregister||[]).filter(b=>b.status==='beschikbaar').map(b=>b.id));
      for(const [i,item] of short.elementen.entries()){
        if(!item||item.element!==Object.keys(elementNames)[i]||typeof item.tekst!=='string'||!item.tekst.trim()||!Array.isArray(item.bron_ids)||!item.bron_ids.length||item.bron_ids.some(id=>!ids.has(id)))throw new Error('Ongeldig weerelement of bron');
      }
      if(typeof feed.bronnotities!=='string')throw new Error('Ongeldige bronnotities');
    }
    if(feed.days.some(d=>d.onzekerheid!==undefined&&typeof d.onzekerheid!=='string'))throw new Error('Ongeldige dagbeoordeling');
    return feed;
  }
  function ageHours(value,now=Date.now()){const ms=Date.parse(value);return Number.isFinite(ms)?Math.max(0,(now-ms)/3600000):null;}
  function fileUrl(file,base,version){
    if(typeof file!=='string'||!/^guidance_[a-zA-Z0-9_.-]+\.(?:png|gif|jpe?g|webp)$/.test(file))return null;
    return base+encodeURIComponent(file)+'?v='+encodeURIComponent(version);
  }
  function sentences(value){return String(value||'').trim().split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/u).filter(Boolean);}
  const api={elementNames,isoDay,today,numeric,chartDate,validate,ageHours,fileUrl,sentences};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.WeerlabDiscussion=api;
})(typeof window==='undefined'?globalThis:window);
