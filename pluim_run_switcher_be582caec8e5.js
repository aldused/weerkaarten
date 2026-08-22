(function () {
  'use strict';

  // Alle vier IFS ENS-cycli aanbieden. 00/12 lopen 15 dagen; de 06/18
  // tussenruns zijn korter en lopen tot +144 uur (zes dagen).
  const CYCLES = [0, 6, 12, 18];
  const HOUR_MS = 3600000;
  const MAX_ARCHIVE_AGE_MS = 24 * HOUR_MS;
  const originalFetch = window.fetch.bind(window);
  const params = new URLSearchParams(location.search);
  const requested = params.get('run');
  const parsedRequestedHour = /^([01]\d|2[0-3])$/.test(requested || '') ? Number(requested) : null;
  const requestedHour = CYCLES.includes(parsedRequestedHour) ? parsedRequestedHour : null;
  const editorModeAware = document.currentScript?.dataset?.editorModeAware === 'true';
  const initialEditorMode = globalThis.WEERLAB_EDITOR_MODE ||
    (location.pathname.endsWith('/weerbewaking_landelijke_pluim.html') ? 'plume' : 'landelijk');
  const requiredVariables = String(document.currentScript?.dataset?.required || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  const DATA_ROOTS = ['https://data.weerlab.nl', '.'];
  const META_URL = 'https://ensemble-api.open-meteo.com/data/ecmwf_ifs025_ensemble/static/meta.json';
  const DIRECT_META_NAME = 'pluim_direct_meta.json';
  const ARCHIVE_META_NAME = 'pluim_archive_meta.json';
  const archiveCache = new Map();

  const stations = [
    ['amsterdam', 52.309, 4.781], ['antwerpen', 51.219, 4.405], ['arcen', 51.500, 6.196],
    ['bocholt', 51.838, 6.617], ['borkum', 53.586, 6.749], ['brussel', 50.901, 4.484],
    ['debilt', 52.101, 5.178], ['deelen', 52.060, 5.885], ['denhelder', 52.928, 4.789],
    ['dollart', 53.230, 7.220], ['groningen', 53.123, 6.586], ['eindhoven', 51.451, 5.377],
    ['enschede', 52.275, 6.889], ['geilenkirchen', 50.967, 6.117], ['gent', 51.054, 3.720],
    ['gilzerijen', 51.567, 4.931], ['hoekvanholland', 51.978, 4.131], ['hoogeveen', 52.730, 6.520],
    ['ijsselmeer', 52.618, 5.433], ['kleinebrogel', 51.168, 5.470], ['kleve', 51.790, 6.140],
    ['leeuwarden', 53.224, 5.774], ['maastricht', 50.911, 5.770], ['nettetal', 51.317, 6.276],
    ['rotterdam', 51.957, 4.437], ['terschelling', 53.392, 5.350], ['valkenburg', 52.270, 4.417],
    ['vlieland', 53.250, 4.920], ['vlissingen', 51.442, 3.596], ['volkel', 51.657, 5.707],
    ['weeze', 51.603, 6.141], ['wielen', 52.320, 6.450], ['woensdrecht', 51.449, 4.342],
    ['wateringen', 52.0244, 4.2867], ['dordrecht', 51.8133, 4.6900],
    ['soestdijk', 52.1797, 5.2872], ['rhoon', 51.8650, 4.4267],
    ['ridderkerk', 51.8722, 4.6075], ['londen', 51.5074, -0.1278],
  ].map(([slug, lat, lon]) => ({ slug, lat, lon }));

  const legacyFields = {
    temperature_2m: 'temp_members', precipitation: 'precip_members',
    wind_speed_10m: 'wind_members', cloud_cover: 'cloud_members',
    wind_gusts_10m: 'gust_members', cape: 'cape_members',
  };

  const state = {
    liveMeta: null,
    directMeta: null,
    archiveManifest: null,
    liveMetaFetchedAt: 0,
    reusableMetaResponses: 0,
    archive: null,
    archiveError: null,
    requestedUnavailableHour: null,
    selectedHour: requestedHour,
    selectedRun: null,
    metaReady: null,
    archiveReady: null,
    ready: null,
    bar: null,
    status: null,
    editorMode: editorModeAware ? initialEditorMode : 'plume',
    locationFallback: false,
    locationFallbackRun: null,
    capabilityFallbackRun: null,
  };

  function jsonResponse(value, status = 200) {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-weerlab-run-selector': '1' },
    });
  }

  function parseUrl(input) {
    try {
      if (input instanceof Request) return new URL(input.url, location.href);
      return new URL(String(input), location.href);
    } catch (_) { return null; }
  }

  function isEnsMeta(url) {
    return url && url.hostname === 'ensemble-api.open-meteo.com' &&
      url.pathname.includes('/data/ecmwf_ifs025_ensemble/static/meta.json');
  }

  function isEnsRequest(url) {
    if (!url) return false;
    const direct = url.hostname === 'ensemble-api.open-meteo.com' && url.pathname === '/v1/ensemble';
    const proxy = url.hostname === 'om.weerlab.nl' && url.pathname === '/om/ensemble';
    return (direct || proxy) && (url.searchParams.get('models') || '').split(',').includes('ecmwf_ifs025');
  }

  function runHour(run) {
    const date = new Date(run && run.run);
    return Number.isFinite(date.getTime()) ? date.getUTCHours() : null;
  }

  function newestForHour(document, hour) {
    return (document && Array.isArray(document.runs) ? document.runs : [])
      .filter(run => runHour(run) === hour)
      .sort((a, b) => new Date(b.run) - new Date(a.run))[0] || null;
  }

  function currentArchivedRunForHour(document, hour) {
    const candidate = newestForHour(document, hour);
    const liveMs = latestReferenceMs(document);
    const candidateMs = Date.parse(candidate && candidate.run || '');
    const ageMs = liveMs - candidateMs;
    // Een knop staat voor de nieuwste reeks hoofdcycli, niet voor een
    // willekeurige historische run met hetzelfde uur. De geldige andere
    // hoofdcyclus ligt altijd hoogstens 18 uur voor de actuele bronrun. Vanaf
    // 24 uur is een hele cyclus gemist en tonen we die knop als niet beschikbaar.
    return candidate && Number.isFinite(liveMs) && Number.isFinite(candidateMs)
      && ageMs >= 0 && ageMs < MAX_ARCHIVE_AGE_MS ? candidate : null;
  }

  function metaRunMs(meta) {
    if (!meta) return NaN;
    const value = Number(meta.last_run_initialisation_time) * 1000;
    return Number.isFinite(value) ? value : NaN;
  }

  function latestReferenceMs() {
    // Een archiefbestand alleen is nooit een publicatiesignaal: de directe
    // producent uploadt 39 stations en zet pas daarna het complete manifest.
    const values = [metaRunMs(state.liveMeta), metaRunMs(state.directMeta)]
      .filter(Number.isFinite);
    return values.length ? Math.max(...values) : NaN;
  }

  function metaVersionMs(meta) {
    if (!meta) return NaN;
    const values = [
      Number(meta.last_run_initialisation_time) * 1000,
      Number(meta.last_run_modification_time) * 1000,
    ].filter(Number.isFinite);
    return values.length ? Math.max(...values) : NaN;
  }

  function compactHash(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function archiveManifestTag(manifest = state.archiveManifest) {
    if (!manifest) return '0';
    const revision = manifest.revision ?? manifest.published_at ?? manifest.updated ?? '';
    const runs = Array.isArray(manifest.runs) ? manifest.runs.map(item => ({
      run: item && item.run,
      complete: item && item.complete,
      fields: Array.isArray(item && item.fields) ? [...item.fields].sort() : [],
      station_count: item && item.station_count,
      member_count: item && item.member_count,
    })) : [];
    return compactHash(JSON.stringify({
      revision,
      complete: manifest.complete,
      station_count: manifest.station_count,
      member_count: manifest.member_count,
      runs,
    }));
  }

  function sourceStateTag() {
    const sources = [state.liveMeta, state.directMeta].map(meta => {
      const run = metaRunMs(meta);
      const version = metaVersionMs(meta);
      return `${Number.isFinite(run) ? run : 0}:${Number.isFinite(version) ? version : 0}`;
    }).join('|');
    return `${sources}|archive:${archiveManifestTag()}`;
  }

  function sourceStateForRun(runMs) {
    if (!Number.isFinite(runMs)) return '';
    const sources = [state.liveMeta, state.directMeta]
      .filter(meta => metaRunMs(meta) === runMs)
      .map(meta => `${metaRunMs(meta)}:${metaVersionMs(meta)}`)
      .join('|');
    const archived = archiveManifestEntryForMs(runMs);
    return `${sources}|archive:${archived ? archiveManifestTag({
      complete: state.archiveManifest?.complete,
      station_count: state.archiveManifest?.station_count,
      member_count: state.archiveManifest?.member_count,
      revision: state.archiveManifest?.revision,
      published_at: state.archiveManifest?.published_at,
      updated: state.archiveManifest?.updated,
      runs: [archived],
    }) : '0'}`;
  }

  function sourceStateForHour(hour) {
    if (!CYCLES.includes(Number(hour))) return '';
    return [state.liveMeta, state.directMeta]
      .filter(meta => {
        const runMs = metaRunMs(meta);
        return Number.isFinite(runMs) && new Date(runMs).getUTCHours() === Number(hour);
      })
      .map(meta => `${metaRunMs(meta)}:${metaVersionMs(meta)}`)
      .join('|');
  }

  function isDirectArchiveRun(run) {
    return !!run && run.source && run.source.access === 'direct_grib2_range_requests';
  }

  function archiveManifestEntryForMs(runMs) {
    if (!Number.isFinite(runMs) || !Array.isArray(state.archiveManifest?.runs)) return null;
    return state.archiveManifest.runs.find(item => Date.parse(item && item.run || '') === runMs) || null;
  }

  function archiveManifestEntry(run) {
    return archiveManifestEntryForMs(Date.parse(run && run.run || ''));
  }

  function archiveManifestAllows(run, variables) {
    const manifest = state.archiveManifest;
    const entry = archiveManifestEntry(run);
    if (!manifest || !entry) return false;
    const fields = new Set(Array.isArray(entry.fields) ? entry.fields.map(normalizeVariable) : []);
    const stationCount = Number(entry.station_count ?? manifest.station_count);
    const memberCount = Number(entry.member_count ?? manifest.member_count);
    return manifest.complete === true
      && entry.complete === true
      && stationCount === stations.length
      && memberCount === 51
      && variables.every(variable => fields.has(normalizeVariable(variable)));
  }

  function directManifestAllows(run, variables = requiredVariables) {
    if (!isDirectArchiveRun(run)) return true;
    const fields = new Set(state.directMeta && state.directMeta.fields || []);
    const manifestRunMs = metaRunMs(state.directMeta);
    const archivedRunMs = Date.parse(run.run || '');
    const isManifestRun = manifestRunMs === archivedRunMs;
    return state.directMeta && state.directMeta.complete === true
      && Number(state.directMeta.station_count) === stations.length
      && Number(state.directMeta.member_count) === 51
      && Number.isFinite(manifestRunMs)
      && Number.isFinite(archivedRunMs)
      // Het manifest wordt pas gepubliceerd nadat alle 39 stationarchieven
      // atomair zijn geupload. Een ouder direct runobject in zo'n bestand is
      // daarom eveneens gepubliceerd en mag selecteerbaar blijven. Een nieuwere
      // run dan het manifest kan uit een halve upload komen en blijft geblokkeerd.
      && archivedRunMs <= manifestRunMs
      // Voor de manifest-run zelf blijft de capabilitylijst de harde poort.
      // Oudere runs worden hieronder op hun werkelijk aanwezige matrices getest.
      && (isManifestRun
        ? Number(state.directMeta.cycle) === runHour(run)
          && variables.every(variable => fields.has(normalizeVariable(variable)))
        : /^[a-f0-9]{64}$/i.test(String(run.data_sha256 || '')));
  }

  function publishedRunAllows(run, variables = requiredVariables) {
    if (archiveManifestAllows(run, variables)) return true;
    if (isDirectArchiveRun(run)) {
      // DirectMeta certificeert alleen de velden die de directe producent voor
      // alle stations heeft gepubliceerd. Een specialistische same-run-matrix
      // kan al in één stationbestand staan terwijl het archiefmanifest nog oud
      // is; zo'n veld mag nooit via de historische digest-bypass uitlekken.
      const directFields = new Set((state.directMeta?.fields || []).map(normalizeVariable));
      return variables.every(variable => directFields.has(normalizeVariable(variable)))
        && directManifestAllows(run, variables);
    }
    // Runs van vóór het aparte archiefmanifest blijven bruikbaar op basis van
    // hun ondertekende stationdocument. Zodra een manifest-entry bestaat, is die
    // entry de atomaire poort en mag een gedeeltelijke verrijking niet lekken.
    return !archiveManifestEntry(run);
  }

  function completeMemberMatrix(run, variable) {
    const matrix = membersFor(run, variable);
    const times = Array.isArray(run && run.times_ms) ? run.times_ms : [];
    const declared = Number(run && run.n);
    const length = Number.isInteger(declared) && declared > 0 ? declared : times.length;
    const runMs = Date.parse(run && run.run || '');
    if (!length || times.length !== length || !Number.isFinite(runMs)
        || times[0] !== runMs || times.some((value, index) =>
          typeof value !== 'number' || !Number.isFinite(value)
          || (index > 0 && value <= times[index - 1]))) return null;
    if (!Array.isArray(matrix) || matrix.length !== 51) return null;
    if (matrix.some(series => !Array.isArray(series) || series.length !== length ||
      series.some(value => !Number.isFinite(value)))) return null;
    return matrix;
  }

  function runHasRequiredVariables(run) {
    return runHasVariables(run, requiredVariables);
  }

  function runHasVariables(run, variables) {
    return variables.every(variable => !!completeMemberMatrix(run, variable));
  }

  function selectableRunForHour(document, hour) {
    const options = [];
    const currentHour = liveHour();
    if (hour === currentHour && state.liveMeta) {
      options.push({
        hour,
        run: null,
        timestamp: metaRunMs(state.liveMeta),
        priority: 0,
      });
    }
    const run = currentArchivedRunForHour(document, hour);
    if (run && publishedRunAllows(run) && runHasRequiredVariables(run)) {
      const timestamp = Date.parse(run.run);
      if (!(hour === currentHour && timestamp < metaRunMs(state.liveMeta))) {
        // Bij dezelfde initialisatietijd heeft het atomair gevalideerde directe
        // archief voorrang. Open-Meteo kan zijn meta al omschakelen terwijl nog
        // niet alle 51 leden beschikbaar zijn.
        const atomicallyPublished = archiveManifestAllows(run, requiredVariables) || isDirectArchiveRun(run);
        options.push({ hour, run, timestamp, priority: atomicallyPublished ? 1 : 0 });
      }
    }
    return options.sort((a, b) => (b.timestamp - a.timestamp) || (b.priority - a.priority))[0] || null;
  }

  function newestSelectableRun(document) {
    return CYCLES.map(hour => selectableRunForHour(document, hour))
      .filter(Boolean)
      .sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  }

  function archiveVersionTag() {
    // Het archief kan binnen dezelfde initialisatie met extra, exact dezelfde
    // runvelden worden verrijkt. De kleine archive-manifestrevision wordt pas na
    // alle stationbestanden gepubliceerd en is daarom onderdeel van de cachekey.
    const runSeconds = latestReferenceMs() / 1000;
    return Number.isFinite(runSeconds)
      ? `${runSeconds}-${sourceStateTag()}`
      : String(Math.floor(Date.now() / 600000));
  }

  async function loadArchive(slug) {
    const cacheKey = `${slug}|${archiveVersionTag()}`;
    if (archiveCache.has(cacheKey)) return archiveCache.get(cacheKey);
    const pending = (async () => {
      let lastError = null;
      for (const root of DATA_ROOTS) {
        const url = `${root}/pluim_trend_${slug}.json?run=${archiveVersionTag()}`;
        try {
          const response = await originalFetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          if (!Array.isArray(data && data.runs)) throw new Error('ongeldig runarchief');
          return data;
        } catch (error) { lastError = error; }
      }
      throw lastError || new Error('runarchief niet beschikbaar');
    })();
    archiveCache.set(cacheKey, pending);
    return pending;
  }

  function nearestStation(lat, lon) {
    let best = null;
    for (const station of stations) {
      const dy = (lat - station.lat) * 111;
      const dx = (lon - station.lon) * 111 * Math.cos(lat * Math.PI / 180);
      const km = Math.hypot(dx, dy);
      if (!best || km < best.km) best = { ...station, km };
    }
    // De API gebruikt een 0,25°-rooster. Binnen acht kilometer valt de
    // zoeklocatie in de praktijk op hetzelfde of een aangrenzend roosterpunt;
    // verder weg substitueren we nooit stilzwijgend een andere plaats.
    return best && best.km <= 8 ? best : null;
  }

  function archiveMeta(run) {
    const start = new Date(run.run).getTime();
    const times = Array.isArray(run.times_ms) ? run.times_ms.map(Number).filter(Number.isFinite) : [];
    const sourceEnd = Date.parse(run.source && run.source.data_end || '');
    const last = times[times.length - 1] || start;
    const previous = times[times.length - 2] || last - 3 * HOUR_MS;
    const end = Number.isFinite(sourceEnd) ? sourceEnd : last + Math.max(HOUR_MS, last - previous);
    const fetched = Date.parse(run.fetched || '') || start;
    const sourceAvailable = Date.parse(
      run.source && (run.source.source_ready || run.source.availability) || '',
    );
    const available = Number.isFinite(sourceAvailable) ? sourceAvailable : fetched;
    return {
      last_run_initialisation_time: start / 1000,
      last_run_availability_time: available / 1000,
      last_run_modification_time: fetched / 1000,
      data_end_time: end / 1000,
      temporal_resolution_seconds: Math.max(3600, Math.round((times[1] - times[0]) / 1000) || 10800),
      update_interval_seconds: 21600,
      weerlab_archived_run: true,
    };
  }

  function normalizeVariable(value) {
    return String(value || '')
      .replace(/^cloudcover$/, 'cloud_cover')
      .replace(/^windspeed_10m$/, 'wind_speed_10m')
      .replace(/^windgusts_10m$/, 'wind_gusts_10m')
      .replace(/^winddirection_10m$/, 'wind_direction_10m')
      .replace(/^dewpoint_2m$/, 'dew_point_2m')
      .replace(/^relativehumidity_2m$/, 'relative_humidity_2m')
      .replace(/^weathercode$/, 'weather_code')
      .replace(/^temperature_850hPa$/, 'temperature_850hPa')
      .replace(/^temperature_500hPa$/, 'temperature_500hPa');
  }

  function membersFor(run, variable) {
    const canonical = normalizeVariable(variable);
    const generic = run.members && run.members[canonical];
    return Array.isArray(generic) ? generic : run[legacyFields[canonical]];
  }

  function unitFor(variable, url) {
    if (/temperature|dew_point/.test(variable)) return '°C';
    if (/wind_speed|wind_gusts/.test(variable)) return url.searchParams.get('wind_speed_unit') === 'ms' ? 'm/s' : 'km/h';
    if (/wind_direction/.test(variable)) return '°';
    if (/precipitation|snowfall/.test(variable)) return 'mm';
    if (/cloud_cover|relative_humidity/.test(variable)) return '%';
    if (variable === 'cape') return 'J/kg';
    if (/geopotential_height/.test(variable)) return 'm';
    return '';
  }

  function archiveEnsembleResponse(document, run, url) {
    const requestedVariables = (url.searchParams.get('hourly') || '').split(',').map(normalizeVariable).filter(Boolean);
    const unavailable = requestedVariables.filter(variable => !completeMemberMatrix(run, variable));
    const timesMs = (run.times_ms || []).map(Number);
    if (timesMs.length < 2) throw new Error('De gekozen run bevat geen geldige tijdas.');
    const meta = archiveMeta(run);
    const iso = value => new Date(value).toISOString().slice(0, 16);
    const hourly = { time: [...timesMs.map(iso), iso(meta.data_end_time * 1000)] };
    const hourly_units = { time: 'iso8601' };
    for (const variable of requestedVariables) {
      const matrix = completeMemberMatrix(run, variable) || Array.from({ length: 51 }, () => Array(timesMs.length).fill(null));
      matrix.forEach((series, index) => {
        const key = index === 0 ? variable : `${variable}_member${String(index).padStart(2, '0')}`;
        hourly[key] = series;
        hourly_units[key] = unitFor(variable, url);
      });
    }
    const hresRun = run.source && run.source.hres && run.source.hres.run_initialisation;
    const hresTemp = Array.isArray(run.temp_hres) ? run.temp_hres : null;
    const hresPrecip = Array.isArray(run.precip_hres) ? run.precip_hres : null;
    const exactHres = Date.parse(hresRun || '') === new Date(run.run).getTime()
      && hresTemp && hresPrecip
      && hresTemp.length === timesMs.length && hresPrecip.length === timesMs.length;
    const weerlabHres = exactHres ? {
      run: new Date(hresRun).toISOString(),
      time: timesMs.map(iso),
      temperature_2m: hresTemp,
      precipitation: hresPrecip,
      precipitation_alignment: run.source.hres.precipitation_alignment || 'sum_preceding_intervals',
      aligned_to_ensemble: true,
    } : null;
    if (weerlabHres) {
      for (const variable of [
        'wind_speed_10m', 'wind_direction_10m', 'cloud_cover',
        'wind_gusts_10m', 'cape',
      ]) {
        const matrix = completeMemberMatrix(run, variable);
        if (matrix) {
          weerlabHres[variable] = matrix[0];
        }
      }
    }
    return {
      latitude: Number(run.source && run.source.grid_latitude) || Number(document.lat),
      longitude: Number(run.source && run.source.grid_longitude) || Number(document.lon),
      elevation: Number(run.source && run.source.grid_elevation) || 0,
      generationtime_ms: 0,
      utc_offset_seconds: 0,
      timezone: 'GMT', timezone_abbreviation: 'GMT', hourly_units, hourly,
      weerlab_run: run.run,
      weerlab_unavailable_variables: unavailable,
      ...(weerlabHres ? { weerlab_hres: weerlabHres } : {}),
    };
  }

  async function archiveForRequest(url) {
    const lat = Number(url.searchParams.get('latitude'));
    const lon = Number(url.searchParams.get('longitude'));
    const station = nearestStation(lat, lon);
    if (!station) {
      throw new Error('Deze eerdere ECMWF-run is voor deze vrije plaats nog niet gearchiveerd. Kies de actuele run of een plaats binnen het pluimarchief.');
    }
    return loadArchive(station.slug);
  }

  function setStatus(text, warning = false) {
    if (!state.status) return;
    state.status.textContent = text;
    state.status.style.color = warning ? '#fecaca' : '#cbd5e1';
  }

  function renderBar() {
    if (document.getElementById('weerlab-run-switcher')) return;
    const style = document.createElement('style');
    style.textContent = `
      #weerlab-run-switcher{position:sticky;top:0;z-index:9998;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;padding:9px 12px;background:#071a33;color:#e2e8f0;border-bottom:1px solid #284766;box-shadow:0 7px 18px rgba(2,12,27,.32);font:700 12px/1.25 Inter,Arial,sans-serif}
      #weerlab-run-switcher .wrs-label{color:#9fb8d4;text-transform:uppercase;letter-spacing:.07em;font-size:10px}
      #weerlab-run-switcher button{border:1px solid #456482;border-radius:999px;background:#122b47;color:#e5eef8;padding:7px 12px;font:800 12px/1 Inter,Arial,sans-serif;cursor:pointer}
      #weerlab-run-switcher button:hover:not(:disabled){background:#1d4266;border-color:#6ca6d8}
      #weerlab-run-switcher button[aria-pressed="true"]{background:#0ea5e9;color:#042033;border-color:#67e8f9;box-shadow:0 0 0 2px rgba(103,232,249,.16)}
      #weerlab-run-switcher button:disabled{opacity:.42;cursor:not-allowed}
      #weerlab-run-switcher .wrs-status{color:#cbd5e1;font-weight:650;margin-left:4px}
      body.weerlab-plume-page>#weerlab-run-switcher~#root{height:calc(100vh - 46px)!important}
      body.weerlab-plume-page>#weerlab-run-switcher~#pin-gate{top:46px!important}
    `;
    document.head.appendChild(style);
    const bar = document.createElement('div');
    bar.id = 'weerlab-run-switcher';
    bar.innerHTML = `<span class="wrs-label">ECMWF-run</span>${CYCLES.map(hour =>
      `<button type="button" data-run-hour="${hour}" aria-pressed="false">${String(hour).padStart(2, '0')} UTC</button>`
    ).join('')}<span class="wrs-status">Runs controleren…</span>`;
    document.body.insertBefore(bar, document.body.firstChild);
    state.bar = bar;
    state.status = bar.querySelector('.wrs-status');
    bar.addEventListener('click', async event => {
      const button = event.target.closest('button[data-run-hour]');
      if (!button || button.disabled) return;
      const previousHour = state.selectedHour;
      button.disabled = true;
      try {
        const detail = await selectRunHour(Number(button.dataset.runHour));
        // De Kaarten Editor luistert zelf naar weerlab:plume-run-change en kan
        // daardoor naadloos opnieuw tekenen. De losse pluimpagina's bouwen hun
        // grafieken alleen bij het laden op. Start die na een echte runwissel
        // opnieuw; ?run=HH staat dan al in de URL en houdt alle data coherent.
        if (!editorModeAware && previousHour !== detail.hour) {
          location.reload();
          return;
        }
      } catch (error) {
        setStatus(error && error.message || 'Deze run kon niet worden gekozen.', true);
      } finally {
        syncBar();
      }
    });
    syncBar();
  }

  function syncBar() {
    if (!state.bar) return;
    const visible = !editorModeAware || state.editorMode === 'plume';
    state.bar.style.display = visible ? 'flex' : 'none';
    document.body.classList.toggle('weerlab-plume-page', visible);
    const referenceMeta = state.liveMeta || state.directMeta;
    const liveHour = referenceMeta
      ? new Date(Number(referenceMeta.last_run_initialisation_time) * 1000).getUTCHours()
      : null;
    for (const button of state.bar.querySelectorAll('button[data-run-hour]')) {
      const hour = Number(button.dataset.runHour);
      const newestCandidate = newestForHour(state.archive, hour);
      const option = selectableRunForHour(state.archive, hour);
      const archived = option && option.run;
      const available = !!option;
      button.disabled = !available;
      button.setAttribute('aria-pressed', String(hour === state.selectedHour));
      const run = archived;
      const coverage = run ? Math.round((archiveMeta(run).data_end_time - archiveMeta(run).last_run_initialisation_time) / 3600 / 24) : null;
      const label = `${String(hour).padStart(2, '0')} UTC`;
      const liveMs = latestReferenceMs();
      const staleHours = newestCandidate && Number.isFinite(liveMs)
        ? Math.round((liveMs - Date.parse(newestCandidate.run)) / HOUR_MS)
        : null;
      const readyLabel = run && sourceReadyLabel(run);
      const observedLabel = run && sourceObservedLabel(run);
      button.title = available
        ? `${label} ${coverage ? `· circa ${coverage} dagen` : '· actuele run'}${readyLabel ? ` · ECMWF-tijd ${readyLabel}` : ''}${observedLabel ? ` · hier gezien ${observedLabel}` : ''}`
        : newestCandidate && !currentArchivedRunForHour(state.archive, hour)
          ? `${label} ontbreekt in de actuele reeks; de laatste ${label}-run is ${staleHours} uur ouder dan de bronrun en wordt niet als vervanger getoond`
          : `${label} is voor deze pluim nog niet volledig in het archief aangekomen`;
    }
    const selected = String(state.selectedHour == null ? '--' : state.selectedHour).padStart(2, '0');
    if (liveHour == null) {
      setStatus('Runs controleren…');
    } else if (state.locationFallback) {
      setStatus(`${selected} UTC · vrije plaats via actuele Open-Meteo-run`);
    } else if (state.capabilityFallbackRun) {
      setStatus(`${selected} UTC · specialistisch veld via actuele Open-Meteo-run`);
    } else if (state.requestedUnavailableHour != null) {
      const missing = String(state.requestedUnavailableHour).padStart(2, '0');
      setStatus(`${missing} UTC ontbreekt in de actuele reeks · ${selected} UTC getoond`, true);
    } else if (!state.archive && !state.archiveError) {
      setStatus(`${selected} UTC · runarchief laden…`);
    } else if (!selectableRunForHour(state.archive, state.selectedHour)) {
      setStatus(`${selected} UTC is nog niet beschikbaar`, true);
    } else {
      const direct = !!state.selectedRun && state.selectedRun.source &&
        state.selectedRun.source.access === 'direct_grib2_range_requests';
      const readyLabel = direct && sourceReadyLabel(state.selectedRun);
      const observedLabel = direct && sourceObservedLabel(state.selectedRun);
      setStatus(`${selected} UTC ${direct
        ? `· rechtstreeks ECMWF${readyLabel ? ` · ECMWF-tijd ${readyLabel}` : ''}${observedLabel ? ` · hier gezien ${observedLabel}` : ''} · exacte run`
        : state.selectedRun ? '· gearchiveerde exacte run' : '· actuele Open-Meteo-run'}`);
    }
  }

  function sourceReadyLabel(run) {
    // Alleen de expliciet geverifieerde bronindextijd zo noemen. Oude runs
    // hebben in `availability` nog de lokale verwerkingstijd staan.
    const value = run && run.source && run.source.source_ready;
    const date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return '';
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    return `${day}-${month} ${hour}:${minute} UTC`;
  }

  function sourceObservedLabel(run) {
    const value = run && run.source && run.source.discovered;
    const date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return '';
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    return `${day}-${month} ${hour}:${minute} UTC`;
  }

  window.addEventListener('weerlab:editor-mode-change', event => {
    if (!editorModeAware) return;
    state.editorMode = event.detail && event.detail.mode || 'landelijk';
    syncBar();
  });

  async function fetchLiveMeta() {
    const response = await originalFetch(`${META_URL}?_weerlab_switcher=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`metadata HTTP ${response.status}`);
    const meta = await response.json();
    if (!Number.isFinite(Number(meta.last_run_initialisation_time))) throw new Error('ongeldige runmetadata');
    return meta;
  }

  async function fetchDirectMeta() {
    let lastError = null;
    for (const root of DATA_ROOTS) {
      try {
        const response = await originalFetch(
          `${root}/${DIRECT_META_NAME}?_weerlab_switcher=${Date.now()}`,
          { cache: 'no-store' },
        );
        if (!response.ok) throw new Error(`directe metadata HTTP ${response.status}`);
        const meta = await response.json();
        if (meta.complete !== true || !Number.isFinite(Number(meta.last_run_initialisation_time))) {
          throw new Error('ongeldige directe runmetadata');
        }
        return meta;
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('directe runmetadata niet beschikbaar');
  }

  async function fetchArchiveManifest() {
    let lastError = null;
    for (const root of DATA_ROOTS) {
      try {
        const response = await originalFetch(
          `${root}/${ARCHIVE_META_NAME}?_weerlab_switcher=${Date.now()}`,
          { cache: 'no-store' },
        );
        if (!response.ok) throw new Error(`archiefmanifest HTTP ${response.status}`);
        const manifest = await response.json();
        if (manifest.complete !== true || !Array.isArray(manifest.runs) ||
            Number(manifest.station_count) !== stations.length ||
            Number(manifest.member_count) !== 51) {
          throw new Error('ongeldig archiefmanifest');
        }
        return manifest;
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('archiefmanifest niet beschikbaar');
  }

  function newestSourceMeta() {
    const liveMs = metaRunMs(state.liveMeta);
    const directMs = metaRunMs(state.directMeta);
    return Number.isFinite(directMs) && (!Number.isFinite(liveMs) || directMs > liveMs)
      ? state.directMeta : state.liveMeta;
  }

  function liveHour() {
    return state.liveMeta
      ? new Date(Number(state.liveMeta.last_run_initialisation_time) * 1000).getUTCHours()
      : null;
  }

  async function initialiseMeta() {
    try {
      const [liveResult, directResult, archiveResult] = await Promise.allSettled([
        fetchLiveMeta(), fetchDirectMeta(), fetchArchiveManifest(),
      ]);
      if (liveResult.status === 'fulfilled') state.liveMeta = liveResult.value;
      if (directResult.status === 'fulfilled') state.directMeta = directResult.value;
      if (archiveResult.status === 'fulfilled') state.archiveManifest = archiveResult.value;
      if (!state.liveMeta && !state.directMeta) {
        throw liveResult.reason || directResult.reason || new Error('geen runmetadata beschikbaar');
      }
      state.liveMetaFetchedAt = Date.now();
      // De eerste metadata-aanvraag van de pluim kan deze zojuist opgehaalde
      // response hergebruiken. De tweede coherentiecontrole blijft wel vers.
      state.reusableMetaResponses = 1;
      if (state.selectedHour == null) {
        const current = newestSourceMeta();
        const currentHour = current
          ? new Date(Number(current.last_run_initialisation_time) * 1000).getUTCHours()
          : null;
        state.selectedHour = CYCLES.includes(currentHour) ? currentHour : (currentHour >= 12 ? 12 : 0);
      }
      syncBar();
      return newestSourceMeta();
    } catch (error) {
      setStatus(`Runkeuze niet beschikbaar: ${error.message}`, true);
      throw error;
    }
  }

  function waitForArchiveSlot() {
    // Een expliciet gekozen oude run heeft het archief direct nodig. Dat geldt
    // net zo goed wanneer de bron op een 06/18-tussenrun staat: de getoonde
    // 00/12-pluim komt dan volledig uit dit bestand, zodat wachten op een
    // rustig moment de enige gegevensbron seconden zou vertragen. Alleen bij de
    // actuele bronrun voedt het archief niets meer dan de knopstatus en krijgt
    // de veel belangrijkere ensemble-aanvraag voorrang.
    const directMs = metaRunMs(state.directMeta);
    const liveMs = metaRunMs(state.liveMeta);
    const directIsCurrent = Number.isFinite(directMs) &&
      (!Number.isFinite(liveMs) || directMs >= liveMs);
    if (requestedHour != null || directIsCurrent || state.selectedHour !== liveHour()) return Promise.resolve();
    return new Promise(resolve => {
      if ('requestIdleCallback' in window) window.requestIdleCallback(resolve, { timeout: 2500 });
      else window.setTimeout(resolve, 750);
    });
  }

  function archiveNeededForSelection() {
    const directMs = metaRunMs(state.directMeta);
    const liveMs = metaRunMs(state.liveMeta);
    const directFields = new Set(state.directMeta && state.directMeta.fields || []);
    const directCanServePage = state.directMeta?.complete === true
      && Number(state.directMeta.station_count) === stations.length
      && Number(state.directMeta.member_count) === 51
      && requiredVariables.every(variable => directFields.has(normalizeVariable(variable)));
    const newestMs = latestReferenceMs();
    const archiveEntry = archiveManifestEntryForMs(newestMs);
    const archiveCanServePage = !!archiveEntry && archiveManifestAllows(
      { run: new Date(newestMs).toISOString() }, requiredVariables,
    );
    return requestedHour != null
      || (directCanServePage && Number.isFinite(directMs)
        && (!Number.isFinite(liveMs) || directMs >= liveMs))
      || archiveCanServePage
      || state.selectedHour !== liveHour();
  }

  async function initialiseArchive() {
    await waitForArchiveSlot();
    try {
      state.archive = await loadArchive('debilt');
      const preferred = requestedHour == null
        ? newestSelectableRun(state.archive)
        : selectableRunForHour(state.archive, state.selectedHour);
      if (preferred) {
        state.selectedHour = preferred.hour;
        state.selectedRun = preferred.run;
      } else {
        if (requestedHour != null) state.requestedUnavailableHour = state.selectedHour;
        const fallback = newestSelectableRun(state.archive);
        state.selectedHour = fallback ? fallback.hour : liveHour();
        state.selectedRun = fallback ? fallback.run : null;
      }
      if (parsedRequestedHour != null && parsedRequestedHour !== state.selectedHour) {
        const url = new URL(location.href);
        url.searchParams.set('run', String(state.selectedHour).padStart(2, '0'));
        history.replaceState(null, '', url);
      }
      syncBar();
      return state.archive;
    } catch (error) {
      state.archiveError = error;
      state.archive = null;
      state.selectedRun = null;
      state.capabilityFallbackRun = null;
      state.locationFallbackRun = null;
      state.locationFallback = false;
      if (state.liveMeta) {
        state.selectedHour = liveHour();
        if (requestedHour != null) state.requestedUnavailableHour = requestedHour;
        const url = new URL(location.href);
        url.searchParams.set('run', String(state.selectedHour).padStart(2, '0'));
        history.replaceState(null, '', url);
      } else {
        setStatus(`Direct ECMWF-archief niet beschikbaar: ${error.message}`, true);
        throw error;
      }
      syncBar();
      return null;
    }
  }

  // Direct ECMWF rondt de vier ENS-runs grofweg zeven uur na initialisatie af.
  // Controleer rond 18Z, 00Z, 06Z en 12Z iedere minuut; buiten deze vensters is
  // een nieuwe directe run niet te verwachten. Tijden zijn UTC.
  const RUN_WINDOWS_UTC = [
    [30, 2 * 60 + 30],
    [7 * 60, 10 * 60 + 30],
    [12 * 60 + 30, 15 * 60],
    [19 * 60, 22 * 60 + 30],
  ];

  function inRunArrivalWindow(date = new Date()) {
    const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    return RUN_WINDOWS_UTC.some(([from, until]) =>
      (minutes >= from && minutes <= until) || (until > 24 * 60 && minutes <= until - 24 * 60));
  }

  async function checkForNewRun() {
    if (document.hidden) return;
    try {
      const arrivalWindow = inRunArrivalWindow();
      const watchedRun = state.selectedRun || state.capabilityFallbackRun;
      const selectedRunMs = Date.parse(watchedRun?.run || selectedRunIso() || '');
      const previous = sourceStateTag();
      const previousArchive = archiveManifestTag();
      const previousSelectedSource = sourceStateForRun(selectedRunMs);
      const previousRequestedSource = sourceStateForHour(requestedHour);
      const results = await Promise.allSettled(arrivalWindow
        ? [fetchLiveMeta(), fetchDirectMeta(), fetchArchiveManifest()]
        : [fetchArchiveManifest()]);
      const [liveResult, directResult, archiveResult] = arrivalWindow
        ? results
        : [{ status: 'skipped' }, { status: 'skipped' }, results[0]];
      if (liveResult.status === 'fulfilled') state.liveMeta = liveResult.value;
      if (directResult.status === 'fulfilled') state.directMeta = directResult.value;
      if (archiveResult.status === 'fulfilled') state.archiveManifest = archiveResult.value;
      const archiveChanged = archiveManifestTag() !== previousArchive;
      if (archiveChanged) {
        archiveCache.clear();
        if (!editorModeAware || state.editorMode === 'plume') {
          setStatus('Dezelfde ECMWF-run is met extra velden verrijkt · pluim vernieuwen…');
          window.setTimeout(() => location.reload(), 500);
          return;
        }
        syncBar();
        return;
      }
      if (!arrivalWindow) return;
      const next = sourceStateTag();
      if (next === previous) return;
      const selectedSourceChanged = sourceStateForRun(selectedRunMs) !== previousSelectedSource;
      const requestedSourceChanged = requestedHour != null
        && sourceStateForHour(requestedHour) !== previousRequestedSource;
      state.liveMetaFetchedAt = Date.now();
      const freshRunMs = latestReferenceMs();
      const freshHour = new Date(freshRunMs).getUTCHours();
      if (CYCLES.includes(freshHour)
          && (requestedHour == null || selectedSourceChanged || requestedSourceChanged)) {
        setStatus(`Nieuwe ${String(freshHour).padStart(2, '0')} UTC-run beschikbaar · pluim vernieuwen…`);
        window.setTimeout(() => location.reload(), 500);
        return;
      }
      syncBar();
    } catch (_) {
      // Een tijdelijke metadatafout mag de al geladen pluim niet verstoren.
    }
  }

  async function createRunContext(hour) {
    await state.metaReady;
    const selectedHour = Number(hour);
    if (!CYCLES.includes(selectedHour)) throw new Error(`Ongeldige ECMWF-cyclus: ${hour}`);
    await state.archiveReady;
    const option = selectableRunForHour(state.archive, selectedHour);
    if (!option) {
      throw new Error(`De ${String(selectedHour).padStart(2, '0')} UTC-run is nog niet in het pluimarchief beschikbaar.`);
    }
    const selectedRun = option.run;
    const contextMeta = selectedRun ? archiveMeta(selectedRun) : { ...state.liveMeta };
    const contextFetch = async (input, init) => {
      const url = parseUrl(input);
      if (!isEnsMeta(url) && !isEnsRequest(url)) return originalFetch(input, init);
      if (!selectedRun) return originalFetch(input, init);
      if (isEnsMeta(url)) return jsonResponse(contextMeta);
      const document = await archiveForRequest(url);
      const exactRun = (document.runs || []).find(item => item.run === selectedRun.run);
      if (!exactRun) throw new Error(`De exacte ${String(selectedHour).padStart(2, '0')} UTC-run ontbreekt voor deze plaats.`);
      return jsonResponse(archiveEnsembleResponse(document, exactRun, url));
    };
    return Object.freeze({
      hour: selectedHour,
      runId: selectedRun ? selectedRun.run : new Date(contextMeta.last_run_initialisation_time * 1000).toISOString(),
      archived: !!selectedRun,
      meta: Object.freeze({ ...contextMeta }),
      fetch: contextFetch,
    });
  }

  async function ensureLocation(lat, lon) {
    await state.metaReady;
    if (archiveNeededForSelection() || state.locationFallbackRun) await state.archiveReady;
    const station = nearestStation(Number(lat), Number(lon));
    if (station) {
      const savedRun = state.locationFallbackRun;
      if (!state.selectedRun && state.locationFallback && savedRun
          && publishedRunAllows(savedRun) && runHasRequiredVariables(savedRun)) {
        state.selectedRun = savedRun;
        state.selectedHour = runHour(savedRun);
        state.reusableMetaResponses = 0;
        const pageUrl = new URL(location.href);
        pageUrl.searchParams.set('run', String(state.selectedHour).padStart(2, '0'));
        history.replaceState(null, '', pageUrl);
      }
      state.locationFallback = false;
      state.locationFallbackRun = null;
      syncBar();
      return {
        archived: !!state.selectedRun,
        station: station.slug,
        restored: !!savedRun && !!state.selectedRun,
        fallback: false,
      };
    }
    if (!state.liveMeta) {
      throw new Error('Deze vrije plaats valt buiten het directe ECMWF-archief en de live terugvalbron is niet beschikbaar.');
    }
    if (!state.selectedRun) {
      state.locationFallbackRun = state.locationFallbackRun || state.capabilityFallbackRun;
      state.capabilityFallbackRun = null;
      state.selectedHour = liveHour();
      state.locationFallback = true;
      state.requestedUnavailableHour = null;
      state.reusableMetaResponses = 1;
      const pageUrl = new URL(location.href);
      pageUrl.searchParams.set('run', String(state.selectedHour).padStart(2, '0'));
      history.replaceState(null, '', pageUrl);
      syncBar();
      return { archived: false, fallback: true };
    }
    state.locationFallbackRun = state.selectedRun;
    state.selectedRun = null;
    state.capabilityFallbackRun = null;
    state.selectedHour = liveHour();
    state.locationFallback = true;
    state.requestedUnavailableHour = null;
    state.reusableMetaResponses = 1;
    const pageUrl = new URL(location.href);
    pageUrl.searchParams.set('run', String(state.selectedHour).padStart(2, '0'));
    history.replaceState(null, '', pageUrl);
    syncBar();
    return { archived: false, fallback: true };
  }

  async function ensureVariables(variables) {
    const requestedVariables = [...new Set((Array.isArray(variables) ? variables : [variables])
      .map(normalizeVariable).filter(Boolean))];
    await state.metaReady;
    if (archiveNeededForSelection() || state.selectedRun || state.capabilityFallbackRun) {
      await state.archiveReady;
    }

    const savedRun = state.capabilityFallbackRun;
    if (!state.selectedRun && savedRun && !state.locationFallback
        && publishedRunAllows(savedRun, requestedVariables) && runHasVariables(savedRun, requestedVariables)) {
      state.selectedRun = savedRun;
      state.selectedHour = runHour(savedRun);
      state.capabilityFallbackRun = null;
      state.locationFallbackRun = null;
      state.reusableMetaResponses = 0;
      const pageUrl = new URL(location.href);
      pageUrl.searchParams.set('run', String(state.selectedHour).padStart(2, '0'));
      history.replaceState(null, '', pageUrl);
      syncBar();
      return { archived: true, restored: true, fallback: false };
    }

    if (!state.selectedRun) {
      return { archived: false, fallback: !!state.capabilityFallbackRun };
    }
    const missing = requestedVariables.filter(variable =>
      !publishedRunAllows(state.selectedRun, [variable]) || !completeMemberMatrix(state.selectedRun, variable));
    if (!missing.length) return { archived: true, fallback: false };
    if (!state.liveMeta) {
      throw new Error(`De directe ECMWF-run bevat ${missing.join(', ')} nog niet en de actuele Open-Meteo-terugvalbron is niet beschikbaar.`);
    }

    state.capabilityFallbackRun = state.selectedRun;
    state.locationFallbackRun = null;
    state.selectedRun = null;
    state.selectedHour = liveHour();
    state.locationFallback = false;
    state.requestedUnavailableHour = null;
    state.reusableMetaResponses = 1;
    const pageUrl = new URL(location.href);
    pageUrl.searchParams.set('run', String(state.selectedHour).padStart(2, '0'));
    history.replaceState(null, '', pageUrl);
    syncBar();
    return { archived: false, fallback: true, missing };
  }

  async function selectRunHour(hour) {
    await state.metaReady;
    const selectedHour = Number(hour);
    if (!CYCLES.includes(selectedHour)) throw new Error(`Ongeldige ECMWF-cyclus: ${hour}`);
    await state.archiveReady;
    const option = selectableRunForHour(state.archive, selectedHour);
    const candidate = option && option.run;
    if (!option) {
      throw new Error(`De ${String(selectedHour).padStart(2, '0')} UTC-run is nog niet volledig beschikbaar.`);
    }
    state.selectedHour = selectedHour;
    state.selectedRun = candidate;
    state.capabilityFallbackRun = null;
    state.locationFallbackRun = null;
    state.locationFallback = false;
    state.requestedUnavailableHour = null;
    const url = new URL(location.href);
    url.searchParams.set('run', String(selectedHour).padStart(2, '0'));
    history.replaceState(null, '', url);
    syncBar();
    const detail = { hour: selectedHour, run: selectedRunIso(), archived: !!candidate };
    window.dispatchEvent(new CustomEvent('weerlab:plume-run-change', { detail }));
    return detail;
  }

  async function withRunHour(hour, task) {
    if (typeof task !== 'function') throw new Error('Runtaak ontbreekt.');
    const context = await createRunContext(hour);
    return task(context);
  }

  function selectedMeta() {
    return state.selectedRun ? archiveMeta(state.selectedRun) : state.liveMeta;
  }

  function selectedRunIso() {
    const seconds = Number(selectedMeta() && selectedMeta().last_run_initialisation_time);
    return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
  }

  function assertRunResponse(data, sourceLabel = 'ECMWF-bron') {
    const expected = selectedRunIso();
    const first = data && data.hourly && data.hourly.time && data.hourly.time[0];
    if (!expected || !first || Date.parse(first + (String(first).endsWith('Z') ? '' : 'Z')) !== Date.parse(expected)) {
      throw new Error(`${sourceLabel} hoort niet bij de gekozen ECMWF-run`);
    }
    if (data.weerlab_run && Date.parse(data.weerlab_run) !== Date.parse(expected)) {
      throw new Error(`${sourceLabel} bevat een andere ECMWF-run`);
    }
    return data;
  }

  state.metaReady = initialiseMeta();
  state.archiveReady = state.metaReady.then(initialiseArchive, () => null);
  state.ready = state.metaReady.then(async () => {
    if (archiveNeededForSelection()) await state.archiveReady;
  });

  window.fetch = async function weerlabRunAwareFetch(input, init) {
    const url = parseUrl(input);
    if (!isEnsMeta(url) && !isEnsRequest(url)) return originalFetch(input, init);
    await state.metaReady;
    if (!archiveNeededForSelection()) {
      if (isEnsMeta(url) && state.reusableMetaResponses > 0 && Date.now() - state.liveMetaFetchedAt < 15000) {
        state.reusableMetaResponses -= 1;
        return jsonResponse(state.liveMeta);
      }
      return originalFetch(input, init);
    }
    await state.archiveReady;
    if (!state.selectedRun) {
      if (isEnsMeta(url) && state.reusableMetaResponses > 0 && Date.now() - state.liveMetaFetchedAt < 15000) {
        state.reusableMetaResponses -= 1;
        return jsonResponse(state.liveMeta);
      }
      return originalFetch(input, init);
    }
    if (isEnsMeta(url)) return jsonResponse(archiveMeta(state.selectedRun));
    const document = await archiveForRequest(url);
    const run = (document.runs || []).find(item => item.run === state.selectedRun.run);
    if (!run) throw new Error(`De ${String(state.selectedHour).padStart(2, '0')} UTC-run ontbreekt voor deze plaats.`);
    return jsonResponse(archiveEnsembleResponse(document, run, url));
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderBar, { once: true });
  else renderBar();

  // Rond de vrijgavemomenten van alle vier cycli iedere minuut controleren
  // zolang de pagina open en zichtbaar is.
  window.setInterval(checkForNewRun, 60 * 1000);

  window.WeerlabPlumeRuns = {
    state, newestForHour, currentArchivedRunForHour, archiveMeta, membersFor, withRunHour,
    createRunContext, selectRunHour, ensureLocation, ensureVariables, selectedMeta, selectedRunIso,
    assertRunResponse, completeMemberMatrix, fetchFreshMeta: fetchLiveMeta,
  };
})();
