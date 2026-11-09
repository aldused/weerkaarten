/*
 * Weerlab Modeltijdseries — instelbare kleurgrenzen en standaardprofielen.
 *
 * Alle kleurgrenzen staan hier, met hun grondslag. Wijzigen = alleen dit bestand.
 * Waarden in interne eenheden (°C, m/s, m, mm, %, J/kg).
 */
(function (root) {
  'use strict';

  var COLOR_SCALES = {
    t2m: {
      basis: 'Doorlopende schaal; 0 °C = vriespunt als neutraal punt, stappen van 10 °C.',
      stops: [[-15, '#3b5bdb'], [-5, '#8fb3f0'], [0, '#e9f0fb'], [10, '#fdf6e3'], [20, '#f7c47a'], [30, '#e8590c'], [38, '#a61e1e']],
      alpha: 0.42
    },
    td2m: { same: 't2m' },
    feels: { same: 't2m' },
    spread: {
      basis: 'Dauwpuntspreiding ≤ 1 °C: lucht (bijna) verzadigd, mist/lage bewolking mogelijk; ≤ 2,5 °C: vochtig.',
      bands: [[1, '#9b6bd6', 0.35], [2.5, '#c4a5ec', 0.25]], below: true
    },
    rh: {
      basis: 'Instelbare visualisatiegrenzen: RV 90 en 97 %. Geen gekwantificeerde modelonzekerheid.',
      bands: [[90, '#c4a5ec', 0.22], [97, '#9b6bd6', 0.32]], above: true
    },
    wspd: {
      basis: 'Beaufort-grenzen (WMO): 6 Bft ≥ 10,8 m/s, 7 Bft ≥ 13,9 m/s, 8 Bft ≥ 17,2 m/s, 9 Bft ≥ 20,8 m/s.',
      bands: [[10.8, '#f6d365', 0.35], [13.9, '#f59f00', 0.40], [17.2, '#e8590c', 0.45], [20.8, '#c92a2a', 0.50]], above: true
    },
    wspd50: { same: 'wspd' }, wspd100: { same: 'wspd' },
    gust: {
      basis: 'Instelbare visualisatiegrenzen: 60, 75, 100 en 120 km/u. Dit zijn geen officiële waarschuwingen; tijdvensters verschillen per model.',
      bands: [[16.7, '#f6d365', 0.35], [20.8, '#f59f00', 0.45], [27.8, '#e8590c', 0.50], [33.3, '#c92a2a', 0.55]], above: true
    },
    vis: {
      basis: 'Visualisatiegrenzen: 5000, 1000 en 200 m. Geen beoordeling van vliegminima of officiële waarschuwing.',
      bands: [[5000, '#ffe8a3', 0.35], [1000, '#f59f00', 0.40], [200, '#c92a2a', 0.50]], below: true
    },
    cbh: {
      basis: 'Visualisatiegrenzen: 1500, 1000 en 500 ft. Alleen modelwolkenbasis boven grondniveau; geen ceiling of vliegconditieclassificatie.',
      bands: [[457, '#ffe8a3', 0.30], [305, '#f59f00', 0.35], [152, '#c92a2a', 0.45]], below: true
    },
    ceiling: { same: 'cbh' },
    precip: {
      basis: 'Neerslag omgerekend naar mm per uur: ≥ 0,1 (meetbaar), ≥ 1, ≥ 2,5, ≥ 5, ≥ 10 mm/u.',
      bands: [[0.1, '#d0ebff', 0.6], [1, '#a5d8ff', 0.7], [2.5, '#74c0fc', 0.7], [5, '#339af0', 0.75], [10, '#1c5fbf', 0.8]], above: true, perHour: true
    },
    prate: { same: 'precip', perHourNative: true },
    tcc: {
      basis: 'Grijswaarde lineair met bedekking (0-100 %).',
      gray: true
    },
    lcc: { same: 'tcc' }, mcc: { same: 'tcc' }, hcc: { same: 'tcc' },
    cape: {
      basis: 'MUCAPE ≥ 100 (zwak), ≥ 500 (matig), ≥ 1000 (aanzienlijk) J/kg.',
      bands: [[100, '#ffe8cc', 0.5], [500, '#ffc078', 0.5], [1000, '#fd7e14', 0.5]], above: true
    },
    fog: { basis: '1 = mist (< 1000 m), 2 = dichte mist (< 200 m).' }
  };

  // Profielen: params = volgorde in tabel en grafiek. models: null = huidige selectie houden.
  var PROFILES = {
    algemeen: { label: 'Algemeen weer', params: ['t2m', 'td2m', 'wdir', 'wspd', 'gust', 'precip', 'ptype', 'tcc', 'msl'] },
    wind: { label: 'Wind', params: ['wdir', 'wspd', 'gust', 'wspd50', 'wspd100', 'wdir100'] },
    luchtvaart: { label: 'Luchtvaart', params: ['wdir', 'wspd', 'gust', 'vis', 'fog', 'cbh', 'ceiling', 'tcc', 'lcc', 'mcc', 'hcc', 't2m', 'td2m', 'msl'], units: { wind: 'kt', height: 'ft' } },
    mist: { label: 'Mist en lage bewolking', params: ['t2m', 'td2m', 'spread', 'rh', 'vis', 'fog', 'lcc', 'cbh', 'wspd'] },
    temperatuur: { label: 'Temperatuurvergelijking', params: ['t2m', 'td2m'], tableMode: 'combined' },
    vergelijking: { label: 'Modelvergelijking', params: ['t2m', 'td2m', 'wspd', 'gust', 'precip', 'tcc', 'msl'], tableMode: 'combined', models: ['ecmwf', 'harmonie43', 'harmonie46', 'icond2'] }
  };

  var DEFAULTS = {
    models: ['ecmwf', 'harmonie43', 'harmonie46', 'icond2'],
    profile: 'algemeen',
    units: { wind: 'kt', height: 'm' },
    tz: 'local',
    view: 'both',
    tableMode: 'combined',
    chartHeight: 560,
    diff: { on: false, t2m: 2, td2m: 2, wspd: 5, gust: 7.5, msl: 2, tcc: 40, vis: 3000, cbh: 300 }  // m/s- of interne eenheden
  };

  var REFRESH_MS = 5 * 60 * 1000;   // runs.json opnieuw bekijken (klein bestand, CDN max-age 30 s)
  var STALE_H = { ecmwf: 16, harmonie43: 4, harmonie46: 8, icond2: 6 };  // ouder dan dit = "verouderd" (run-leeftijd)

  root.TSConfig = { COLOR_SCALES: COLOR_SCALES, PROFILES: PROFILES, DEFAULTS: DEFAULTS, REFRESH_MS: REFRESH_MS, STALE_H: STALE_H };
})(typeof self !== 'undefined' ? self : this);
