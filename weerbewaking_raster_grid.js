// Het 7/10-dagenraster met canvas-grafieken.
(function (g) {
  'use strict';
  const { prefs } = WP;
  const LABEL_W = 76, TOP = 9, STRIP = 24, HEAD = 50;
  const GOLD = '#ffe000', CYAN = '#00e6f2';

  function fractionFn(starts) {
    const n = starts.length - 1;
    return (t) => { t = +t; if (t < +starts[0] || t >= +starts[n]) return null; for (let i = 0; i < n; i++) if (t < +starts[i + 1]) return (i + (t - starts[i]) / (starts[i + 1] - starts[i])) / n; return null; };
  }

  function drawChart(canvas, w, h, starts, city, fn) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const frac = fractionFn(starts), plotW = w - LABEL_W, plotH = h - TOP - STRIP, base = TOP + plotH, n = starts.length - 1;
    const P = {
      ctx, w, h, plotW, plotH, base, n,
      x: (t) => { const f = frac(t); return f == null ? null : LABEL_W + f * plotW; },
      y: (f) => TOP + plotH * (1 - f),
      bw: Math.max(1, plotW / (n * 24) - 0.5),
      grid(ticks, lo, hi, every = 1, dotted = null) {
        ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.fillStyle = '#fff'; ctx.font = '600 10px system-ui'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        const skip = Math.max(every, Math.ceil(12 / (plotH / Math.max(ticks.length - 1, 1))));
        ticks.forEach((v, k) => { const y = P.y((v - lo) / (hi - lo)); ctx.beginPath(); ctx.moveTo(LABEL_W, y); ctx.lineTo(w, y); ctx.stroke(); if (k % skip === 0) ctx.fillText(String(Math.round(v * 100) / 100), LABEL_W - 6, y); });
        if (dotted != null) { const y = P.y((dotted - lo) / (hi - lo)); ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(LABEL_W, y); ctx.lineTo(w, y); ctx.stroke(); ctx.restore(); }
      },
      hours(show = true) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
        for (let i = 0; i < n; i++) { const x = LABEL_W + i / n * plotW; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        if (!show) return;
        ctx.fillStyle = '#fff'; ctx.font = '700 10px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const step = n <= 2 ? 1 : 6;
        for (let i = 0; i < n; i++) for (let hr = 0; hr < 24; hr += step) { const t = new Date(+starts[i] + hr * 3600e3), x = P.x(t); if (x != null) ctx.fillText(String(hr).padStart(2, '0'), x + 8, base + 13); }
      },
      line(pts, lo, hi, color, width = 1.6, dash = []) {
        ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.beginPath(); let st = false;
        for (const [t, v] of pts) { const x = P.x(t); if (x == null) continue; const y = P.y((v - lo) / (hi - lo)); st ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), st = true); }
        ctx.stroke(); ctx.setLineDash([]);
      },
      band(up, down, color) {
        if (up.length < 3) return; ctx.fillStyle = color; ctx.beginPath(); up.forEach(([t, v], k) => { const x = P.x(t); if (x == null) return; k ? ctx.lineTo(x, P.y(v)) : ctx.moveTo(x, P.y(v)); });
        [...down].reverse().forEach(([t, v]) => { const x = P.x(t); if (x != null) ctx.lineTo(x, P.y(v)); }); ctx.closePath(); ctx.fill();
      },
      hollow(t, frac01, color) { const x = P.x(t); if (x == null) return; const hh = plotH * Math.min(1, Math.max(0, frac01)); ctx.strokeStyle = color; ctx.lineWidth = 0.8; ctx.strokeRect(x + 0.4, base - hh, P.bw - 0.8, hh); },
      bar(t, frac01, color) { const x = P.x(t); if (x == null) return; const hh = plotH * Math.min(1, Math.max(0, frac01)); ctx.fillStyle = color; ctx.fillRect(x, base - hh, P.bw, hh); },
    };
    fn(P);
  }

  function render(root, { city, fc, starts, onDay, alertsList, ens = null, knmi = [], sourceLabel = '' }) {
    const n = starts.length - 1, tz = city.tz;
    const hours = fc.hours.filter(h => h.start >= starts[0] && h.start < starts[n]);
    const dayOf = (i) => fc.days.find(d => d.date.toISOString().slice(0, 10) === WP.ymd(starts[i], tz));
    const days = [...Array(n)].map((_, i) => dayOf(i));
    const colsStyle = `grid-template-columns:${LABEL_W}px repeat(${n},1fr)`;
    const rules = prefs, offCity = WP.alertOff(city.id), hot = rules.alertsOn && !offCity;
    const W = root.clientWidth || 1000, colW = (W - LABEL_W) / n;
    const availH = root.clientHeight || 800, hSym = Math.max(132, Math.min(230, availH * 0.18)), hChart = Math.max(70, Math.min(230, (availH - HEAD - hSym - 225) / 5 - 24)), hC = hChart + STRIP;
    const iconSize = Math.max(48, Math.min(170, colW * 0.62, hSym - 66));

    const label = (icon, lines) => `<div class="lab"><div class="lic">${icon}</div>${lines.map(l => `<div class="lun">${l}</div>`).join('')}</div>`;
    let html = `<div class="grow head" style="${colsStyle}"><div class="lab"><div class="lic" title="Klik op een datum voor het weer per uur">ⓘ</div>${sourceLabel ? `<div class="srclab">${sourceLabel}</div>` : ''}</div>`;
    for (let i = 0; i < n; i++) {
      const isToday = WP.ymd(starts[i], tz) === WP.ymd(new Date(), tz);
      const warn = alertsList.some(a => (a.kind === 'heat' || a.kind === 'frost') ? WP.ymd(a.start, 'UTC') === WP.ymd(starts[i], tz) : (a.start < starts[i + 1] && a.end > starts[i]));
      const kw = knmi.filter(w => w.onset < starts[i + 1] && w.expires > starts[i]).sort((a, b) => b.level - a.level)[0];
      html += `<div class="dayhead${isToday ? ' today' : ''}" data-i="${i}"><span class="wd">${WP.wdShort(starts[i], tz)}</span><span>${WP.ddmm(starts[i], tz)}</span>${warn ? '<i class="warn">⚠</i>' : ''}${kw ? `<i class="kn" style="background:${WP.levelColor(kw.level)}" title="KNMI code ${WP.levelName(kw.level)}: ${kw.typeName}">${kw.icon}</i>` : ''}</div>`;
    }
    html += '</div>';

    // symbolen
    html += `<div class="grow sym" style="${colsStyle};min-height:${hSym}px">${label('<span class="mi">⛅</span>', [])}`;
    for (let i = 0; i < n; i++) {
      const d = days[i];
      if (n <= 2) {
        const slots = hours.filter(h => h.start >= starts[i] && h.start < starts[i + 1]);
        html += `<div class="colcell hourly">${slots.map(h => `<div class="hs">${Icons.icon(WP.decode(h.symbol, h.ww, h.cloud), WP.isNight(new Date(+h.start + 1800e3), city.lat, city.lon), Math.min(40, colW / slots.length * 0.8))}<b>${WP.fT(h.temp, false)}</b><small>${WP.hh(h.start, tz)}</small></div>`).join('')}</div>`;
      } else html += `<div class="colcell">${d ? Icons.icon(WP.decode(d.symbol, d.ww, d.cloud), false, iconSize) + `<div class="desc">${WP.describe(d.ww, d.cloud)}</div>` : ''}</div>`;
    }
    html += '</div>';

    const chartRow = (id, icon, lines) => `<div class="grow chart" style="${colsStyle};height:${hC}px">${label(icon, lines)}<canvas id="${id}" class="cv"></canvas></div>`;
    const valRow = (cells, cls = '') => `<div class="grow vals ${cls}" style="${colsStyle}"><div class="lab"></div>${cells.join('')}</div>`;

    html += chartRow('cTemp', '🌡', [WP.tunit()]);
    const on = (k) => prefs[k] !== false, showFeels = on('showFeels'), showSun = on('showSunTimes'), showEnsMax = on('showEnsMax'), showBand = on('showEnsBand');
    const feelOf = (h) => showFeels ? WP.feelsLike(h.temp, h.dew, h.kn) : null;
    html += valRow(days.map((d, i) => { const fl = hours.filter(h => h.start >= starts[i] && h.start < starts[i + 1]).map(feelOf).filter(v => v != null);
      return `<div class="colcell tw"><div class="tt"><span>${WP.fTC(d?.tn)}</span><span class="gold">${WP.fTC(d?.tx)}</span></div>${(() => { const b = showEnsMax && ens && ens.dailyMax(starts[i], starts[i + 1]); return b ? `<div class="ens">ens. max ${WP.fT(b.p10, false)}–${WP.fT(b.p90)}</div>` : ''; })()}${fl.length ? `<div class="feel">voelt ${WP.fT(Math.min(...fl), false)}–${WP.fT(Math.max(...fl))}</div>` : ''}</div>`; }));
    html += chartRow('cRain', '💧', [WP.ru(), '%']);
    html += valRow(days.map(d => { const tot = d && d.rain != null ? d.rain + (d.rainN || 0) : null; return `<div class="colcell tt"><span class="cy">${tot == null ? '–' : WP.num(WP.rconv(tot)) + WP.ru()}</span><span class="dim">${WP.fPct(d?.prob)}</span></div>`; }));
    html += chartRow('cSun', '☀', ['min']);
    html += valRow(starts.slice(0, n).map((s, i) => { const d = days[i], rs = WP.riseSet(s, city.lat, city.lon); const lo = Math.round(d?.uvLow ?? d?.uvi ?? 0), hi = Math.round(d?.uvi ?? 0), uv = d ? (lo === hi || lo === 0 ? hi : lo + '-' + hi) : '–';
      const sun = d?.sun != null ? WP.num(d.sun) + 'h' : '–', up = rs.rise ? WP.hm(rs.rise, tz) : '–', dn = rs.set ? WP.hm(rs.set, tz) : '–';
      return `<div class="colcell sunv"><div class="s2"><div><i>☀</i>${sun}<b>UV ${uv}</b></div>${showSun ? `<div><i>${Icons.horizon(true)}</i>${up}<i>${Icons.horizon(false)}</i>${dn}</div>` : ''}</div><div class="s4"><div><i>☀</i>${sun}</div>${showSun ? `<div><i>${Icons.horizon(true)}</i>${up}</div><div><i>${Icons.horizon(false)}</i>${dn}</div>` : ''}<div><b>UV ${uv}</b></div></div></div>`; }), '');
    html += chartRow('cWind', '🚩', [WP.isBft() ? 'Bft' : WP.windLabel()]);
    html += valRow(days.map((d, i) => { const dh = hours.filter(h => h.start >= starts[i] && h.start < starts[i + 1]); const gm = Math.max(...dh.map(h => h.gust ?? 0), d?.gust ?? 0) || null;
      const mean = d?.kn == null ? '–' : (prefs.wind === 'bftkmh' ? WP.half(WP.bft(d.kn)) + ' Bft' : WP.half(WP.windVal(d.kn)));
      const gust = gm == null ? '–' : (prefs.wind === 'bftkmh' ? WP.half(gm * WP.KN) + ' km/u' : WP.half(WP.windVal(gm)));
      return `<div class="colcell windv">${Icons.compass(d?.dir, 46)}<div><div class="dim">${mean}</div><div>${gust}</div></div></div>`; }), 'wv');
    html += chartRow('cPres', '🧭', [WP.pu()]);
    root.innerHTML = html; root.classList.toggle('narrow', colW < 150);

    // grafieken tekenen
    const full = root.clientWidth;
    const getCv = (id) => root.querySelector('#' + id);

    // temperatuur
    {
      const ensVals = ens ? ens.times.flatMap((t, i) => (t >= starts[0] && t < starts[n]) ? [ens.t10[i], ens.t90[i]] : []) : [];
      const vals = [...ensVals, ...hours.flatMap(h => [h.temp, h.dew, feelOf(h)]), ...days.flatMap(d => [d?.tx, d?.tn])].filter(v => v != null).map(WP.tconv);
      const mn = Math.min(...vals), mx = Math.max(...vals), x0 = Math.floor((mn - 2) / 2) * 2, lo = x0 - 1, hi = Math.ceil((mx + 1) / 2) * 2 + 1;
      const ticks = []; for (let v = lo; v <= hi; v += 2) ticks.push(v);
      drawChart(getCv('cTemp'), full, hC, starts, city, (P) => {
        P.grid(ticks, lo, hi); P.hours();
        if (ens && showBand) { const idx = ens.times.map((t, i) => i).filter(i => ens.times[i] >= starts[0] && ens.times[i] < starts[n] && ens.t10[i] != null);
          P.band(idx.map(i => [ens.times[i], WP.tconv(ens.t90[i])]), idx.map(i => [ens.times[i], WP.tconv(ens.t10[i])]), 'rgba(255,255,255,.17)'); }
        P.line(hours.filter(h => h.dew != null).map(h => [+h.start + 1800e3, WP.tconv(h.dew)]), lo, hi, 'rgba(255,255,255,.55)', 1.4);
        if (showFeels) P.line(hours.filter(h => feelOf(h) != null).map(h => [+h.start + 1800e3, WP.tconv(feelOf(h))]), lo, hi, '#ffb86b', 1.3, [4, 3]);
        P.line(hours.filter(h => h.temp != null).map(h => [+h.start + 1800e3, WP.tconv(h.temp)]), lo, hi, '#fff', 1.8);
        const at = (i, hr, v) => [new Date(+starts[i] + hr * 3600e3), WP.tconv(v)];
        P.line(days.map((d, i) => d?.tx != null ? at(i, 15, d.tx) : null).filter(Boolean), lo, hi, GOLD, 1.4);
        P.line(days.map((d, i) => d?.tn != null ? at(i, 5, d.tn) : null).filter(Boolean), lo, hi, '#00204d', 1.4);
      });
    }
    // neerslag
    {
      const top = Math.max(5, Math.ceil(WP.rconv(Math.max(0, ...hours.map(h => h.rain || 0))))), ticks = [...Array(top + 1).keys()];
      drawChart(getCv('cRain'), full, hC, starts, city, (P) => {
        P.grid(ticks, 0, top); P.hours();
        if (ens) ens.times.forEach((t, i) => { const v = ens.r90[i]; if (v != null && v >= 0.2 && t >= starts[0] && t < starts[n] + 3600e3) P.hollow(new Date(t - 3600e3), Math.min(WP.rconv(v), top) / top, 'rgba(0,230,242,.6)'); });
        for (const h of hours) if (h.rain > 0) P.bar(h.start, Math.min(WP.rconv(h.rain), top) / top, hot && h.rain >= prefs.alertRain ? '#ff9500' : CYAN);
        P.line(hours.filter(h => h.prob != null).map(h => [+h.start + 1800e3, h.prob / 100 * top]), 0, top, 'rgba(255,255,255,.85)', 1.3);
      });
    }
    // zon
    drawChart(getCv('cSun'), full, hC, starts, city, (P) => {
      P.grid([...Array(11).keys()].map(k => k * 6), 0, 60); P.hours();
      for (const h of hours) if (h.sun > 0) P.bar(h.start, h.sun / 60, '#ffdb00');
    });
    // wind
    {
      const bf = WP.isBft(), v = (kn) => WP.windVal(kn), maxG = Math.max(10, ...hours.map(h => h.gust ? v(h.gust) : 0));
      const top = bf ? 10 : Math.max(10, Math.ceil(maxG / 5) * 5), ticks = bf ? [...Array(11).keys()] : [...Array(11).keys()].map(k => k * top / 10), gale = bf ? 8 : v(34);
      drawChart(getCv('cWind'), full, hC, starts, city, (P) => {
        P.grid(ticks, 0, top, 1, gale); P.hours();
        for (const h of hours) {
          if (h.gust != null) P.bar(h.start, v(h.gust) / top, hot && h.gust * WP.KN >= prefs.alertGust ? '#ff8c73' : '#9ec2eb');
          if (h.kn != null) P.bar(h.start, v(h.kn) / top, '#6b9ed1');
        }
      });
    }
    // druk
    {
      const vals = hours.map(h => h.p).filter(x => x != null).map(WP.pconv), step = prefs.pressure === 'inhg' ? 0.12 : 4;
      const lo = Math.floor((Math.min(...vals) - step) / step) * step, hi = Math.ceil((Math.max(...vals) + step) / step) * step, ticks = []; for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(t);
      drawChart(getCv('cPres'), full, hC, starts, city, (P) => {
        P.grid(ticks, lo, hi, ticks.length > 9 ? 2 : 1, WP.pconv(1013) > lo && WP.pconv(1013) < hi ? WP.pconv(1013) : null); P.hours(false);
        P.line(hours.filter(h => h.p != null).map(h => [+h.start + 1800e3, WP.pconv(h.p)]), lo, hi, '#fff', 1.6);
      });
    }
    Icons.fit(root);
    root.querySelectorAll('.dayhead').forEach(el => el.addEventListener('click', () => onDay(+el.dataset.i, el)));
  }

  g.Grid = { render };
})(window);
