// Repeatable load measurement in a real, foreground Chrome page.
// A background or hidden tab throttles both animation frames and worker CPU,
// which hides the real cost; headless Chrome renders a visible viewport.
// Usage: node tests/perf-browser.mjs [--runs 3] [--url http://…] [--label naam]
//        [--width 1440] [--height 900] [--throttle 20] [--latency 40] [--json out.json]
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((list, value, i, all) =>
  value.startsWith('--') ? [...list, [value.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : 'true']] : list, []));
const RUNS = Number(args.runs || 3);
const URL_BASE = args.url || 'http://localhost:8787/ecmwf_weerradar/index.html?profile=1';
const WIDTH = Number(args.width || 1440), HEIGHT = Number(args.height || 900);
const MBIT = args.throttle ? Number(args.throttle) : 0, LATENCY = Number(args.latency || 0);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(args.port || 9333);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const profile = await mkdtemp(join(tmpdir(), 'weerlab-perf-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--hide-scrollbars',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, `--window-size=${WIDTH},${HEIGHT}`,
  'about:blank',
], {stdio: 'ignore'});
process.on('exit', () => chrome.kill());

let version;
for (let i = 0; i < 60 && !version; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); }
}
if (!version) { chrome.kill(); throw new Error('Chrome niet bereikbaar'); }

const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const waiting = new Map(), listeners = new Set();
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    const pending = waiting.get(message.id); waiting.delete(message.id);
    message.error ? pending?.reject(new Error(message.error.message)) : pending?.resolve(message.result);
  } else for (const listener of [...listeners]) listener(message);
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId; waiting.set(id, {resolve, reject});
  socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
});
const once = (method, predicate = () => true) => new Promise(resolve => {
  const listener = message => { if (message.method === method && predicate(message)) { listeners.delete(listener); resolve(message.params); } };
  listeners.add(listener);
});

const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
const call = (method, params) => send(method, params, sessionId);
await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
await call('Emulation.setDeviceMetricsOverride', {width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false});
if (MBIT) await call('Network.emulateNetworkConditions', {offline: false, latency: LATENCY, downloadThroughput: MBIT * 1e6 / 8, uploadThroughput: MBIT * 1e6 / 8});

const bootstrap = `
  try{sessionStorage.setItem('weerlab-europakaart-access-v1','1');}catch{}
  window.__long=[];
  try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__long.push(Math.round(e.duration));}).observe({type:'longtask',buffered:true});}catch{}
`;
await call('Page.addScriptToEvaluateOnNewDocument', {source: bootstrap});

const evaluate = async expression => {
  const {result, exceptionDetails} = await call('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
  if (exceptionDetails) throw new Error(exceptionDetails.text + ' ' + (exceptionDetails.exception?.description || ''));
  return result.value;
};

const results = [];
for (let run = 0; run < RUNS; run++) {
  const transfers = new Map();
  const collect = message => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Network.responseReceived') transfers.set(message.params.requestId, {url: message.params.response.url, bytes: 0, fromCache: message.params.response.fromDiskCache});
    if (message.method === 'Network.loadingFinished') { const entry = transfers.get(message.params.requestId); if (entry) entry.bytes = message.params.encodedDataLength; }
  };
  listeners.add(collect);
  const warm = args.scenario === 'repeat' && run > 0;
  if (!warm) { await call('Network.clearBrowserCache'); await call('Network.clearBrowserCookies'); }
  await call('Page.navigate', {url: 'about:blank'});
  await sleep(150);
  if (!warm) await call('Storage.clearDataForOrigin', {origin: new URL(URL_BASE).origin, storageTypes: 'all'});
  const started = Date.now();
  await call('Page.navigate', {url: URL_BASE});
  await once('Page.loadEventFired');
  const markers = await evaluate(`(async()=>{
    const waitFor=async(test,limit=40000)=>{const t=performance.now();while(!test()&&performance.now()-t<limit)await new Promise(r=>setTimeout(r,8));return performance.now()-t;};
    // The map may run inside the Weerlab shell; measure the frame it lives in.
    const shellStart=performance.now();
    await waitFor(()=>document.getElementById('app')||document.querySelector('#product-frame')?.contentDocument?.getElementById('app'),15000);
    const host=document.getElementById('app')?document:document.querySelector('#product-frame').contentDocument;
    const inShell=host!==document;
    const app=host.getElementById('app');const t0=performance.now();
    while(!app.dataset.firstWeatherMs&&!app.dataset.lastLoadError&&performance.now()-t0<60000)await new Promise(r=>setTimeout(r,15));
    await new Promise(r=>setTimeout(r,250));
    const res=[...performance.getEntriesByType('resource'),...(inShell?host.defaultView.performance.getEntriesByType('resource'):[])];
    const paint=performance.getEntriesByType('paint').find(p=>p.name==='first-contentful-paint');
    const profile=inShell?host.defaultView.weerlabProfile:globalThis.weerlabProfile;
    const samples=profile?profile.samples():[];
    const perVariable={};
    for(const s of samples){(perVariable[s.v]??={n:0,render:0});perVariable[s.v].n++;perVariable[s.v].render+=s.render;}
    for(const k in perVariable)perVariable[k].avg=Math.round(perVariable[k].render/perVariable[k].n);
    return {
      firstPaint:paint?Math.round(paint.startTime):null,
      baseMap:(()=>{const t=res.filter(r=>r.name.includes('arcgisonline')).map(r=>r.responseEnd);return t.length?Math.round(Math.min(...t)):null;})(),
      baseMapComplete:(()=>{const t=res.filter(r=>r.name.includes('arcgisonline')).map(r=>r.responseEnd);return t.length?Math.round(Math.max(...t)):null;})(),
      module:+app.dataset.moduleReadyMs||null,metadata:+app.dataset.metadataReadyMs||null,
      firstLayer:+app.dataset.firstVisibleWeatherMs||null,complete:+app.dataset.firstWeatherMs||null,
      status:app.dataset.frameStatus,error:app.dataset.lastLoadError||null,
      requests:res.length,transferKB:Math.round(res.reduce((s,r)=>s+(r.transferSize||0),0)/1024),
      dataRequests:res.filter(r=>r.name.includes('workers.dev')).length,
      dataKB:Math.round(res.filter(r=>r.name.includes('workers.dev')).reduce((s,r)=>s+(r.transferSize||0),0)/1024),
      longTasks:(window.__long||[]).filter(d=>d>=50).length,longestTask:Math.max(0,...(window.__long||[])),
      moduleAbsolute:inShell&&app.dataset.moduleReadyMs?Math.round(Number(app.dataset.moduleReadyMs)+(host.defaultView.performance.timeOrigin-performance.timeOrigin)):null,
      stats:profile?profile.stats():null,perVariable,inShell,
      shellToMapMs:Math.round(t0-shellStart),
      memoryMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null,
      stress:${args.stress ? `await (async()=>{const host3=document.getElementById("app")?document:document.querySelector("#product-frame").contentDocument;const app3=host3.getElementById("app");const profile3=host3.defaultView.weerlabProfile;const samples=[];const steps=${Number(args.stress)};for(let i=0;i<steps;i++){const button=i%8===7?"previous":"next";const before=app3.dataset.validTime;const started=performance.now();host3.getElementById(button).click();await waitFor(()=>app3.dataset.frameStatus==="ready"&&app3.dataset.validTime!==before,20000);samples.push(Math.round(performance.now()-started));await new Promise(r=>setTimeout(r,120));}samples.sort((a,b)=>a-b);return {stappen:steps,mediaan:samples[Math.floor(samples.length/2)],p90:samples[Math.floor(samples.length*0.9)],max:samples.at(-1),heapMB:host3.defaultView.performance.memory?Math.round(host3.defaultView.performance.memory.usedJSHeapSize/1048576):null,stats:profile3?profile3.stats():null};})()` : 'null'},
      interactions:${args.interactions ? 'await (async()=>{const out={};const app=(document.getElementById("app")||document.querySelector("#product-frame").contentDocument.getElementById("app"));const host2=document.getElementById("app")?document:document.querySelector("#product-frame").contentDocument;const press=async(id)=>{const before=app.dataset.validTime;const started=performance.now();host2.getElementById(id).click();await waitFor(()=>app.dataset.frameStatus==="ready"&&app.dataset.validTime!==before);return Math.round(performance.now()-started);};const mode=async(name)=>{const started=performance.now();host2.querySelector(`[data-mode=${name}]`).click();await waitFor(()=>app.dataset.frameStatus==="ready"&&host2.querySelector(`[data-mode=${name}]`).getAttribute("aria-pressed")==="true");return Math.round(performance.now()-started);};await new Promise(r=>setTimeout(r,900));out.volgende=await press("next");await new Promise(r=>setTimeout(r,700));out.volgende2=await press("next");await new Promise(r=>setTimeout(r,700));out.terug=await press("previous");await new Promise(r=>setTimeout(r,500));out.temperatuur=await mode("temperature");await new Promise(r=>setTimeout(r,500));out.weerTerug=await mode("weather");await new Promise(r=>setTimeout(r,500));out.wind=await mode("wind");return out;})()' : 'null'},
      biggest:res.map(r=>({u:r.name.replace(location.origin,'').slice(0,72),kb:Math.round((r.transferSize||0)/1024),ms:Math.round(r.duration),start:Math.round(r.startTime)})).sort((a,b)=>b.kb-a.kb).slice(0,14),
      byKind:res.reduce((m,r)=>{const k=r.name.includes('arcgisonline')?'esri-tegels':r.name.includes('workers.dev')?'weerdata':r.name.includes('/assets/map-details/')?'kaartdetails':r.name.includes('/assets/')?'app-assets':'overig';(m[k]??={n:0,kb:0});m[k].n++;m[k].kb+=Math.round((r.transferSize||0)/1024);return m;},{}),
    };
  })()`);
  if (args.screenshot && run === RUNS - 1) {
    // Proof that the faster path draws the same map, not a simplified one.
    await evaluate('new Promise(r=>setTimeout(r,1500))');
    const shot = await call('Page.captureScreenshot', {format: 'png'});
    await writeFile(args.screenshot, Buffer.from(shot.data, 'base64'));
    console.log(`schermafdruk: ${args.screenshot}`);
  }
  listeners.delete(collect);
  const network = [...transfers.values()];
  results.push({...markers, wallMs: Date.now() - started,
    networkRequests: network.length, networkKB: Math.round(network.reduce((s, r) => s + r.bytes, 0) / 1024)});
  console.log(`run ${run + 1}: eerste laag ${markers.firstLayer} ms, compleet ${markers.complete} ms, ` +
    `${markers.requests} verzoeken / ${markers.transferKB} kB, langste taak ${markers.longestTask} ms` +
    (markers.error ? ` FOUT: ${markers.error}` : '') +
    (markers.interactions ? `\n   interacties: ${Object.entries(markers.interactions).map(([k, v]) => `${k} ${v} ms`).join(', ')}` : ''));
}

const median = key => {
  const values = results.map(r => r[key]).filter(v => typeof v === 'number').sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : null;
};
const summary = {
  label: args.label || 'meting', url: URL_BASE, runs: RUNS, viewport: [WIDTH, HEIGHT],
  throttle: MBIT ? `${MBIT} Mbit/s +${LATENCY} ms` : 'geen',
  median: Object.fromEntries(['firstPaint', 'baseMap', 'baseMapComplete', 'module', 'metadata', 'firstLayer', 'complete', 'requests', 'transferKB',
    'dataRequests', 'dataKB', 'longTasks', 'longestTask', 'memoryMB'].map(k => [k, median(k)])),
  medianInteractions: results[0]?.interactions ? Object.fromEntries(Object.keys(results[0].interactions).map(key => {
    const values = results.map(r => r.interactions?.[key]).filter(Number.isFinite).sort((a, b) => a - b);
    return [key, values[Math.floor(values.length / 2)] ?? null];
  })) : null,
  runsDetail: results,
};
console.log('\nmediaan:', JSON.stringify(summary.median));
if (summary.medianInteractions) console.log('mediaan interacties:', JSON.stringify(summary.medianInteractions));
if (args.json) await writeFile(args.json, JSON.stringify(summary, null, 1));
socket.close(); chrome.kill();
