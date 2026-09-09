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
  const context = {console,document,localStorage:storage,sessionStorage:storage,location:{pathname:'/weerbewaking_landelijke_kaart.html',protocol:'http:',hostname:'localhost',href:'http://localhost/weerbewaking_landelijke_kaart.html'},navigator:{userAgent:'node'},setTimeout,clearTimeout,URL,fetch:()=>Promise.reject(new Error('offline fixture')),alert:m=>alerts.push(m),createLandelijkeStudio,createWeatherIcon,WEATHER_ICON_LABELS};
  context.window = context;
  context.addEventListener = context.removeEventListener = () => {};
  vm.createContext(context);
  let bundle = fs.readFileSync(path.join(root,'landelijke-editor-assets/weerbewaking_landelijke_kaart-pc6L27QC.js'),'utf8').replace(/^import .*;\n/gm,'');
  bundle = bundle.slice(0,bundle.lastIndexOf('ys.createRoot(')) + ';globalThis.editor={React:z,App:Ah,Icon:Lt,labels:WA,stations:ce};';
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
  let tree=render();
  assert.equal(tree.props.className,'landelijke-studio');
  assert.equal(all(tree,n=>n.props?.role==='tab').length,3);
  button(tree,'Download PNG');button(tree,'Opslaan');button(tree,'Openen');
  assert.equal(all(tree,n=>n.props?.['aria-label']==='Eigen plaats toevoegen').length,0,'Custom form is not cluttering initial screen');

  const days=['2026-09-09','2026-09-10'];
  const data={dagen:days,data:{}};
  for(const day of days) {
    data.data[day]={};
    for(const [key,value] of Object.entries({TX:22,TN:12,DD:225,FF:18,Neff:50,RR:0,wwT:0,wwZ:0,wwM:0})) {
      data.data[day][key]=Object.fromEntries(stations.map(s=>[s.dataStation||s.station,value]));
    }
  }
  const forecast=app.slots.find(s=>s.kind==='state'&&s.value?.period==='day'&&'data' in s.value);
  forecast.value={data,day:days[0],period:'day',loading:false,error:''};
  tree=render();button(tree,'Vul kaart met MOSMIX').props.onClick();tree=render();
  assert.equal(mapElements().length,8);
  assert.ok(mapElements().every(p=>p.value==='22'&&p.showWind===false));
  assert.equal(all(tree,n=>n.props?.['data-studio-section']==='forecast').length,1);

  // Selection opens the side panel; the SVG is no longer covered by a dialog.
  const place=all(tree,n=>n.type==='g'&&n.props?.['aria-label']?.endsWith(' bewerken'))[0];
  place.props.onPointerDown({button:0,pointerId:1,clientX:0,clientY:0,stopPropagation(){},currentTarget:{setPointerCapture(){}}});
  tree=render();
  all(tree,n=>n.type==='svg'&&n.props.onPointerUp)[0].props.onPointerUp({});
  tree=render();
  assert.equal(all(tree,n=>n.props?.role==='tab'&&n.props['aria-selected']&&text(n)==='Bewerken').length,1);
  assert.equal(all(tree,n=>n.props?.role==='dialog').length,0);
  all(tree,n=>n.type==='button'&&n.props['aria-label']==='Temperatuur hoger')[0].props.onClick();
  tree=render();assert.equal(lastProps.selected.value,'23');
  field(tree,'Wind tonen bij dit station').props.onChange({target:{checked:true}});
  tree=render();assert.equal(lastProps.selected.showWind,true);
  const selectedId=lastProps.selected.id;
  button(tree,'Verwijder dit onderdeel').props.onClick();tree=render();
  assert.equal(mapElements().length,7);
  lastProps.actions.undo();tree=render();
  assert.equal(mapElements().length,8);
  assert.ok(mapElements().some(p=>p.id===selectedId));

  button(tree,'Toevoegen').props.onClick();tree=render();
  assert.equal(all(tree,n=>n.type==='button'&&n.props['aria-label']&&WEATHER_ICON_LABELS.zon===n.props['aria-label']).length,1);
  assert.equal(all(tree,n=>n.props.className==='studio-common-symbols')[0].props.children.length,16);
  button(tree,'Regen').props.onClick();tree=render();
  assert.equal(lastProps.tool,'regen');
  field(tree,'Plaatsnaam eigen weerpunt').props.onChange({target:{value:'Amersfoort'}});
  tree=render();field(tree,'Temperatuur eigen weerpunt').props.onChange({target:{value:'19'}});
  tree=render();button(tree,'＋ Plaats eigen weerpunt').props.onClick();tree=render();
  assert.equal(lastProps.selected.label,'AMERSFOORT');
  assert.equal(mapElements().length,9);
  assert.equal(all(tree,n=>n.props.role==='tab'&&n.props['aria-selected']&&text(n)==='Bewerken').length,1);

  button(tree,'Opmaak').props.onClick();tree=render();
  field(tree,'Koptekst landelijke kaart').props.onChange({target:{value:'Een zonnige middag'}});
  tree=render();assert.equal(all(tree,n=>n.type==='text'&&text(n)==='Een zonnige middag').length,1);
  button(tree,'Nacht').props.onClick();tree=render();assert.equal(lastProps.night,true);
  field(tree,'Helderheid achtergrond').props.onChange({target:{value:'80'}});
  tree=render();assert.equal(lastProps.nightBrightness,80);

  // Arrow-key tabs activate and focus the same destination, without bubbling
  // to the canvas's move-selected-element shortcut.
  let focused=-1,stopped=false;
  const tabs=all(tree,n=>n.props.role==='tab');
  tabs[2].props.onKeyDown({key:'ArrowRight',preventDefault(){},stopPropagation(){stopped=true;},currentTarget:{parentElement:{children:tabs.map((_,i)=>({focus(){focused=i;}}))}}});
  tree=render();assert.equal(focused,3);assert.equal(stopped,true);

  // Night mapping uses moon/cloud symbols instead of daytime sun or clear
  // stars when the underlying forecast is partly cloudy.
  lastProps.actions.deselect();tree=render();
  button(tree,'Weergegevens').props.onClick();tree=render();
  forecast.value={data,day:days[1],period:'night',loading:false,error:''};
  tree=render();button(tree,'Vul kaart met MOSMIX').props.onClick();tree=render();
  assert.ok(mapElements().every(p=>p.value==='12'&&p.period==='night'&&p.icon==='maan_wolk'));

  // The actual export callback removes editing overlays before serialization.
  let removed=0,exportSelector='';
  const svg=all(tree,n=>n.type==='svg'&&n.props.onPointerUp)[0];
  svg.ref.current={cloneNode(){return {querySelectorAll(selector){exportSelector=selector;return [{remove(){removed++;}}];}};}};
  context.XMLSerializer=class {serializeToString(){return '<svg xmlns="http://www.w3.org/2000/svg"/>';}};
  context.Blob=Blob;context.Image=class {set src(value){URL.revokeObjectURL(value);}};
  lastProps.actions.download();
  assert.ok(exportSelector.includes('[data-editor-selection]'));
  assert.equal(removed,1);

  assert.equal(Object.keys(WEATHER_ICON_SPECS).length,73);
  assert.deepEqual(Object.keys(labels).sort(),Object.keys(WEATHER_ICON_SPECS).sort());
  assert.deepEqual(Object.keys(WEATHER_ICON_LABELS).sort(),Object.keys(WEATHER_ICON_SPECS).sort());
  for(const type of Object.keys(labels)) {
    const icon=expand(Icon({type,s:32}));
    assert.equal(icon.props['data-weather-icon'],type);
    assert.equal(all(icon,n=>n.type==='image').length,0,'No external resources in exported symbols');
    assert.ok(!JSON.stringify(icon).includes('NaN'));
  }
  assert.deepEqual(alerts,[]);
  // The legacy view remains available to the other modes sharing the bundle.
  context.location.pathname='/weerbewaking_landelijke_meerdaagse.html';
  tree=render();assert.equal(tree.props.className,undefined);assert.equal(tree.props.style.display,'grid');
  console.log('Landelijke studio: 8 stations, edit, wind, undo, 16 basics, custom place, styling, keyboard tabs, night mapping, export cleanup and 73 SVG variants passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
