const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'pluim_ens6_nav.js'),'utf8');
function boot(mode,pathname='/pluim_6_plus',search='?run=20261014T00&station=De+Bilt&lat=52.101&lon=5.18'){
 const messages=[],assigned=[],opened=[];
 function element(){return {children:[],attrs:{},listeners:{},appendChild(e){this.children.push(e)},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,f){this.listeners[k]=f},querySelector(){return null},remove(){}};}
 const nav=element(),document={readyState:'complete',head:element(),body:element(),createElement:element,querySelector:s=>s==='.wb-nav'?nav:null};
 const parent={document:{getElementById:()=>mode==='shell'?{}:null},postMessage:m=>messages.push(m)};
 if(mode==='host')parent.openPluim=k=>opened.push(k);
 const window={parent};window.self=window;window.top=mode==='standalone'?window:parent;
 const location={pathname,search,origin:'https://weerlab.nl',assign:url=>assigned.push(url)};
 vm.runInNewContext(source,{document,window,location,URLSearchParams});
 const links=nav.children[0].children;
 return {links,messages,assigned,opened};
}
for(const mode of ['shell','host','standalone']){
 const p=boot(mode);assert.equal(p.links.length,10);
 assert.equal(p.links.filter(l=>l.attrs['aria-current']==='page')[0].textContent,'ECMWF uitgebreid','extensionless URL must activate the correct tab');
 for(const link of p.links.filter(l=>l.listeners.click))link.listeners.click({preventDefault(){}});
 assert.equal((mode==='shell'?p.messages:mode==='host'?p.opened:p.assigned).length,9,'every other plume must be reachable');
 if(mode==='shell')assert(p.messages.every(m=>m.type==='weerlab-navigate'&&m.hash.startsWith('#pluim')));
 if(mode==='standalone')for(const url of p.assigned){const u=new URL(url,'https://weerlab.nl');assert.equal(u.searchParams.get('run'),null);assert.equal(u.searchParams.get('station'),'De Bilt');}
}
for(const view of ['weer','aifs','wind','winter','wolken','mist']){
 const p=boot('shell','/pluim_modelvergelijking','?view='+view);assert.equal(p.links.filter(l=>l.attrs['aria-current']==='page').length,1);
}
const css=fs.readFileSync(path.join(root,'pluim-presentatie.css'),'utf8');assert(!/body\.plume-embedded[^\{]*(?:pluim-wissel|plume-tabs)/.test(css),'directly embedded pages must retain navigation');
console.log('Pluimnavigatie: alle 10 tabs vanuit directe menu-pagina, host en losse pagina; correcte actieve tab en plaatsbehoud.');
