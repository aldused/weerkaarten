// Public, immutable ECMWF OM bytes only. Never forwards cookies or API keys.
const ROOT='/data_spatial/ecmwf_ifs/';
const UPSTREAM='https://openmeteo.s3.amazonaws.com';
const RUN='\\d{4}/\\d{2}/\\d{2}/(?:00|06|12|18)00Z/';
const PATH=new RegExp('^'+ROOT+'(?:latest\\.json|'+RUN+'(?:meta\\.json|\\d{4}-\\d{2}-\\d{2}T\\d{4}\\.om))$');
const CORS={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers':'Range',
  'Access-Control-Expose-Headers':'ETag, Content-Range, Content-Length, X-Weerlab-Cache, Server-Timing',
  'Access-Control-Max-Age':'86400',
};
const failure=(message,status)=>new Response(message,{status,headers:{...CORS,'Cache-Control':'no-store'}});

export function createHandler({fetcher=(...args)=>fetch(...args),getCache=()=>caches.default}={}){
  const inflight=new Map();
  return async function handle(request,env,ctx){
    const started=performance.now(),url=new URL(request.url);
    if(!PATH.test(url.pathname)||[...url.searchParams.keys()].some(key=>!['range','cached','tail'].includes(key))||url.searchParams.getAll('tail').length>1||url.searchParams.getAll('range').length>1||url.searchParams.getAll('cached').length>1||(url.searchParams.has('cached')&&url.searchParams.get('cached')!=='1'))return failure('Niet gevonden',404);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
    if(!['GET','HEAD'].includes(request.method))return failure('Alleen GET en HEAD',405);
    const binary=url.pathname.endsWith('.om'),head=request.method==='HEAD';
    let range;
    if(binary&&!head){
      const tail=url.searchParams.get('tail');
      if(tail!==null){
        if(tail!=='262144'||url.searchParams.has('range')||request.headers.get('Range')!=='bytes=-262144')return failure('Ongeldige indexaanvraag',400);
        range={tail:262144,text:'bytes=-262144'};
      }else{
      const m=/^bytes=(\d+)-(\d+)$/.exec(request.headers.get('Range')||'');
      if(!m)return failure('Een enkel bytebereik is vereist',400);
      const start=Number(m[1]),end=Number(m[2]);
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<start||end-start+1>512*1024)return failure('Ongeldig of te groot bytebereik',416);
      range={start,end,text:`bytes=${start}-${end}`};
      if(url.search&&url.searchParams.get('range')!==`${start}-${end}`)return failure('Afwijkend bytebereik',400);
      }
    }
    if(url.search&&(!binary||head))return failure('Ongeldige query',400);
    // Cache API cannot store206. Store each exact range as a separate200 body
    // under a versioned private cache key, then restore206 at the boundary.
    const keyURL=new URL(url);keyURL.pathname='/__ecmwf_cache_v1'+url.pathname;
    keyURL.search='';keyURL.searchParams.set('part',binary?(head?'head':range.text):'json');
    const key=new Request(keyURL),cache=getCache();
    const present=await cache.match(key);
    // Legacy cold HEADs redirect. New clients use one suffix GET instead.
    // Both selected and background fields populate the shared byte cache.
    if(binary&&head&&!present)return new Response(null,{status:307,headers:{...CORS,Location:UPSTREAM+url.pathname,'Cache-Control':'no-store'}});
    async function load(){
      const originStart=performance.now();
      const response=await fetcher(UPSTREAM+url.pathname,{
        method:binary&&head?'HEAD':'GET',headers:range?{Range:range.text}:{},
        signal:AbortSignal.timeout(20000),redirect:'manual',cache:'no-store',
      });
      const originHeaders=performance.now();
      if(!response.ok)return failure('ECMWF-bron tijdelijk niet beschikbaar',response.status===404?404:502);
      const headers=new Headers({'Content-Type':binary?'application/octet-stream':'application/json'});
      for(const name of ['ETag','Last-Modified'])if(response.headers.has(name))headers.set(name,response.headers.get(name));
      let body,ttl=86400;
      if(binary&&head){
        const length=Number(response.headers.get('Content-Length'));
        if(response.status!==200||!Number.isSafeInteger(length)||length<=0)return failure('Ongeldige ECMWF-bestandslengte',502);
        headers.set('X-File-Length',String(length));body=new Uint8Array();
      }else if(binary){
        const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range')||'');
        if(response.status!==206||!match)return failure('Ongeldig ECMWF-deelantwoord',502);
        const [start,end,total]=match.slice(1).map(Number);
        if(![start,end,total].every(Number.isSafeInteger)||total<=end||start<0||end<start||
          (range.tail?(end!==total-1||start!==Math.max(0,total-range.tail)):(start!==range.start||end!==range.end)))return failure('Ongeldig ECMWF-deelantwoord',502);
        const length=end-start+1;
        headers.set('X-Source-Range',response.headers.get('Content-Range'));
        headers.set('Cache-Control','public, max-age=86400');headers.set('Content-Length',String(length));
        // Deliver source bytes immediately. Cache only the completely validated
        // clone, outside the visitor's critical path; never cache a short body.
        const storeBytes=async bytes=>{
          if(bytes.byteLength!==length)throw new Error('Onvolledig ECMWF-deelantwoord');
          await cache.put(key,new Response(bytes,{headers}));
          if(end===total-1){
            const headKey=new URL(keyURL);headKey.searchParams.set('part','head');
            const headHeaders=new Headers(headers);headHeaders.set('X-File-Length',String(total));headHeaders.set('Content-Length','0');
            await cache.put(new Request(headKey),new Response(new Uint8Array(),{headers:headHeaders}));
          }
        };
        if(ctx?.waitUntil){
          const source=response.clone();
          const done=source.arrayBuffer().then(buffer=>storeBytes(new Uint8Array(buffer))).catch(()=>{});
          ctx.waitUntil(done);
          // Retain the in-flight entry until cache persistence has finished.
          const streamed=new Response(response.body,{headers});
          return {response:streamed,done};
        }
        body=new Uint8Array(await response.arrayBuffer());
        if(body.byteLength!==length)return failure('Onvolledig ECMWF-deelantwoord',502);
        await storeBytes(body);
        return {response:new Response(body,{headers}),done:Promise.resolve()};
      }else{
        body=new Uint8Array(await response.arrayBuffer());
        if(body.byteLength>2*1024*1024)return failure('Ongeldige ECMWF-metadata',502);
        let metadata;try{metadata=JSON.parse(new TextDecoder().decode(body));}catch{return failure('Ongeldige ECMWF-metadata',502);}
        ttl=url.pathname.endsWith('/latest.json')||metadata.completed!==true?30:3600;
      }
      headers.set('Cache-Control',`public, max-age=${ttl}`);headers.set('Content-Length',String(body.byteLength));
      const stored=new Response(body,{headers});
      // Keep the shared miss in flight until storage is complete. Concurrent
      // visitors to this isolate cannot cause duplicate upstream requests.
      const bodyReady=performance.now();
      try{await cache.put(key,stored.clone());}catch{/* Cache failure must not hide valid source bytes. */}
      stored.headers.set('X-Origin-Timing',`headers;dur=${Math.round(originHeaders-originStart)}, body;dur=${Math.round(bodyReady-originHeaders)}, store;dur=${Math.round(performance.now()-bodyReady)}`);
      return {response:stored,done:Promise.resolve()};
    }
    let stored=present,hit=!!present;
    if(!stored){
      let task=inflight.get(key.url);
      if(!task){
        task=load().catch(error=>{console.error('ECMWF cache source:',error.name,error.message);return failure('ECMWF-bron tijdelijk niet bereikbaar',502);});
        inflight.set(key.url,task);
        const cleanup=task.then(async result=>{await result.done;}).finally(()=>{if(inflight.get(key.url)===task)inflight.delete(key.url);});
        ctx?.waitUntil(cleanup);
      }
      else hit=true;
      const result=await task;stored=(result.response??result).clone();
    }
    if(!stored.ok)return stored;
    const headers=new Headers(stored.headers);
    for(const [name,value] of Object.entries(CORS))headers.set(name,value);
    headers.set('X-Weerlab-Cache',hit?'HIT':'MISS');
    headers.set('Server-Timing',(headers.get('X-Origin-Timing')?headers.get('X-Origin-Timing')+', ':'')+`ecmwf;dur=${Math.round(performance.now()-started)};desc="${hit?'cache':'origin'}"`);
    if(binary){
      // Browser persistence belongs to the validated block CacheStorage.
      // Do not let a second HTTP cache serialize range writes for this file.
      headers.set('Cache-Control','no-store');
      headers.set('Accept-Ranges','bytes');
      if(head)headers.set('Content-Length',headers.get('X-File-Length'));
      else headers.set('Content-Range',headers.get('X-Source-Range'));
    }
    headers.delete('X-Origin-Timing');headers.delete('X-File-Length');headers.delete('X-Source-Range');
    return new Response(head?null:stored.body,{status:binary&&!head?206:200,headers});
  };
}
export default {fetch:createHandler()};
