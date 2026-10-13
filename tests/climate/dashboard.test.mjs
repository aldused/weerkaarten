// DOM contract tests without a browser, using the real published datasets.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../');
const base=(await fs.stat(path.join(root,'beta-klimaat')).catch(()=>null))?root:path.resolve(root,'../');
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.attrs={};this.handlers={};this.style={setProperty(){}};this.clientWidth=1180;this._text='';this.value='';}
 set textContent(t){this._text=String(t);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')this.id=String(v);}getAttribute(k){return this.attrs[k];}
 append(...nodes){for(const e of nodes)e.parent=this;this.children.push(...nodes);}prepend(...nodes){for(const e of nodes)e.parent=this;this.children.unshift(...nodes);}replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
 addEventListener(k,f){this.handlers[k]=f;}getBoundingClientRect(){return {left:0,width:1180};}
 setPointerCapture(){}click(){this.onclick?.();}get firstChild(){return this.children[0];}
 insertBefore(node,before){node.parent=this;this.children.splice(Math.max(0,this.children.indexOf(before)),0,node);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);}
 querySelectorAll(selector){return [this,...this.children.flatMap(e=>e.querySelectorAll('*'))].filter(e=>selector==='*'||selector==='[visibility]'&&e.attrs.visibility);}
 cloneNode(){const e=new Element(this.tagName);e.attrs={...this.attrs};e._text=this._text;e.append(...this.children.map(c=>c.cloneNode()));return e;}
}
const blobs=[];const createURL=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{blobs.push(blob);return createURL(blob);};
const escape=text=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
globalThis.XMLSerializer=class{serializeToString(e){return `<${e.tagName} ${Object.entries(e.attrs).map(([k,v])=>k+'="'+escape(v)+'"').join(' ')}>${escape(e._text)}${e.children.map(c=>this.serializeToString(c)).join('')}</${e.tagName}>`;}};
async function test(page,name,width=1180){
 const text=await fs.readFile(path.join(base,'beta-klimaat',name),'utf8');const els=new Map([...text.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element('div')]));
 for(const [id,value]of Object.entries({'episode-index':'roni','episode-align':'start','episode-sort':'strength','extreme-sort':'year','trend-month':'0'}))if(els.has(id))els.get(id).value=value;
 for(const e of els.values())e.clientWidth=width;
 globalThis.document={body:{dataset:{page}},getElementById:id=>{assert(els.has(id),'Missing HTML element '+id);return els.get(id);},createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),createTextNode:text=>{const e=new Element('#text');e.textContent=text;return e;}};
 globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await fs.readFile(path.join(base,'beta-klimaat',url),'utf8'))});
 await import(path.join(base,'beta-klimaat/assets/dashboard.mjs')+'?page='+page+'&width='+width);
 await new Promise(resolve=>setTimeout(resolve,100));
 assert(!els.get('warnings').textContent.includes('niet volledig'),'Dashboard boot failed: '+els.get('warnings').textContent);
 const walk=e=>[e,...e.children.flatMap(walk)];
 const paths=()=>[...els.values()].flatMap(walk).filter(e=>e.tagName==='path');
 assert(paths().length>0||page==='methods','No chart paths');
 for(const e of paths())assert(!/NaN|undefined|Infinity/.test(e.attrs.d),'Invalid SVG coordinates');
 if(page==='enso'){
  const r=JSON.parse(await fs.readFile(path.join(base,'beta-klimaat/data/roni.json'),'utf8')),a=JSON.parse(await fs.readFile(path.join(base,'beta-klimaat/data/advisory.json'),'utf8'));
  assert(els.get('metrics').textContent.includes(new Intl.NumberFormat('nl-NL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(r.rows.at(-1).value)));assert(els.get('metrics').textContent.includes(a.value.phase));
  els.get('episode-index').onchange({target:{value:'oni'}});const o=JSON.parse(await fs.readFile(path.join(base,'beta-klimaat/data/oni.json'),'utf8'));for(const ep of o.episodes.filter(e=>e.ongoing))assert(!els.get('episode-ranking').textContent.includes(ep.start_period),'Ongoing episode leaked into definitive ranking');
  els.get('episode-sort').value='duration';els.get('episode-sort').onchange();assert(els.get('episode-ranking').textContent.includes('middenmaanden'));
  els.get('episode-align').onchange({target:{value:'peak'}});
  const button=els.get('index-switch').children.find(e=>e.textContent==='ONI');button.click();assert(els.get('enso-chart').textContent.includes('ONI'));
  let nodes=walk(els.get('enso-chart'));nodes.find(e=>e.tagName==='button'&&e.textContent==='CSV').click();const csv=await blobs.at(-1).text();assert(csv.includes('ONI'));assert(csv.includes(String(o.rows.at(-1).value)));assert(csv.includes('NOAA CPC'));
  nodes.find(e=>e.tagName==='button'&&e.textContent==='SVG').click();const exported=await blobs.at(-1).text();assert(exported.includes('xmlns="http://www.w3.org/2000/svg"'));assert(exported.includes('ONI'));assert(exported.includes('opgehaald'));assert(!/NaN|undefined/.test(exported));
  nodes.find(e=>e.tagName==='button'&&e.textContent==='Inzoomen').click();nodes=walk(els.get('enso-chart'));nodes.find(e=>e.tagName==='button'&&e.textContent==='Herstel zoom').click();
 }
 if(page==='ice'){
  const n=JSON.parse(await fs.readFile(path.join(base,'beta-klimaat/data/north.json'),'utf8'));assert(els.get('metrics').textContent.includes(new Intl.NumberFormat('nl-NL',{minimumFractionDigits:3,maximumFractionDigits:3}).format(n.analysis.latest.value)));els.get('hemisphere').children.find(e=>e.textContent==='Zuidpool').click();
  assert(els.get('region-title').textContent==='Zuidpool');const south=JSON.parse(await fs.readFile(path.join(base,'beta-klimaat/data/south.json'),'utf8'));if(south.analysis.extremes.some(e=>!e.complete))assert(els.get('extremes-table').textContent.includes('Voorlopig/onvolledig'));
  const choices=els.get('year-select').children;for(let i=0;i<7;i++){const input=choices[i].children[0];input.checked=true;input.onchange();}assert(choices.filter(e=>e.children[0].checked).length===5);
  els.get('monthly-view').children.find(e=>e.textContent==='Afwijking').click();assert(els.get('monthly-chart').textContent.includes('Afwijking'));
  els.get('trend-month').value='9';els.get('trend-month').onchange();assert(els.get('trend-summary').textContent.includes('decennium'));
 }
 for(const e of paths())assert(!/NaN|undefined|Infinity/.test(e.attrs.d),'Invalid SVG after controls');
 console.log('PASS',page,width,'px · data, controls and SVG geometry');
}
await test('enso','index.html');await test('ice','zeeijs.html');await test('methods','bronnen.html');await test('enso','index.html',390);await test('ice','zeeijs.html',390);
