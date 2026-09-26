// Local review server: runs the new cloud endpoint without deploying a Worker.
// Other data requests use the existing public field service. Static endpoint
// origins are rewritten in the response only; the production build is intact.
import {createServer} from 'node:http';
import {readFile,stat,open} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initWasm,LruBlockCache} from '@openmeteo/file-reader';
import {getProtocolInstance,defaultOmProtocolSettings} from '@openmeteo/weather-map-layer';
import {createFieldHandler} from '../edge-fields/handler.mjs';
import {harmonie} from '../edge-fields/harmonie.mjs';
await initWasm();
const reader=getProtocolInstance({...defaultOmProtocolSettings,fileReaderConfig:{cache:new LruBlockCache(65536,1024),useSAB:false}}).omFileReader;
const stored=new Map(),cache={match:async k=>stored.get(k.url)?.clone(),put:async(k,r)=>{stored.set(k.url,r.clone());while(stored.size>24)stored.delete(stored.keys().next().value);}};
globalThis.caches={default:cache};
const handler=createFieldHandler({getCache:()=>cache,readField:(...args)=>reader.readVariable(...args)});
const root=fileURLToPath(new URL('../',import.meta.url)),port=Number(process.env.CLOUD_PREVIEW_PORT||8794),origin=`http://127.0.0.1:${port}`;
const remote={ecmwf:'https://weerlab-ecmwf-fields.dawn-term-a69f.workers.dev',harmonie:'https://weerlab-harmonie-fields.dawn-term-a69f.workers.dev'};
// Optional immutable local exports for review of newly exposed cloud base.
// This never writes/publishes a remote run or reads mutable frame files.
const localModels={};
for(const [model,path] of Object.entries({harmonie:process.env.CLOUD_REVIEW_HARMONIE,harmonie46:process.env.CLOUD_REVIEW_HARMONIE46,icond2:process.env.CLOUD_REVIEW_ICOND2}))if(path){
 const meta=JSON.parse(await readFile(resolve(path,'meta.json'),'utf8'));
 if(meta.model!==model)throw Error('Wrong local model');
 localModels[model]={meta,path:resolve(path)};
}
const localSource={async get(key,options){
 const match=/^map-source\/(harmonie|harmonie46|icond2)\/(latest\.json|\d{10}-[a-f0-9]{16}\/(meta\.json|\d{3}\.bin))$/.exec(key);
 const local=match&&localModels[match[1]];if(!local)return null;
 if(match[2]==='latest.json')return {body:JSON.stringify(local.meta)};
 if(!match[2].startsWith(local.meta.version+'/'))return null;
 const path=resolve(local.path,match[3]);
 if(match[3]==='meta.json')return {json:async()=>local.meta};
 return {arrayBuffer:async()=>{const file=await open(path);try{const range=options.range,bytes=Buffer.alloc(range.length),{bytesRead}=await file.read(bytes,0,range.length,range.offset);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytesRead);}finally{await file.close();}}};
}};
const types={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png'};
createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,origin);
    if(u.pathname.startsWith('/data_spatial/')||u.pathname.startsWith('/harmonie/')){
      const regional=u.pathname.startsWith('/harmonie/'),ctx={waitUntil:p=>p.catch(e=>console.error(e.message))};
      const local=regional&&localModels[u.pathname.split('/')[2]],native=!!local||(u.searchParams.get('variable')==='pressure_msl'||(!process.env.ISOBAR_PREVIEW&&u.searchParams.get('variable')==='cloud_layers'))||/hPa$/.test(u.searchParams.get('variable')||'');
      const response=native
        ?await (regional?harmonie:handler)(new Request(u),local?{HARMONIE_MAPS:localSource}:{},ctx)
        :await fetch(remote[regional?'harmonie':'ecmwf']+u.pathname+u.search);
      const bytes=Buffer.from(await response.arrayBuffer()),headers=Object.fromEntries(response.headers);
      // Fetch has already decoded the remote service's content encoding.
      if(!native)delete headers['content-encoding'];
      delete headers['transfer-encoding'];delete headers['content-length'];
      res.writeHead(response.status,{...headers,'Content-Length':bytes.length});res.end(bytes);return;
    }
    let path=resolve(root,'.'+decodeURIComponent(u.pathname));
    if(path!==resolve(root)&&!path.startsWith(root))throw Error('Invalid path');
    if((await stat(path)).isDirectory())path=resolve(path,'index.html');
    let bytes=await readFile(path);
    if(['.js','.mjs'].includes(extname(path)))bytes=Buffer.from(bytes.toString().replaceAll(remote.ecmwf,origin).replaceAll(remote.harmonie,origin));
    // Test fixture only on this loopback review server; production access stays unchanged.
    if(process.env.ISOBAR_PREVIEW&&path===resolve(root,'access.mjs'))bytes=Buffer.from(bytes.toString().replace('installAccessGate(document,storage,startMap);',"installAccessGate(document,{getItem:()=> '1'},startMap);"));
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
  }catch(error){console.error(error.message);res.writeHead(500,{'Content-Type':'text/plain'});res.end(error.message);}
}).listen(port,'127.0.0.1',()=>console.log('Cloud review: '+origin));
