/* Estimated sunshine from native hourly radiation. Missing inputs remain missing.
 * Erbs hourly diffuse fraction: https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.irradiance.erbs.html
 * Clear direct reference: Meinel, shared with scripts/zonuren.py. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.VierluikSun=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';const rad=Math.PI/180;
 function prepare(end){const samples=[];for(let k=0;k<12;k++){const ms=end-3600000+(k+.5)*300000,date=new Date(ms),day=Math.floor((ms-Date.UTC(date.getUTCFullYear(),0,1))/86400000)+1,hour=date.getUTCHours()+date.getUTCMinutes()/60,g=2*Math.PI/365*(day-1+(hour-12)/24),eq=229.18*(.000075+.001868*Math.cos(g)-.032077*Math.sin(g)-.014615*Math.cos(2*g)-.040849*Math.sin(2*g)),dec=.006918-.399912*Math.cos(g)+.070257*Math.sin(g)-.006758*Math.cos(2*g)+.000907*Math.sin(2*g)-.002697*Math.cos(3*g)+.00148*Math.sin(3*g),angle=(hour*60+eq-720)*rad/4;samples.push([Math.sin(dec),Math.cos(dec)*Math.cos(angle),-Math.cos(dec)*Math.sin(angle),1361*(1+.033*Math.cos(2*Math.PI*day/365))]);}return samples;}
 function ref(samples,sl,cl,so,co){let clear=0,extra=0,minutes=0;for(const [sd,cd,ss,e0] of samples){const h=Math.max(0,sl*sd+cl*(cd*co+ss*so));extra+=e0*h/12;if(h>.01){const dni=1361*Math.pow(.7,Math.pow(1/h,.678));if(dni>=120){clear+=dni*h/12;minutes+=5;}}}return {clear,extra,minutes};}
 function reference(end,lat,lon){return ref(prepare(end),Math.sin(lat*rad),Math.cos(lat*rad),Math.sin(lon*rad),Math.cos(lon*rad));}
 function minutes(value,end,lat,lon,direct=false){if(!Number.isFinite(value)||!Number.isFinite(end))return NaN;const r=reference(end,lat,lon);return convert(value,r,direct);}
 function convert(value,r,direct){if(r.clear<=1||!r.minutes)return 0;let beam=Math.max(0,value);
 if(!direct){const k=Math.min(1,beam/Math.max(1,r.extra));const diffuse=k<=.22?1-.09*k:k<=.8?.9511-.1604*k+4.388*k*k-16.638*k*k*k+12.336*k*k*k*k:.165;beam*=1-Math.min(1,Math.max(0,diffuse));}
 return Math.min(1,Math.max(0,beam/r.clear))*r.minutes;}
 function derive(pd,times,timeMs,direct=false){const data=new Float32Array(pd.nSteps*pd.nLat*pd.nLon),g=pd.grid,size=pd.nLat*pd.nLon;
 for(let t=0;t<pd.nSteps;t++){const end=timeMs(times[t]),samples=prepare(end);for(let y=0;y<pd.nLat;y++){const lat=g.lat_min+y*(g.lat_max-g.lat_min)/(pd.nLat-1);for(let x=0;x<pd.nLon;x++){const i=t*size+y*pd.nLon+x,lon=g.lon_min+x*(g.lon_max-g.lon_min)/(pd.nLon-1);const value=pd.data[i]*(pd.schaal??1);data[i]=Number.isFinite(value)&&Number.isFinite(end)?convert(value,ref(samples,Math.sin(lat*rad),Math.cos(lat*rad),Math.sin(lon*rad),Math.cos(lon*rad)),direct):NaN;}}}
 return {...pd,data,nComp:1,schaal:1,afgeleid:true,source:direct?'Eigen directe modelstraling; geschatte zonminuten':'Eigen globale modelstraling; Erbs-splitsing en geschatte zonminuten'};}
 return {minutes,reference,derive};
});
