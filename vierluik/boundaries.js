// Draw shared borders once. Province datasets also contain country/coast outlines.
export function boundaryLines(features,sharedOnly=false){
 const edges=new Map();
 const key=point=>point.map(v=>Math.round(v*1e5)).join(',');
 features.forEach((geometry,owner)=>{
  const lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.type==='MultiLineString'?geometry.coordinates:[];
  for(const line of lines)for(let i=1;i<line.length;i++){
   const a=line[i-1],b=line[i],ka=key(a),kb=key(b);if(ka===kb)continue;
   const id=ka<kb?ka+'|'+kb:kb+'|'+ka;
   if(!edges.has(id))edges.set(id,{points:[a,b],owners:new Set()});
   edges.get(id).owners.add(owner);
  }
 });
 return [{type:'MultiLineString',coordinates:[...edges.values()].filter(e=>!sharedOnly||e.owners.size>1).map(e=>e.points)}];
}
