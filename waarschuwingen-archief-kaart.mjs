const NS = 'http://www.w3.org/2000/svg';
const COLORS = {geel:'#f5d149', oranje:'#ef902d', rood:'#bb2533'};
const names = ['Groningen','Fryslân','Drenthe','Overijssel','Flevoland','Gelderland','Utrecht','Noord-Holland','Zuid-Holland','Zeeland','Noord-Brabant','Limburg','Waddeneilanden','IJsselmeergebied'];
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/friesland/g,'fryslan').replace(/overrijssel/g,'overijssel').replace(/ijsselmeergebeid/g,'ijsselmeergebied');

// These are the areas explicitly named by the source, never inferred from the
// weather description. Unknown regions remain uncoloured.
export function namedRegions(areas) {
  const text = normalize(areas.join(' · '));
  if (/niet vermeld|overige provincies/.test(text)) return [];
  const exception = /(?:met uitzondering van|m\.u\.v\.|behalve)/.exec(text);
  const include = exception ? text.slice(0, exception.index) : text;
  const exclude = exception ? text.slice(exception.index + exception[0].length) : '';
  const all = /hele land|alle provincies/.test(include);
  const mentions = (part, name) => name === 'Waddeneilanden'
    ? /waddeneilanden|waddengebied|wadden\(eilanden\)|\bwadden\b/.test(part) : name === 'IJsselmeergebied'
    ? /ijsselmeer/.test(part) : part.includes(normalize(name));
  return names.filter(name => (all && name !== 'IJsselmeergebied' || mentions(include, name)) && !mentions(exclude, name)
    && !(name === 'Waddeneilanden' && /niet de waddeneilanden/.test(text)));
}

const project = ([lon,lat]) => [36 + (lon - 3.2) * 132, 34 + (53.6 - lat) * 215];
export function geometryPath(geometry) {
  if (!geometry || !['Polygon','MultiPolygon'].includes(geometry.type)) throw Error('Onbekende kaartgeometrie');
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap(polygon => polygon.map(ring => {
    if (ring.length < 4) throw Error('Ongeldige gebiedsgrens');
    return ring.map((point, index) => {
      if (point.length !== 2 || !point.every(Number.isFinite)) throw Error('Ongeldig kaartpunt');
      const [x,y] = project(point);
      return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ') + 'Z';
  })).join(' ');
}

export function mapSelection(record) {
  if (record.geometry) return {exact:true, regions:[], ambiguous:false};
  return {exact:false, regions:namedRegions(record.areas), ambiguous:record.codes.length !== 1};
}

let basemap;
async function loadBasemap() {
  if (!basemap) basemap = fetch(new URL('./waarschuwingen-archief-basiskaart.json?v=20261122-1', import.meta.url))
    .then(response => {if (!response.ok) throw Error('Kaart niet beschikbaar'); return response.json();})
    .catch(error => {basemap = null; throw error;});
  return basemap;
}
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
function svgNode(tag, attributes = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key,value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
}
const date = value => new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam', day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
let sequence = 0;
export function originalWarningMaps(record) {
  return (record.factsheet_images || []).filter(item => {
    try {
      const url = new URL(item.url);
      return url.protocol === 'https:' && url.hostname === 'cdn.knmi.nl'
        && (/waarschuw|code (?:oranje|rood|geel)/i.test(item.caption) || /waarschuw/i.test(url.pathname));
    } catch {return false;}
  });
}
function renderOriginalMap(host, record, maps, day) {
  host.replaceChildren(element('h4', '', 'Oorspronkelijke KNMI-waarschuwingskaart'));
  const label = element('label', 'archive-map-version', 'Kaartmoment');
  const select = element('select');
  maps.forEach((item,index) => {
    const option = element('option','',item.caption.replace(/^Figuur\s+\d+\s*:\s*/i,''));
    option.value = String(index); select.append(option);
  });
  let index = maps.length - 1;
  if (day) {
    const months = 'januari februari maart april mei juni juli augustus september oktober november december'.split(' ');
    const pattern = new RegExp(`\\b${Number(day.slice(8))}\\s+${months[Number(day.slice(5,7))-1]}\\b`, 'i');
    const sameDay = maps.map((item,index) => ({item,index})).filter(({item}) => pattern.test(item.caption));
    if (sameDay.length) index = sameDay.at(-1).index;
  }
  select.value = String(index); label.append(select);
  if (maps.length > 1) host.append(label);
  const figure = element('figure', 'archive-original-map'), link = element('a'), img = element('img');
  link.target = '_blank'; link.rel = 'noopener';
  img.decoding = 'async';
  const caption = element('figcaption');
  link.append(img); figure.append(link,caption);
  const source = element('a', '', 'Originele kaart bij het KNMI openen');
  source.target = '_blank'; source.rel = 'noopener';
  host.append(figure, element('p', 'archive-map-note', 'Dit is de oorspronkelijke KNMI-kaart met de toen afgegeven kleuren. Elk kaartmoment kan andere gebieden en kleuren tonen. Bron: KNMI.'),source);
  function draw() {
    const item = maps[Number(select.value)];
    img.hidden = false; img.src = item.url; img.alt = item.caption;
    link.href = source.href = item.url; caption.textContent = item.caption;
  }
  img.addEventListener('error', () => {img.hidden = true; caption.textContent = 'De oorspronkelijke kaart kan niet worden geladen. Open de kaart via de KNMI-link hieronder.';});
  select.addEventListener('change',draw); draw();
}
export async function renderWarningMap(host, record, {day = null} = {}) {
  const originalMaps = originalWarningMaps(record);
  if (originalMaps.length) {renderOriginalMap(host,record,originalMaps,day); return;}
  const geo = await loadBasemap();
  host.replaceChildren();
  const heading = element('h4', '', 'Kaart bij deze waarschuwing');
  const figure = element('figure', 'archive-map-figure');
  const note = element('p', 'archive-map-note');
  const map = svgNode('svg', {viewBox:'0 0 590 665', class:'archive-map-svg', role:'img'});
  const title = svgNode('title'), description = svgNode('desc');
  const id = `archive-map-${++sequence}`;
  title.id = `${id}-title`; description.id = `${id}-desc`;
  map.setAttribute('aria-labelledby', `${title.id} ${description.id}`);
  const defs = svgNode('defs'), pattern = svgNode('pattern', {id:`${id}-pattern`,width:8,height:8,patternUnits:'userSpaceOnUse'});
  pattern.append(svgNode('rect',{width:8,height:8,fill:'#dce8f3'}),svgNode('path',{d:'M-2 2L2 -2M0 8L8 0M6 10L10 6',stroke:'#68849c','stroke-width':2}));
  defs.append(pattern);
  map.append(title, description, defs);
  const shapes = svgNode('g'); map.append(shapes);
  const legend = element('div', 'archive-map-legend');
  const areaLabel = element('p', 'archive-map-areas');
  const textColumn = element('figcaption', 'archive-map-info');
  figure.classList.add('archive-map-layout');
  textColumn.append(legend, areaLabel, note); figure.append(map, textColumn); host.append(heading);
  const versions = (record.revisions || []).filter(revision => revision.geometry);
  let select;
  if (versions.length > 1) {
    const label = element('label', 'archive-map-version', 'Kaartversie');
    select = element('select');
    versions.forEach((revision,index) => {
      const status = revision.status === 'cancelled' ? ' · ingetrokken' : revision.status === 'expired' ? ' · beëindigd' : '';
      const option = element('option','',`${date(revision.issued)}${status}`); option.value = String(index); select.append(option);
    });
    select.value = String(versions.length - 1);
    label.append(select); host.append(label);
    select.addEventListener('change', () => draw({...record,...versions[Number(select.value)]}));
  }
  host.append(figure);
  function draw(version) {
    const selection = mapSelection(version), code = record.codes.length === 1 ? record.codes[0] : null;
    const fill = code ? COLORS[code] : `url(#${id}-pattern)`;
    shapes.replaceChildren(); legend.replaceChildren();
    for (const feature of geo.features) {
      const name = feature.properties.name, chosen = !selection.exact && selection.regions.includes(name);
      const path = svgNode('path', {d:geometryPath(feature.geometry), fill:chosen ? fill : name === 'IJsselmeergebied' ? '#e4f1f7' : '#f8fafc', stroke:'#8296a7','stroke-width':1, 'fill-rule':'evenodd'});
      path.append(svgNode('title', {}, `${name}${chosen ? code ? ' · code '+code : ' · genoemd gebied' : ''}`)); shapes.append(path);
    }
    if (selection.exact) shapes.append(svgNode('path', {d:geometryPath(version.geometry),fill,stroke:'#435e73','stroke-width':1.4,'fill-opacity':.85,'fill-rule':'evenodd'}));
    const cities = [['Groningen',6.57,53.22],['Amsterdam',4.90,52.37],['Utrecht',5.12,52.09],['Rotterdam',4.48,51.92],['Arnhem',5.91,51.98],['Eindhoven',5.48,51.44],['Maastricht',5.69,50.85]];
    for (const [name,lon,lat] of cities) {
      const [x,y] = project([lon,lat]);
      shapes.append(svgNode('circle',{cx:x,cy:y,r:2.5,fill:'#17334d'}),svgNode('text',{x:x+6,y:y-6,class:'archive-map-city'},name));
    }
    const swatch = element('span', `archive-map-swatch${code ? ' '+code : ' ambiguous'}`);
    legend.append(swatch,document.createTextNode(code ? `Code ${code}` : 'Gebied met meerdere vermelde kleurcodes'));
    if (!selection.exact && !selection.regions.length) legend.replaceChildren(document.createTextNode('Gebied niet nauwkeurig te tekenen'));
    areaLabel.textContent = version.areas.join(' · ');
    let explanation = selection.exact
      ? `Oorspronkelijke KNMI-gebiedsgrens${version.issued ? ' · uitgifte '+date(select ? version.issued : record.updated || version.issued) : ''}.`
      : selection.regions.length ? 'Gereconstrueerd uit de genoemde provincies en gebieden. De bron bevat geen oorspronkelijke gebiedsgrens.'
      : 'De bron geeft onvoldoende gebiedsinformatie voor een ingekleurd vlak. Bekijk de gebiedsbeschrijving en de officiële bron.';
    if (!selection.exact && /waddenzee|waddengebied|wadden-/.test(normalize(version.areas.join(' ')))) explanation += ' Voor de Waddenzee is geen historische grens beschikbaar; alleen herkenbare landgebieden zijn ingekleurd.';
    if (selection.ambiguous) explanation += ` De bron noemt ${record.codes.map(c=>'code '+c).join(' en ')}, zonder een precieze verdeling per gebied en tijd. De arcering toont de genoemde gebieden.`;
    if (version.status === 'cancelled') explanation += ' Deze versie is ingetrokken; het vlak toont het eerder afgegeven gebied.';
    explanation += ' Grijs betekent: geen gebied van deze geselecteerde melding. Dit is geen overzicht van alle waarschuwingen op dat moment.';
    note.textContent = explanation;
    title.textContent = `${record.phenomenon} · ${record.date_label || date(record.onset)} · ${version.areas.join(', ')}`;
    description.textContent = explanation;
  }
  draw(versions.length ? {...record,...versions.at(-1)} : record);
}
