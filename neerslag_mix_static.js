// Static R2 transport: one image per selected step, quantitative data on click.
const base='https://data.weerlab.nl/neerslag-mix/';
let manifest,pointCache;
export async function mixFetch(path){
 const url=new URL(path,location.href);
 if(url.pathname==='/manifest'){
  const latest=await fetch(base+'latest.json',{cache:'no-store'});if(!latest.ok)return latest;
  const pointer=await latest.json();if(!/^[a-f0-9]{24}$/.test(pointer.version))throw Error('Ongeldige kaartversie');
  const response=await fetch(base+pointer.version+'/manifest.json');if(!response.ok)return response;
  manifest=await response.json();if(manifest.version!==pointer.version)throw Error('Kaartversie komt niet overeen');
  return Response.json(manifest);
 }
 if(url.pathname==='/legend'){
  // The palette is version-independent; do not fetch an additional model dataset.
  return fetch(base+'legend.json');
 }
 const step=Number(url.searchParams.get('step')),version=url.searchParams.get('version');
 if(!manifest||version!==manifest.version||!Number.isInteger(step)||step<0||step>manifest.frames.length)throw Error('Ongeldige kaartstap');
 const prefix=base+version+'/'+String(step).padStart(3,'0');
 if(url.pathname==='/image'){
  const field=url.searchParams.get('field');const suffix=step===0?'radar':({amount_mm:'amount',intensity_mm_h:'intensity'})[field];
  if(!suffix)throw Error('Onbekende kaartlaag');return fetch(prefix+'-'+suffix+'.png');
 }
 if(url.pathname==='/point'){
  const g=manifest.web_points,lat=Number(url.searchParams.get('lat')),lon=Number(url.searchParams.get('lon'));
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<g.south||lat>=g.north||lon<g.west||lon>=g.east)throw Error('Buiten kaartgebied');
  if(!pointCache||pointCache.step!==step){
   const response=await fetch(prefix+'-point.bin.gz');if(!response.ok)return response;
   const bytes=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
   if(bytes.byteLength!==g.fields.length*g.width*g.height*4)throw Error('Onvolledige locatiegegevens');
   pointCache={step,data:new DataView(bytes)};
  }
  const merc=a=>Math.asinh(Math.tan(a*Math.PI/180));
  const x=Math.floor((lon-g.west)/(g.east-g.west)*g.width),y=Math.floor((merc(g.north)-merc(lat))/(merc(g.north)-merc(g.south))*g.height);
  if(y<0||y>=g.height||x<0||x>=g.width)throw Error('Buiten kaartgebied');
  const values={};g.fields.forEach((key,i)=>{const v=pointCache.data.getFloat32((i*g.width*g.height+y*g.width+x)*4,true);values[key]=Number.isFinite(v)?v:null;});
  return Response.json({frame:step===0?manifest.current:manifest.frames[step-1],values});
 }
 throw Error('Onbekend gegevensverzoek');
}
