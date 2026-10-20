// Same Access application and RS256 verification as the existing redaction Worker.
let certificates;
const decode = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
export async function identity(request, env) {
  try {
    const token=request.headers.get('Cf-Access-Jwt-Assertion');
    if(!token || token.length>20000) return null;
    const parts=token.split('.'); if(parts.length!==3)return null;
    const header=JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
    const now=Date.now()/1000;
    if(header.alg!=='RS256'||claims.iss!==env.ACCESS_TEAM||claims.type!=='app'||!Array.isArray(claims.aud)||!claims.aud.includes(env.ACCESS_AUD)||!Number.isFinite(claims.exp)||claims.exp<=now||(claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>now))||typeof claims.sub!=='string'||!claims.sub||typeof claims.email!=='string'||!claims.email.includes('@'))return null;
    if(!certificates||certificates.issuer!==env.ACCESS_TEAM||certificates.until<Date.now()||!certificates.keys.some(k=>k.kid===header.kid)) {
      const response=await fetch(env.ACCESS_TEAM+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(8000)});
      if(!response.ok)return null;
      certificates={...await response.json(),issuer:env.ACCESS_TEAM,until:Date.now()+300000};
    }
    const jwk=certificates.keys.find(k=>k.kid===header.kid);if(!jwk)return null;
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))return null;
    return {subject:claims.iss+'|'+claims.sub,email:claims.email.trim().toLowerCase()};
  } catch { return null; }
}
