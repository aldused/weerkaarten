/* Sneeuwverwachting: pure functies (decodering, kleuren, tijd). Ook in Node te testen. */
(function(root){
  'use strict';
  const MISSING = 255;
  const TZ = 'Europe/Amsterdam';

  // Kaartvak exact als weerlab/mosmix_kaart.html.
  const MAP = {lonMin:3.3, lonMax:7.4, latMin:50.45, latMax:53.8, w:800, h:1100};
  const lonToX = lon => (lon - MAP.lonMin) / (MAP.lonMax - MAP.lonMin) * MAP.w;
  const latToY = lat => (1 - (lat - MAP.latMin) / (MAP.latMax - MAP.latMin)) * MAP.h;
  const xToLon = x => MAP.lonMin + x / MAP.w * (MAP.lonMax - MAP.lonMin);
  const yToLat = y => MAP.latMax - y / MAP.h * (MAP.latMax - MAP.latMin);

  // Kansschaal (ondergrenzen in %). 0 % blijft transparant: dan is de ondergrond zichtbaar.
  const PCT_SCALE = [
    {min:1,  color:'#e3e6eb', label:'< 10 %'},
    {min:10, color:'#c3def3', label:'10–20 %'},
    {min:20, color:'#78bde8', label:'20–40 %'},
    {min:40, color:'#2f7dcc', label:'40–60 %'},
    {min:60, color:'#5653b5', label:'60–80 %'},
    {min:80, color:'#4a1d78', label:'80–100 %'}
  ];
  // Hoeveelheidsschaal (cm), bewust een andere kleurfamilie dan de kansen.
  const CM_SCALE = [
    {min:0.5, color:'#e4f4f1', label:'0,5–1 cm'},
    {min:1,   color:'#b5e2dc', label:'1–3 cm'},
    {min:3,   color:'#74c6c4', label:'3–5 cm'},
    {min:5,   color:'#36a1b5', label:'5–10 cm'},
    {min:10,  color:'#1f6fa3', label:'10–15 cm'},
    {min:15,  color:'#2a4590', label:'15–25 cm'},
    {min:25,  color:'#5b2f8a', label:'25–50 cm'},
    {min:50,  color:'#8c2470', label:'≥ 50 cm'}
  ];

  // Neerslagsoort (categorieën uit criteria.PTYPE_CLASSES); 0 = geen/weinig kans op neerslag (transparant).
  const CAT_SCALE = [
    {code:1, color:'#6aa6dc', label:'Regen'},
    {code:3, color:'#5fbfae', label:'Regen en sneeuw'},
    {code:2, color:'#a99be0', label:'Natte sneeuw'},
    {code:4, color:'#6b35a8', label:'Sneeuw'},
    {code:5, color:'#e0902f', label:'IJskorrels'},
    {code:6, color:'#c62d42', label:'IJzel'},
    {code:7, color:'#c9a227', label:'Korrelhagel'}
  ];
  // Sneeuwval in mm water-equivalent (kaart 4), eigen schaal: geen cm.
  const MM_SCALE = [
    {min:0.25, color:'#eef3fa', label:'0,25–0,5 mm'},
    {min:0.5,  color:'#cfe0f2', label:'0,5–1 mm'},
    {min:1,    color:'#9fc3e6', label:'1–2 mm'},
    {min:2,    color:'#6a9fd6', label:'2–5 mm'},
    {min:5,    color:'#3f72b8', label:'5–10 mm'},
    {min:10,   color:'#4b4a9c', label:'10–20 mm'},
    {min:20,   color:'#6e2f86', label:'≥ 20 mm'}
  ];

  /** Code (uint8) -> fysieke waarde; null = ontbrekend. */
  function decode(code, encoding){
    if(code === MISSING) return null;
    return encoding === 'cm_x2' ? code / 2 : encoding === 'mm_x4' ? code / 4 : code;
  }
  function scaleFor(encoding){ return encoding === 'cm_x2' ? CM_SCALE : encoding === 'mm_x4' ? MM_SCALE : encoding === 'categorie' ? CAT_SCALE : PCT_SCALE; }
  /** Kleur bij waarde, of null (transparant) onder de laagste klasse. */
  function colorFor(value, encoding){
    if(value === null) return null;
    if(encoding === 'categorie'){ const k = CAT_SCALE.find(k => k.code === value); return k ? k.color : null; }
    const s = scaleFor(encoding); let c = null;
    for(const k of s) if(value >= k.min) c = k.color;
    return c;
  }
  const hexRGB = h => [1,3,5].map(i => parseInt(h.slice(i, i+2), 16));

  /** SNW1-raster: Uint8Array (al gedecomprimeerd) -> {nx, ny, nt, frame(t)}. */
  function parseRaster(bytes){
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if(String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'SNW1') throw Error('Geen SNW1-raster');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const nx = dv.getUint16(4, true), ny = dv.getUint16(6, true), nt = dv.getUint16(8, true);
    if(b.length !== 10 + nx * ny * nt) throw Error('Raster onvolledig');
    const n = nx * ny;
    return {nx, ny, nt, frame: t => b.subarray(10 + t * n, 10 + (t + 1) * n)};
  }
  const isGzip = b => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

  /** Celindex bij kaartcoördinaat (SVG-eenheden 800x1100); -1 buiten het vak. */
  function cellAt(x, y, grid){
    const i = Math.floor(x / MAP.w * grid.nx), j = Math.floor(y / MAP.h * grid.ny);
    return (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) ? -1 : j * grid.nx + i;
  }

  const fmt = (opts) => new Intl.DateTimeFormat('nl-NL', {timeZone: TZ, ...opts});
  const F_DAY = fmt({weekday:'short', day:'numeric', month:'short'});
  const F_HOUR = fmt({hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
  const F_FULL = fmt({weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hourCycle:'h23', timeZoneName:'short'});
  const F_KEY = new Intl.DateTimeFormat('sv-SE', {timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit'});
  const dayKey = t => F_KEY.format(t);
  const dayLabel = t => F_DAY.format(t);
  const hourLabel = t => F_HOUR.format(t);
  const fullLabel = t => F_FULL.format(t);

  /** Venster (t − W, t] als leesbare lokale tekst; DST-veilig omdat we in UTC rekenen. */
  function windowLabel(validMs, hours){
    const start = validMs - hours * 3600000;
    return (dayKey(start) === dayKey(validMs) ? hourLabel(start) : dayLabel(start) + ' ' + hourLabel(start)) + ' – ' + hourLabel(validMs);
  }

  /** Runleeftijd-waarschuwing (ICON-D2-EPS draait 8x per dag). */
  function staleWarning(runMs, now = Date.now(), maxHours = 9){
    if(!Number.isFinite(runMs)) return 'Modelrun onbekend.';
    const h = (now - runMs) / 3600000;
    return h > maxHours ? `Let op: deze run is ${Math.round(h)} uur oud; een nieuwere is nog niet verwerkt.` : '';
  }

  const api = {MISSING, MAP, lonToX, latToY, xToLon, yToLat, PCT_SCALE, CM_SCALE, CAT_SCALE, MM_SCALE, decode, scaleFor, colorFor, hexRGB,
    parseRaster, isGzip, cellAt, dayKey, dayLabel, hourLabel, fullLabel, windowLabel, staleWarning};
  if(typeof module === 'object' && module.exports) module.exports = api; else root.SneeuwCore = api;
})(typeof self !== 'undefined' ? self : this);
