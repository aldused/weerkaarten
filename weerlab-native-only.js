/* Open-Meteo is no longer a network source. Preserve legacy URLs only as input aliases. */
(function(g){'use strict';if(g.__weerlabNativeOnly)return;g.__weerlabNativeOnly=true;
const ROOT='https://om.weerlab.nl',nativeFetch=g.fetch?.bind(g);
function target(input){const raw=typeof input==='string'?input:input.url||String(input),u=new URL(raw,g.location?.href||'https://weerlab.nl/');if(u.hostname!=='open-meteo.com'&&!u.hostname.endsWith('.open-meteo.com'))return null;
 if(u.pathname.includes('/data/ecmwf_ifs025_ensemble/static/meta.json'))return ROOT+'/native-ecmwf-meta';
 const p=u.pathname.includes('/ensemble')?'ensemble':u.pathname.endsWith('/forecast')?'forecast':null;
 if(!p)throw Error('Deze Open-Meteo-bron is uitgeschakeld; nog geen eigen rechtstreekse bron beschikbaar.');
 u.searchParams.delete('apikey');return ROOT+'/om/'+p+'?'+u.searchParams;
}
if(nativeFetch)g.fetch=function(input,options){try{const to=target(input);return nativeFetch(to?(typeof input==='string'||input instanceof URL?to:new Request(to,input)):input,options);}catch(e){return Promise.reject(e);}};
if(g.XMLHttpRequest){const open=g.XMLHttpRequest.prototype.open;g.XMLHttpRequest.prototype.open=function(method,url,...rest){return open.call(this,method,target(String(url))||url,...rest);};}
})(globalThis);
