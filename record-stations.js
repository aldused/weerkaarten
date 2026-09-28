/* Historical records are independent of station activity and map coordinates. */
(function(root) {
  let pending;
  function load() {
    if (!pending) pending = fetch('record-stations.json?v=20260928-3').then(r => {
      if (!r.ok) throw new Error('Stationsregister niet beschikbaar');
      return r.json();
    }).catch(e => { pending = null; throw e; });
    return pending;
  }
  function normalize(source, id, registry) {
    if (id === 'nl_extreme') return source;
    const entry = Object.entries(registry.stations).find(([,s]) => s.source === String(id));
    if (!entry) throw new Error('Onbekende recordbron: ' + id);
    const [name,station] = entry;
    if (source.station !== name && !(station.aliases || []).includes(source.station)) throw new Error('Stationsnaam past niet bij bron ' + id);
    source.station = name;
    return source;
  }
  function historical(registry) {
    return Object.fromEntries(Object.entries(registry.stations)
      .filter(([,s]) => s.source === 'nl_extreme').map(([name,s]) => [s.id,name]));
  }
  function registerSource(source, registry) {
    for (const month of Object.values(source.dag || {}))
      for (const day of Object.values(month))
        for (const rows of Object.values(day)) for (const row of rows) {
          const name = row[2] || source.station;
          if (name && !registry.stations[name]) {
            console.warn('Recordstation nog niet in register:', name);
            registry.stations[name] = {id:'hist_' + encodeURIComponent(name), source:'nl_extreme', coordinates:null};
          }
        }
  }
  function populate(select, registry) {
    const existing = new Set(Array.from(select.options, option => option.value));
    let group = select.querySelector('[data-record-stations]');
    if (!group) {
      group = document.createElement('optgroup');
      group.label = 'Historische en aanvullende recordstations';
      group.dataset.recordStations = 'true';
      select.appendChild(group);
    }
    for (const [name,station] of Object.entries(registry.stations).sort(([a],[b])=>a.localeCompare(b,'nl'))) {
      if (existing.has(station.id)) continue;
      const option = document.createElement('option');
      option.value = station.id; option.textContent = name;
      group.appendChild(option);
    }
  }
  function validate(source, registry) {
    function station(name) {
      if (!name || !registry.stations[name]) throw new Error('Onbekend recordstation: ' + name);
    }
    function walk(value) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const row of value) if (Array.isArray(row)) station(typeof row[2] === 'string' ? row[2] : source.station);
      } else for (const child of Object.values(value)) walk(child);
    }
    for (const key of ['dag','decade','maand','seizoen','jaar','alltime','maandranking','decaderanking','seizoenranking','jaarranking']) walk(source[key]);
    for (const row of source.waarnemingen || []) station(row.station);
  }
  function national(sources) {
    const result = {};
    for (const source of sources) {
      if (!source) throw new Error('Onvolledige landelijke recordbronnen');
      for (const [m,month] of Object.entries(source.dag || {}))
        for (const [d,day] of Object.entries(month))
          for (const [key,rows] of Object.entries(day)) {
            if (!/_(hoog|laag)$/.test(key)) continue;
            for (const row of rows) {
              const name = row[2] || source.station;
              if (!name || !Number.isFinite(row[0]) || !/^\d{4}-\d{2}-\d{2}$/.test(row[1])) throw new Error('Ongeldig dagrecord');
              const target = (result[m] ||= {})[d] ||= {};
              const old = target[key];
              const next = [row[0],row[1],name];
              if (!old || (key.endsWith('_hoog') ? row[0] > old[0][0] : row[0] < old[0][0])) target[key] = [next];
              else if (row[0] === old[0][0] && !old.some(r => r[1] === row[1] && r[2] === name)) old.push(next);
            }
          }
    }
    return result;
  }
  const api = {load,normalize,historical,registerSource,populate,validate,national};
  if (typeof module !== 'undefined') module.exports = api;
  else root.RecordStations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
