/* Shared MOS/MIX navigation and presentation; existing products retain their own data/renderers. */
(function(){'use strict';
const products=[
 {id:'maps',name:'Uren & dagdelen',src:'mosmix-werkstation.html',description:'Zes kaarten en één grote interactieve kaart'},
 {id:'mini',name:'9-daagse minikaarten',src:'mosmix_9dag.html',description:'Negen dagen temperatuur en wind in één overzicht'},
 {id:'overview',name:'Totaaloverzicht',src:'mosmix_composiet.html',description:'Weerbeeld en verwachtingen per dag'},
 {id:'elements',name:'Alle elementen',src:'mosmix_kaart.html',description:'Temperatuur, neerslag, wind, zon en overige parameters'},
 {id:'rain',name:'Neerslagkansen',src:'mosmix_neerslagkans.html',description:'Kansen op neerslag per drempel en tijdvak'},
 {id:'trend',name:'Trend per plaats',src:'grafiek_trend.html',description:'De ontwikkeling van opeenvolgende verwachtingen'},
 {id:'verification',name:'Verificatie',src:'verificatie.html',description:'Verwachtingen vergelijken met waarnemingen'},
 {id:'europe',name:'Europa',src:'mosmix_composiet_eu.html',description:'Regionale overzichten voor vijftien gebieden'}
];
const mini=[['mosmix_9dag.html','Maximumtemperatuur'],['mosmix_9dag_tn.html','Minimumtemperatuur'],['mosmix_9dag_wind.html','Wind'],['mosmix_9dag_dagdeel.html','Temperatuur per dagdeel'],['mosmix_9dag_dagdeel_wind.html','Wind per dagdeel']];
const page=location.pathname.split('/').pop().replace(/\.html$/,'');
const workstation=page==='mosmix-werkstation';
const params=new URLSearchParams(location.search);
let embedded=params.get('mosmix_embed')==='1';
try{embedded=embedded||Boolean(window.frameElement&&parent.document.body.dataset.mosmixEmbedded==='true');}catch{}
document.body.classList.add('mosmix-suite');document.body.dataset.mosmixEmbedded=String(embedded);
function theme(){try{document.documentElement.dataset.theme=localStorage.getItem('weerlab_theme')||'light';}catch{}}
theme();window.addEventListener('storage',e=>{if(e.key==='weerlab_theme')theme();});
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;}
const nav=node('nav','mos-suite-nav');nav.setAttribute('aria-label','Alle MOS/MIX-producten');
const current=workstation?'maps':page.startsWith('mosmix_9dag')?'mini':page==='mosmix_composiet_eu'?'europe':page.startsWith('mosmix_composiet')||page.startsWith('mosmix_eigen')?'overview':page==='grafiek_trend'?'trend':page==='verificatie'?'verification':page==='mosmix_neerslagkans'?'rain':'elements';
for(const p of products){const a=node('a','mos-suite-link',p.name);a.href=p.src;a.dataset.product=p.id;if(p.id===current)a.setAttribute('aria-current','page');nav.append(a);}
if(!embedded){
 if(workstation)document.querySelector('header').after(nav);
 else{const banner=node('div','mos-suite-banner');banner.append(node('p','mos-suite-eyebrow','WEERLAB · DWD MOS/MIX'),node(document.querySelector('h1')?'p':'h1','mos-suite-title',products.find(p=>p.id===current).name),node('p','mos-suite-intro',products.find(p=>p.id===current).description));document.body.prepend(banner,nav);}
}
if(!workstation){
 if(current==='mini'&&!embedded){const controls=node('nav','mos-suite-mini');controls.setAttribute('aria-label','Soort minikaart');for(const[src,label]of mini){const a=node('a','mos-suite-link',label);a.href=src;if(src.replace('.html','')===page)a.setAttribute('aria-current','page');controls.append(a);}nav.after(controls);}
 return;
}
document.querySelector('h1').textContent='Wind en weer in ontwikkeling';
document.querySelector('header>a').textContent='9-daagse minikaarten ↗';document.querySelector('header>a').href='index.html#mosmix-minikaarten';
const content=node('section','mos-suite-product');content.hidden=true;content.setAttribute('aria-label','Geselecteerd MOS/MIX-product');
const heading=node('div','mos-suite-product-heading'),text=node('div'),title=node('h2'),description=node('p'),standalone=node('a','mos-suite-standalone','Afzonderlijk openen ↗');standalone.target='_top';text.append(title,description);heading.append(text,standalone);
const controls=node('div','mos-suite-product-controls');const frame=node('iframe','mos-suite-frame');frame.setAttribute('allow','downloads');frame.setAttribute('loading','lazy');content.append(heading,controls,frame);document.querySelector('main').before(content);
let selected='maps';
function loadFrame(src,label){const url=new URL(src,location.href);url.searchParams.set('mosmix_embed','1');url.searchParams.set('v','20261021-suite1');if(frame.getAttribute('src')!==url.href)frame.src=url.href;frame.title='MOS/MIX · '+label;}
function activate(id,update=true){const product=products.find(p=>p.id===id)||products[0];selected=product.id;const maps=selected==='maps';content.hidden=maps;if(maps&&frame.hasAttribute('src'))frame.removeAttribute('src');document.querySelector('main').hidden=!maps;document.getElementById('source-status').hidden=!maps;document.querySelector('.sections').hidden=!maps;document.querySelector('header h1').textContent=maps?'Wind en weer in ontwikkeling':product.name;document.querySelectorAll('.mos-suite-nav [data-product]').forEach(a=>{if(a.dataset.product===selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});if(!maps){title.textContent=product.name;description.textContent=product.description;standalone.href='index.html#mosmix-'+({mini:'minikaarten',overview:'overzicht',elements:'parameter',rain:'neerslagkans',trend:'trend',verification:'verificatie',europe:'eu'}[selected]);controls.replaceChildren();loadFrame(product.src,product.name);if(selected==='mini'){for(const[src,label]of mini){const b=node('button','',label);b.type='button';b.setAttribute('aria-pressed',String(src===mini[0][0]));b.onclick=()=>{controls.querySelectorAll('button').forEach(other=>other.setAttribute('aria-pressed',String(other===b)));loadFrame(src,label);};controls.append(b);}}else if(selected==='overview'||selected==='elements'){const label=node('label','','Gebied'),select=node('select');for(const[value,name]of [['nl','Nederland'],['be','België']]){const option=node('option','',name);option.value=value;select.append(option);}select.onchange=()=>loadFrame(selected==='overview'?(select.value==='be'?'mosmix_composiet_be.html':'mosmix_composiet.html'):(select.value==='be'?'mosmix_kaart_be.html':'mosmix_kaart.html'),product.name+' · '+select.selectedOptions[0].textContent);label.append(select);controls.append(label);}}
 if(update){const url=new URL(location.href);if(maps)url.searchParams.delete('product');else url.searchParams.set('product',selected);history.replaceState(null,'',url);}
 window.dispatchEvent(new CustomEvent('mosmix-product-change',{detail:{product:selected}}));
}
nav.addEventListener('click',event=>{const a=event.target.closest('[data-product]');if(!a||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();activate(a.dataset.product);});
window.addEventListener('popstate',()=>activate(new URLSearchParams(location.search).get('product')||'maps',false));
activate(params.get('product')||'maps',false);
})();
