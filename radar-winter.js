/* Winter colours are a HARMONIE surface wet-bulb indication, not observed precipitation type. */
(function(global) {
  'use strict';
  var ramps={2:[[185,164,231],[148,116,207],[114,77,182],[84,45,146]],3:[[247,181,214],[237,125,188],[214,65,154],[168,24,109]]};
  function wetBulb(t,td) {
    if(!Number.isFinite(t)||!Number.isFinite(td)||t < -70||t > 60||td < -90||td > t+2) return NaN;
    td=Math.min(t,td);
    var vapour=6.112*Math.exp(17.62*td/(243.12+td)),lo=td,hi=t;
    for(var i=0;i<18;i++) {
      var tw=(lo+hi)/2,estimate=6.112*Math.exp(17.62*tw/(243.12+tw))-.00066*(1+.00115*tw)*1013.25*(t-tw);
      if(estimate>vapour)hi=tw;else lo=tw;
    }
    return (lo+hi)/2;
  }
  function category(tw){return !Number.isFinite(tw)?0:tw<=.5?3:tw<2?2:1;}
  function colour(kind,dbz) {
    var ramp=ramps[kind]; if(!ramp)return null;
    var value=Math.max(0,Math.min(3,(dbz-7)/12)),index=Math.min(2,Math.floor(value)),f=value-index;
    return ramp[index].map(function(c,k){return Math.round(c+(ramp[index+1][k]-c)*f);});
  }
  function utc(time) {
    if(/[zZ]|[+-]\d\d:\d\d$/.test(time))return Date.parse(time);
    var assumed=Date.parse(time+'Z');
    for(var i=0;i<2;i++) {
      var local=new Date(assumed).toLocaleString('sv-SE',{timeZone:'Europe/Amsterdam'}).replace(' ','T');
      assumed+=Date.parse(time+'Z')-Date.parse(local+'Z');
    }
    return assumed;
  }
  async function json(url){var r=await fetch(url);if(!r.ok)throw Error('Modelmeta ontbreekt');return r.json();}
  async function slices(base,parameter,grid,first,last,total,version) {
    if(!/^[a-z0-9_]+\.bin$/i.test(parameter.file))throw Error('Ongeldig modelbestand');
    var cells=grid.n_lat*grid.n_lon,start=16+first*cells*4,end=16+(last+1)*cells*4;
    // R2 ranges address the stored gzip stream. A full fetch lets the browser decompress it.
    var r=await fetch(base+parameter.file+'?run='+encodeURIComponent(version));
    if(!r.ok)throw Error('Modelveld ontbreekt');
    var buf=await r.arrayBuffer();
    if(buf.byteLength!==16+total*cells*4)throw Error('Onvolledig modelbestand');
    var h=new DataView(buf);
    if(h.getUint16(0,true)!==grid.n_lat||h.getUint16(2,true)!==grid.n_lon||h.getUint16(4,true)!==total||h.getUint16(6,true)!==1)throw Error('Modelgrid wijkt af');
    return new Float32Array(buf.slice(start,end));
  }
  var cachedModel=null;
  async function load(base,radarTimes) {
    var m=await json(base+'harmonie_canvas_meta.json?t='+Date.now()),run=Date.parse(m.run_utc);
    if(!Number.isFinite(run)||Date.now()-run>6*3600000||run>Date.now()+3600000)throw Error('Modelrun verouderd');
    var p=m.parameters,g=m.grid,times=m.tijden.map(utc),first=times.findIndex(function(t){return t>=Date.parse(radarTimes[0])-3600000;});
    if(!p.temp||!p.dauwpunt||!p.druk||p.druk.components!==1||p.druk.grid||p.temp.components!==1||p.dauwpunt.components!==1||p.temp.grid||p.dauwpunt.grid)throw Error('Modelvelden niet compatibel');
    var last=times.findIndex(function(t){return t>=Date.parse(radarTimes[radarTimes.length-1]);});
    if(first<0||last<0)throw Error('Modeltijd ontbreekt');
    if(cachedModel&&cachedModel.run===m.run_utc&&cachedModel.times[0]<=times[first]&&cachedModel.times[cachedModel.times.length-1]>=times[last])return cachedModel;
    var data=await Promise.all([slices(base,p.temp,g,first,last,times.length,m.run_utc),slices(base,p.dauwpunt,g,first,last,times.length,m.run_utc),slices(base,p.druk,g,first,last,times.length,m.run_utc)]);
    var verify=await json(base+'harmonie_canvas_meta.json?t='+Date.now());if(verify.run_utc!==m.run_utc)throw Error('Modelrun gewijzigd tijdens laden');
    var cells=g.n_lat*g.n_lon,fields=[];
    for(var h=0;h<=last-first;h++) {
      var field=new Float32Array(cells);
      for(var i=0;i<cells;i++)field[i]=Number.isFinite(data[2][h*cells+i])&&data[2][h*cells+i]>0?wetBulb(data[0][h*cells+i],data[1][h*cells+i]):NaN;
      fields.push(field);
    }
    cachedModel={run:m.run_utc,grid:g,times:times.slice(first,last+1),fields:fields};
    return cachedModel;
  }
  function hour(model,time) {
    var ms=Date.parse(time),index=-1;
    for(var i=0;i<model.times.length;i++)if(ms>=model.times[i])index=i;
    return index>=0&&ms-model.times[index]<=3600000?index:-1;
  }
  function sample(model,index,lat,lon) {
    var g=model.grid;if(index<0||lat<g.lat_min||lat>g.lat_max||lon<g.lon_min||lon>g.lon_max)return NaN;
    // HARMONIE arrays run south to north; coordinates in meta refer to grid nodes.
    var x=(lon-g.lon_min)/(g.lon_max-g.lon_min)*(g.n_lon-1),y=(lat-g.lat_min)/(g.lat_max-g.lat_min)*(g.n_lat-1);
    var x0=Math.min(g.n_lon-2,Math.floor(x)),y0=Math.min(g.n_lat-2,Math.floor(y)),fx=x-x0,fy=y-y0,f=model.fields[index];
    var a=f[y0*g.n_lon+x0],b=f[y0*g.n_lon+x0+1],c=f[(y0+1)*g.n_lon+x0],d=f[(y0+1)*g.n_lon+x0+1];
    if(![a,b,c,d].every(Number.isFinite))return NaN;
    return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
  }
  global.RadarWinter={load:load,hour:hour,sample:sample,category:category,colour:colour,wetBulb:wetBulb,utc:utc,ramps:ramps};
})(typeof window==='undefined'?globalThis:window);
