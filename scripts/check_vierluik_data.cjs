// Run: node scripts/check_vierluik_data.cjs [local-data-directory] [output.json]
const fs=require('fs'),path=require('path');
const C=require('../vierluik-core');
const root=process.argv[2] || path.join(__dirname,'..');
const files=['harmonie','harmonie46','icond2','icond2ruc','arome_om','ukmo_om','dmi_om','ecmwf_om','gfs_global_om','icon_global_om','ukmo_global_om'];
const out=[];
for(const model of files){
 const meta=JSON.parse(fs.readFileSync(path.join(root,model+'_canvas_meta.json')));const row={model,updated:meta.bijgewerkt,fields:{}};
 for(const [key,info] of Object.entries(meta.parameters)){
  if(!info.file || info.derived)continue;
  try{
   const b=fs.readFileSync(path.join(root,info.file));const pd=C.decode(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),info,meta);
   let min=Infinity,max=-Infinity,missing=0,n=0;for(let i=0;i<pd.data.length;i+=Math.max(1,Math.floor(pd.data.length/2000))){n++;const v=pd.data[i]*(pd.schaal??1);if(!Number.isFinite(v))missing++;else{min=Math.min(min,v);max=Math.max(max,v)}}
   row.fields[key]={shape:[pd.nSteps,pd.nComp,pd.nLat,pd.nLon],min,max,sampled:n,missing,bytes:b.length};
  }catch(e){row.fields[key]={error:e.message};}
 }
 out.push(row);
}
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(out,null,2));
const failed=out.flatMap(m=>Object.entries(m.fields).filter(([k,v])=>v.error).map(([k,v])=>`${m.model}/${k}: ${v.error}`));
console.log(JSON.stringify({models:out.length,fields:out.reduce((a,m)=>a+Object.keys(m.fields).length,0),failed},null,2));

if(failed.length)process.exitCode=1;
