(function(root){
 'use strict';const H=3600000;
 function chill(t,v){if(!Number.isFinite(t)||!Number.isFinite(v)||t< -46||t>10||v<1.3*3.6||v>49*3.6)return null;return 13.12+.6215*t-11.37*v**.16+.3965*t*v**.16;}
 function at(m,cube,kind,p,now=Date.now()){
  const g=m.grid,y=(p.lat-g.lat0)/g.dlat,x=(p.lon-g.lon0)/g.dlon;if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>g.nx-1||y>g.ny-1)throw Error('Deze plaats ligt buiten het modelgebied');
  const i=Math.min(g.ny-2,Math.floor(y)),j=Math.min(g.nx-2,Math.floor(x)),fy=y-i,fx=x-j,N=g.ny*g.nx;
  const corners=[[i,j,(1-fy)*(1-fx)],[i+1,j,fy*(1-fx)],[i,j+1,(1-fy)*fx],[i+1,j+1,fy*fx]];
  const rows=[];for(let t=0;t<m.hours;t++){const stamp=Date.parse(m.start||m.t0)+t*H;if(stamp<Math.ceil(now/H)*H||stamp>=Math.ceil(now/H)*H+120*H)continue;
   const sum=field=>corners.reduce((v,[a,b,w])=>v+w*cube[(kind==='wind'?field*m.hours*N:0)+t*N+a*g.nx+b],0);
   rows.push({t:stamp,value:sum(0),...(kind==='wind'?{gust:sum(1)}:{}),interval:m.source_intervals?.[t]||1});
  }return rows;
 }
 function spread(series){const maps=series.map(s=>new Map(s.rows.filter(r=>Number.isFinite(r.value)).map(r=>[r.t,r.value])));if(maps.length<2)return [];
  return [...maps[0]].flatMap(([t])=>{const v=maps.map(m=>m.get(t));return v.every(Number.isFinite)?[{t,min:Math.min(...v),max:Math.max(...v),range:Math.max(...v)-Math.min(...v)}]:[]});
 }
 function feels(temp,wind){const w=new Map(wind.map(r=>[r.t,r.value]));return temp.map(r=>({...r,value:chill(r.value,w.get(r.t)),temperature:r.value,wind:w.get(r.t)}));}
 const api={chill,at,spread,feels};if(typeof module!=='undefined')module.exports=api;else root.WeergrafiekenCore=api;
})(typeof window==='undefined'?globalThis:window);
