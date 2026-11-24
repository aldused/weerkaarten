/* Calendar and spatial contract for the combined temperature forecast. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TemperaturePlaceData=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const localDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'});
  const dayKey=date=>localDay.format(new Date(date));
  const normalise=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  function decode(payload,count){
    if(!payload)return null;
    const bytes=Uint8Array.from(atob(payload),c=>c.charCodeAt(0));
    if(bytes.length!==count*2)throw new Error('Onjuist aantal temperatuurwaarden');
    const view=new DataView(bytes.buffer), out=new Float64Array(count);
    for(let i=0;i<count;i++){const v=view.getInt16(i*2,true);out[i]=v===-32768?NaN:v/10;}
    return out;
  }
  function source(kind,j){
    const grid=j.rooster,count=grid.iy.length;
    if(!count||grid.ix.length!==count)throw new Error('Geen geldig temperatuurrooster');
    const points=grid.iy.map((y,i)=>({lat:grid.lat0+y*grid.dlat,lon:grid.lon0+grid.ix[i]*grid.dlon}));
    const periods=(kind==='night'?j.nachten:j.dagen).map(p=>({...p,
      min:kind==='night'?decode(p.tn,count):null,grass:kind==='night'?decode(p.t10min,count):null,
      max:kind==='tx'?decode(p.txmax,count):null,sigma:decode(p.sigma,count),
      key:kind==='night'?dayKey(p.eind):p.label}));
    return {kind,points,periods,created:j.gemaakt_utc,analysis:j.analyse_utc};
  }
  function distance(a,b){
    const r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=(b.lon-a.lon)*r;
    const q=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2;
    return 12742*Math.asin(Math.sqrt(Math.min(1,q)));
  }
  function nearest(src,point,maxKm=12){
    if(!src||!Number.isFinite(point.lat)||!Number.isFinite(point.lon))return null;
    let km=Infinity,index=-1;
    src.points.forEach((p,i)=>{const d=distance(point,p);if(d<km){km=d;index=i;}});
    return km<=maxKm?{index,km}:null;
  }
  function series(sources,point,now=Date.now()){
    const rows=new Map(),cells={};
    const get=key=>{if(!rows.has(key))rows.set(key,{key,min:NaN,max:NaN,grass:NaN,sigmaMax:NaN,sigmaGrass:NaN,night:null,day:null});return rows.get(key);};
    for(const kind of ['night','tx']){
      const src=sources[kind],cell=nearest(src,point);cells[kind]=cell;
      if(!cell)continue;
      for(const p of src.periods){
        const row=get(p.key),i=cell.index;
        if(kind==='night'){row.min=p.min?.[i]??NaN;row.grass=p.grass?.[i]??NaN;row.sigmaGrass=p.sigma?.[i]??NaN;row.night=p;}
        else{row.max=p.max?.[i]??NaN;row.sigmaMax=p.sigma?.[i]??NaN;row.day=p;}
      }
    }
    const today=dayKey(now);
    return {cells,rows:[...rows.values()].filter(r=>r.key>=today).sort((a,b)=>a.key.localeCompare(b.key)).slice(0,8)};
  }
  function catalogue(rows){return rows.map((p,i)=>({...p,rank:p.rank??i,key:normalise(p.name+' '+(p.alias||''))}));}
  function search(places,query){
    const q=normalise(query);if(q.length<2)return [];
    return places.map(p=>{const name=normalise(p.name),alias=normalise(p.alias||'');
      const score=name===q||alias===q?0:name.startsWith(q)?1:alias.startsWith(q)?2:p.key.split(' ').some(w=>w.startsWith(q))?3:p.key.includes(q)?4:99;
      return {p,score};}).filter(r=>r.score<99).sort((a,b)=>a.score-b.score||a.p.rank-b.p.rank||a.p.name.localeCompare(b.p.name,'nl')).slice(0,8).map(r=>r.p);
  }
  function segments(rows,keys){
    const result=[];let run=[];
    rows.forEach((row,i)=>{const valid=keys.every(k=>Number.isFinite(row[k]));
      const gap=i>0&&Date.parse(row.key)-Date.parse(rows[i-1].key)>86400e3;
      if(!valid||gap){if(run.length)result.push(run);run=[];}
      if(valid)run.push({row,index:i});
    });if(run.length)result.push(run);return result;
  }
  return {dayKey,normalise,decode,source,distance,nearest,series,catalogue,search,segments};
});
