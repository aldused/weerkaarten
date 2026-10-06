import {DurableObject} from 'cloudflare:workers';
const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers});
let certCache;
function bytes(value){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
export async function authorized(request,env){
  try{
    const token=request.headers.get('Cf-Access-Jwt-Assertion');
    if(!token)return false;
    const parts=token.split('.');if(parts.length!==3)return false;
    const head=JSON.parse(new TextDecoder().decode(bytes(parts[0])));
    const claim=JSON.parse(new TextDecoder().decode(bytes(parts[1])));
    const now=Date.now()/1000;
    if(head.alg!=='RS256'||claim.iss!==env.ACCESS_TEAM||claim.exp<=now||!Number.isFinite(claim.exp)||claim.nbf>now||!Array.isArray(claim.aud)||!claim.aud.includes(env.ACCESS_AUD)||!claim.email||claim.type!=='app')return false;
    if(!certCache||certCache.until<Date.now()){
      const response=await fetch(env.ACCESS_TEAM+'/cdn-cgi/access/certs');if(!response.ok)return false;
      certCache={...(await response.json()),until:Date.now()+300000};
    }
    const jwk=certCache.keys.find(k=>k.kid===head.kid);if(!jwk){certCache=null;return false;}
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  }catch{return false;}
}
export default{
 async fetch(request,env){
  const url=new URL(request.url);
  const path=url.pathname.replace(/^\/api\/kranten/,'');
  const agent=path.startsWith('/agent/');
  if(agent){
    if(!env.AGENT_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.AGENT_TOKEN)return json({error:'Geen toegang.'},401);
  }else{
    if(url.hostname!=='weerlab.nl'||!await authorized(request,env))return json({error:'Log opnieuw in op Weerlab.'},401);
    if(request.method==='POST'&&request.headers.get('Origin')!=='https://weerlab.nl')return json({error:'Geen toegang.'},403);
  }
  const allowed=(request.method==='GET'&&path==='/status')||(request.method==='POST'&&['/rewrite','/agent/poll','/agent/update'].includes(path));
  if(!allowed)return json({error:'Onbekende aanvraag.'},404);
  if(request.method==='POST'&&!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON vereist.'},415);
  if(Number(request.headers.get('Content-Length')||0)>4096)return json({error:'Aanvraag te groot.'},413);
  // Forward only explicit fixed-task operations after authentication.
  return env.REDACTION.get(env.REDACTION.idFromName('kranten')).fetch(new Request('https://queue'+path,request));
 }
};
export class RedactionQueue extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;}
 async fetch(request){
  return this.ctx.blockConcurrencyWhile(async()=>{
    const path=new URL(request.url).pathname;
    const store=this.ctx.storage;
    const now=Date.now();
    let job=await store.get('job')||{state:'idle',message:'Geen redactieronde actief.'};
    const heartbeat=await store.get('heartbeat')||0;
    if(['running','queued'].includes(job.state)&&now-job.requestedAt>3600000){job={...job,state:'error',message:'Aanvraag verlopen. Start een nieuwe redactieronde.'};await store.put('job',job);}
    if(path==='/rewrite'){
      if(!['queued','running'].includes(job.state)){
        const last=await store.get('lastRequest')||0;
        if(now-last<60000)return json({error:'Wacht even voordat je opnieuw herschrijft.'},429);
        job={id:crypto.randomUUID(),state:'queued',message:now-heartbeat<60000?'Verzoek ontvangen; jouw Mac start de redactieronde.':'Verzoek ontvangen; wacht op de Mac van Ed.',requestedAt:now};
        await store.put({job,lastRequest:now});
      }
      return json({...job,macOnline:now-heartbeat<60000},202);
    }
    if(path==='/status')return json({...job,macOnline:now-heartbeat<60000});
    if(path==='/agent/poll'){
      await store.put('heartbeat',now);
      if(job.state==='queued'){
        job={...job,state:'running',message:'Redactieronde op de Mac gestart.',startedAt:now};await store.put('job',job);
        return json({job});
      }
      // A single Mac executor recovers a claimed job after a restart.
      return json({job:job.state==='running'?job:null});
    }
    if(path==='/agent/update'){
      const payload=await request.json();
      if(payload.id!==job.id)return json({error:'Aanvraag gewijzigd.'},409);
      if(!['running','done','error'].includes(payload.state)||typeof payload.message!=='string')return json({error:'Ongeldige status.'},400);
      if(['done','error'].includes(job.state))return json({ok:true});
      job={...job,state:payload.state,message:payload.message.slice(0,600),updatedAt:now};
      if(['done','error'].includes(job.state))job.finishedAt=now;
      await store.put({job,heartbeat:now});return json({ok:true});
    }
    return json({},404);
  });
 }
}
