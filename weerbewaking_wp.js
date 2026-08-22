/* WeatherPro point-forecast als databron voor de weerbewaking-tabellen.
   Client-side, elke lat/lon (MeteoGroup/DTN, zelfde bron als de app; run ~zelfde
   dag, iets ouder dan de app-feed). Levert genormaliseerde uur- + dagdata.
   Gebruik:  const wp = await WeatherProSrc.fetch(lat, lon, {days:7});
             wp.hours -> [{t,tt,td,rh,ff,ffg,dd,n,rr,pop,thunder,ppp,sun,ww}]
             wp.days  -> { "YYYY-MM-DD": {tx,tn} }
   Helpers:  WeatherProSrc.bft(kmh), WeatherProSrc.kompas(graden) */
window.WeatherProSrc = (function () {
  const TOKEN = "https://api.weatherpro.com/v1/token/weather";
  const FC = "https://point-forecast-weatherpro.meteogroup.com/search";
  const F0S = "issuedAt,airTemperatureInCelsius,dewPointTemperatureInCelsius,windSpeedInKilometerPerHour," +
              "windDirectionInDegree,effectiveCloudCoverInOcta,airPressureAtSeaLevelInHectoPascal," +
              "relativeHumidityInPercent,weatherCode";
  const F1H = "precipitationAmountInMillimeter,precipitationProbabilityInPercent,sunshineDurationInMinutes," +
              "maxWindGustInKilometerPerHour,thunderstormProbabilityInPercent";
  const F12 = "maxAirTemperatureInCelsius,minAirTemperatureInCelsius";

  let _tok = null, _tokT = 0;
  async function token() {
    const now = Date.now();
    if (_tok && now - _tokT < 540000) return _tok;
    const r = await fetch(TOKEN);
    _tok = (await r.text()).trim(); _tokT = now;
    return _tok;
  }
  const isoZ = d => d.toISOString().slice(0, 19) + "Z";
  const hk = iso => iso.slice(0, 16);            // "2026-07-08T14:00" lokaal (offset-iso)
  const num = v => (v === undefined || v === null ? null : +v);

  async function get(fields, period, lat, lon, from, until, tok) {
    const u = `${FC}?fields=${fields}&locatedAt=${lon},${lat}&validPeriod=${period}` +
              `&validFrom=${from}&validUntil=${until}`;
    const r = await fetch(u, { headers: { Authorization: "Bearer " + tok } });
    if (!r.ok) throw new Error("WeatherPro " + period + " " + r.status);
    return (await r.json()).forecasts || [];
  }

  async function fetchData(lat, lon, opts) {
    const days = (opts && opts.days) || 7;
    const tok = await token();
    const frm = new Date(); frm.setUTCHours(0, 0, 0, 0);
    const unt = new Date(frm); unt.setUTCDate(unt.getUTCDate() + days);
    const F = isoZ(frm), U = isoZ(unt);
    const [inst, intv, d12] = await Promise.all([
      get(F0S, "PT0S", lat, lon, F, U, tok),
      get(F1H, "PT1H", lat, lon, F, U, tok),
      get(F12, "PT12H", lat, lon, F, U, tok),
    ]);
    const im = {}; intv.forEach(x => im[hk(x.validFrom)] = x);
    // Stempel = EINDE van het uurvak (zoals de feed/app) -> label met de vak-start
    // (instant - 1u); het PT1H-interval met validFrom == label eindigt op het instant.
    const locHK = ms => new Date(ms).toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" })
                          .slice(0, 16).replace(" ", "T");
    const hours = inst.map(g => {
      const ms = new Date(g.validFrom).getTime() - 3600000;
      const k = locHK(ms), iv = im[k] || {};
      return {
        t: k,
        iso: new Date(ms).toISOString(),   // UTC, offset-veilig
        tt: num(g.airTemperatureInCelsius),
        td: num(g.dewPointTemperatureInCelsius),
        rh: num(g.relativeHumidityInPercent),
        ff: Math.round(num(g.windSpeedInKilometerPerHour) || 0),
        ffg: Math.round(num(iv.maxWindGustInKilometerPerHour) ?? num(g.windSpeedInKilometerPerHour) ?? 0),
        dd: Math.round(num(g.windDirectionInDegree) || 0),
        n: num(g.effectiveCloudCoverInOcta),
        rr: Math.round((num(iv.precipitationAmountInMillimeter) || 0) * 100) / 100,
        pop: Math.round(num(iv.precipitationProbabilityInPercent) || 0),
        thunder: Math.round(num(iv.thunderstormProbabilityInPercent) || 0),
        ppp: num(g.airPressureAtSeaLevelInHectoPascal),
        sun: Math.round(num(iv.sunshineDurationInMinutes) || 0),
        ww: Math.round(num(g.weatherCode) || 0),
      };
    });
    const dd = {};
    d12.forEach(f => {
      const uur = f.validFrom.slice(11, 13);
      if (uur === "06") {                                  // dag-venster 06-18 lokaal: tx
        const k = f.validFrom.slice(0, 10);
        const tx = num(f.maxAirTemperatureInCelsius);
        if (tx != null) (dd[k] = dd[k] || {}).tx = tx;
        const tn = num(f.minAirTemperatureInCelsius);      // fallback-tn als nachtvenster mist
        if (tn != null && (dd[k] || {}).tn == null) (dd[k] = dd[k] || {}).tn = tn;
      } else if (uur === "18") {                           // nachtvenster 18-06: echte nachtmin
        const k = f.validUntil.slice(0, 10);               // hoort bij de ochtend-dag
        const tn = num(f.minAirTemperatureInCelsius);
        if (tn != null) (dd[k] = dd[k] || {}).tn = tn;
      }
    });
    return { issued: inst.length ? inst[0].issuedAt : null, hours, days: dd };
  }

  function bft(kmh) {
    // ondergrenzen Bft 1..12 in km/u (1-5 = Bft 1, 6-11 = Bft 2, …)
    const b = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
    let i = 0; while (i < b.length && kmh >= b[i]) i++; return i;
  }
  function kompas(dd) {
    return ["N", "NNO", "NO", "ONO", "O", "OZO", "ZO", "ZZO", "Z", "ZZW", "ZW", "WZW",
            "W", "WNW", "NW", "NNW"][Math.round(dd / 22.5) % 16];
  }

  // Aggregeer uren → dagwaarden voor de opgegeven datums ("YYYY-MM-DD").
  // Levert {tmax,tmin,zon(uren),nsk(%),nsm(mm),bft,ri(graden)} arrays, kant-en-klaar
  // voor vulVooruitzichten() van de 5/6-daagse pagina's.
  function daily(wp, dateKeys) {
    const out = { tmax: [], tmin: [], zon: [], nsk: [], nsm: [], bft: [], ri: [] };
    dateKeys.forEach(dk => {
      const d = wp.days[dk];
      const hrs = wp.hours.filter(h => h.t.slice(0, 10) === dk);
      const temps = hrs.map(h => h.tt).filter(v => v != null);
      out.tmax.push(d && d.tx != null ? Math.round(d.tx) : (temps.length ? Math.round(Math.max(...temps)) : "–"));
      out.tmin.push(d && d.tn != null ? Math.round(d.tn) : (temps.length ? Math.round(Math.min(...temps)) : "–"));
      if (hrs.length) {
        const sun = hrs.reduce((s, h) => s + (h.sun || 0), 0);
        out.zon.push(Math.round(sun / 60 * 10) / 10);
        out.nsk.push(Math.max(...hrs.map(h => h.pop || 0)));
        const rr = hrs.reduce((s, h) => s + (h.rr || 0), 0);
        out.nsm.push(rr > 0 ? Math.round(rr * 10) / 10 : 0);
        out.bft.push(bft(Math.max(...hrs.map(h => h.ff || 0))));
        const noon = hrs.find(h => h.t.slice(11, 13) === "12") || hrs[Math.floor(hrs.length / 2)];
        out.ri.push(noon ? noon.dd : null);
      } else {
        out.zon.push("–"); out.nsk.push("–"); out.nsm.push("–"); out.bft.push("–"); out.ri.push(null);
      }
    });
    return out;
  }

  // Geocodeer plaatsnaam → {lat, lon, naam} (Open-Meteo, keyless, CORS-OK).
  async function geocode(q) {
    q = (q || "").trim();
    if (!q) return null;
    // "lat, lon" direct toestaan
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) return { lat: +m[1], lon: +m[2], naam: `${(+m[1]).toFixed(3)}, ${(+m[2]).toFixed(3)}` };
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=nl`);
    const j = await r.json();
    const res = j.results && j.results[0];
    if (!res) return null;
    const naam = [res.name, res.admin1, res.country].filter(Boolean).join(", ");
    return { lat: res.latitude, lon: res.longitude, naam };
  }

  /* ---------- Verse feed via R2 (exact dezelfde run/cijfers als de app) ---------- */
  const FEED_URL = ["localhost", "127.0.0.1"].includes(location.hostname)
    ? "weatherpro_uur.json" : "https://data.weerlab.nl/weatherpro_uur.json";
  let _feed = null, _feedT = 0;
  async function feed() {
    const now = Date.now();
    if (_feed && now - _feedT < 300000) return _feed;
    const r = await fetch(FEED_URL, { cache: "no-store" });
    if (!r.ok) throw new Error("feed " + r.status);
    _feed = await r.json(); _feedT = now;
    return _feed;
  }
  // Plaats uit de feed op slug, of null.
  async function feedCity(slug) {
    const f = await feed();
    const c = f[slug];
    return (c && c.data) ? c : null;
  }
  // KNMI-stationnummer -> feed-plaats (via _meta.stations), of null.
  async function feedStation(knmiNr) {
    const f = await feed();
    const slug = f._meta && f._meta.stations && f._meta.stations[String(knmiNr)];
    return slug ? feedCity(slug) : null;
  }
  // Dichtstbijzijnde feed-plaats binnen maxKm, of null.
  async function nearestFeedCity(lat, lon, maxKm = 8) {
    const f = await feed();
    let best = null;
    for (const [slug, c] of Object.entries(f)) {
      if (slug.startsWith("_") || !c.data) continue;
      const d = Math.hypot((c.lat - lat) * 111, (c.lon - lon) * 68);
      if (d <= maxKm && (!best || d < best.d)) best = { d, c };
    }
    return best ? best.c : null;
  }
  // RH uit temp/dauwpunt (Magnus) — feed-uren hebben geen RV-veld.
  function rhFromTd(tt, td) {
    if (tt == null || td == null) return null;
    const es = t => Math.exp(17.625 * t / (243.04 + t));
    return Math.min(100, Math.round(100 * es(td) / es(tt)));
  }
  // Feed-uren -> zelfde vorm als fetchData().hours (met iso/rh; thunder onbekend).
  // iso komt uit de pipeline (exacte UTC, browser-TZ-onafhankelijk).
  function feedHours(city) {
    return city.data.map(h => ({
      ...h,
      iso: h.iso || new Date(h.t).toISOString(),
      rh: rhFromTd(h.tt, h.td),
      thunder: null,
    }));
  }
  // Feed-dagen -> {tmax,tmin,zon,nsk,nsm,bft,ri} voor vulVooruitzichten().
  // Dit zijn de EXACTE app-dagcijfers (rechtstreeks uit de feed-<day>).
  function dailyFromFeed(city, dateKeys) {
    const out = { tmax: [], tmin: [], zon: [], nsk: [], nsm: [], bft: [], ri: [] };
    dateKeys.forEach(dk => {
      const d = city.days[dk];
      if (!d) { for (const k in out) out[k].push(k === "ri" ? null : "–"); return; }
      out.tmax.push(d.tx);
      out.tmin.push(d.tn);
      out.zon.push(d.sun != null ? (+d.sun).toFixed(1).replace(".0", "") : "–");
      out.nsk.push(d.pop ?? "–");
      out.nsm.push(d.rr != null ? (+d.rr).toFixed(1).replace(".0", "") : "–");
      out.bft.push(d.ff != null ? bft(d.ff) : "–");
      out.ri.push(d.dd ?? "–");
    });
    return out;
  }

  return { fetch: fetchData, daily, geocode, bft, kompas,
           feed, feedCity, feedStation, nearestFeedCity, feedHours, dailyFromFeed };
})();
