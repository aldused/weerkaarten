import {DurableObject} from 'cloudflare:workers';
import {identity} from './auth.mjs';
import {emptyDashboard,validateDashboard,importDashboard,InputError} from './model.mjs';
import {catalog} from './catalog.mjs';
const catalogMap=new Map(catalog.map(p=>[p.id,p]));
export const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export default {async fetch(request,env) {
  try {
    const url=new URL(request.url), path=url.pathname.replace(/^\/api\/mijn-weerlab/,'');
    if(url.origin!==env.SITE_ORIGIN)return json({error:'Geen toegang.'},403);
    const person=await identity(request,env);if(!person)return json({error:'Je sessie is verlopen. Log opnieuw in.',code:'SESSION_EXPIRED'},401);
    if(!['GET','PUT','POST'].includes(request.method))return json({error:'Methode niet toegestaan.'},405);
    if(request.method!=='GET'&&(request.headers.get('Origin')!==env.SITE_ORIGIN||request.headers.get('X-Weerlab-Request')!=='1'))return json({error:'Geen toegang.'},403);
    if(request.method==='GET'&&path==='/catalog')return json({products:catalog});
    if(!((request.method==='GET'||request.method==='PUT')&&path==='/dashboard'||request.method==='POST'&&path==='/import'))return json({error:'Onbekende aanvraag.'},404);
    let body;
    if(request.method!=='GET'){
      if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON vereist.'},415);
      // Limit actual streamed bytes too, including chunked requests.
      const reader=request.body?.getReader();if(!reader)return json({error:'Lege aanvraag.'},400);
      let size=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();return json({error:'Bestand te groot.'},413);}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'Ongeldige JSON.'},400);}
    }
    // Only verified claims reach the private identity registry. Browser user_id is ignored.
    const registry=env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts-v1'));
    const response=await registry.fetch(new Request('https://internal/resolve',{method:'POST',body:JSON.stringify(person)}));
    if(!response.ok)return json({error:'Accountkoppeling kon niet veilig worden bevestigd.'},409);
    const {userId}=await response.json();
    return env.DASHBOARDS.get(env.DASHBOARDS.idFromName(userId)).fetch(new Request('https://internal'+path,{method:request.method,headers:{'X-User-Id':userId,'X-Expected-User':request.headers.get('X-Expected-User')||'','If-Match':request.headers.get('If-Match')||''},body:body===undefined?undefined:JSON.stringify(body)}));
  }catch{return json({error:'Opslag is tijdelijk niet bereikbaar. Probeer opnieuw.'},503);}
}};
export class Accounts extends DurableObject {
  async fetch(request){
    const person=await request.json();
    return this.ctx.storage.transaction(async tx=>{
      const bySubject=await tx.get('subject:'+person.subject),byEmail=await tx.get('email:'+person.email);
      // Never silently join two existing identities on an email change.
      if(bySubject&&byEmail&&bySubject!==byEmail)return json({error:'Identity conflict'},409);
      const userId=bySubject||byEmail||crypto.randomUUID();
      await tx.put({['subject:'+person.subject]:userId,['email:'+person.email]:userId});
      return json({userId});
    });
  }
}
export class Dashboard extends DurableObject {
  async fetch(request){
    const input=request.method==='GET'?undefined:await request.json();
    return this.ctx.storage.transaction(async tx=>{
      const current=await tx.get('dashboard')||emptyDashboard(),userId=request.headers.get('X-User-Id');
      if(request.method==='GET')return json({userId,dashboard:current});
      // Prevent a tab from writing A's draft into B's account after a browser account switch.
      if(request.headers.get('X-Expected-User')!==userId)return json({error:'Het ingelogde account is gewijzigd. Herlaad de pagina.',code:'ACCOUNT_CHANGED'},401);
      if(request.headers.get('If-Match')!==String(current.revision))return json({error:'Je dashboard is op een ander apparaat gewijzigd. Laad de nieuwste versie en pas je wijziging opnieuw toe.',code:'CONFLICT'},409);
      try{
        const body=input;let dashboard,skipped=0;
        if(new URL(request.url).pathname==='/import')({dashboard,skipped}=importDashboard(body,current,catalogMap));
        else dashboard=validateDashboard(body,catalogMap,current);
        await tx.put('dashboard',dashboard);
        return json({userId,dashboard,skipped});
      }catch(error){if(error instanceof InputError)return json({error:error.message},400);throw error;}
    });
  }
}
