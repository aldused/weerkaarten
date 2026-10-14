/* KNMI geometry and live-feed contract, shared by Weerlab and Meteobewaking. */
export const rank = {groen:0,geel:1,oranje:2,rood:3};
export const colors = {groen:'#7cc47c',geel:'#ffd633',oranje:'#ff8c1a',rood:'#cc0000'};
export function validGeometry(geometry){
 if(!geometry || !['Polygon','MultiPolygon'].includes(geometry.type)||!Array.isArray(geometry.coordinates))return false;
 const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
 return polygons.length>0&&polygons.every(poly=>Array.isArray(poly)&&poly.length>0&&poly.every(ring=>Array.isArray(ring)&&ring.length>=4&&ring.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90)&&ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1]));
}
function onSegment(x,y,a,b){
 const cross=(x-a[0])*(b[1]-a[1])-(y-a[1])*(b[0]-a[0]);
 return Math.abs(cross)<1e-10&&x>=Math.min(a[0],b[0])-1e-10&&x<=Math.max(a[0],b[0])+1e-10&&y>=Math.min(a[1],b[1])-1e-10&&y<=Math.max(a[1],b[1])+1e-10;
}
function inRing(x,y,ring){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[j],b=ring[i];
  if(onSegment(x,y,a,b))return {inside:true,boundary:true};
  if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return {inside,boundary:false};
}
export function containsPoint(geometry,lon,lat){
 if(!validGeometry(geometry)||!Number.isFinite(lon)||!Number.isFinite(lat))return false;
 const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
 return polygons.some(poly=>{
  const outer=inRing(lon,lat,poly[0]);if(!outer.inside)return false;
  if(outer.boundary)return true;
  return !poly.slice(1).some(hole=>{const test=inRing(lon,lat,hole);return test.inside&&!test.boundary;});
 });
}
export function assertFeed(data,now=Date.now()){
 const generated=Date.parse(data?.generated);
 if(!Number.isFinite(generated)||now-generated>45*60000||generated>now+5*60000)throw Error('De KNMI-gegevens zijn niet actueel.');
 if(!Array.isArray(data.warnings))throw Error('Waarschuwingsgegevens zijn onvolledig.');
 if(data.mode==='polygons'){
  const issued=Date.parse(data.issued);
  if(data.operational_status!=='Actual'||!['manual','heartbeat'].includes(data.publication_type)||!Number.isFinite(issued)||now-issued>36*3600000||issued>now+5*60000)throw Error('Geen actuele operationele KNMI-publicatie.');
  if(!Array.isArray(data.outlook))throw Error('Vooruitblik ontbreekt.');
  for(const w of [...data.warnings,...data.outlook]){
   if(w.operational_status!=='Actual'||!['geel','oranje','rood'].includes(w.code)||!validGeometry(w.geometry)||!Number.isFinite(Date.parse(w.onset))||!Number.isFinite(Date.parse(w.expires))||Date.parse(w.onset)>=Date.parse(w.expires))throw Error('Ongeldig KNMI-waarschuwingsgebied.');
  }
 }else if(data.mode&&data.mode!=='provinces')throw Error('Onbekende KNMI-dataversie.');
 else if(!data.provinces||typeof data.provinces!=='object')throw Error('Provinciegegevens ontbreken.');
 return data;
}
export function liveWarnings(list,now=Date.now()){
 return list.filter(w=>!w.expires||Date.parse(w.expires)>now);
}
export function forLocation(data,{lat,lon,province='Zuid-Holland',name},now=Date.now()){
 assertFeed(data,now);
 if(data.mode==='polygons'){
  const relevant=list=>liveWarnings(list,now).filter(w=>containsPoint(w.geometry,lon,lat));
  const warnings=relevant(data.warnings),outlook=relevant(data.outlook);
  const current=warnings.filter(w=>Date.parse(w.onset)<=now);
  const highest=list=>list.reduce((code,w)=>rank[w.code]>rank[code]?w.code:code,'groen');
  return {mode:'polygons',location:name,code:highest(current),upcoming_code:highest(warnings),generated:data.generated,issued:data.issued,warnings,outlook};
 }
 const p=data.provinces[province];
 if(!p||data.errors?.[province]||!Object.hasOwn(rank,p.code)||!Array.isArray(p.warnings))throw Error('KNMI-waarschuwingen voor dit gebied zijn niet beschikbaar.');
 return {mode:'provinces',location:name,province,code:p.code,upcoming_code:p.code,generated:data.generated,warnings:p.warnings.map(w=>({...w,warning_type:'warning'})),outlook:[]};
}
export function formatValidity(w){
 if(!w.onset||!w.expires)return String(w.geldigheid||w.validity||'');
 const fmt=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
 return fmt.format(new Date(w.onset))+' – '+fmt.format(new Date(w.expires));
}
