/**
 * weerbewaking_pluim_export.js
 *
 * Genereert rustige losse kleurpluim-PNG's voor de Weerbewaking RRDK PDF-export:
 * temperatuur, neerslagkans, neerslag in mm, cumulatieve neerslag, wind,
 * windstoten,
 * zon/bewolking en onweer.
 *
 * Publieke functie:
 *   WBPluimExport.genereerLossePluimenPNGs({lat, lon, naam, startDate, endDate, runHour}) -> Promise
 */
(function(){
  const PlumeMath = window.WeerlabPlumeMath;
  if (!PlumeMath) throw new Error('pluim_math.js ontbreekt');
  const ENS_URL = 'https://ensemble-api.open-meteo.com/v1/ensemble';
  const DOW_NL = ['zo','ma','di','wo','do','vr','za'];
  const MAAND_NL = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  const FORECAST_DAYS = 15;
  const ECMWF_ENS_META_URL = 'https://ensemble-api.open-meteo.com/data/ecmwf_ifs025_ensemble/static/meta.json';

  const PAGE_W = 1400;
  const PAGE_MARGIN = 64;
  const HEADER_H = 142;
  const CARD_GAP = 28;
  const FOOTER_H = 70;
  const CARD_PAD = 18;
  const CHART_SRC_W = 820;
  const CHART_SRC_H = 290;
  const CLOUD_CATS = [
    { label: 'Onbewolkt', lo: 0, hi: 12, color: '#f5e642' },
    { label: 'Licht bewolkt', lo: 12, hi: 37, color: '#dcd28c' },
    { label: 'Half bewolkt', lo: 37, hi: 62, color: '#a09464' },
    { label: 'Zwaar bewolkt', lo: 62, hi: 87, color: '#828296' },
    { label: 'Geheel bewolkt', lo: 87, hi: 101, color: '#373746' },
  ];

  const OM_PROXY_BASE = (location.protocol === 'https:' && /(^|\.)weerlab\.nl$/.test(location.hostname))
    ? 'https://om.weerlab.nl/om'
    : null;

  function rewriteOM(url) {
    if (!OM_PROXY_BASE) return url;
    const from = 'https://ensemble-api.open-meteo.com/v1/ensemble';
    if (url.startsWith(from)) return `${OM_PROXY_BASE}/ensemble${url.slice(from.length)}`;
    return url;
  }

  function addFreshParam(url) {
    if (!OM_PROXY_BASE) return url;
    const u = new URL(url, location.href);
    u.searchParams.set('_weerlab_fresh', '1');
    return u.toString();
  }

  async function fetchJson(url, ms = 30000, retries = 3, runContext = null) {
    url = addFreshParam(rewriteOM(url));
    for (let poging = 0; poging < retries; poging++) {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), ms);
      try {
        const transport = runContext?.fetch || window.fetch.bind(window);
        const r = await transport(url, { signal: ctrl.signal, cache: OM_PROXY_BASE ? 'no-store' : 'default' });
        clearTimeout(id);
        if (r.status === 429 && poging < retries - 1) {
          await new Promise(res => setTimeout(res, 2000 * (poging + 1)));
          continue;
        }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      } catch (e) {
        clearTimeout(id);
        if (poging === retries - 1) {
          throw new Error(e.name === 'AbortError' ? 'time-out' : e.message);
        }
        await new Promise(res => setTimeout(res, 1200 * (poging + 1)));
      }
    }
  }

  function verifiedRunMeta(meta) {
    const init = Number(meta?.last_run_initialisation_time);
    const end = Number(meta?.data_end_time);
    if (!Number.isFinite(init) || init <= 0 || !Number.isFinite(end) || end < init) {
      throw new Error('ECMWF ENS-metadata bevat geen geldig runvenster');
    }
    return { ...meta, last_run_initialisation_time: init, data_end_time: end };
  }

  function sameRunSnapshot(before, after) {
    return Number(before?.last_run_initialisation_time) === Number(after?.last_run_initialisation_time)
      && Number(before?.data_end_time) === Number(after?.data_end_time)
      && String(before?.last_run_modification_time || '') === String(after?.last_run_modification_time || '');
  }

  async function fetchRunMeta(runContext = null) {
    if (runContext?.archived) return verifiedRunMeta(runContext.meta);
    const separator = ECMWF_ENS_META_URL.includes('?') ? '&' : '?';
    const transport = runContext?.fetch || window.fetch.bind(window);
    const response = await transport(`${ECMWF_ENS_META_URL}${separator}_weerlab_meta=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`ECMWF ENS-metadata HTTP ${response.status}`);
    return verifiedRunMeta(await response.json());
  }

  function boundResponseToRunMeta(data, runMeta) {
    const verified = verifiedRunMeta(runMeta);
    const hourly = data?.hourly;
    const times = Array.isArray(hourly?.time) ? hourly.time : [];
    const rawLength = times.length;
    if (!rawLength) throw new Error('Ensemble bevat geen tijdas');
    const startMs = verified.last_run_initialisation_time * 1000;
    const endMs = verified.data_end_time * 1000;
    const indexes = times.map((time, index) => ({ index, stamp: new Date(time).getTime() }))
      .filter(item => Number.isFinite(item.stamp) && item.stamp >= startMs && item.stamp <= endMs)
      .map(item => item.index);
    if (indexes.length < 2) throw new Error('Geen ensembledata binnen het geverifieerde runvenster');
    const boundedHourly = {};
    Object.entries(hourly).forEach(([key, values]) => {
      boundedHourly[key] = Array.isArray(values) && values.length === rawLength
        ? indexes.map(index => values[index])
        : values;
    });
    return { ...data, hourly: boundedHourly };
  }

  async function fetchStableEnsembleBatch(loader, runContext = null) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = await fetchRunMeta(runContext);
      const value = await loader(before);
      const after = await fetchRunMeta(runContext);
      if (sameRunSnapshot(before, after)) return { value, runMeta: before };
    }
    throw new Error('ECMWF ENS-run wijzigde tijdens de export; probeer opnieuw');
  }

  async function withRequestedRun(runHour, task) {
    if (runHour == null) return task(null);
    const hour = Number(runHour);
    if (!Number.isInteger(hour) || ![0, 6, 12, 18].includes(hour)) {
      throw new Error(`Ongeldige ECMWF-exportcyclus: ${runHour}`);
    }
    const selector = window.WeerlabPlumeRuns;
    if (!selector || typeof selector.withRunHour !== 'function') {
      throw new Error('De vaste ECMWF-run kon niet worden geselecteerd');
    }
    return selector.withRunHour(hour, task);
  }

  function isoDatum(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function verschuifIsoDatum(iso, dagen) {
    const [year, month, day] = String(iso).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + dagen));
    return date.toISOString().slice(0, 10);
  }

  function fmtDag(t) {
    const d = new Date(t);
    return `${DOW_NL[d.getDay()]} ${d.getDate()} ${MAAND_NL[d.getMonth()]}`;
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hexToRgb(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }

  function colorFromScale(scale, value) {
    if (!scale.length) return '#ffffff';
    for (let i = 0; i < scale.length - 1; i++) {
      const [v0, c0] = scale[i];
      const [v1, c1] = scale[i + 1];
      if (value <= v1) {
        const f = clamp((value - v0) / (v1 - v0), 0, 1);
        const [r0,g0,b0] = hexToRgb(c0);
        const [r1,g1,b1] = hexToRgb(c1);
        return `rgb(${Math.round(lerp(r0,r1,f))},${Math.round(lerp(g0,g1,f))},${Math.round(lerp(b0,b1,f))})`;
      }
    }
    return scale[scale.length - 1][1];
  }

  function scaleStops(scale, yMin, yMax) {
    const range = yMax - yMin || 1;
    return Array.from(new Set([
      yMin,
      yMax,
      ...scale.map(([value]) => clamp(value, yMin, yMax)),
    ]))
      .sort((a, b) => b - a)
      .map(value => ({
        offset: clamp((yMax - value) / range, 0, 1),
        color: colorFromScale(scale, value),
      }));
  }

  function percentiel(arr, p) {
    const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
    if (!s.length) return null;
    const idx = (p / 100) * (s.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  }

  function kmhToBft(kmh) {
    const limits = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
    for (let i = 0; i < limits.length; i++) {
      if (kmh < limits[i]) return i;
    }
    return 12;
  }

  function capeDuiding(cape) {
    if (!Number.isFinite(cape) || cape < 100) return 'stabiel';
    if (cape < 500) return 'licht onstabiel';
    if (cape < 1000) return 'matig onstabiel';
    if (cape < 2000) return 'flink onstabiel';
    if (cape < 3000) return 'zeer onstabiel';
    if (cape < 4000) return 'extreem onstabiel';
    return 'uitzonderlijk onstabiel';
  }

  function fmtValue(v, cfg) {
    if (!Number.isFinite(v)) return '-';
    const n = cfg.decimals == null ? Math.round(v) : v.toFixed(cfg.decimals);
    return `${n}${cfg.unit}`;
  }

  const PARAMS = {
    temp: {
      title: 'Temperatuurpluim',
      hourly: 'temperature_2m',
      unit: '\u00b0',
      decimals: 0,
      yStep: 5,
      minRange: 15,
      rangePad: 1,
      statusSuffix: 'mediaan + P10-P90 marge',
      lineLabel: 'Mediaan (P50)',
      bandLabel: 'Marge P10-P90',
      bandFill: 'rgba(255,255,255,0.38)',
      bandEdgeColor: 'rgba(7,24,45,0.82)',
      bandEdgeWidth: 1.1,
      medianHaloColor: 'rgba(7,24,45,0.92)',
      medianHaloWidth: 4,
      medianColor: '#ffffff',
      medianWidth: 2.1,
      smoothScale: true,
      backgroundOpacity: 0.74,
      dayLineColor: 'rgba(7,24,45,0.13)',
      gridLineColor: 'rgba(255,255,255,0.48)',
      gridLineWidth: 0.9,
      gridLineDash: [4, 4],
      curveSmoothPasses: 0,
      scale: [[-8,'#3d7158'],[0,'#589464'],[4,'#74a866'],[8,'#94b967'],[12,'#b8c465'],[15,'#d1c56a'],[18,'#dfb768'],[21,'#e3a061'],[25,'#d98259'],[30,'#c96358'],[40,'#934a55']],
      makeStats(times, members) {
        const stats = makeDefaultStats(times, members);
        stats.dailyMax = makeDailyMaxStats(times, members);
        return stats;
      },
      summary(stats) {
        const vals = (stats.dailyMax || stats).filter(s => Number.isFinite(s.p50));
        const warm = vals.reduce((a,b) => b.p50 > a.p50 ? b : a, vals[0]);
        const cool = vals.reduce((a,b) => b.p50 < a.p50 ? b : a, vals[0]);
        const spread = vals.reduce((a,b) => (b.p90-b.p10) > (a.p90-a.p10) ? b : a, vals[0]);
        return [
          `Hoogste maximumtemperatuur: ${fmtValue(warm.p50, this)} · ${fmtDag(warm.t)}`,
          `Laagste maximumtemperatuur: ${fmtValue(cool.p50, this)} · ${fmtDag(cool.t)}`,
          `Meeste onzekerheid maximum: ±${Math.round((spread.p90-spread.p10)/2)}\u00b0`,
        ];
      },
    },
    rain: {
      title: 'Neerslagkanspluim',
      hourly: 'precipitation',
      unit: '%',
      decimals: 0,
      yMin: 0,
      yMax: 100,
      yStep: 20,
      render: 'bars',
      barValue: 'p50',
      statusSuffix: '6-uurs neerslagkans + stevige neerslag',
      barLabel: 'Staafjes: kans op neerslag per 6 uur',
      percentLine: { key: 'heavy', label: 'Kans op minstens 1 mm/6u (%)', color: 'white' },
      legendItems: [
        { color: '#8bcf9d', label: 'kleine neerslagkans' },
        { color: '#19559b', label: 'grote neerslagkans' },
      ],
      scale: [[0,'#7fb65d'],[20,'#8bcf9d'],[40,'#5fb7c9'],[60,'#3287bf'],[80,'#19559b'],[100,'#102f67']],
      makeStats(times, members) {
        const agg = aggregateMembersByHours(times, members, 6);
        return agg.times.map((t, i) => {
          const vals = agg.members.map(m => m[i]).filter(Number.isFinite);
          const n = vals.length || 1;
          const chance = vals.filter(v => v >= 0.1).length / n * 100;
          const heavy = vals.filter(v => v >= 1.0).length / n * 100;
          return {
            t,
            p10: heavy,
            p50: chance,
            p90: chance,
            extra: { heavy, p90mm: percentiel(vals, 90) || 0 },
          };
        });
      },
      summary(stats) {
        const vals = stats.filter(s => Number.isFinite(s.p50));
        const peak = vals.reduce((a, b) => {
          const ar = Math.round(a.p50), br = Math.round(b.p50);
          if (br !== ar) return br > ar ? b : a;
          if ((b.extra?.p90mm || 0) !== (a.extra?.p90mm || 0)) return b.extra.p90mm > a.extra.p90mm ? b : a;
          return new Date(b.t) > new Date(a.t) ? b : a;
        }, vals[0]);
        const heavy = vals.reduce((a,b) => b.extra.heavy > a.extra.heavy ? b : a, vals[0]);
        const wet = vals.reduce((a,b) => b.extra.p90mm > a.extra.p90mm ? b : a, vals[0]);
        return [
          `Hoogste neerslagkans: ${Math.round(peak.p50)}% · ${fmtDag(peak.t)}`,
          `Kans ≥1 mm/6u: ${Math.round(heavy.extra.heavy)}%`,
          `Natste 6-uurs signaal: ${wet.extra.p90mm.toFixed(1)} mm`,
        ];
      },
    },
    rainmm: {
      title: 'Neerslagpluim (mm)',
      hourly: 'precipitation',
      unit: ' mm',
      decimals: 1,
      yMin: 0,
      yStep: 2,
      minRange: 8,
      leftAxis: 82,
      rangePad: 1,
      sampleStep: 1,
      statusSuffix: '6-uurs hoeveelheid in mm',
      lineLabel: 'Mediaan (middelste waarde)',
      bandLabel: '80% kans (P10-P90)',
      bandFill: 'rgba(50, 133, 86, 0.62)',
      bandEdgeColor: 'rgba(13, 78, 46, 0.72)',
      bandEdgeWidth: 1.25,
      medianHaloColor: 'rgba(255,255,255,0.92)',
      medianHaloWidth: 3.4,
      medianColor: '#111111',
      medianWidth: 1.8,
      smoothScale: true,
      backgroundOpacity: 0.2,
      dayLineColor: 'rgba(0,0,0,0.2)',
      gridLineColor: 'rgba(255,255,255,0.32)',
      gridLineWidth: 0.7,
      curveSmoothPasses: 0,
      scale: [[0,'#d7f3c9'],[0.5,'#addf9d'],[1,'#75c486'],[2,'#3ca06f'],[5,'#19744e'],[10,'#0f4a34'],[20,'#072d1f']],
      makeStats(times, members) {
        const agg = aggregateMembersByHours(times, members, 6);
        return agg.times.map((t, i) => {
          const vals = agg.members.map(m => m[i]).filter(Number.isFinite);
          return {
            t,
            pMin: vals.length ? Math.min(...vals) : 0,
            p10: percentiel(vals, 10) || 0,
            p50: percentiel(vals, 50) || 0,
            p90: percentiel(vals, 90) || 0,
            pMax: vals.length ? Math.max(...vals) : 0,
            extra: { chance: vals.length ? vals.filter(v => v >= 0.1).length / vals.length * 100 : 0 },
          };
        });
      },
      summary(stats) {
        const vals = stats.filter(s => Number.isFinite(s.p90));
        const wet = vals.reduce((a,b) => b.p90 > a.p90 ? b : a, vals[0]);
        const med = vals.reduce((a,b) => b.p50 > a.p50 ? b : a, vals[0]);
        const spread = vals.reduce((a,b) => (b.p90 - b.p10) > (a.p90 - a.p10) ? b : a, vals[0]);
        return [
          `Natste 6-uurs signaal: ${wet.p90.toFixed(1)} mm · ${fmtDag(wet.t)}`,
          `Breedste 80%-marge: ${spread.p10.toFixed(1)}-${spread.p90.toFixed(1)} mm`,
          `Mediaan max 6u: ${med.p50.toFixed(1)} mm`,
        ];
      },
    },
    raincum: {
      title: 'Neerslagsom cumulatief',
      hourly: 'precipitation',
      unit: ' mm',
      decimals: 0,
      yMin: 0,
      yStep: 5,
      minRange: 20,
      leftAxis: 76,
      rangePad: 2,
      medianMarkerDays: 5,
      statusSuffix: 'lopende neerslagsom vanaf start',
      lineLabel: 'Mediaan lopende som',
      bandLabel: 'Marge P10-P90',
      bandFill: 'rgba(255,255,255,0.34)',
      bandEdgeColor: 'rgba(6,38,25,0.70)',
      bandEdgeWidth: 1.6,
      medianHaloColor: 'rgba(6,38,25,0.82)',
      medianHaloWidth: 4,
      medianColor: '#ffffff',
      medianWidth: 2.1,
      scale: [[0,'#d7f3c9'],[2,'#addf9d'],[5,'#75c486'],[10,'#3ca06f'],[20,'#19744e'],[35,'#0f4a34'],[60,'#072d1f']],
      makeStats(times, members) {
        const agg = aggregateMembersByHours(times, members, 6);
        return makeDefaultStats(agg.times, cumulativeMembers(agg.members));
      },
      summary(stats) {
        const vals = stats.filter(s => Number.isFinite(s.p50));
        if (!vals.length) return [];
        const last = vals[vals.length - 1];
        const spread = vals.reduce((a,b) => (b.p90-b.p10) > (a.p90-a.p10) ? b : a, vals[0]);
        return [
          `Mediaan totaalsom: ${last.p50.toFixed(1)} mm`,
          `P10-P90 einde: ${last.p10.toFixed(1)}-${last.p90.toFixed(1)} mm`,
          `Meeste onzekerheid: ±${((spread.p90-spread.p10)/2).toFixed(1)} mm · ${fmtDag(spread.t)}`,
        ];
      },
    },
    wind: {
      title: 'Windpluim',
      hourly: 'wind_speed_10m',
      unit: ' km/u',
      decimals: 0,
      yMin: 0,
      yStep: 5,
      minRange: 40,
      rangePad: 5,
      leftAxis: 96,
      rightAxis: 'bft',
      statusSuffix: 'windsnelheid in km/u + Beaufort',
      lineLabel: 'Ensemble mediaan',
      bandLabel: 'Onzekerheidsband (P10-P90)',
      bandEdgeColor: 'rgba(17,35,47,0.72)',
      bandEdgeWidth: 1.1,
      medianHaloColor: 'rgba(10,25,35,0.78)',
      medianHaloWidth: 4,
      medianColor: '#ffffff',
      medianWidth: 2.1,
      scale: [[0,'#4d9b4d'],[15,'#9bc95c'],[25,'#d9c750'],[35,'#ef9a3a'],[50,'#d9573b'],[65,'#9f3251'],[90,'#50245f']],
      summary(stats) {
        const vals = stats.filter(s => Number.isFinite(s.p50));
        const peak = vals.reduce((a,b) => b.p50 > a.p50 ? b : a, vals[0]);
        const spread = vals.reduce((a,b) => (b.p90-b.p10) > (a.p90-a.p10) ? b : a, vals[0]);
        const gusty = vals.reduce((a,b) => b.p90 > a.p90 ? b : a, vals[0]);
        return [
          `Meeste wind: ${fmtValue(peak.p50, this)} (${kmhToBft(peak.p50)} Bft) · ${fmtDag(peak.t)}`,
          `Bovenkant ensemble: ${fmtValue(gusty.p90, this)} (${kmhToBft(gusty.p90)} Bft)`,
          `Meeste onzekerheid: ±${Math.round((spread.p90-spread.p10)/2)} km/u`,
        ];
      },
    },
    gust: {
      title: 'Windstotenpluim',
      hourly: 'wind_gusts_10m',
      unit: ' km/u',
      decimals: 0,
      yMin: 0,
      yStep: 10,
      minRange: 60,
      rangePad: 5,
      leftAxis: 96,
      statusSuffix: 'maximale windstoten in km/u',
      lineLabel: 'Ensemble mediaan windstoot',
      bandLabel: 'Onzekerheidsband windstoten (P10-P90)',
      bandEdgeColor: 'rgba(17,35,47,0.72)',
      bandEdgeWidth: 1.1,
      medianHaloColor: 'rgba(10,25,35,0.78)',
      medianHaloWidth: 4,
      medianColor: '#ffffff',
      medianWidth: 2.1,
      scale: [[0,'#4d9b4d'],[25,'#9bc95c'],[40,'#d9c750'],[55,'#ef9a3a'],[70,'#d9573b'],[85,'#9f3251'],[110,'#50245f'],[130,'#281235']],
      summary(stats) {
        const vals = stats.filter(s => Number.isFinite(s.p50));
        const peak = vals.reduce((a,b) => b.p50 > a.p50 ? b : a, vals[0]);
        const high = vals.reduce((a,b) => b.p90 > a.p90 ? b : a, vals[0]);
        const spread = vals.reduce((a,b) => (b.p90-b.p10) > (a.p90-a.p10) ? b : a, vals[0]);
        return [
          `Hoogste mediane windstoot: ${fmtValue(peak.p50, this)} · ${fmtDag(peak.t)}`,
          `Bovenkant ensemble: ${fmtValue(high.p90, this)} · ${fmtDag(high.t)}`,
          `Meeste onzekerheid: ±${Math.round((spread.p90-spread.p10)/2)} km/u`,
        ];
      },
    },
    cloud: {
      title: 'Zon/bewolkingspluim',
      hourly: 'cloud_cover',
      unit: '%',
      decimals: 0,
      yMin: 0,
      yMax: 100,
      yStep: 20,
      render: 'stacked',
      statusSuffix: 'kans per bewolkingsklasse',
      legendItems: CLOUD_CATS,
      stackItems: CLOUD_CATS,
      scale: [[0,'#eef2f4'],[100,'#eef2f4']],
      makeStats(times, members) {
        return times.map((t, i) => {
          const cloudVals = members.map(m => Number.isFinite(m[i]) ? clamp(m[i], 0, 100) : null)
            .filter(Number.isFinite);
          const sunVals = cloudVals.map(v => 100 - v);
          const stack = CLOUD_CATS.map(cat => {
            if (!cloudVals.length) return 0;
            return cloudVals.filter(v => v >= cat.lo && v < cat.hi).length / cloudVals.length * 100;
          });
          return {
            t,
            p10: percentiel(cloudVals, 10),
            p50: percentiel(cloudVals, 50),
            p90: percentiel(cloudVals, 90),
            extra: {
              stack,
              cloudP10: percentiel(cloudVals, 10),
              cloudP50: percentiel(cloudVals, 50),
              cloudP90: percentiel(cloudVals, 90),
              sunP50: percentiel(sunVals, 50),
            },
          };
        });
      },
      summary(stats) {
        const vals = stats.filter(s => Number.isFinite(s.p50));
        const sun = vals.reduce((a,b) => b.extra.sunP50 > a.extra.sunP50 ? b : a, vals[0]);
        const cloud = vals.reduce((a,b) => b.extra.cloudP50 > a.extra.cloudP50 ? b : a, vals[0]);
        const spread = vals.reduce((a,b) => (b.extra.cloudP90-b.extra.cloudP10) > (a.extra.cloudP90-a.extra.cloudP10) ? b : a, vals[0]);
        return [
          `Zonnigste moment: ${Math.round(sun.extra.sunP50)}% zon · ${fmtDag(sun.t)}`,
          `Meeste bewolking: ${Math.round(cloud.extra.cloudP50)}% bewolkt · ${fmtDag(cloud.t)}`,
          `Meeste spreiding bewolking: ±${Math.round((spread.extra.cloudP90-spread.extra.cloudP10)/2)}%`,
        ];
      },
    },
    thunder: {
      title: 'Onweerpluim',
      hourly: 'cape',
      unit: ' J/kg',
      decimals: 0,
      yMin: 0,
      yMax: 5000,
      yStep: 500,
      leftAxis: 78,
      rightAxis: 'percent',
      render: 'bars',
      barValue: 'p90',
      statusSuffix: 'CAPE P90 + onweerkans (intervalsom omgerekend naar ≥0,1 mm/u)',
      barLabel: 'Staafjes: bovenkant CAPE (P90)',
      percentLine: { key: 'thunderChance', label: 'Kans op onweer (%)', color: 'white' },
      legendItems: [
        { color: '#dfe5de', label: '0 stabiel' },
        { color: '#f0d66b', label: '100-500 licht' },
        { color: '#f0a64a', label: '500-1000 matig' },
        { color: '#d9573b', label: '1000-2000 flink' },
        { color: '#9f3251', label: '2000-3000 zeer' },
        { color: '#50245f', label: '3000-4000 extreem' },
        { color: '#120722', label: '>4000 uitzonderlijk' },
      ],
      scale: [[0,'#dfe5de'],[100,'#e9e3a8'],[500,'#f0d66b'],[1000,'#f0a64a'],[2000,'#d9573b'],[3000,'#9f3251'],[4000,'#50245f'],[5000,'#120722']],
      makeStats(times, members, hourly) {
        const precipKeys = PlumeMath.ensembleMemberKeys(hourly || {}, 'precipitation');
        return times.map((t, i) => {
          const capeVals = members.map(m => m[i]).filter(Number.isFinite);
          const n = capeVals.length || 1;
          const pass = threshold => capeVals.filter(v => v >= threshold).length / n * 100;
          let thunderHits = 0;
          let thunderN = 0;
          members.forEach((member, memberIdx) => {
            const cape = member?.[i];
            const precip = hourly?.[precipKeys[memberIdx]]?.[i];
            const intervalHours = precedingIntervalHours(times, i);
            if (!Number.isFinite(cape) || (precipKeys.length && (!Number.isFinite(precip) || !intervalHours))) return;
            thunderN++;
            const precipRate = precipKeys.length ? precip / intervalHours : null;
            if (cape >= 500 && (!precipKeys.length || precipRate >= 0.1)) thunderHits++;
          });
          return {
            t,
            p10: percentiel(capeVals, 10) || 0,
            p50: percentiel(capeVals, 50) || 0,
            p90: percentiel(capeVals, 90) || 0,
            extra: {
              light: pass(100),
              strong: pass(500),
              severe: pass(1500),
              thunderChance: thunderN ? thunderHits / thunderN * 100 : 0,
            },
          };
        });
      },
      summary(stats) {
        const vals = stats.filter(s => Number.isFinite(s.p90));
        const peak = vals.reduce((a,b) => b.p90 > a.p90 ? b : a, vals[0]);
        const storm = vals.reduce((a,b) => b.extra.thunderChance > a.extra.thunderChance ? b : a, vals[0]);
        return [
          `Hoogste CAPE P90: ${Math.round(peak.p90)} J/kg · ${fmtDag(peak.t)}`,
          `Duiding: ${capeDuiding(peak.p90)}`,
          `Hoogste onweerkans: ${Math.round(storm.extra.thunderChance)}% · ${fmtDag(storm.t)}`,
        ];
      },
    },
  };

  const MULTI_PARAMS = ['temp', 'rain', 'rainmm', 'raincum', 'wind', 'gust', 'cloud', 'thunder'];
  const FILE_LABELS = {
    temp: 'temperatuur',
    rain: 'neerslagkans',
    rainmm: 'neerslag',
    raincum: 'neerslagsom',
    wind: 'windkracht bft',
    gust: 'windstoten',
    cloud: 'zon bewolking',
    thunder: 'onweer',
    multi: '8pluim',
  };

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawChartSurface(ctx, x, y, w, h) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.24)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 4;
    roundRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.restore();
  }

  function clipRoundedChart(ctx, x, y, w, h) {
    ctx.save();
    roundRect(ctx, x, y, w, h, 8);
    ctx.clip();
  }

  function strokeRoundedChart(ctx, x, y, w, h) {
    roundRect(ctx, x, y, w, h, 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawChipRow(ctx, chips, x, y, maxW) {
    let cx = x;
    let cy = y;
    const h = 30;
    ctx.font = '800 23px Inter, Arial, sans-serif';
    chips.forEach(chip => {
      const w = Math.min(maxW, Math.ceil(ctx.measureText(chip).width + 28));
      if (cx > x && cx + w > x + maxW) {
        cx = x;
        cy += h + 8;
      }
      roundRect(ctx, cx, cy, w, h, 15);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(chip, cx + 14, cy + 22);
      cx += w + 8;
    });
    return cy + h;
  }

  function membersOf(hourly, key) {
    return PlumeMath.ensembleMemberKeys(hourly, key)
      .map(k => Array.isArray(hourly[k]) ? hourly[k].map(v => Number.isFinite(v) ? v : null) : null)
      .filter(Boolean);
  }

  function makeDefaultStats(times, members) {
    return times.map((t, i) => {
      const vals = members.map(m => m[i]).filter(Number.isFinite);
      return { t, p10: percentiel(vals, 10), p50: percentiel(vals, 50), p90: percentiel(vals, 90) };
    });
  }

  function makeDailyMaxStats(times, members) {
    const days = [];
    const byDay = new Map();
    times.forEach((t, i) => {
      const d = new Date(t);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!byDay.has(key)) {
        const entry = { t, idxs: [] };
        byDay.set(key, entry);
        days.push(entry);
      }
      byDay.get(key).idxs.push(i);
    });
    return days.map(day => {
      const maxima = members.map(member => {
        const vals = day.idxs.map(i => member[i]).filter(Number.isFinite);
        return vals.length ? Math.max(...vals) : null;
      }).filter(Number.isFinite);
      return {
        t: day.t,
        p10: percentiel(maxima, 10),
        p50: percentiel(maxima, 50),
        p90: percentiel(maxima, 90),
      };
    }).filter(s => Number.isFinite(s.p50));
  }

  function aggregateMembersByHours(times, members, hours = 6) {
    return PlumeMath.aggregatePrecedingHours(times, members, hours, { keepInitialZero: false });
  }

  function cumulativeMembers(members) {
    return PlumeMath.cumulativeMembers(members);
  }

  function precedingIntervalHours(times, index) {
    if (index <= 0) return null;
    const current = new Date(times?.[index]).getTime();
    const adjacent = new Date(times[index - 1]).getTime();
    if (!Number.isFinite(current) || !Number.isFinite(adjacent)) return null;
    const hours = Math.abs(current - adjacent) / 3600000;
    return hours > 0 && hours <= 6 ? hours : null;
  }

  function calcRange(stats, cfg) {
    if (cfg.yMin != null && cfg.yMax != null) return { yMin: cfg.yMin, yMax: cfg.yMax };
    const rangeKeys = Array.isArray(cfg.rangeKeys) && cfg.rangeKeys.length ? cfg.rangeKeys : ['p10', 'p90'];
    const all = stats.flatMap(s => rangeKeys.map(key => s[key])).filter(Number.isFinite);
    if (!all.length) throw new Error('Geen data ontvangen');
    const pad = cfg.rangePad ?? 0;
    let yMin = cfg.yMin ?? Math.floor((Math.min(...all) - pad) / cfg.yStep) * cfg.yStep;
    let yMax = cfg.yMax ?? Math.ceil((Math.max(...all) + pad) / cfg.yStep) * cfg.yStep;
    if (cfg.yMin === 0) yMin = 0;
    while (yMax - yMin < (cfg.minRange || cfg.yStep * 4)) {
      yMax += cfg.yStep;
      if (cfg.yMin !== 0) yMin -= cfg.yStep;
    }
    return { yMin, yMax };
  }

  function drawLine(ctx, pts) {
    const good = pts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (good.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(good[0][0], good[0][1]);
    for (let i = 1; i < good.length; i++) ctx.lineTo(good[i][0], good[i][1]);
    ctx.stroke();
  }

  function smoothPointsY(pts, passes = 0) {
    if (!passes || pts.length < 5) return pts;
    let out = pts.map(p => [p[0], p[1]]);
    for (let pass = 0; pass < passes; pass++) {
      out = out.map((p, i, arr) => {
        if (i < 2 || i > arr.length - 3) return p;
        const y = (arr[i - 2][1] + arr[i - 1][1] * 2 + arr[i][1] * 3 + arr[i + 1][1] * 2 + arr[i + 2][1]) / 9;
        return [p[0], y];
      });
    }
    return out;
  }

  function addCurveToPath(ctx, pts) {
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
    }
  }

  function drawSmoothLine(ctx, pts) {
    const good = pts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (good.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(good[0][0], good[0][1]);
    addCurveToPath(ctx, good);
    ctx.stroke();
  }

  function drawBand(ctx, topPts, botPts) {
    const top = topPts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    const bot = botPts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (top.length < 2 || bot.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    for (let i = 1; i < top.length; i++) ctx.lineTo(top[i][0], top[i][1]);
    for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  function drawSmoothBand(ctx, topPts, botPts) {
    const top = topPts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    const bot = botPts.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (top.length < 2 || bot.length < 2) return;
    const revBot = [...bot].reverse();
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    addCurveToPath(ctx, top);
    ctx.lineTo(revBot[0][0], revBot[0][1]);
    addCurveToPath(ctx, revBot);
    ctx.closePath();
    ctx.fill();
  }

  const AXIS_FONT = '800 23px Inter, Arial, sans-serif';
  const AXIS_LABEL_GAP = 7;

  // Breedste y-as-label bepaalt de linkermarge. Met een vaste marge valt
  // "40 km/u" of "14.0 mm" buiten het kaartvlak en knipt de afronding het
  // eerste cijfer af.
  function axisLabelWidth(ctx, yMin, yMax, cfg) {
    if (!(cfg.yStep > 0)) return 0;
    ctx.save();
    ctx.font = AXIS_FONT;
    let maxW = 0;
    let steps = 0;
    for (let v = Math.ceil(yMin / cfg.yStep) * cfg.yStep; v <= yMax && steps < 200; v += cfg.yStep, steps++) {
      maxW = Math.max(maxW, ctx.measureText(fmtValue(v, cfg)).width);
    }
    ctx.restore();
    return maxW;
  }

  const MARKER_FONT = '800 21px Inter, Arial, sans-serif';

  // Indexen op vaste dagafstand vanaf de start van de pluim. Het laatste punt
  // wordt meegenomen zodat de eindsom altijd een label krijgt.
  function markerIndexes(timeValues, everyDays) {
    if (!(everyDays > 0) || timeValues.length < 2) return [];
    const stepMs = everyDays * 24 * 3600 * 1000;
    const start = timeValues[0];
    const end = timeValues[timeValues.length - 1];
    const out = [];
    for (let target = start + stepMs; target <= end + stepMs / 2; target += stepMs) {
      const want = Math.min(target, end);
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < timeValues.length; i++) {
        const dist = Math.abs(timeValues[i] - want);
        if (dist < bestDist) { bestDist = dist; best = i; }
      }
      if (best >= 0 && !out.includes(best)) out.push(best);
    }
    return out;
  }

  // Zet de bereikte mediaansom als chip op de mediaanlijn, zodat de lopende
  // som per periode afleesbaar is zonder de y-as te volgen.
  function drawMedianMarkers(ctx, o) {
    const { cfg, st, timeValues, xF, yF, yMin, yMax, left, right, top } = o;
    ctx.save();
    ctx.font = MARKER_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    markerIndexes(timeValues, cfg.medianMarkerDays).forEach(i => {
      const value = st[i] && st[i].p50;
      if (!Number.isFinite(value)) return;
      const px = xF(i);
      const py = yF(clamp(value, yMin, yMax));

      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = cfg.medianHaloColor || 'rgba(0,0,0,0.55)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = cfg.medianColor || '#ffffff';
      ctx.fill();

      const label = fmtValue(value, cfg);
      const chipW = ctx.measureText(label).width + 18;
      const chipH = 30;
      const chipX = clamp(px - chipW / 2, left + 4, right - chipW - 4);
      let chipY = py - 14 - chipH;
      if (chipY < top + 4) chipY = py + 14;
      roundRect(ctx, chipX, chipY, chipW, chipH, 8);
      ctx.fillStyle = 'rgba(6,26,18,0.80)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.38)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, chipX + chipW / 2, chipY + chipH / 2 + 1);
    });
    ctx.restore();
  }

  function drawChart(ctx, x, y, w, h, times, stats, cfg) {
    const nMax = Math.min(times.length, FORECAST_DAYS * 24);
    const ts = times.slice(0, nMax);
    const st = stats.slice(0, nMax);
    const { yMin, yMax } = calcRange(st, cfg);
    const leftAxisMin = axisLabelWidth(ctx, yMin, yMax, cfg) + AXIS_LABEL_GAP + 4;
    const m = { top: 16, right: cfg.rightAxis ? 76 : 28, bottom: 72, left: Math.max(cfg.leftAxis || 72, Math.ceil(leftAxisMin)) };
    const iw = w - m.left - m.right;
    const ih = h - m.top - m.bottom;
    const yRange = yMax - yMin || 1;
    const timeValues = ts.map(value => new Date(value).getTime());
    const timeStart = timeValues[0];
    const timeEnd = timeValues[timeValues.length - 1];
    const timeRange = Math.max(1, timeEnd - timeStart);
    // Native ECMWF-stappen lopen van 3 naar 6 uur. Plaats ieder punt op zijn
    // echte tijd zodat de tweede helft van de pluim niet horizontaal vervormt.
    const xF = i => x + m.left + ((timeValues[i] - timeStart) / timeRange) * iw;
    const yF = v => y + m.top + (1 - (v - yMin) / yRange) * ih;
    const yPercentF = v => y + m.top + (1 - clamp(v, 0, 100) / 100) * ih;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + m.left, y + m.top, iw, ih);
    ctx.clip();

    if (cfg.smoothScale) {
      const gradient = ctx.createLinearGradient(0, y + m.top, 0, y + m.top + ih);
      scaleStops(cfg.scale, yMin, yMax).forEach(stop => {
        gradient.addColorStop(stop.offset, stop.color);
      });
      ctx.fillStyle = gradient;
      ctx.globalAlpha = cfg.backgroundOpacity ?? 0.82;
      ctx.fillRect(x + m.left, y + m.top, iw, ih);
      ctx.globalAlpha = 1;
    } else {
      for (let v = yMin; v < yMax; v += cfg.yStep) {
        const bandTop = Math.min(yMax, v + cfg.yStep);
        const yy = yF(bandTop);
        const hh = yF(v) - yy;
        ctx.fillStyle = colorFromScale(cfg.scale, v + cfg.yStep / 2);
        ctx.globalAlpha = cfg.render === 'bars' ? 0.28 : (cfg.render === 'stacked' ? 0.16 : 0.88);
        ctx.fillRect(x + m.left, yy, iw, Math.max(0, hh));
        ctx.globalAlpha = 1;
      }
    }

    ctx.strokeStyle = cfg.dayLineColor || 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    for (let i = 1; i < ts.length; i++) {
      if (new Date(ts[i]).getHours() === 0) {
        const xx = xF(i);
        ctx.beginPath();
        ctx.moveTo(xx, y + m.top);
        ctx.lineTo(xx, y + m.top + ih);
        ctx.stroke();
      }
    }

    const sampledPoints = key => st.map((s, i) => (
      Number.isFinite(s[key]) ? [xF(i), yF(s[key])] : null
    )).filter(Boolean);
    const sampledBand = () => st.map((s, i) => (
      Number.isFinite(s.p90) && Number.isFinite(s.p10)
        ? { top: [xF(i), yF(s.p90)], bot: [xF(i), yF(s.p10)] }
        : null
    )).filter(Boolean);

    if (cfg.render === 'stacked') {
      const stackItems = cfg.stackItems || cfg.legendItems || [];
      for (let catIdx = 0; catIdx < stackItems.length; catIdx++) {
        const topPts = [];
        const botPts = [];
        st.forEach((s, i) => {
          const stack = s.extra?.stack;
          if (!Array.isArray(stack)) return;
          const base = clamp(stack.slice(0, catIdx).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0), 0, 100);
          const top = clamp(base + (Number.isFinite(stack[catIdx]) ? stack[catIdx] : 0), 0, 100);
          topPts.push([xF(i), yPercentF(top)]);
          botPts.push([xF(i), yPercentF(base)]);
        });
        ctx.fillStyle = stackItems[catIdx]?.color || '#dfe5de';
        ctx.globalAlpha = 0.95;
        drawBand(ctx, topPts, botPts);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.46)';
      ctx.lineWidth = 1;
      for (let i = 1; i < ts.length; i++) {
        if (new Date(ts[i]).getHours() === 0) {
          const xx = xF(i);
          ctx.beginPath();
          ctx.moveTo(xx, y + m.top);
          ctx.lineTo(xx, y + m.top + ih);
          ctx.stroke();
        }
      }
    } else if (cfg.render === 'bars') {
      const spacing = iw / Math.max(1, nMax - 1);
      const rangeW = cfg.barRange
        ? Math.max(5, spacing * (cfg.rangeWidthFactor ?? 0.78))
        : Math.max(3, spacing * 2.25);
      const fullRangeW = cfg.barFullRange
        ? Math.max(rangeW + 1, spacing * (cfg.fullRangeWidthFactor ?? 0.95))
        : rangeW;
      const barW = cfg.barRange
        ? Math.max(3, spacing * (cfg.barWidthFactor ?? 0.38))
        : Math.max(3, spacing * 2.25);
      st.forEach((s, i) => {
        const barValue = cfg.barValue ? s[cfg.barValue] : s.p50;
        if (!Number.isFinite(barValue)) return;
        const fill = cfg.barColor ? cfg.barColor(s, barValue) : colorFromScale(cfg.scale, barValue);
        const rangeValue = cfg.rangeColorValue && Number.isFinite(s[cfg.rangeColorValue]) ? s[cfg.rangeColorValue] : barValue;
        const rangeFill = cfg.barColor ? cfg.barColor(s, rangeValue) : colorFromScale(cfg.scale, rangeValue);
        const drawRange = (low, high, width, opacity, stroke, capStroke, haloStroke) => {
          if (!Number.isFinite(low) || !Number.isFinite(high)) return;
          const hi = Math.max(low, high);
          const lo = Math.max(yMin, Math.min(low, high));
          const rangeTop = yF(hi);
          const rangeBot = yF(lo);
          const rangeH = Math.max(1.6, rangeBot - rangeTop);
          const rangeX = xF(i) - width / 2;
          ctx.save();
          ctx.globalAlpha = opacity;
          ctx.fillStyle = rangeFill;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 0.9;
          roundRect(ctx, rangeX, rangeTop, width, rangeH, 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          [yF(hi), yF(lo)].forEach(yy => {
            ctx.beginPath();
            ctx.strokeStyle = haloStroke;
            ctx.lineWidth = 2.6;
            ctx.moveTo(rangeX, yy);
            ctx.lineTo(rangeX + width, yy);
            ctx.stroke();
            ctx.beginPath();
            ctx.strokeStyle = capStroke;
            ctx.lineWidth = 1.35;
            ctx.moveTo(rangeX, yy);
            ctx.lineTo(rangeX + width, yy);
            ctx.stroke();
          });
        };
        if (cfg.barFullRange && Number.isFinite(s.pMin) && Number.isFinite(s.pMax)) {
          drawRange(s.pMin, s.pMax, fullRangeW, cfg.fullRangeOpacity ?? 0.2, cfg.fullRangeStroke || 'rgba(3,23,15,0.66)', cfg.rangeCapStroke || 'rgba(255,255,255,0.86)', cfg.rangeHaloStroke || 'rgba(0,0,0,0.34)');
        }
        if (cfg.barRange && Number.isFinite(s.p10) && Number.isFinite(s.p90)) {
          drawRange(s.p10, s.p90, rangeW, cfg.rangeOpacity ?? 0.52, cfg.rangeStroke || 'rgba(6,38,25,0.72)', cfg.rangeCapStroke || 'rgba(255,255,255,0.92)', cfg.rangeHaloStroke || 'rgba(0,0,0,0.38)');
        }
        const xx = xF(i) - barW / 2;
        const yy = yF(barValue);
        ctx.fillStyle = fill;
        ctx.strokeStyle = 'rgba(255,255,255,0.46)';
        ctx.lineWidth = 0.6;
        roundRect(ctx, xx, yy, barW, Math.max(0, y + m.top + ih - yy), 1.5);
        ctx.fill();
        ctx.stroke();
      });
      if (cfg.percentLine) {
        const pctPts = st.map((s, i) => {
          const v = s.extra?.[cfg.percentLine.key];
          return Number.isFinite(v) ? [xF(i), yPercentF(v)] : null;
        }).filter(Boolean);
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = 'rgba(0,0,0,0.48)';
        ctx.lineWidth = 3.4;
        drawLine(ctx, pctPts);
        ctx.strokeStyle = cfg.percentLine.color || 'white';
        ctx.lineWidth = 1.8;
        drawLine(ctx, pctPts);
      }
    } else {
      const bandPts = sampledBand();
      const smoothPasses = cfg.curveSmoothPasses || 0;
      const topPts = smoothPointsY(bandPts.map(p => p.top), smoothPasses);
      const botPts = smoothPointsY(bandPts.map(p => p.bot), smoothPasses);
      ctx.fillStyle = cfg.bandFill || 'rgba(0,0,0,0.27)';
      if (smoothPasses) drawSmoothBand(ctx, topPts, botPts);
      else drawBand(ctx, topPts, botPts);
      if (cfg.bandEdgeColor) {
        ctx.strokeStyle = cfg.bandEdgeColor;
        ctx.lineWidth = cfg.bandEdgeWidth || 1.4;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        if (smoothPasses) {
          drawSmoothLine(ctx, topPts);
          drawSmoothLine(ctx, botPts);
        } else {
          drawLine(ctx, topPts);
          drawLine(ctx, botPts);
        }
      }
      (cfg.referenceLines || []).forEach(line => {
        if (!Number.isFinite(line.value) || line.value < yMin || line.value > yMax) return;
        const yy = yF(line.value);
        ctx.save();
        ctx.strokeStyle = line.color || 'rgba(7,24,45,0.55)';
        ctx.lineWidth = line.width || 1;
        ctx.setLineDash(line.dash || [5, 6]);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + m.left, yy);
        ctx.lineTo(x + m.left + iw, yy);
        ctx.stroke();
        ctx.restore();
      });

      const medPts = smoothPointsY(sampledPoints('p50'), smoothPasses);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.strokeStyle = cfg.medianHaloColor || 'rgba(0,0,0,0.45)';
      ctx.lineWidth = cfg.medianHaloWidth || 4;
      if (smoothPasses) drawSmoothLine(ctx, medPts);
      else drawLine(ctx, medPts);
      ctx.strokeStyle = cfg.medianColor || 'white';
      ctx.lineWidth = cfg.medianWidth || 2.1;
      if (smoothPasses) drawSmoothLine(ctx, medPts);
      else drawLine(ctx, medPts);
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x + m.left, y + m.top, iw, ih);

    ctx.font = AXIS_FONT;
    ctx.textBaseline = 'middle';
    for (let v = Math.ceil(yMin / cfg.yStep) * cfg.yStep; v <= yMax; v += cfg.yStep) {
      const yy = yF(v);
      ctx.save();
      ctx.strokeStyle = cfg.gridLineColor || 'rgba(255,255,255,0.09)';
      ctx.lineWidth = cfg.gridLineWidth ?? 0.5;
      ctx.setLineDash(Array.isArray(cfg.gridLineDash) ? cfg.gridLineDash : []);
      ctx.beginPath();
      ctx.moveTo(x + m.left, yy);
      ctx.lineTo(x + m.left + iw, yy);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = 'white';
      ctx.textAlign = 'right';
      ctx.fillText(fmtValue(v, cfg), x + m.left - AXIS_LABEL_GAP, yy);
    }
    if (cfg.rightAxis === 'bft') {
      const bftThresholds = [0, 1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
      ctx.textAlign = 'left';
      bftThresholds.forEach((value, bft) => {
        if (value < yMin || value > yMax) return;
        ctx.fillText(`${bft} Bft`, x + m.left + iw + 7, yF(value));
      });
    }
    if (cfg.rightAxis === 'percent') {
      ctx.textAlign = 'left';
      for (let p = 0; p <= 100; p += 20) {
        ctx.fillStyle = 'white';
        ctx.fillText(`${p}%`, x + m.left + iw + 7, yPercentF(p));
      }
    }

    const daySet = new Set();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < ts.length; i++) {
      const t = new Date(ts[i]);
      const key = `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
      if (daySet.has(key)) continue;
      daySet.add(key);
      let bestIdx = i, bestDist = Infinity;
      for (let j = i; j < Math.min(i + 24, ts.length); j++) {
        const dist = Math.abs(new Date(ts[j]).getHours() - 12);
        if (dist < bestDist) { bestDist = dist; bestIdx = j; }
      }
      const xx = xF(bestIdx);
      const d = new Date(ts[bestIdx]);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(xx, y + m.top + ih);
      ctx.lineTo(xx, y + m.top + ih + 6);
      ctx.stroke();
      ctx.fillStyle = 'white';
      ctx.font = '900 25px Inter, Arial, sans-serif';
      ctx.fillText(DOW_NL[d.getDay()], xx, y + m.top + ih + 27);
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      ctx.font = '800 22px Inter, Arial, sans-serif';
      ctx.fillText(`${d.getDate()} ${MAAND_NL[d.getMonth()]}`, xx, y + m.top + ih + 51);
    }

    if (cfg.medianMarkerDays > 0 && cfg.render !== 'bars' && cfg.render !== 'stacked') {
      drawMedianMarkers(ctx, {
        cfg, st, timeValues, xF, yF, yMin, yMax,
        left: x + m.left, right: x + m.left + iw, top: y + m.top,
      });
    }
  }

  function drawLegend(ctx, cfg, x, y, maxW) {
    ctx.font = '800 23px Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.76)';
    const items = cfg.render === 'stacked'
      ? (cfg.legendItems || cfg.stackItems || [])
      : cfg.render === 'bars'
      ? [{ label: cfg.barLabel || 'Staafjes' }, ...(cfg.legendItems || []), ...(cfg.percentLine ? [{ type: 'line', color: cfg.percentLine.color || 'white', label: cfg.percentLine.label }] : [])]
      : [
        { type: 'line', color: cfg.medianColor || 'white', haloColor: cfg.medianHaloColor, label: cfg.lineLabel },
        { type: 'band', color: cfg.bandFill || 'rgba(0,0,0,0.28)', stroke: cfg.bandEdgeColor || 'rgba(0,0,0,0.15)', label: cfg.bandLabel },
      ];
    let lx = x;
    let ly = y;
    items.forEach((item, i) => {
      const label = item.label || '';
      const textW = ctx.measureText(label).width;
      const itemW = textW + 44;
      if (lx > x && lx + itemW > x + maxW) {
        lx = x;
        ly += 34;
      }
      if (itemW > maxW) return;
      if (item.type === 'line') {
        if (item.haloColor) {
          ctx.strokeStyle = item.haloColor;
          ctx.lineWidth = 7;
          ctx.beginPath();
          ctx.moveTo(lx, ly - 6);
          ctx.lineTo(lx + 24, ly - 6);
          ctx.stroke();
        }
        ctx.strokeStyle = item.color || 'white';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(lx, ly - 6);
        ctx.lineTo(lx + 24, ly - 6);
        ctx.stroke();
      } else if (item.type === 'band') {
        ctx.fillStyle = item.color || 'rgba(0,0,0,0.28)';
        roundRect(ctx, lx, ly - 12, 18, 12, 3);
        ctx.fill();
        ctx.strokeStyle = item.stroke || 'rgba(255,255,255,0.42)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (item.color) {
        ctx.fillStyle = item.color;
        roundRect(ctx, lx, ly - 12, 18, 12, 3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.42)';
        ctx.stroke();
      } else if (cfg.render === 'bars' || i === 1) {
        ctx.fillStyle = cfg.render === 'bars' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.28)';
        roundRect(ctx, lx, ly - 12, 18, 12, 3);
        ctx.fill();
      } else {
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lx, ly - 6);
        ctx.lineTo(lx + 24, ly - 6);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.76)';
      ctx.fillText(label, lx + 28, ly);
      lx += itemW;
    });
    return ly;
  }

  function visibleStatsForSummary(stats) {
    const visible = stats.slice(0, FORECAST_DAYS * 24);
    if (stats.dailyMax) visible.dailyMax = stats.dailyMax.slice(0, FORECAST_DAYS);
    return visible;
  }

  function chartTimesForStats(times, stats) {
    return stats.length === times.length ? times : stats.map(s => s.t);
  }

  const ENSEMBLE_FIELDS = 'temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,cloud_cover,cape';

  async function fetchEnsemble(lat, lon, startIso, endIso, hourlyFields = ENSEMBLE_FIELDS, runMeta, runContext = null) {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      hourly: hourlyFields,
      models: 'ecmwf_ifs025',
      temporal_resolution: 'native',
      start_date: startIso,
      end_date: endIso,
      timezone: 'GMT',
      wind_speed_unit: 'kmh',
    });
    try {
      const data = PlumeMath.markUtcTimes(await fetchJson(`${ENS_URL}?${params}`, 30000, 3, runContext));
      return boundResponseToRunMeta(data, runMeta);
    } catch (e) {
      throw new Error('Ensemble ' + e.message);
    }
  }

  function spatialPoints(lat, lon) {
    const radiusKm = 10;
    const latDelta = radiusKm / 111.32;
    const lonDelta = radiusKm / (111.32 * Math.max(0.2, Math.cos(Number(lat) * Math.PI / 180)));
    return [
      [Number(lat), Number(lon)],
      [Number(lat) + latDelta, Number(lon)],
      [Number(lat) - latDelta, Number(lon)],
      [Number(lat), Number(lon) + lonDelta],
      [Number(lat), Number(lon) - lonDelta],
    ];
  }

  function mergeUniqueSpatialPrecipitation(responses) {
    const unique = [];
    const seen = new Set();
    responses.forEach(response => {
      if (!response?.hourly?.time) return;
      const key = `${Number(response.latitude).toFixed(5)},${Number(response.longitude).toFixed(5)}`;
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(response);
    });
    if (unique.length < 3) throw new Error(`Te weinig unieke neerslagroosterpunten ontvangen (${unique.length}/5)`);
    const center = unique[0];
    const merged = { ...center, hourly: { ...center.hourly }, spatial_grid_points: unique.length, spatial_radius_km: 10 };
    const keys = PlumeMath.ensembleMemberKeys(center.hourly, 'precipitation');
    if (keys.length !== 51) throw new Error(`Neerslag: ${keys.length} ensembleleden ontvangen, verwacht 51`);
    const timeIndexes = unique.map(response => new Map(
      (response.hourly.time || []).map((time, index) => [new Date(time).getTime(), index])
    ));
    unique.forEach((response, index) => {
      const responseKeys = PlumeMath.ensembleMemberKeys(response.hourly, 'precipitation');
      if (responseKeys.length !== 51 || keys.some(key => !responseKeys.includes(key))) {
        throw new Error(`Neerslagroosterpunt ${index + 1}: onvolledige set ensembleleden`);
      }
    });
    keys.forEach(key => {
      merged.hourly[key] = (center.hourly.time || []).map(time => {
        const epoch = new Date(time).getTime();
        const values = unique.map((response, responseIndex) => {
          const index = timeIndexes[responseIndex].get(epoch);
          return index == null ? null : PlumeMath.finiteNumber(response.hourly?.[key]?.[index]);
        });
        return values.length === unique.length && values.every(Number.isFinite)
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : null;
      });
    });
    return merged;
  }

  async function fetchEnsembleWithSpatialRain(lat, lon, startIso, endIso, runMeta, runContext = null) {
    const points = spatialPoints(lat, lon);
    const center = await fetchEnsemble(points[0][0], points[0][1], startIso, endIso, ENSEMBLE_FIELDS, runMeta, runContext);
    const nearby = await Promise.allSettled(points.slice(1).map(point =>
      fetchEnsemble(point[0], point[1], startIso, endIso, 'precipitation', runMeta, runContext)
    ));
    const rainResponses = [center, ...nearby.filter(result => result.status === 'fulfilled').map(result => result.value)];
    const rain = mergeUniqueSpatialPrecipitation(rainResponses);
    const merged = { ...center, hourly: { ...center.hourly }, spatial_grid_points: rain.spatial_grid_points, spatial_radius_km: 10 };
    PlumeMath.ensembleMemberKeys(rain.hourly, 'precipitation').forEach(key => {
      merged.hourly[key] = rain.hourly[key];
    });
    return merged;
  }

  function completeMemberWindow(times, memberMatrices, expectedMembers = 51) {
    if (!Array.isArray(times) || !times.length || !Array.isArray(memberMatrices) || !memberMatrices.length) {
      throw new Error('Geen volledige ensemblematrix ontvangen');
    }
    memberMatrices.forEach((members, index) => {
      if (!Array.isArray(members) || members.length !== expectedMembers) {
        throw new Error(`Ensembleveld ${index + 1}: ${members?.length || 0} leden ontvangen, verwacht ${expectedMembers}`);
      }
    });
    const members = memberMatrices.flat();
    const limit = Math.min(times.length, ...members.map(member => Array.isArray(member) ? member.length : 0));
    let first = -1;
    let lastExclusive = limit;
    for (let index = 0; index < limit; index++) {
      const complete = members.every(member => Number.isFinite(member[index]));
      if (first < 0) {
        if (complete) first = index;
      } else if (!complete) {
        lastExclusive = index;
        break;
      }
    }
    if (first < 0 || lastExclusive - first < 2) {
      throw new Error('Ensemble bevat te weinig tijdstappen met alle 51 leden compleet');
    }
    return { first, lastExclusive };
  }

  function buildModels(ens, startIso, endIso, runMeta, wantedParams = null) {
    const hourly = ens.hourly || {};
    const rawTimes = hourly.time || [];
    if (!rawTimes.length) throw new Error('Geen ensembledata ontvangen');
    const startMs = Date.parse(`${startIso}T00:00:00Z`);
    const endExclusiveMs = Date.parse(`${verschuifIsoDatum(endIso, 1)}T00:00:00Z`);
    const modelParams = Array.isArray(wantedParams) && wantedParams.length
      ? MULTI_PARAMS.filter(param => wantedParams.includes(param))
      : MULTI_PARAMS;
    const models = [];
    const unavailable = [];
    modelParams.forEach(param => {
      const cfg = PARAMS[param];
      try {
        const membersRaw = membersOf(hourly, cfg.hourly);
        if (membersRaw.length !== 51) throw new Error(`${membersRaw.length} leden ontvangen, verwacht 51`);
        const requiredFields = param === 'thunder' ? ['cape', 'precipitation'] : [cfg.hourly];
        const requiredMatrices = requiredFields.map(field => membersOf(hourly, field));
        const window = completeMemberWindow(rawTimes, requiredMatrices);
        const length = window.lastExclusive - window.first;
        const isPrecedingPrecipitation = param === 'rain' || param === 'rainmm' || param === 'raincum';
        const indexes = Array.from({ length }, (_, index) => window.first + index).filter(index => {
          const time = new Date(rawTimes[index]).getTime();
          return time >= startMs && (isPrecedingPrecipitation ? time <= endExclusiveMs : time < endExclusiveMs);
        });
        const times = indexes.map(index => new Date(rawTimes[index]));
        const members = membersRaw.map(member => indexes.map(index => member[index]));
        const rangedHourly = {};
        Object.entries(hourly).forEach(([key, values]) => {
          rangedHourly[key] = Array.isArray(values) ? indexes.map(index => values[index]) : values;
        });
        rangedHourly.time = times;
        const stats = cfg.makeStats ? cfg.makeStats(times, members, rangedHourly) : makeDefaultStats(times, members);
        models.push({ param, cfg, times: chartTimesForStats(times, stats), stats, keys: members.length, runMeta });
      } catch (error) {
        unavailable.push({ param, title: cfg.title, reason: error.message });
      }
    });
    if (!models.length) throw new Error('Geen van de gevraagde kleurpluimen is in deze opgeslagen run beschikbaar');
    models.unavailable = unavailable;
    return models;
  }

  function runStatusText(meta) {
    const verified = verifiedRunMeta(meta);
    const init = new Date(verified.last_run_initialisation_time * 1000);
    const hours = Math.max(0, Math.round((verified.data_end_time - verified.last_run_initialisation_time) / 3600));
    return `ENS ${DOW_NL[init.getUTCDay()]} ${init.getUTCDate()} ${MAAND_NL[init.getUTCMonth()]} ${String(init.getUTCHours()).padStart(2, '0')} UTC · dekking ${hours} uur`;
  }

  function drawPage(ctx, naam, models, resize = true) {
    const cardW = PAGE_W - PAGE_MARGIN * 2 + CARD_PAD * 2;
    const chartW = PAGE_W - PAGE_MARGIN * 2 - 36;
    const chartH = Math.round(chartW * CHART_SRC_H / CHART_SRC_W);
    const cardH = chartH + 206;
    const pageH = HEADER_H + (cardH * models.length) + (CARD_GAP * (models.length - 1)) + FOOTER_H;

    if (resize) {
      ctx.canvas.width = PAGE_W;
      ctx.canvas.height = pageH;
    }
    ctx.fillStyle = '#8a8070';
    ctx.fillRect(0, 0, PAGE_W, pageH);
    roundRect(ctx, 28, 28, PAGE_W - 56, pageH - 56, 14);
    ctx.fillStyle = '#b0a488';
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.font = '900 64px Inter, Arial, sans-serif';
    const pageTitle = models.length === 8 ? '8-pluim' : `${models.length} van 8 pluimen`;
    ctx.fillText(pageTitle, PAGE_MARGIN, 92);
    const titleW = ctx.measureText(pageTitle).width;
    ctx.font = '500 46px Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.84)';
    ctx.fillText(naam, PAGE_MARGIN + titleW + 30, 92);
    ctx.fillStyle = 'rgba(255,255,255,0.36)';
    ctx.fillRect(PAGE_MARGIN, 118, PAGE_W - PAGE_MARGIN * 2, 2);

    models.forEach((model, i) => {
      const y = HEADER_H + i * (cardH + CARD_GAP);
      roundRect(ctx, PAGE_MARGIN - CARD_PAD, y, cardW, cardH, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = 'white';
      ctx.font = '900 30px Inter, Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(model.cfg.title, PAGE_MARGIN, y + 38);
      ctx.fillStyle = 'rgba(255,255,255,0.68)';
      ctx.font = '800 23px Inter, Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${model.keys} leden · ${runStatusText(model.runMeta)} · ${model.cfg.statusSuffix}`, PAGE_W - PAGE_MARGIN, y + 36);
      ctx.textAlign = 'left';

      const chips = model.cfg.summary(visibleStatsForSummary(model.stats));
      const chipBottom = drawChipRow(ctx, chips, PAGE_MARGIN, y + 54, PAGE_W - PAGE_MARGIN * 2);
      const chartY = Math.max(y + 96, chipBottom + 14);
      drawChartSurface(ctx, PAGE_MARGIN, chartY, chartW, chartH);
      clipRoundedChart(ctx, PAGE_MARGIN, chartY, chartW, chartH);
      drawChart(ctx, PAGE_MARGIN, chartY, chartW, chartH, model.times, model.stats, model.cfg);
      ctx.restore();
      strokeRoundedChart(ctx, PAGE_MARGIN, chartY, chartW, chartH);
      drawLegend(ctx, model.cfg, PAGE_MARGIN, chartY + chartH + 34, PAGE_W - PAGE_MARGIN * 2);
    });

    ctx.fillStyle = 'rgba(255,255,255,0.56)';
    ctx.font = '800 20px Inter, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Ed Aldus WM · Data: Open-Meteo / ECMWF IFS ENS', PAGE_MARGIN, pageH - 36);
    return pageH;
  }

  function drawSinglePage(ctx, naam, model, resize = true) {
    const cardW = PAGE_W - PAGE_MARGIN * 2 + CARD_PAD * 2;
    const chartW = PAGE_W - PAGE_MARGIN * 2 - 36;
    const chartH = Math.round(chartW * 350 / CHART_SRC_W);
    const cardH = chartH + 250;
    const pageH = HEADER_H + cardH + FOOTER_H;

    if (resize) {
      ctx.canvas.width = PAGE_W;
      ctx.canvas.height = pageH;
    }
    ctx.fillStyle = '#8a8070';
    ctx.fillRect(0, 0, PAGE_W, pageH);
    roundRect(ctx, 28, 28, PAGE_W - 56, pageH - 56, 14);
    ctx.fillStyle = '#b0a488';
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.font = '900 64px Inter, Arial, sans-serif';
    ctx.fillText(model.cfg.title, PAGE_MARGIN, 92);
    const titleW = ctx.measureText(model.cfg.title).width;
    ctx.font = '500 46px Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.84)';
    ctx.fillText(naam, PAGE_MARGIN + titleW + 30, 92);
    ctx.fillStyle = 'rgba(255,255,255,0.36)';
    ctx.fillRect(PAGE_MARGIN, 118, PAGE_W - PAGE_MARGIN * 2, 2);

    const y = HEADER_H;
    roundRect(ctx, PAGE_MARGIN - CARD_PAD, y, cardW, cardH, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.font = '800 23px Inter, Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${model.keys} leden · ${runStatusText(model.runMeta)} · ${model.cfg.statusSuffix}`, PAGE_W - PAGE_MARGIN, y + 36);
    ctx.textAlign = 'left';

    const chips = model.cfg.summary(visibleStatsForSummary(model.stats));
    const chipBottom = drawChipRow(ctx, chips, PAGE_MARGIN, y + 54, PAGE_W - PAGE_MARGIN * 2);
    const chartY = Math.max(y + 96, chipBottom + 14);
    drawChartSurface(ctx, PAGE_MARGIN, chartY, chartW, chartH);
    clipRoundedChart(ctx, PAGE_MARGIN, chartY, chartW, chartH);
    drawChart(ctx, PAGE_MARGIN, chartY, chartW, chartH, model.times, model.stats, model.cfg);
    ctx.restore();
    strokeRoundedChart(ctx, PAGE_MARGIN, chartY, chartW, chartH);
    drawLegend(ctx, model.cfg, PAGE_MARGIN, chartY + chartH + 34, PAGE_W - PAGE_MARGIN * 2);

    ctx.fillStyle = 'rgba(255,255,255,0.56)';
    ctx.font = '800 20px Inter, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Ed Aldus WM · Data: Open-Meteo / ECMWF IFS ENS', PAGE_MARGIN, pageH - 36);
    return pageH;
  }

  function slug(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'plaats';
  }

  function shortDateFromIso(iso) {
    const parts = String(iso || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return '0000';
    return `${String(parts[2]).padStart(2, '0')}${String(parts[1]).padStart(2, '0')}`;
  }

  function pluimFilename(naam, param) {
    const plaats = slug(naam || 'plaats');
    const type = slug(FILE_LABELS[param] || param || 'pluim');
    return `${plaats}_${type}.png`;
  }

  const ZIP_ENCODER = new TextEncoder();
  let zipCrcTable = null;

  function getZipCrcTable() {
    if (zipCrcTable) return zipCrcTable;
    zipCrcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      zipCrcTable[n] = c >>> 0;
    }
    return zipCrcTable;
  }

  function crc32(bytes) {
    const table = getZipCrcTable();
    let c = 0xffffffff;
    for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zipDateTime(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, date: dosDate };
  }

  async function makeZip(entries) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const stamp = zipDateTime();

    for (const entry of entries) {
      const nameBytes = ZIP_ENCODER.encode(entry.path.replace(/^\/+/, ''));
      const data = new Uint8Array(await entry.blob.arrayBuffer());
      const crc = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, nameBytes.length, true);
      local.set(nameBytes, 30);
      chunks.push(local, data);
      central.push({ nameBytes, crc, size: data.length, offset });
      offset += local.length + data.length;
    }

    const centralStart = offset;
    for (const entry of central) {
      const header = new Uint8Array(46 + entry.nameBytes.length);
      const view = new DataView(header.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, stamp.time, true);
      view.setUint16(14, stamp.date, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.nameBytes.length, true);
      view.setUint32(42, entry.offset, true);
      header.set(entry.nameBytes, 46);
      chunks.push(header);
      offset += header.length;
    }

    const centralSize = offset - centralStart;
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, central.length, true);
    endView.setUint16(10, central.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, centralStart, true);
    chunks.push(end);
    return new Blob(chunks, { type: 'application/zip' });
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function validateInput({lat, lon, naam, startDate, endDate}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('lat/lon ontbreekt');
    const start = startDate instanceof Date ? startDate : new Date(startDate);
    const end = endDate instanceof Date ? endDate : new Date(endDate);
    if (isNaN(start)) throw new Error('Ongeldige startdatum');
    if (isNaN(end)) throw new Error('Ongeldige einddatum');
    if (end < start) throw new Error('Einddatum vóór startdatum');
    const startIso = isoDatum(start);
    const endIso = isoDatum(end);
    return {
      naam: naam || 'Plaats',
      startIso,
      endIso,
      // Een rechts-gelabeld vak 18–24 uur eindigt om 00 UTC op de volgende
      // datum. Haal daarom één dag extra op en snijd daarna per parameter terug.
      fetchEndIso: verschuifIsoDatum(endIso, 1),
    };
  }

  async function renderBlob(drawFn, scale) {
    const previewCanvas = document.createElement('canvas');
    const previewCtx = previewCanvas.getContext('2d');
    drawFn(previewCtx, true);

    const canvas = document.createElement('canvas');
    canvas.width = previewCanvas.width * scale;
    canvas.height = previewCanvas.height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    drawFn(ctx, false);

    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.95));
    if (!png) throw new Error('PNG maken mislukt');
    return png;
  }

  async function genereerPluimPNG({lat, lon, naam, startDate, endDate, scale=2}) {
    const { naam: naamOut, startIso, endIso, fetchEndIso } = validateInput({lat, lon, naam, startDate, endDate});
    const stable = await fetchStableEnsembleBatch(runMeta =>
      fetchEnsembleWithSpatialRain(lat, lon, startIso, fetchEndIso, runMeta)
    );
    const models = buildModels(stable.value, startIso, endIso, stable.runMeta);
    const png = await renderBlob((ctx, resize) => drawPage(ctx, naamOut, models, resize), scale);
    const fname = pluimFilename(naamOut, 'multi');
    downloadBlob(png, fname);
    return { filename: fname, sizeBytes: png.size };
  }

  async function genereerLossePluimenPNGs({lat, lon, naam, startDate, endDate, scale=2, zip=false, folderName, params=null, runHour=null}) {
    const { naam: naamOut, startIso, endIso, fetchEndIso } = validateInput({lat, lon, naam, startDate, endDate});
    // Een gearchiveerde hoofdrun bevat het exacte centrale roosterpunt. Gebruik
    // bij een afgedwongen cyclus geen actuele omliggende punten, want dan zouden
    // twee ECMWF-runs in één neerslagpluim worden gemengd.
    const needsSpatialRain = runHour == null && (!params || params.some(param => ['rain', 'rainmm', 'raincum', 'thunder'].includes(param)));
    const stable = await withRequestedRun(runHour, runContext => fetchStableEnsembleBatch(runMeta => needsSpatialRain
      ? fetchEnsembleWithSpatialRain(lat, lon, startIso, fetchEndIso, runMeta, runContext)
      : fetchEnsemble(lat, lon, startIso, fetchEndIso, ENSEMBLE_FIELDS, runMeta, runContext), runContext));
    const models = buildModels(stable.value, startIso, endIso, stable.runMeta, params);
    const results = [];
    const folder = slug(folderName || naamOut || 'plaats');

    for (const model of models) {
      const png = await renderBlob((ctx, resize) => drawSinglePage(ctx, naamOut, model, resize), scale);
      const fname = pluimFilename(folderName || naamOut, model.param);
      results.push({ filename: fname, path: fname, blob: png, sizeBytes: png.size });
      if (!zip) {
        downloadBlob(png, fname);
        await new Promise(resolve => setTimeout(resolve, 120));
      }
    }

    if (zip) {
      const zipBlob = await makeZip(results.map(r => ({ path: r.path, blob: r.blob })));
      const fname = `${folder}_pluimen.zip`;
      downloadBlob(zipBlob, fname);
      return {
        filename: fname,
        folder,
        files: results.map(({ blob, ...r }) => r),
        count: results.length,
        unavailable: models.unavailable || [],
        sizeBytes: zipBlob.size,
        zipped: true,
      };
    }

    return { files: results.map(({ blob, ...r }) => r), count: results.length, unavailable: models.unavailable || [] };
  }

  window.WBPluimExport = { genereerPluimPNG, genereerLossePluimenPNGs };
})();
