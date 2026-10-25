// Eigen getekende weersymbolen (SVG) op basis van de symboolcode van de feed.
(function (g) {
  'use strict';
  let uid = 0;
  const sunSVG = (cx, cy, w) => {
    const r = w * 0.30, rays = [...Array(8)].map((_, i) => { const a = i * Math.PI / 4; return `<line x1="${cx + Math.cos(a) * r * 1.35}" y1="${cy + Math.sin(a) * r * 1.35}" x2="${cx + Math.cos(a) * r * 1.8}" y2="${cy + Math.sin(a) * r * 1.8}" stroke="#ffd21a" stroke-width="${w * 0.07}" stroke-linecap="round"/>`; }).join('');
    return `${rays}<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#mbSun)"/>`;
  };
  const moonSVG = (cx, cy, w) => { const r = w * 0.42, id = 'mbm' + (++uid); return `<mask id="${id}"><rect width="100" height="100" fill="#fff"/><circle cx="${cx + r * 0.55}" cy="${cy - r * 0.3}" r="${r * 0.85}" fill="#000"/></mask><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#mbMoon)" mask="url(#${id})"/>`; };
  // wolk: bbox x 19..89, y 23..72 -> middelpunt (54, 47.5), breedte 70
  const cloudSVG = (cx, cy, w, grey) => {
    const id = 'mbc' + (++uid), s = w / 70, tx = cx - 54 * s, ty = cy - 47.5 * s;
    return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><g fill="#fff" transform="translate(${tx} ${ty}) scale(${s})"><circle cx="38" cy="56" r="16"/><circle cx="56" cy="46" r="22"/><circle cx="76" cy="58" r="14"/><rect x="36" y="56" width="40" height="16" rx="3"/></g></mask>
      <g class="cl"><rect x="${tx + 19 * s}" y="${ty + 23 * s}" width="${70 * s}" height="${49 * s}" mask="url(#${id})" fill="url(#${grey ? 'mbCloudG' : 'mbCloud'})"/></g>`;
  };
  const dropSVG = (cx, cy, w) => `<path d="M${cx} ${cy - w * 0.75} C${cx + w * 0.62} ${cy - w * 0.1} ${cx + w * 0.55} ${cy + w * 0.7} ${cx} ${cy + w * 0.7} C${cx - w * 0.55} ${cy + w * 0.7} ${cx - w * 0.62} ${cy - w * 0.1} ${cx} ${cy - w * 0.75}Z" fill="url(#mbDrop)"/>`;
  const flakeSVG = (cx, cy, w) => [0, 60, 120].map(a => `<line x1="${cx - w / 2}" y1="${cy}" x2="${cx + w / 2}" y2="${cy}" transform="rotate(${a} ${cx} ${cy})" stroke="#fff" stroke-width="${w * 0.14}" stroke-linecap="round"/>`).join('');

  function icon(code, night, size) {
    const c = code, lightCloud = c.cloud <= 2;
    let o = '';
    if (c.sky) {
      const big = c.cloud === 0, W = big ? 82 : c.cloud === 1 ? 66 : 72;
      const dx = big ? 0 : (c.cloud === 1 ? -10 : -19), dy = big ? 0 : (c.cloud === 1 ? -10 : -20);
      o += night ? moonSVG(50 + dx, 50 + dy, W) : sunSVG(50 + dx, 50 + dy, W);
    }
    if (c.cloud > 0) {
      const w = c.cloud === 1 ? 46 : c.cloud === 2 ? 74 : 88;
      const sx = c.cloud === 1 ? 20 : 3, sy = c.cloud === 1 ? 20 : ((c.rain || c.snow) ? -10 : 4);
      o += cloudSVG(50 + sx, 50 + sy, w, !(lightCloud || night));
    }
    if (c.rain || c.snow) {
      const both = c.rain && c.snow;
      let rl = []; let sl = [];
      if (c.rain) rl = both ? [[-20, 38, 16], [-4, 40, 14]] : c.rain === 1 ? [[4, 34, 20], [-12, 40, 13]] : c.rain <= 3 ? [[-16, 36, 17], [4, 37, 19], [22, 34, 16]] : [[-22, 36, 17], [-5, 40, 18], [12, 36, 18], [28, 40, 15]];
      if (c.snow) sl = both ? [[14, 38, 17], [30, 36, 14]] : c.snow >= 3 ? [[-18, 36, 18], [2, 40, 20], [22, 36, 17]] : [[-6, 37, 19], [14, 40, 15]];
      for (const [x, y, w] of rl) o += dropSVG(50 + x * 0.85, 50 + y - 6, w * 0.68);
      for (const [x, y, w] of sl) o += flakeSVG(50 + x * 0.85, 50 + y - 6, w * 0.7);
    }
    if (c.thunder) o += `<polygon points="52,60 44,76 51,76 47,90 60,70 52,70 56,60" fill="#ffe01a" transform="translate(0 -4)"/>`;
    if (c.mist) o += [0, 1, 2].map(i => `<rect x="15" y="${75 + i * 5.5}" width="70" height="3.4" rx="1.7" fill="#fff" opacity=".9"/>`).join('');
    if (c.gust) o += `<g fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M16 66h22a4 4 0 1 0-4-4"/><path d="M16 73h28a4 4 0 1 1-4 4"/></g>`;
    return `<svg class="wicon" overflow="visible" viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${o}</svg>`;
  }

  /** gedeelde verloopdefinities, één keer in de pagina */
  function defs() {
    return `<svg width="0" height="0" style="position:absolute"><defs>
      <radialGradient id="mbSun" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#fff27a"/><stop offset=".6" stop-color="#ffd21a"/><stop offset="1" stop-color="#f5a800"/></radialGradient>
      <linearGradient id="mbMoon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fafafa"/><stop offset="1" stop-color="#d9e0f2"/></linearGradient>
      <linearGradient id="mbCloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#cfd2d6"/></linearGradient>
      <linearGradient id="mbCloudG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c4c6ca"/><stop offset="1" stop-color="#6b6d72"/></linearGradient>
      <linearGradient id="mbDrop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b3e0ff"/><stop offset="1" stop-color="#3a8be6"/></linearGradient>
    </defs></svg>`;
  }

  /** windroos: pijlpunt wijst naar de richting waarheen de wind waait (dd = herkomst, dus +180°) */
  function compass(dir, size) {
    const arcs = [0, 1, 2, 3].map(k => { const a0 = (0.02 + 0.25 * k) * 2 * Math.PI - Math.PI / 2, a1 = (0.23 + 0.25 * k) * 2 * Math.PI - Math.PI / 2; const R = 44; return `<path d="M${50 + R * Math.cos(a0)} ${50 + R * Math.sin(a0)} A${R} ${R} 0 0 1 ${50 + R * Math.cos(a1)} ${50 + R * Math.sin(a1)}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="7" stroke-linecap="round"/>`; }).join('');
    const arrow = dir == null ? '' : `<polygon points="50,12 66,86 50,70 34,86" fill="#fff" transform="rotate(${dir + 180} 50 50)" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"/>`;
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">${arcs}${arrow}</svg>`;
  }

  /** zonsopkomst/-ondergang: halve zon boven horizon + pijl */
  const horizon = (up) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ffe000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18M7 18a5 5 0 0 1 10 0"/><path d="${up ? 'M12 4v6M9.5 6.5L12 4l2.5 2.5' : 'M12 10V4M9.5 7.5L12 10l2.5-2.5'}"/></svg>`;
  /** Centreert elk symbool op zijn eigen omlijning (geen afgesneden zonnestralen, gelijke uitlijning). */
  function fit(root) {
    root.querySelectorAll('svg.wicon').forEach(svg => {
      try {
        const b = svg.getBBox(); if (!b.width || !b.height) return;
        const side = Math.max(b.width, b.height) * 1.08, cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        svg.setAttribute('viewBox', `${cx - side / 2} ${cy - side / 2} ${side} ${side}`);
      } catch (e) { /* element nog niet zichtbaar */ }
    });
  }
  g.Icons = { icon, defs, compass, horizon, fit };
})(window);
