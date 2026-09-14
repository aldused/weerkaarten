/* Data contracts for the model-map viewer. No UI state or network access. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vierluik-core'));
  else root.ModelkaartenCore = factory(root.VierluikCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(V) {
  'use strict';
  const HOUR = V.HOUR;
  const format = (value, options={}) => new Intl.DateTimeFormat('nl-NL', {
    timeZone:'Europe/Amsterdam', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', ...options
  }).format(new Date(value));
  function prepareMeta(meta) {
    if (!meta || !meta.parameters || !Array.isArray(meta.tijden) || !meta.tijden.length || meta.uren !== meta.tijden.length) throw Error('Metadata mist geldige tijdstappen');
    const times = meta.tijden.map((t,i) => {
      let ms = V.timeMs(t);
      // A feed without offsets can contain the repeated autumn 02:00 hour.
      // Only infer it when a run and a continuous hourly sequence identify it.
      if (meta.run_utc && !/(?:Z|[+-]\d\d:?\d\d)$/i.test(t)) {
        const candidate = Date.parse(meta.run_utc) + (i+1)*HOUR;
        if (Number.isFinite(candidate)) {
          const d=V.displayDate(candidate), pad=n=>String(n).padStart(2,'0');
          const wall=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
          if (wall === t.slice(0,16)) ms=candidate;
        }
      }
      return ms;
    });
    if(times.some((t,i)=>!Number.isFinite(t)||(i && t<=times[i-1]))) throw Error('Ongeldige of dubbelzinnige geldigheidstijden');
    Object.defineProperty(meta,'_times',{value:times,configurable:true});
    return meta;
  }
  function time(meta,i) { return (meta._times || prepareMeta(meta)._times)[i]; }
  function nearest(meta,ms) {
    let best=0, distance=Infinity;
    meta._times.forEach((t,i)=>{if(Math.abs(t-ms)<distance){distance=Math.abs(t-ms);best=i;}});
    return best;
  }
  function lead(meta,i) {
    const start=meta.run_utc ? Date.parse(meta.run_utc) : time(meta,0);
    return (time(meta,i)-start)/HOUR;
  }
  function decode(buffer,info,meta) {
    const pd=V.decode(buffer,info,meta);
    if(pd.schaal!==1){pd.data=Float32Array.from(pd.data,v=>v*pd.schaal);pd.schaal=1;}
    return pd;
  }
  function sample(pd,step,lat,lon,comp=0) {
    const value=V.sample(pd,step,lat,lon,comp,'nearest');
    return value === null ? NaN : value;
  }
  function value(pd,step,lat,lon) {
    const a=sample(pd,step,lat,lon);
    return pd && pd.nComp===2 ? Math.hypot(a,sample(pd,step,lat,lon,1)) : a;
  }
  function clean(pd,key) {
    if(!['druk','cape','rv','bewolking'].includes(key))return pd;
    for(let i=0;i<pd.data.length;i++) {
      const v=pd.data[i];
      if(key==='druk' && v<=0 || key==='cape' && v<0)pd.data[i]=NaN;
      else if(key==='rv' && Number.isFinite(v))pd.data[i]=Math.max(0,Math.min(100,v));
      else if(key==='bewolking' && Number.isFinite(v))pd.data[i]=Math.max(0,Math.min(1,v));
    }
    return pd;
  }
  function maskGrid(pd,pressure) {
    // Some older ICON files replace every missing field by 0 outside the domain.
    // Zero pressure is physically invalid, and provides an explicit validity mask.
    if(!pressure || pressure.data.every(Number.isFinite))return pd;
    const g=pd.grid, pg=pressure.grid, size=pd.nLat*pd.nLon, psize=pressure.nLat*pressure.nLon;
    const indices=new Int32Array(size);
    for(let y=0;y<pd.nLat;y++)for(let x=0;x<pd.nLon;x++) {
      const lat=g.lat_min+y*(g.lat_max-g.lat_min)/(pd.nLat-1),lon=g.lon_min+x*(g.lon_max-g.lon_min)/(pd.nLon-1);
      const px=Math.round((lon-pg.lon_min)/(pg.lon_max-pg.lon_min)*(pressure.nLon-1));
      const py=Math.round((lat-pg.lat_min)/(pg.lat_max-pg.lat_min)*(pressure.nLat-1));
      indices[y*pd.nLon+x]=px<0||px>=pressure.nLon||py<0||py>=pressure.nLat ? -1 : py*pressure.nLon+px;
    }
    for(let s=0;s<pd.nSteps;s++)for(let i=0;i<size;i++) {
      const pi=indices[i];
      if(pi>=0 && Number.isFinite(pressure.data[s*psize+pi]))continue;
      for(let c=0;c<pd.nComp;c++)pd.data[(s*pd.nComp+c)*size+i]=NaN;
    }
    return pd;
  }
  function position(frac, bounds, zoom, grid) {
    if(!bounds)return null;
    const x=(frac.mx-bounds.x)/bounds.width, y=(frac.my-bounds.y)/bounds.height;
    if(x<0||x>1||y<0||y>1)return null;
    const fx=zoom.cx+(x-.5)/zoom.zoom, fy=zoom.cy+(y-.5)/zoom.zoom;
    return {lon:grid.lon_min+fx*(grid.lon_max-grid.lon_min),lat:grid.lat_max-fy*(grid.lat_max-grid.lat_min)};
  }
  function sum(pd,meta,step) {
    const size=pd.nLat*pd.nLon, result=new Float32Array(size);
    for(let s=0;s<=step;s++) {
      if(s && time(meta,s)-time(meta,s-1)!==HOUR){result.fill(NaN);break;}
      for(let i=0;i<size;i++) {
        const v=pd.data[s*size+i];
        result[i]=Number.isFinite(v) && v>=0 ? result[i]+v : NaN;
      }
    }
    return result;
  }
  function source(meta,key) {
    const info=meta.parameters[key];
    if(!info)return '';
    if(info.source)return info.source.replace('open-meteo dmi_harmonie_arome_europe','DMI HARMONIE via Open-Meteo').replace('open-meteo knmi_harmonie_arome_europe','KNMI HARMONIE via Open-Meteo');
    if(info.derived)return [...new Set(info.needs.map(k=>source(meta,k)).filter(Boolean))].join(' + ');
    return meta.source || meta.model || '';
  }
  function description(meta,key,step) {
    const notes=[];
    if(key==='neerslag'||key==='neerslag_mm'||key==='combi') notes.push('Neerslag in het voorafgaande uur: '+format(time(meta,step)-HOUR)+' – '+format(time(meta,step))+'.');
    if(key==='nsomm')notes.push('Som vanaf '+format(time(meta,0)-HOUR)+' tot '+format(time(meta,step))+'.');
    if(key==='cape')notes.push('CAPE geeft beschikbare convectieve energie aan; dit is geen onweerskans.');
    if(key==='cumulus')notes.push('Experimentele afleiding van stapelwolken; geen directe modeluitvoer of satellietbeeld.');
    if(key==='cloud_base'&&!meta.parameters.wolkenbasis)notes.push('Geschatte condensatiehoogte uit temperatuur en dauwpunt; geen gemodelleerde wolkenbasis.');
    if(key==='theta_e')notes.push('Benadering met zeeniveaudruk; boven reliëf geen exacte theta-e.');
    if(key==='bewolking')notes.push('Hoog = wit · midden = oker · laag = grijs. Samengestelde lagen; kies een losse laag voor percentages.');
    notes.push('Bron: '+source(meta,key)+'.');
    if(source(meta,key).includes('Open-Meteo'))notes.push('Aanvullende bron; de afzonderlijke modelrun is niet meegeleverd.');
    notes.push('Grijs raster: ontbrekende of ongeldige waarden. Getallen zijn modelwaarden, geen metingen.');
    return notes.join(' ');
  }
  function freshness(meta,now=Date.now()) {
    const run=meta.run_utc ? Date.parse(meta.run_utc) : NaN;
    if(time(meta,meta.uren-1)<now)return 'Verouderde gegevens: alle geldigheidstijden liggen in het verleden.';
    if(Number.isFinite(run) && now-run>18*HOUR)return 'Oude modelrun: meer dan 18 uur geleden gestart.';
    return '';
  }
  return {HOUR,format,prepareMeta,time,nearest,lead,decode,sample,value,clean,maskGrid,position,sum,source,description,freshness};
});
