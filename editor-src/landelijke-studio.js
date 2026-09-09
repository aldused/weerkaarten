// Presentation layer for the existing editor. All weather, drawing, history and
// export callbacks stay owned by the original React application.
import {createWeatherIcon, WEATHER_ICON_LABELS, WEATHER_ICON_BASICS} from './weather-icons.js?v=20260909-icons1';
export const STUDIO_TABS = [
  { id: 'data', label: 'Weergegevens', icon: 'cloud' },
  { id: 'add', label: 'Toevoegen', icon: 'plus' },
  { id: 'style', label: 'Opmaak', icon: 'sliders' },
];

export function cleanLabel(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F]/gu, '').trimStart()
    .replace('Overdag (TX)', 'Overdag · maximum').replace('Nacht (TN)', 'Nacht · minimum')
    .replace('Temp (', 'Temperatuur (').replace('Plaats 8 MOSMIX-punten', 'Vul kaart met MOSMIX')
    .replace('Plaats 8 WeatherPro-punten', 'Vul kaart met WeatherPro');
}

export function createLandelijkeStudio(React) {
  const h = React.createElement;
  const WeatherIcon = createWeatherIcon(React);
  const items = node => React.Children.toArray(node?.props?.children);
  const section = node => node?.props?.['data-studio-section'];
  const iconPaths = {
    cloud: 'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 20 11a3.5 3.5 0 0 1-.5 7H7Z',
    plus: 'M12 5v14M5 12h14',
    sliders: 'M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6',
    arrow: 'm10 5-7 7 7 7M3 12h18',
    download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    save: 'M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-8h10v8',
    folder: 'M3 7V4h6l3 3h9v13H3V7Z',
    undo: 'M3 10h11a6 6 0 0 1 0 12M3 10l5-5m-5 5 5 5',
    redo: 'M21 10H10a6 6 0 0 0 0 12m11-12-5-5m5 5-5 5',
    pointer: 'm4 3 6 18 3-8 8-3L4 3Z',
    sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z',
    edit: 'm4 16 12-12 4 4L8 20H4v-4Zm10-10 4 4',
    map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15',
  };
  const Icon = ({ name }) => h('svg', { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: iconPaths[name] || iconPaths.sliders }));
  const Button = ({ icon, children, className = '', ...props }) => h('button', { type: 'button', className: `studio-button ${className}`, ...props }, icon && h(Icon, { name: icon }), children);
  const Card = ({ title, description, children }) => h('section', { className: 'studio-section' }, title && h('h2', null, title), description && h('p', { className: 'studio-description' }, description), children);

  // Reskin React elements, never move DOM nodes out from under React. Preserve
  // keys, refs, values and event handlers. SVG artwork is left untouched.
  function skin(node) {
    if (Array.isArray(node)) return node.map(skin);
    if (!React.isValidElement(node)) return typeof node === 'string' ? cleanLabel(node) : node;
    if (node.type === 'svg') return node;
    const props = { ...node.props };
    const style = { ...props.style };
    if (style.fontSize) style.fontSize = Math.max(14, Number(style.fontSize) || 14);
    if (style.color) style.color = '#475569';
    if (node.type === 'div' || node.type === 'span' || node.type === 'label') {
      delete style.background;
      if (style.border) style.border = '1px solid #dbe3ed';
      if (style.borderTop) style.borderTop = '1px solid #e2e8f0';
      if (style.borderBottom) style.borderBottom = '1px solid #e2e8f0';
      if (style.fontSize) style.lineHeight = 1.5;
      if (style.textTransform === 'uppercase') { style.textTransform = 'none'; style.letterSpacing = 0; }
    }
    if (node.type === 'button') {
      props.className = `${props.className || ''} studio-control`;
      const active = typeof style.border === 'string' && style.border.startsWith('2px');
      if (active || props['aria-pressed'] !== undefined) props['aria-pressed'] = active;
      if (style.border === 'none' && style.width === '100%') props.className += ' studio-control-primary';
      delete style.background; delete style.color; delete style.border; delete style.fontFamily;
      if (style.padding === 0) style.padding = '0 8px';
    }
    props.style = style;
    return React.cloneElement(node, props, ...React.Children.toArray(props.children).map(skin));
  }

  return function LandelijkeStudio(props) {
    const { children, enabled, selected, tool, pendingLabel, count, dayLabel, actions, night, brightness, nightBrightness, ratio, source, loading, error } = props;
    const [tab, setTab] = React.useState('data');
    const [zoom, setZoom] = React.useState(false);
    const panelRef = React.useRef(null);
    React.useEffect(() => { if (selected) setTab('edit'); }, [selected?.id]);
    React.useEffect(() => { if (!selected && tab === 'edit') setTab('data'); }, [selected, tab]);
    React.useEffect(() => { if (panelRef.current) panelRef.current.scrollTop = 0; }, [tab, selected?.id]);
    if (!enabled) return h('div', { style: props.style }, children);

    const root = React.Children.toArray(children);
    const header = root.find(n => section(n) === 'header');
    const tools = root.find(n => section(n) === 'tools');
    const workspace = root.find(n => section(n) === 'workspace');
    const work = items(workspace);
    const map = work.find(n => section(n) === 'map');
    const inspector = work.find(n => section(n) === 'inspector');
    const panels = items(inspector);
    const dataHead = panels.find(n => section(n) === 'data-head');
    const headParts = items(dataHead);
    const custom = headParts.find(n => n.props?.['aria-label'] === 'Eigen plaats toevoegen');
    const heading = headParts.find(n => n.props?.['aria-label'] === 'Koptekst landelijke kaart instellen');
    const summary = headParts.slice(0, 2);
    const dataPanels = panels.filter(n => section(n) === 'forecast');
    const editing = panels.find(n => section(n) === 'edit');
    const copyright = panels.find(n => section(n) === 'copyright');
    const other = panels.filter(n => !section(n));
    const symbolRows = items(items(header)[1]).slice(1);
    const mapFrame = items(map)[0];
    const frameParts = items(mapFrame);
    const quickEdit = frameParts.find(n => n.props?.role === 'dialog');
    const pointerMap = node => {
      if (!React.isValidElement(node)) return node;
      const next = {};
      for (const [mouse, pointer] of [['onMouseDown','onPointerDown'],['onMouseMove','onPointerMove'],['onMouseUp','onPointerUp'],['onMouseLeave','onPointerLeave']]) {
        if (node.props[mouse]) {
          next[mouse] = undefined;
          next[pointer] = event => {
            if (pointer === 'onPointerDown' && event.button === 0) event.currentTarget.setPointerCapture?.(event.pointerId);
            node.props[mouse](event);
          };
        }
      }
      if (node.props.onMouseUp) next.onPointerCancel = node.props.onMouseUp;
      return React.cloneElement(node, next, ...items(node).map(pointerMap));
    };
    const cleanMap = React.cloneElement(map, {
      className: 'studio-map-viewport',
      style: {},
      children: React.cloneElement(mapFrame, {
        className: 'studio-map-sheet',
        style: { '--map-ratio': ratio, aspectRatio: String(ratio) },
        children: frameParts.filter(n => n !== quickEdit).map(pointerMap),
      }),
    });
    const selectTab = id => { setTab(id); actions.select(); if (id === 'data') actions.data(); };
    const tabs = selected ? [...STUDIO_TABS, { id: 'edit', label: 'Bewerken', icon: 'edit' }] : STUDIO_TABS;
    const status = pendingLabel ? `Klik op de kaart om ${pendingLabel} te plaatsen.` : tool !== 'select' ? 'Klik op de kaart om te plaatsen. Druk op Esc als je klaar bent.' : selected ? `${selected.label || selected.value || 'Element'} geselecteerd · sleep om te verplaatsen` : 'Klik op een plaats om te bewerken. Sleep om te verplaatsen.';
    const detail = (title, content) => h('details', { className: 'studio-details' }, h('summary', null, title), h('div', { className: 'studio-details-body' }, content));
    const text = node => typeof node === 'string' ? node : React.isValidElement(node) ? items(node).map(text).join(' ') : '';
    const forecastPanel = node => React.cloneElement(node, {}, ...items(node).filter(n => !text(n).startsWith('Plaatst de ')).map(n => {
      const label = text(n);
      if (label.includes('Extra MOSMIX-plaats toevoegen') || label.includes('Extra WeatherPro-plaats toevoegen')) return detail('Extra plaatsen toevoegen', skin(n));
      if (label.includes('Verwijderde basisplaats terugzetten')) return detail('Verwijderde plaatsen terugzetten', skin(n));
      return skin(n);
    }));

    return h('div', { className: `landelijke-studio${zoom ? ' studio-zoom' : ''}` },
      root.filter(n => n.type === 'input'),
      h('header', { className: 'studio-header' },
        h('div', { className: 'studio-brand' }, h('span', { className: 'studio-brand-mark' }, h(Icon, { name: 'map' })), h('div', null, h('span', { className: 'studio-eyebrow' }, 'WEERLAB / KAARTENSTUDIO'), h('h1', null, 'Landelijke weerkaart'))),
        h('div', { className: 'studio-header-actions' },
          h(Button, { icon: 'folder', onClick: actions.open, title: 'Een opgeslagen kaartindeling openen' }, 'Openen'),
          h(Button, { icon: 'save', onClick: actions.save, title: 'Kaartindeling opslaan om later verder te werken' }, 'Opslaan'),
          h(Button, { icon: 'download', onClick: actions.download, className: 'studio-primary' }, 'Download PNG'))),
      h('aside', { className: 'studio-sidebar', 'aria-label': 'Kaartinstellingen' },
        h('div', { className: 'studio-tabs', role: 'tablist', 'aria-label': 'Editoronderdelen' }, tabs.map((t, index) => h('button', {
          key: t.id, type: 'button', role: 'tab', id: `studio-tab-${t.id}`, 'aria-selected': tab === t.id, 'aria-controls': 'studio-panel', tabIndex: tab === t.id ? 0 : -1,
          onClick: () => selectTab(t.id), onKeyDown: event => {
            let next;
            if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
            if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = tabs.length - 1;
            if (next !== undefined) { event.preventDefault(); event.stopPropagation(); selectTab(tabs[next].id); event.currentTarget.parentElement.children[next].focus(); }
          },
        }, h(Icon, { name: t.icon }), t.label))),
        h('div', { className: 'studio-panel', id: 'studio-panel', role: 'tabpanel', 'aria-labelledby': `studio-tab-${tab}`, ref: panelRef, tabIndex: 0 },
          tab === 'data' && h(React.Fragment, null,
            h(Card, { title: 'Vul je weerkaart', description: 'Kies de bron, dag en periode. Zet daarna de verwachting op de kaart.' }, skin(summary), dataPanels.map(forecastPanel)),
            !dataHead && h('p', { className: 'studio-description' }, 'De weergegevens worden klaargezet…')),
          tab === 'add' && h(React.Fragment, null,
            h(Card, { title: 'Zet iets op de kaart', description: 'Kies een onderdeel en klik op de gewenste plek.' }, h('div', { className: 'studio-tool-grid' }, items(tools).filter(n => n.type === 'button').slice(0, 8).map(skin))),
            h(Card, { title: 'Weersymbolen' }, h('div', {className:'studio-common-symbols'}, WEATHER_ICON_BASICS.map(([type,label]) => h('button', {type:'button',key:type,'aria-label':WEATHER_ICON_LABELS[type],title:WEATHER_ICON_LABELS[type],'aria-pressed':tool===type,onClick:()=>actions.chooseSymbol(type)},h('svg',{viewBox:'0 0 96 96','aria-hidden':true},h(WeatherIcon,{type,s:96})),h('span',null,label)))), h(Button, { onClick: actions.symbols, 'aria-expanded': props.symbolsOpen, className: 'studio-full' }, props.symbolsOpen ? 'Meer symbolen sluiten' : 'Meer symbolen en varianten'), h('div', { className: 'studio-symbols' }, symbolRows.map(skin))),
            other.map(skin), custom && h(Card, { title: 'Eigen plaats' }, skin(custom))),
          tab === 'style' && h(React.Fragment, null,
            h(Card, { title: 'Maak de kaart af', description: 'Pas de koptekst, achtergrond en naamsvermelding aan.' }, skin(heading)),
            h(Card, { title: 'Achtergrond' }, h('div', { className: 'studio-segment' }, h(Button, { onClick: () => actions.appearance(false), 'aria-pressed': !night, icon: 'sun' }, 'Dag'), h(Button, { onClick: () => actions.appearance(true), 'aria-pressed': night, icon: 'moon' }, 'Nacht')),
              h('label', { className: 'studio-range' }, h('span', null, 'Helderheid', h('output', null, `${night ? nightBrightness : brightness}%`)), h('input', { type: 'range', min: 30, max: 150, value: night ? nightBrightness : brightness, onChange: e => actions.brightness(+e.target.value), 'aria-label': 'Helderheid achtergrond' })),
              h(Button, { icon: 'folder', onClick: actions.background, className: 'studio-full' }, 'Eigen achtergrond kiezen')),
            h(Card, { title: 'Wind op de kaart' }, h('div', { className: 'studio-wind-grid' }, items(tools).filter(n => n.type === 'button').slice(8).map(skin))),
            h(Card, { title: 'Naamsvermelding' }, skin(copyright))),
          tab === 'edit' && selected && h(React.Fragment, null,
            h('div', { className: 'studio-selection-heading' }, h('div', null, h('span', { className: 'studio-eyebrow' }, 'GESELECTEERD'), h('h2', null, selected.label || 'Onderdeel bewerken')), h(Button, { onClick: actions.deselect }, 'Klaar')),
            quickEdit ? h(React.Fragment, null, skin(React.cloneElement(quickEdit, { role: 'group', style: {}, className: 'studio-quick-edit' })), detail('Meer eigenschappen', skin(editing))) : skin(editing),
            h(Button, {onClick:actions.removeSelected,className:'studio-delete studio-full'}, 'Verwijder dit onderdeel'))),
        h('footer', { className: 'studio-sidebar-footer' }, h(Button, { icon: 'arrow', onClick: actions.back }, 'Weerlab'), h(Button, { onClick: actions.reset, className: 'studio-new' }, 'Nieuwe kaart'))),
      h('main', { className: 'studio-canvas' },
        h('div', { className: 'studio-canvas-toolbar' },
          h('div', { className: 'studio-canvas-title' }, h('span', { className: 'studio-live-dot' }), h('strong', null, 'Kaartvoorbeeld'), h('span', null, `${count} ${count === 1 ? 'onderdeel' : 'onderdelen'}`)),
          h('div', { className: 'studio-canvas-actions' },
            h(Button, { icon: 'pointer', onClick: actions.select, 'aria-pressed': tool === 'select', title: 'Selecteren en verplaatsen' }, 'Selecteer'),
            h(Button, { icon: 'undo', onClick: actions.undo, title: 'Ongedaan maken (Ctrl / ⌘ Z)', 'aria-label': 'Ongedaan maken' }),
            h(Button, { icon: 'redo', onClick: actions.redo, title: 'Opnieuw uitvoeren (Ctrl / ⌘ Shift Z)', 'aria-label': 'Opnieuw uitvoeren' }),
            h(Button, { onClick: () => setZoom(v => !v), 'aria-pressed': zoom, title: 'Wissel tussen passend en groot kaartvoorbeeld' }, zoom ? 'Passend' : 'Vergroten'))),
        h('div', { className: 'studio-map-stage' }, cleanMap),
        h('div', { className: `studio-canvas-hint${tool !== 'select' || pendingLabel ? ' is-placing' : ''}`, role: 'status' }, h(Icon, { name: tool !== 'select' ? 'plus' : 'pointer' }), status),
        h('div', { className: 'studio-data-status', role: 'status' }, h('span', null, error ? 'Weergegevens niet beschikbaar · zie Weergegevens' : loading ? `${source} laden…` : dayLabel || 'Kies een dag bij Weergegevens'), h('span', null, 'PNG · originele resolutie'))),
      work.filter(n => n !== map && n !== inspector));
  };
}
