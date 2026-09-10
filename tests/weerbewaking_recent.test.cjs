const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'weerbewaking_recent.js'),'utf8');
function setup(seed={},query='',fail=false){
 const data=new Map(Object.entries(seed)),events={};
 const doc={readyState:'loading',addEventListener(n,f){(events[n]??=[]).push(f)},getElementById(){return null}};
 const storage={getItem:k=>data.get(k)??null,setItem(k,v){if(fail)throw Error('quota');data.set(k,v)},key:i=>[...data.keys()][i],get length(){return data.size}};
 const c={location:{pathname:'/weerbewaking_rr.html',search:query,hash:''},history:{state:null,replaceState(state,title,url){c.lastURL=url}},document:doc,localStorage:storage,URLSearchParams,Date,Set,Number,JSON,setTimeout:()=>1,clearTimeout(){},addEventListener(){}};c.window=c;
 vm.runInNewContext(source,c);return {api:c.WBRecent,data,events,dirty(){events.input[0]({target:{closest:()=>true}})},init(){events.DOMContentLoaded[0]()}};
}
const key=d=>'wb_rr_draft_2026-09-'+d, draft=(ts,text)=>({__ts:ts,vandaag:text});
const env=setup();
for(const [day,ts,text] of [['08',1,'een'],['09',2,'twee'],['10',3,'drie']]){env.dirty();env.api.capture(key(day),draft(ts,text))}
assert.deepEqual(JSON.parse(JSON.stringify(env.api.list())).map(e=>e.data.vandaag),['drie','twee']);
env.dirty();env.api.capture(key('10'),draft(4,'drie bijgewerkt'));
assert.equal(env.api.list().length,2);assert.equal(env.api.list()[0].data.vandaag,'drie bijgewerkt');
// Auto-generated data without user edits does not replace recent written forms.
env.api.capture(key('11'),draft(5,'automatisch'));assert.equal(env.api.list()[0].key,key('10'));
// Another editor has its own two slots.
env.dirty();env.api.capture('wb_fey_draft_2026-09-10',draft(6,'wedstrijd'));assert.equal(env.api.list().length,3);
// Archive restoration happens before the page reads its daily draft.
const restored=setup(Object.fromEntries(env.data),'?datum=2026-09-10&wb-recent='+key('10'));
assert.equal(JSON.parse(restored.data.get(key('10'))).vandaag,'drie bijgewerkt');
assert.equal(restored.api.startDate('2026-09-11'),'2026-09-10');
assert.equal(setup({},'?datum=onzin').api.startDate('2026-09-11'),'2026-09-11');
// A more recent daily save from another tab wins over the archive snapshot.
const newer=setup({...Object.fromEntries(env.data),[key('10')]:JSON.stringify(draft(7,'nieuwste'))},'?wb-recent='+key('10'));
assert.equal(JSON.parse(newer.data.get(key('10'))).vandaag,'nieuwste');
assert.doesNotThrow(()=>setup({'wb_recent_forms_v1':'{"bad":true}'}).api.list());
assert.equal(setup({'wb_recent_forms_v1':'[{"key":42,"data":{}},null]'}).api.list().length,0);
const full=setup({},'',true);full.dirty();assert.doesNotThrow(()=>full.api.capture(key('10'),draft(1,'bewaren')));
// Every menu destination, including the hourly WBGT route, gets the same navigation.
const menu=fs.readFileSync(path.join(root,'weerbewaking.html'),'utf8');
const pages=[...menu.matchAll(/href="([^"?]+\.html)[^"]*" data-route=/g)].map(m=>m[1]);pages.push('weerbewaking_wbgt_uurlijks.html');
for(const file of pages){const html=fs.readFileSync(path.join(root,file),'utf8');assert.match(html,/weerbewaking_return\.js/);assert.match(html,/weerbewaking_workspace\.css/)}
for(const file of ['weerbewaking_rijnmond.html','weerbewaking_uurlijks.html','weerbewaking_ridderkerk_rhoon_dekuip.html','weerbewaking_gladheid.html','weerbewaking_rr.html','weerbewaking_fey.html','vlaggenweer.html']){
 const html=fs.readFileSync(path.join(root,file),'utf8');assert.match(html,/WBRecent.capture\(saveKey\(\),d\)/);
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){if(m[1].trim())new vm.Script(m[1],{filename:file})}
}
console.log('PASS: 2 distinct forms per editor, updates, no automatic eviction, restoration, newer saves, malformed/full storage, all 14 menu routes, 7 editor scripts.');
// Navigation uses the same route standalone, embedded, and with an unavailable parent.
const backSource=fs.readFileSync(path.join(root,'weerbewaking_return.js'),'utf8');
for(const mode of ['standalone','embedded','fallback']){
 const calls=[],c={document:{readyState:'loading',addEventListener(){}},location:{assign:url=>calls.push(url),replace:url=>calls.push(url)},WBRecent:{flush:()=>calls.push('saved')}};
 c.window=c;c.self=c;c.top=mode==='standalone'?c:{};c.parent=mode==='embedded'?{openWeerbewakingSubpage:route=>calls.push(route),history:{replaceState:(a,b,url)=>calls.push(url)}}:{};
 vm.runInNewContext(backSource,c);c.terugNaarWeerbewaking({preventDefault(){}});
 assert.deepEqual(calls,mode==='standalone'?['saved','index.html#weerbewaking']:mode==='embedded'?['saved','home','#weerbewaking']:['saved','weerbewaking.html']);
}
console.log('PASS: save before leaving, canonical overview route, embedded and standalone fallback.');
