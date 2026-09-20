// Shared, pure contracts for the ENS6plus endpoint and browser.
export const MODEL = 'ecmwf_ifs025';
export const CORE = ['cloud_cover', 'wind_direction_10m'];
export const PARAMETERS = [...CORE, 'cloud_cover_low', 'cloud_cover_mid', 'cape', 'temperature_850hPa', 'temperature_500hPa'];
export function runId(value) {
  const raw = String(value || '');
  const match = /^(\d{4})(\d{2})(\d{2})T(00|06|12|18)$/.exec(raw);
  const iso = match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:00:00Z` : raw;
  if (!/^\d{4}-\d{2}-\d{2}T(00|06|12|18):00(?::00(?:\.000)?)?Z$/.test(iso)) throw new Error('Ongeldige modelrun. Gebruik een volledige UTC-datum en 00, 06, 12 of 18 UTC.');
  const date = new Date(iso);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 16) !== iso.slice(0, 16)) throw new Error('Ongeldige modelrundatum.');
  return date.toISOString().replace('.000Z', 'Z');
}
export function runToken(value) { return runId(value).replaceAll('-', '').replace(':00:00Z', ''); }
export function runLabel(value) {
  const date = new Date(runId(value));
  return `${new Intl.DateTimeFormat('nl-NL', {timeZone:'UTC', day:'numeric', month:'long', year:'numeric'}).format(date)} – ${String(date.getUTCHours()).padStart(2, '0')} UTC`;
}
export function nearestStation(lat, lon) {
  let best;
  for (const [slug, y, x] of STATIONS) {
    const km = Math.hypot((lat-y)*111, (lon-x)*111*Math.cos(lat*Math.PI/180));
    if (!best || km < best.km) best = {slug, lat:y, lon:x, km};
  }
  return best?.km <= 8 ? best : null;
}
export function publishedRuns(manifest) {
  if (manifest?.complete !== true || manifest.member_count !== 51 || manifest.station_count !== 39) return [];
  return (manifest.runs || []).filter(entry => {
    try { runId(entry.run); } catch { return false; }
    return entry.complete === true && (entry.member_count ?? 51) === 51 && (entry.station_count ?? 39) === 39
      && CORE.every(field => entry.fields?.includes(field));
  }).map(entry => ({...entry, run:runId(entry.run)})).sort((a,b)=>Date.parse(b.run)-Date.parse(a.run));
}
export function matrixFor(run, field) {
  const matrix = run.members?.[field] || (field === 'cloud_cover' ? run.cloud_members : null);
  if (!Array.isArray(matrix) || matrix.length !== 51 || matrix.some(row=>!Array.isArray(row) || row.length !== run.times_ms.length)) return null;
  if (field === 'wind_direction_10m' && matrix.some(row=>row.some(value=>!Number.isFinite(value)))) return null;
  return matrix.some(row=>row.some(Number.isFinite)) ? matrix : null;
}
export function archivedDataset(document, entry, parameters=PARAMETERS) {
  const id = runId(entry.run);
  const run = document.runs?.find(item=>item.run === id);
  if (!run) throw new Error('Deze modelrun ontbreekt voor de gekozen locatie.');
  const times = run.times_ms;
  if (!Array.isArray(times) || times.length < 2 || times[0] !== Date.parse(id) || times.some((t,i)=>!Number.isFinite(t) || (i && t <= times[i-1]))) throw new Error('De gekozen modelrun heeft geen geldige tijdas.');
  if (run.source?.run_initialisation && runId(run.source.run_initialisation) !== id) throw new Error('Bron en archiefrun verschillen.');
  if (!CORE.every(field=>matrixFor(run, field))) throw new Error('De gekozen modelrun is onvolledig voor deze locatie.');
  const hourly = {time:times.map(t=>new Date(t).toISOString())};
  const missing = [];
  for (const field of parameters) {
    const matrix = entry.fields.includes(field) ? matrixFor(run, field) : null;
    if (!matrix) { missing.push(field); continue; }
    matrix.forEach((row,i)=>{hourly[field+(i ? `_member${String(i).padStart(2,'0')}` : '')] = row;});
  }
  return {
    run:id, model:run.source?.model || MODEL, source:run.source || {},
    meta:{last_run_initialisation_time:Date.parse(id)/1000, data_end_time:times.at(-1)/1000,
      last_run_modification_time:(Date.parse(run.fetched || '') || Date.parse(id))/1000,
      last_run_availability_time:(Date.parse(run.source?.source_ready || run.source?.availability || '') || Date.parse(id))/1000},
    ens:{weerlab_run:id, weerlab_unavailable_variables:missing, hourly, latitude:document.lat, longitude:document.lon},
    hres:null,
  };
}
export function assertDataset(data, id) {
  const expected = runId(id);
  if (data?.run !== expected || runId(data.ens?.weerlab_run) !== expected || data.meta?.last_run_initialisation_time*1000 !== Date.parse(expected)) throw new Error('De ontvangen gegevens horen niet bij de gekozen modelrun.');
  const times = data.ens.hourly?.time;
  if (!times?.length || Date.parse(times[0]) !== Date.parse(expected) || Date.parse(times.at(-1)) !== data.meta.data_end_time*1000) throw new Error('De tijdas hoort niet bij de gekozen modelrun.');
  return data;
}
const STATIONS = [
  ['amsterdam',52.309,4.781],['antwerpen',51.219,4.405],['arcen',51.500,6.196],['bocholt',51.838,6.617],['borkum',53.586,6.749],['brussel',50.901,4.484],['debilt',52.101,5.178],['deelen',52.060,5.885],['denhelder',52.928,4.789],['dollart',53.230,7.220],['groningen',53.123,6.586],['eindhoven',51.451,5.377],['enschede',52.275,6.889],['geilenkirchen',50.967,6.117],['gent',51.054,3.720],['gilzerijen',51.567,4.931],['hoekvanholland',51.978,4.131],['hoogeveen',52.730,6.520],['ijsselmeer',52.618,5.433],['kleinebrogel',51.168,5.470],['kleve',51.790,6.140],['leeuwarden',53.224,5.774],['maastricht',50.911,5.770],['nettetal',51.317,6.276],['rotterdam',51.957,4.437],['terschelling',53.392,5.350],['valkenburg',52.270,4.417],['vlieland',53.250,4.920],['vlissingen',51.442,3.596],['volkel',51.657,5.707],['weeze',51.603,6.141],['wielen',52.320,6.450],['woensdrecht',51.449,4.342],['wateringen',52.0244,4.2867],['dordrecht',51.8133,4.6900],['soestdijk',52.1797,5.2872],['rhoon',51.8650,4.4267],['ridderkerk',51.8722,4.6075],['londen',51.5074,-0.1278],
];
