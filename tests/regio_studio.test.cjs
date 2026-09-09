// Execute the real bundled React component and its callbacks without a browser
// or live requests. Fixtures exercise weather semantics, not just string anchors.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');

(async () => {
  const {createLandelijkeStudio} = await import(pathToFileURL(path.join(root, 'editor-src/landelijke-studio.js')));
  const {createWeatherIcon, WEATHER_ICON_SPECS, WEATHER_ICON_LABELS} = await import(pathToFileURL(path.join(root, 'editor-src/weather-icons.js')));
  const fakeElement = () => ({relList:{supports:()=>true},style:{},setAttribute(){},removeAttribute(){},appendChild(){},addEventListener(){}});
  const document = {createElement:fakeElement,createElementNS:fakeElement,documentElement:{style:{}},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
  const storage = {getItem:()=>null,setItem(){}};
  const alerts = [];
  const context = {console,document,localStorage:storage,sessionStorage:storage,location:{pathname:'/weerbewaking_regio_kaart.html',protocol:'http:',hostname:'localhost',href:'http://localhost/weerbewaking_regio_kaart.html'},navigator:{userAgent:'node'},setTimeout,clearTimeout,URL,fetch:()=>Promise.reject(new Error('offline fixture')),alert:m=>alerts.push(m),createLandelijkeStudio,createWeatherIcon,WEATHER_ICON_LABELS};
  context.window = context;
  context.addEventListener = context.removeEventListener = () => {};
  vm.createContext(context);
  let bundle = fs.readFileSync(path.join(root,'regio-editor-assets/weerbewaking_regio_kaart-DCFOt_3t.js'),'utf8').replace(/^import .*;\n/gm,'');
  bundle = bundle.slice(0,bundle.lastIndexOf('Cs.createRoot(')) + ';globalThis.editor={React:z,App:eh,Icon:Lt,labels:KA,stations:ce};';
  vm.runInContext(bundle,context);
  const {React,App,Icon,labels,stations} = context.editor;
  const app = {slots:[],cursor:0}, studio = {slots:[],cursor:0};
  let current=app, serial=0;
  const next = (kind,initial) => {
    const index=current.cursor++;
    if(!current.slots[index]) current.slots[index]={kind,value:initial()};
    assert.equal(current.slots[index].kind,kind,'Hook order changed');
    return current.slots[index];
  };
  React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current={
    useState(initial){const slot=next('state',()=>typeof initial==='function'?initial():initial);return [slot.value,v=>slot.value=typeof v==='function'?v(slot.value):v];},
    useEffect(fn,deps){const slot=next('effect',()=>({}));if(current===studio&&(!slot.deps||deps.some((v,i)=>v!==slot.deps[i]))) { slot.deps=deps;slot.pending=fn; }},
    useLayoutEffect(){next('layout',()=>null);},
    useRef(value){return next('ref',()=>({current:value})).value;},
    useCallback(fn){next('callback',()=>null);return fn;},
    useMemo(fn){next('memo',()=>null);return fn();},
    useId(){return `fixture-${serial++}`;},
  };
  const expand = node => {
    if(Array.isArray(node)) return node.map(expand);
    if(!React.isValidElement(node)) return node;
    if(typeof node.type==='function') return expand(node.type(node.props));
    return {...node,props:{...node.props,children:React.Children.toArray(node.props.children).map(expand)}};
  };
  let lastProps;
  const render = () => {
    let tree;
    for(let pass=0;pass<2;pass++) {
      current=app;app.cursor=0;const legacy=App();lastProps=legacy.props;
      current=studio;studio.cursor=0;tree=legacy.type(legacy.props);
      for(const slot of studio.slots) if(slot.pending){const effect=slot.pending;slot.pending=null;effect();}
    }
    return expand(tree);
  };
  const all = (node,predicate) => Array.isArray(node)?node.flatMap(n=>all(n,predicate)):!node||typeof node!=='object'?[]:[...(predicate(node)?[node]:[]),...all(node.props?.children,predicate)];
  const text = node => Array.isArray(node)?node.map(text).join(''):typeof node==='string'||typeof node==='number'?String(node):node&&typeof node==='object'?text(node.props?.children):'';
  const button = (tree,label) => {const matches=all(tree,n=>n.type==='button'&&text(n)===label);assert.equal(matches.length,1,`Button ${label}`);return matches[0];};
  const field = (tree,label) => {const matches=all(tree,n=>['input','select'].includes(n.type)&&n.props['aria-label']===label);assert.equal(matches.length,1,`Field ${label}`);return matches[0];};
  const mapElements = () => app.slots.find(s=>s.kind==='state'&&Array.isArray(s.value)&&s.value.some(x=>x.type==='mosmixPoint'))?.value||[];
  const elements = () => app.slots.find(s=>s.kind==='state'&&Array.isArray(s.value))?.value || [];
  let tree=render();
  assert.equal(tree.props.className,'landelijke-studio');
  assert.equal(all(tree,n=>n.props.role==='tab').length,2);
  assert.equal(text(all(tree,n=>n.type==='h1')[0]),'Regionale weerkaart');
  button(tree,'Download PNG');button(tree,'Opslaan');button(tree,'Openen');
  assert.equal(all(tree,n=>n.props.className==='studio-common-symbols')[0].props.children.length,16);
  assert.equal(all(tree,n=>n.props.className==='studio-symbols').length,0);
  button(tree,'Meer symbolen en varianten').props.onClick();tree=render();
  assert.equal(all(tree,n=>n.props.className==='studio-symbols').length,1);
  button(tree,'Meer symbolen sluiten').props.onClick();tree=render();
  assert.ok(all(tree,n=>n.type==='button').every(n=>text(n).trim()||n.props['aria-label']),'No unnamed buttons');

  // Place names retain their actual regional coordinates.
  button(tree,'Plaatsen').props.onClick();tree=render();
  button(tree,'Rotterdam').props.onClick();tree=render();
  assert.equal(lastProps.selected.type,'label');
  assert.equal(lastProps.selected.value,'ROTTERDAM');
  assert.ok(Number.isFinite(lastProps.selected.x)&&lastProps.selected.x>0);
  button(tree,'Dupliceren').props.onClick();tree=render();
  assert.equal(elements().length,2);
  button(tree,'Verwijder dit onderdeel').props.onClick();tree=render();
  assert.equal(elements().length,1);
  lastProps.actions.undo();tree=render();assert.equal(elements().length,2);
  lastProps.actions.redo();tree=render();assert.equal(elements().length,1);

  const map = () => all(tree,n=>n.type==='svg'&&n.props.onPointerUp)[0];
  const place = async () => {
    const svg=map();
    svg.ref.current={getBoundingClientRect:()=>({left:0,top:0,width:1000,height:800})};
    svg.props.onPointerDown({button:0,pointerId:1,clientX:300,clientY:250,currentTarget:{setPointerCapture(){}},stopPropagation(){}});
    await new Promise(resolve=>setTimeout(resolve,10));
    tree=render();map().props.onPointerUp({});tree=render();
  };
  button(tree,'Kaart maken').props.onClick();tree=render();
  button(tree,'Regen').props.onClick();tree=render();await place();
  assert.equal(elements().filter(e=>e.type==='regen').length,1);
  assert.ok(all(tree,n=>n.props['data-weather-icon']==='regen').length>0);
  // The properties pane edits the selected symbol and day labels separately.
  lastProps.actions.select();tree=render();
  const symbol=all(tree,n=>n.type==='g'&&n.props.onPointerDown).find(n=>all(n,c=>c.props?.['data-weather-icon']==='regen').length);
  symbol.props.onPointerDown({button:0,pointerId:2,clientX:300,clientY:250,stopPropagation(){},currentTarget:{setPointerCapture(){}}});
  tree=render();map().props.onPointerUp({});tree=render();
  assert.equal(lastProps.selected.type,'regen');
  button(tree,'300').props.onClick();tree=render();assert.equal(lastProps.selected.size,300);
  button(tree,'Kaart maken').props.onClick();tree=render();
  button(tree,'Dagen').props.onClick();tree=render();
  const dayButton=all(tree,n=>n.type==='button'&&/woensdag/i.test(text(n)))[0];
  assert.ok(dayButton);dayButton.props.onClick();tree=render();await place();
  assert.equal(elements().filter(e=>e.type==='day').length,1);
  assert.equal(elements().filter(e=>e.type==='zontijden').length,0,'No unrequested sunrise/sunset alongside day labels');

  button(tree,'Opmaak').props.onClick();tree=render();
  button(tree,'Nacht').props.onClick();tree=render();assert.equal(lastProps.night,true);
  field(tree,'Helderheid achtergrond').props.onChange({target:{value:'80'}});tree=render();
  assert.equal(lastProps.nightBrightness,80);
  assert.equal(all(tree,n=>n.type==='image'&&n.props.style?.filter==='brightness(0.8)').length,1);
  button(tree,'Kaart maken').props.onClick();tree=render();
  button(tree,'5-daagse').props.onClick();tree=render();
  assert.equal(elements().filter(e=>e.type==='meerdaags').length,1);
  assert.equal(lastProps.selected.type,'meerdaags');
  button(tree,'MOSMIX ophalen (Rotterdam)');

  // JSON roundtrip and full-resolution PNG keep the original real callbacks.
  let downloadName='',exportSize=null,serialized='';
  const clicks=[];
  document.createElement=tag=>tag==='a'?{set download(v){downloadName=v},click(){clicks.push(downloadName)}}:tag==='canvas'?{set width(v){exportSize=[v]},set height(v){exportSize.push(v)},getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/png;base64,fixture'}:fakeElement();
  context.Blob=Blob;
  lastProps.actions.save();assert.match(clicks[0],/^layout_.*\.json$/);
  let removed=0;
  map().ref.current={cloneNode(){return {querySelectorAll(selector){assert.ok(selector.includes('[data-editor-selection]'));return [{remove(){removed++}}];}};}};
  context.XMLSerializer=class {serializeToString(){serialized='svg';return '<svg xmlns="http://www.w3.org/2000/svg"/>';}};
  context.Image=class {set src(v){this.onload();}};
  lastProps.actions.download();
  assert.equal(removed,1);assert.equal(serialized,'svg');
  assert.ok(exportSize[0]>1000&&exportSize[1]>800);
  assert.match(clicks[1],/^weerkaart_.*\.png$/);
  assert.deepEqual(Object.keys(labels).sort(),Object.keys(WEATHER_ICON_SPECS).sort());
  for(const type of Object.keys(labels)) {
    const icon=expand(Icon({type,s:32}));
    assert.equal(icon.props['data-weather-icon'],type);
    assert.equal(all(icon,n=>n.type==='image').length,0);
    assert.ok(!JSON.stringify(icon).includes('NaN'));
  }
  assert.deepEqual(alerts,[]);
  console.log('Regional studio: 16 basics, catalog, regional places, duplicate, delete, undo/redo, symbol placement and size, separate day labels, night, brightness, five-day outlook, save and original-resolution PNG passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
