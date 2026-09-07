/* Numerical contracts shared by the four-panel map and its regression tests. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VierluikCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const HOUR = 3600000;
  const formatter = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Amsterdam', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});
  function parts(value) {
    return Object.fromEntries(formatter.formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  }
  function timeMs(value) {
    if (typeof value !== 'string' || /(?:Z|[+-]\d\d:?\d\d)$/i.test(value)) return new Date(value).getTime();
    // The published feeds store offset-free Amsterdam wall times, not browser-local times.
    const m=value.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?$/);
    if(!m)return NaN;
    const wall=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0));
    let utc=wall;
    for(let i=0;i<3;i++) {const p=parts(utc);utc+=wall-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);}
    const p=parts(utc);
    if(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)!==wall)return NaN;
    return utc;
  }
  function dayKey(value) {const p=parts(timeMs(value));return p.year+'-'+String(p.month).padStart(2,'0')+'-'+String(p.day).padStart(2,'0');}
  function displayDate(value) {
    const p=parts(timeMs(value));
    // A wall-time Date for the existing date labels; never use this for interval arithmetic.
    return new Date(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
  }
  function decode(buffer, info, meta) {
    if(buffer.byteLength<16)throw Error('Databestand mist de kop');
    const v=new DataView(buffer),nLat=v.getUint16(0,true),nLon=v.getUint16(2,true),nSteps=v.getUint16(4,true),nComp=v.getUint16(6,true),dtype=v.getUint8(8);
    if(nLat<2||nLon<2||!nSteps||!nComp||![0,1,2].includes(dtype))throw Error('Ongeldige afmetingen of datatype');
    const count=nLat*nLon*nSteps*nComp;
    if(buffer.byteLength!==16+count*(dtype===0?4:1))throw Error('Onvolledig of afwijkend databestand');
    if(meta.tijden && meta.tijden.length!==nSteps)throw Error('Aantal tijdstappen wijkt af van metadata');
    if(info.components && info.components!==nComp)throw Error('Aantal componenten wijkt af van metadata');
    const grid=info.grid||meta.grid;
    if(!grid || !['lat_min','lat_max','lon_min','lon_max'].every(k=>Number.isFinite(grid[k])) || grid.lat_min>=grid.lat_max || grid.lon_min>=grid.lon_max)throw Error('Ongeldig geografisch rooster');
    if((grid.n_lat && grid.n_lat!==nLat)||(grid.n_lon && grid.n_lon!==nLon))throw Error('Rooster wijkt af van metadata');
    let data,schaal=1;
    if(dtype===0)data=new Float32Array(buffer,16);
    else if(dtype===2){data=new Uint8Array(buffer,16);schaal=1/255;}
    else {
      const scale=info.scale??16,power=info.power??2;
      if(!(scale>0)||![1,2,3].includes(power))throw Error('Ongeldige compressieschaal');
      data=Float32Array.from(new Uint8Array(buffer,16),q=>Math.pow(q/scale,power));
    }
    return {data,nLat,nLon,nSteps,nComp,schaal,grid,source:info.source||'',info};
  }
  function bilinear(a,b,c,d,x,y) {
    const w0=(1-x)*(1-y),w1=x*(1-y),w2=(1-x)*y,w3=x*y;
    if((w0&& !Number.isFinite(a))||(w1&& !Number.isFinite(b))||(w2&& !Number.isFinite(c))||(w3&& !Number.isFinite(d)))return NaN;
    return (w0?a*w0:0)+(w1?b*w1:0)+(w2?c*w2:0)+(w3?d*w3:0);
  }
  function sample(pd, step, lat, lon, component=0) {
    if(!pd||!pd.grid||step<0||step>=pd.nSteps||component<0||component>=pd.nComp)return null;
    const g=pd.grid,nx=pd.nLon,ny=pd.nLat;
    let x=(lon-g.lon_min)/(g.lon_max-g.lon_min)*(nx-1),y=(lat-g.lat_min)/(g.lat_max-g.lat_min)*(ny-1);
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>nx-1||y<0||y>ny-1)return null;
    const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(x0+1,nx-1),y1=Math.min(y0+1,ny-1),dx=x-x0,dy=y-y0;
    const off=(step*pd.nComp+component)*nx*ny;
    const positions=[y0*nx+x0,y0*nx+x1,y1*nx+x0,y1*nx+x1],weights=[(1-dx)*(1-dy),dx*(1-dy),(1-dx)*dy,dx*dy];
    let sum=0;
    for(let i=0;i<4;i++){if(weights[i]===0)continue;const value=pd.data[off+positions[i]];if(!Number.isFinite(value))return null;sum+=value*weights[i];}
    return sum*(pd.schaal??1);
  }
  // Gusts are scalar maxima. Interpolating their artificial U/V representation
  // first can cancel equal gusts with opposing directions.
  function gustMagnitude(pd) {
    if(pd.nComp===1)return pd;
    if(pd.nComp!==2)throw Error('Windstoten missen geldige componenten');
    const size=pd.nLat*pd.nLon,data=new Float32Array(pd.nSteps*size);
    for(let s=0;s<pd.nSteps;s++)for(let i=0;i<size;i++) {
      const u=pd.data[s*2*size+i],v=pd.data[s*2*size+size+i];
      data[s*size+i]=Number.isFinite(u)&&Number.isFinite(v)?Math.hypot(u,v)*(pd.schaal??1):NaN;
    }
    return {...pd,data,nComp:1,schaal:1};
  }
  function scalarValue(key,value) {
    if(key==='zon')return Math.min(60,Math.max(0,value));
    return ['cape','zicht','neerslag','cumul','cumzon'].includes(key)?Math.max(0,value):value;
  }
  function cumulative(pd,times,startMs,dailySun=false) {
    const size=pd.nLat*pd.nLon, data=new Float32Array(pd.nSteps*size);data.fill(NaN);
    let previousDay='',previousEnd=NaN;
    const dayStarts=[];
    for(let s=0;s<pd.nSteps;s++){
      const end=timeMs(times[s]),day=dayKey(end-1),newDay=day!==previousDay;
      const baseline=Number.isFinite(startMs);
      const starts=dailySun ? newDay || (baseline && end===startMs+HOUR) : end===startMs+HOUR;
      const eligible=dailySun && !baseline || end>startMs;
      if(dailySun && starts && eligible)dayStarts.push({day,start:end-HOUR});
      for(let i=0;i<size;i++){
        if(baseline && end===startMs){data[s*size+i]=0;continue;}
        const value=pd.data[s*size+i]*(pd.schaal??1);
        if(!eligible||!Number.isFinite(value))continue;
        const before=starts?0:(s>0 && end-previousEnd===HOUR?data[(s-1)*size+i]:NaN);
        data[s*size+i]=before+(dailySun?Math.min(60,Math.max(0,value))/60:Math.max(0,value));
      }
      previousDay=day;previousEnd=end;
    }
    return {data,nLat:pd.nLat,nLon:pd.nLon,nSteps:pd.nSteps,nComp:1,schaal:1,grid:pd.grid,startMs,dayStarts};
  }
  return {HOUR,timeMs,dayKey,displayDate,decode,sample,cumulative,bilinear,gustMagnitude,scalarValue};
});
