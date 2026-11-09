/*
 * Weerlab Modeltijdseries — grafiekmodule.
 *
 * Gekoppelde panelen met één gedeelde tijdas. Elke eenheid krijgt een eigen paneel
 * (temperatuur, wind, bewolking, zicht ...), dus nooit °C en m/s op één as.
 * Tekenwerk loopt via een klein "g"-object met een Canvas- en een SVG-variant: de
 * PNG- en SVG-export tekenen exact hetzelfde als het scherm.
 *
 * Geen interpolatie: lijnen verbinden alleen bestaande modeltijdstappen; ontbrekende
 * waarden onderbreken de lijn. Kolommen (neerslag) beslaan het werkelijke tijdvenster.
 */
(function (root) {
  'use strict';
  var C = root.TSCore;
  function belongs(s, panel) { return panel === 'dew' ? s.param === 'td2m' : C.PARAM[s.param].panel === panel; }
  var HOUR = 3600000;
  var DPR = function () { return Math.max(1, Math.min(3, root.devicePixelRatio || 1)); };

  // ------------------------------------------------------------------ teken-backends
  function CanvasG(ctx) { this.c = ctx; }
  CanvasG.prototype = {
    rect: function (x, y, w, h, fill) { this.c.fillStyle = fill; this.c.fillRect(x, y, w, h); },
    strokeRect: function (x, y, w, h, stroke) { this.c.strokeStyle = stroke; this.c.lineWidth = 1; this.c.strokeRect(x + .5, y + .5, w - 1, h - 1); },
    line: function (pts, stroke, width, dash) {
      var c = this.c; c.strokeStyle = stroke; c.lineWidth = width || 1; c.setLineDash(dash || []);
      c.beginPath(); var pen = false;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (!p) { pen = false; continue; }
        if (pen) c.lineTo(p[0], p[1]); else { c.moveTo(p[0], p[1]); pen = true; }
      }
      c.stroke(); c.setLineDash([]);
    },
    dot: function (x, y, r, fill) { var c = this.c; c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, 2 * Math.PI); c.fill(); },
    poly: function (pts, fill) { var c = this.c; c.fillStyle = fill; c.beginPath(); pts.forEach(function (p, i) { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }); c.closePath(); c.fill(); },
    text: function (x, y, s, font, fill, align, base) {
      var c = this.c; c.font = font; c.fillStyle = fill; c.textAlign = align || 'left'; c.textBaseline = base || 'alphabetic'; c.fillText(s, x, y);
    },
    verticalText: function (x,y,s,font,fill) { var c=this.c; c.save(); c.translate(x,y); c.rotate(-Math.PI/2); this.text(0,0,s,font,fill,'center','middle'); c.restore(); },
    clip: function (x, y, w, h) { this.c.save(); this.c.beginPath(); this.c.rect(x, y, w, h); this.c.clip(); },
    unclip: function () { this.c.restore(); }
  };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function f(n) { return Math.round(n * 10) / 10; }
  function SvgG(w, h, bg) { this.o = []; this.w = w; this.h = h; this.clipN = 0; this.open = 0; if (bg) this.rect(0, 0, w, h, bg); }
  SvgG.prototype = {
    rect: function (x, y, w, h, fill) { this.o.push('<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) + '" fill="' + fill + '"/>'); },
    strokeRect: function (x, y, w, h, stroke) { this.o.push('<rect x="' + f(x + .5) + '" y="' + f(y + .5) + '" width="' + f(w - 1) + '" height="' + f(h - 1) + '" fill="none" stroke="' + stroke + '"/>'); },
    line: function (pts, stroke, width, dash) {
      var d = '', pen = false;
      pts.forEach(function (p) { if (!p) { pen = false; return; } d += (pen ? 'L' : 'M') + f(p[0]) + ' ' + f(p[1]); pen = true; });
      if (d) this.o.push('<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + (width || 1) + '"' + (dash && dash.length ? ' stroke-dasharray="' + dash.join(' ') + '"' : '') + '/>');
    },
    dot: function (x, y, r, fill) { this.o.push('<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + r + '" fill="' + fill + '"/>'); },
    poly: function (pts, fill) { this.o.push('<path d="' + pts.map(function (p, i) { return (i ? 'L' : 'M') + f(p[0]) + ' ' + f(p[1]); }).join('') + 'Z" fill="' + fill + '"/>'); },
    text: function (x, y, s, font, fill, align, base) {
      var anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
      var dy = base === 'middle' ? ' dominant-baseline="central"' : base === 'top' ? ' dominant-baseline="hanging"' : '';
      var m = /(\d+)\s*(\d+)px\s*(.*)/.exec(font) || [];
      this.o.push('<text x="' + f(x) + '" y="' + f(y) + '" text-anchor="' + anchor + '"' + dy + ' font-weight="' + (m[1] || 400) + '" font-size="' + (m[2] || 11) + '" font-family="' + esc(m[3] || 'sans-serif').replace(/"/g, "'") + '" fill="' + fill + '">' + esc(s) + '</text>');
    },
    verticalText: function (x,y,s,font,fill) { this.o.push('<g transform="translate('+f(x)+' '+f(y)+') rotate(-90)">'); this.text(0,0,s,font,fill,'center','middle'); this.o.push('</g>'); },
    clip: function (x, y, w, h) { var id = 'c' + (this.clipN++); this.o.push('<clipPath id="' + id + '"><rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) + '"/></clipPath><g clip-path="url(#' + id + ')">'); this.open++; },
    unclip: function () { if (this.open) { this.o.push('</g>'); this.open--; } },
    toString: function () { return '<svg xmlns="http://www.w3.org/2000/svg" width="' + this.w + '" height="' + this.h + '" viewBox="0 0 ' + this.w + ' ' + this.h + '">' + this.o.join('') + '</svg>'; }
  };

  // ------------------------------------------------------------------ hulpfuncties
  function niceStep(span, n) {
    var raw = span / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
    return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  }
  function fmtNum(v, dec) { return isFinite(v) ? v.toFixed(dec).replace('.', ',').replace('-', '−') : '—'; }

  function theme() {
    var cs = getComputedStyle(document.documentElement);
    var v = function (n, d) { return (cs.getPropertyValue(n) || '').trim() || d; };
    return {
      bg: v('--ts-chart-bg', '#ffffff'), grid: v('--ts-grid', '#e8edf3'), axis: v('--ts-axis', '#64748b'),
      text: v('--ts-text', '#0f172a'), night: v('--ts-night', 'rgba(15,32,91,0.055)'), day: v('--ts-daysep', '#94a3b8'),
      sel: v('--ts-sel', '#f59f00'), panelBg: v('--ts-panel-bg', '#fbfcfe'), font: v('--wl-font-sans', 'DM Sans, sans-serif'),
      mono: v('--wl-font-mono', 'DM Mono, monospace')
    };
  }

  // ------------------------------------------------------------------ grafiek
  function TSChart(el, opts) {
    this.el = el;
    this.opts = opts || {};
    this.canvas = document.createElement('canvas');
    this.overlay = document.createElement('canvas');
    this.tip = document.createElement('div');
    this.tip.className = 'ts-tip';
    this.tip.hidden = true;
    el.classList.add('ts-chart');
    el.appendChild(this.canvas); el.appendChild(this.overlay); el.appendChild(this.tip);
    this.series = []; this.times = []; this.range = null; this.full = null;
    this.hoverT = null; this.selT = null; this.listeners = {};
    this.units = { wind: 'kt', height: 'm' }; this.tz = 'local'; this.place = null;
    this.M = { l: 84, r: 24, t: 76, b: 48, gap: 100 };
    this._bind();
    var self = this;
    if (root.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(el);
  }
  TSChart.prototype.on = function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); };
  TSChart.prototype.emit = function (ev, a) { (this.listeners[ev] || []).forEach(function (fn) { fn(a); }); };

  /**
   * data: { series: [{model, param, t: number[], v: Float64Array, window?: [[a,b]|null], color, dash, label}],
   *         times: number[] (vereniging), units, tz, place }
   */
  TSChart.prototype.setData = function (d, keepRange) {
    this.series = d.series; this.times = d.times; this.units = d.units || this.units; this.tz = d.tz || this.tz; this.place = d.place;
    if (this.times.length) {
      var full = [this.times[0], this.times[this.times.length - 1]];
      var changed = !this.full || this.full[0] !== full[0] || this.full[1] !== full[1];
      this.full = full;
      if (!this.range || !keepRange || changed && !keepRange) this.range = full.slice();
      this.range[0] = Math.max(this.range[0], full[0] - 6 * HOUR);
      this.range[1] = Math.min(this.range[1], full[1] + 6 * HOUR);
      if (this.range[1] - this.range[0] < 3 * HOUR) this.range = full.slice();
    } else { this.full = null; this.range = null; }
    this.layout(); this.draw();
  };
  TSChart.prototype.setRange = function (a, b) {
    if (!this.full) return;
    var span = Math.max(3 * HOUR, b - a);
    var lo = this.full[0] - 6 * HOUR, hi = this.full[1] + 6 * HOUR;
    if (span > hi - lo) { a = lo; b = hi; } else { if (a < lo) { a = lo; } if (a + span > hi) a = hi - span; b = a + span; }
    this.range = [a, b]; this.draw(); this.drawOverlay(); this.emit('range', this.range);
  };
  TSChart.prototype.resize = function () { this.layout(); this.draw(); };

  TSChart.prototype.panelsUsed = function () {
    var used = {}, list = [];
    this.series.forEach(function (s) { var p = C.PARAM[s.param]; if (p && p.panel) used[p.panel] = true; if (s.param === 'td2m') used.dew = true; });
    C.PANEL_ORDER.forEach(function (k) { if (used[k]) list.push(k); });
    return list;
  };
  TSChart.prototype.layout = function () {
    var W = this.el.clientWidth || 800, H = this.el.clientHeight || 500, M = this.M;
    var panels = this.panelsUsed();
    var base = panels.reduce(function (a, k) { return a + C.PANELS[k].h; }, 0) || 1;
    var avail = H - M.t - M.b - M.gap * Math.max(0, panels.length - 1);
    var minimum = panels.reduce(function (n, k) { return n + 380; }, 0);
    var extra = Math.max(0, avail - minimum);
    var y = M.t, out = [];
    panels.forEach(function (k) {
      var h = 380 + Math.floor(extra * C.PANELS[k].h / base);
      out.push({ key: k, y: y, h: h });
      y += h + M.gap;
    });
    this.W = W; this.H = Math.max(H, y - M.gap + M.b); this.P = out;
    [this.canvas, this.overlay].forEach(function (cv) {
      var d = DPR();
      cv.width = Math.round(W * d); cv.height = Math.round(this.H * d);
      cv.style.width = W + 'px'; cv.style.height = this.H + 'px';
    }, this);
  };
  TSChart.prototype.x = function (t) { var M = this.M, r = this.range; return M.l + (t - r[0]) / (r[1] - r[0]) * (this.W - M.l - M.r); };
  TSChart.prototype.t = function (x) { var M = this.M, r = this.range; return r[0] + (x - M.l) / (this.W - M.l - M.r) * (r[1] - r[0]); };

  TSChart.prototype.conv = function (param, v) {
    var p = C.PARAM[param];
    if (p.unit === 'wind') return C.windConv(v, this.units.wind);
    if (p.unit === 'height') return C.heightConv(v, this.units.height);
    return v;
  };
  TSChart.prototype.unitLabel = function (u) {
    if (u === 'wind') return C.WIND_UNITS[this.units.wind];
    if (u === 'height') return this.units.height === 'ft' ? 'ft' : 'm';
    return u;
  };

  TSChart.prototype.scaleFor = function (panel) {
    var cfg = C.PANELS[panel], self = this;
    if (cfg.fixed && !(panel === 'vis')) return { lo: cfg.fixed[0], hi: cfg.fixed[1], log: false, ticks: cfg.ticks };
    if (cfg.log) return { lo: cfg.fixed[0], hi: cfg.fixed[1], log: true };
    var lo = Infinity, hi = -Infinity, r = this.range;
    this.series.forEach(function (s) {
      if (!belongs(s, panel)) return;
      for (var i = 0; i < s.t.length; i++) {
        if (s.t[i] < r[0] - 6 * HOUR || s.t[i] > r[1] + 6 * HOUR) continue;
        var v = self.conv(s.param, s.v[i]);
        if (!isFinite(v)) continue;
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
    });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (cfg.min0) lo = Math.min(0, lo);
    if (cfg.minMax && hi < cfg.minMax) hi = cfg.minMax;
    var pad = (hi - lo) * 0.08 || 1;
    if (!cfg.min0) lo -= pad;
    hi += pad;
    var st = niceStep(hi - lo, 4);
    return { lo: Math.floor(lo / st) * st, hi: Math.ceil(hi / st) * st, step: st };
  };
  function yOf(sc, P, v) {
    if (sc.log) {
      v = Math.max(sc.lo, Math.min(sc.hi, v));
      return P.y + P.h - (Math.log(v) - Math.log(sc.lo)) / (Math.log(sc.hi) - Math.log(sc.lo)) * P.h;
    }
    return P.y + P.h - (v - sc.lo) / (sc.hi - sc.lo) * P.h;
  }

  /** Tekent alles op g (canvas of svg). */
  TSChart.prototype.paint = function (g, th, opt) {
    opt = opt || {};
    var self = this, M = this.M, W = this.W, r = this.range;
    g.rect(0, 0, W, this.H, th.bg);
    if (!r || !this.P.length) {
      g.text(W / 2, this.H / 2, opt.empty || 'Geen parameters of modellen geselecteerd', '500 13px ' + th.font, th.axis, 'center', 'middle');
      return;
    }
    var x0 = M.l, x1 = W - M.r;
    // dag/nacht + dagscheiding
    var nights = this.nightSpans(), days = this.daySplits();
    this.P.forEach(function (P) {
      g.rect(x0, P.y, x1 - x0, P.h, th.panelBg);
      g.clip(x0, P.y, x1 - x0, P.h);
      nights.forEach(function (n) { g.rect(self.x(n[0]), P.y, self.x(n[1]) - self.x(n[0]), P.h, th.night); });
      g.unclip();
    });
    // dagkop
    g.clip(x0, 0, x1 - x0, this.H);
    days.forEach(function (d, i) {
      var xa = self.x(d.t), xb = i + 1 < days.length ? self.x(days[i + 1].t) : x1;
      if (xa >= x0 - 1) g.line([[Math.round(xa) + .5, M.t - 18], [Math.round(xa) + .5, self.H - M.b]], th.day, 1, [3, 3]);
      var cx = (Math.max(xa, x0) + Math.min(xb, x1)) / 2;
      if (Math.min(xb, x1) - Math.max(xa, x0) > 54) g.text(cx, 10, d.label, '600 11px ' + th.font, th.text, 'center', 'middle');
    });
    g.unclip();
    // uurmarkeringen onderaan
    var span = r[1] - r[0], stepH = span <= 72 * HOUR ? 3 : span <= 96 * HOUR ? 6 : span <= 7 * 24 * HOUR ? 12 : 24;
    var ticks = this.hourTicks(stepH);
    this.P.forEach(function (P) {
      var sc = self.scaleFor(P.key), cfg = C.PANELS[P.key];
      P.sc = sc;
      // horizontale rasterlijnen + y-labels
      var yt = [];
      if (sc.log) yt = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
      else if (sc.ticks) yt = sc.ticks;
      else for (var v = sc.lo; v <= sc.hi + 1e-9; v += sc.step) yt.push(v);
      yt.forEach(function (v) {
        var y = Math.round(yOf(sc, P, v)) + .5;
        g.line([[x0, y], [x1, y]], th.grid, 1);
        var lab = sc.log ? (v >= 1000 ? (v / 1000) + ' km' : v + ' m') : fmtNum(v, sc.step && sc.step < 1 ? (sc.step < 0.1 ? 2 : 1) : 0);
        
        
        g.text(x0 - 6, y, lab, '500 11px ' + th.mono, th.axis, 'right', 'middle');
      });
      ticks.forEach(function (t) { var x = Math.round(self.x(t)) + .5; if (x > x0 && x < x1) g.line([[x, P.y], [x, P.y + P.h]], th.grid, 1); });
      g.rect(x0, P.y - 27, x1 - x0, 21, th.bg);
      var names = {wdir: 'DD', wind: 'FF & FFx', temp: 'T2m & Td2m', dew: 'Td2m'};
      var place = self.place ? self.place.name : '';
      var runs = self.series.filter(function(s) { return !s.observation; }).map(function(s) { return s.run; }).filter(Boolean).sort();
      var runLabel = runs.length ? runs[runs.length - 1].replace(/[-:TZ]/g, '').slice(0,10) : '';
      g.text((x0+x1)/2, P.y - 43, place + ' (' + (P.key === 'temp' ? 't2m' : P.key === 'dew' ? 'td2m' : P.key) + ')', '400 14px Arial', th.text, 'center', 'middle');
      g.text((x0+x1)/2, P.y - 23, (names[P.key] || cfg.label) + ' HAR & EC time series ' + place + ' ' + runLabel, '400 18px Arial', th.text, 'center', 'middle');
      g.verticalText(18, P.y + P.h/2, (names[P.key] || cfg.label) + ' (' + self.unitLabel(cfg.unit) + ')', '400 13px Arial', th.text);
      g.strokeRect(x0, P.y, x1 - x0, P.h, th.text);
      ticks.forEach(function(t) {
        var x = self.x(t); if (x < x0 || x > x1) return;
        g.text(x, P.y + P.h + 16, C.parts(t, self.tz).hour, '400 12px Arial', th.text, 'center', 'middle');
        g.line([[x,P.y],[x,P.y-5]],th.text,1);
        g.line([[x,P.y+P.h],[x,P.y+P.h+5]],th.text,1);
      });
      g.text((x0+x1)/2, P.y+P.h+34, 'Tijd (' + C.tzLabel(r[0], self.tz) + ')', '400 13px Arial', th.text, 'center', 'middle');
      if (self.series.some(function(s) {return s.observation && belongs(s,P.key);})) g.text(x1-18,P.y+115,'Waarnemingen','700 13px Arial','#111111','right','middle');
      C.MODEL_IDS.forEach(function(m, i) {
        if (!self.series.some(function(s) { return s.model === m && belongs(s, P.key); })) return;
        g.text(x1-18, P.y+34+i*27, C.MODELS[m].short, '700 13px Arial', C.MODELS[m].color, 'right', 'middle');
      });
    });
    // reeksen
    this.P.forEach(function (P) {
      g.clip(x0, P.y, x1 - x0, P.h);
      var inPanel = self.series.filter(function (s) { return belongs(s, P.key); }).sort(function(a,b) { return Number(!!a.observation)-Number(!!b.observation); });
      var bars = inPanel.filter(function (s) { return C.PARAM[s.param].kind === 'bar'; });
      bars.forEach(function (s, bi) {
        for (var i = 0; i < s.t.length; i++) {
          var w = s.window && s.window[i];
          var v = s.v[i];
          if (!w || !isFinite(v) || v <= 0) continue;
          var t0 = s.t[i] - (w[1] - w[0]) * HOUR, t1 = s.t[i];
          var xa = self.x(t0), xb = self.x(t1), bw = (xb - xa) / bars.length;
          var xs = xa + bi * bw + Math.min(1, bw * 0.1), y = yOf(P.sc, P, v);
          g.rect(xs, y, Math.max(1, bw - Math.min(2, bw * 0.2)), P.y + P.h - y, s.color + 'cc');
        }
      });
      inPanel.forEach(function (s) {
        var p = C.PARAM[s.param];
        if (p.kind === 'line' || p.kind === 'dir') {
          var pts = [], prevT = null;
          for (var i = 0; i < s.t.length; i++) {
            var v = self.conv(s.param, s.v[i]);
            if (!isFinite(v)) { pts.push(null); continue; }
            if (s.maxGap && prevT != null && s.t[i]-prevT>s.maxGap) pts.push(null);
            if (p.kind === 'dir' && i && Math.abs(v - s.v[i-1]) > 180) pts.push(null);
            pts.push([self.x(s.t[i]), yOf(P.sc, P, v)]);
            prevT = s.t[i];
          }
          g.line(pts, s.color, s.observation ? 2.3 : 2, P.key === 'dew' ? [] : p.dash);
          if (s.t.length && (s.observation || (r[1] - r[0]) / HOUR < 80)) pts.forEach(function (q) { if (q) g.dot(q[0], q[1], s.observation ? 2.2 : 1.6, s.color); });
        } else if (p.kind === 'dir') {
          for (var j = 0; j < s.t.length; j++) {
            var d = s.v[j]; if (!isFinite(d)) continue;
            var x = self.x(s.t[j]), y = yOf(P.sc, P, d);
            arrow(g, x, y, d, s.color, s.param === 'wdir100' ? 0.7 : 1);
          }
        }
      });
      g.unclip();
    });
    var now = Date.now(), nx = self.x(now);
    if (nx >= x0 && nx <= x1) {
      g.line([[nx, M.t - 4], [nx, this.H - M.b]], th.axis, 1, [5, 4]);
      g.text(nx + 4, this.H - 4, 'nu', '600 10px ' + th.font, th.axis, 'left', 'middle');
    }
    if (opt.selected && this.selT != null) {
      var xs = Math.round(this.x(this.selT)) + .5;
      if (xs >= x0 && xs <= x1) g.line([[xs, M.t - 4], [xs, this.H - M.b]], th.sel, 2);
    }
  };
  function arrow(g, x, y, dirFrom, color, scale) {
    // pijl wijst waar de wind naartoe waait (vanuit de herkomstrichting)
    var a = (dirFrom + 180) * Math.PI / 180, L = 9 * (scale || 1);
    var dx = Math.sin(a), dy = -Math.cos(a);
    var tipx = x + dx * L / 2, tipy = y + dy * L / 2, tx = x - dx * L / 2, ty = y - dy * L / 2;
    g.line([[tx, ty], [tipx, tipy]], color, 1.4);
    var px = -dy, py = dx;
    g.poly([[tipx, tipy], [tipx - dx * 4 + px * 2.6, tipy - dy * 4 + py * 2.6], [tipx - dx * 4 - px * 2.6, tipy - dy * 4 - py * 2.6]], color);
  }

  TSChart.prototype.nightSpans = function () {
    if (!this.place || !this.range) return [];
    var r = this.range, step = 10 * 60000, out = [], cur = null;
    for (var t = Math.floor(r[0] / step) * step - step; t <= r[1] + step; t += step) {
      var night = C.sunElevation(t, this.place.lat, this.place.lon) < -0.833;
      if (night && !cur) cur = [t, t];
      if (night && cur) cur[1] = t + step;
      if (!night && cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out;
  };
  TSChart.prototype.daySplits = function () {
    var r = this.range, out = [], tz = this.tz;
    var t = Math.floor((r[0] - 24 * HOUR) / HOUR) * HOUR;
    var last = null;
    for (; t <= r[1]; t += HOUR) {
      var k = C.dayKey(t, tz);
      if (k !== last) {
        var p = C.parts(t, tz);
        out.push({ t: t, label: p.weekday + ' ' + (+p.day) + ' ' + C.fmt(tz, { month: 'short' }).format(new Date(t)) });
        last = k;
      }
    }
    return out;
  };
  TSChart.prototype.hourTicks = function (stepH) {
    var r = this.range, out = [], tz = this.tz;
    for (var t = Math.floor(r[0] / HOUR) * HOUR; t <= r[1]; t += HOUR) {
      if (+C.parts(t, tz).hour % stepH === 0) out.push(t);
    }
    return out;
  };

  TSChart.prototype.draw = function () {
    var ctx = this.canvas.getContext('2d'), d = DPR();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.th = theme();
    this.paint(new CanvasG(ctx), this.th, { selected: true });
  };

  TSChart.prototype.nearestTime = function (t) {
    var a = this.times, lo = 0, hi = a.length - 1;
    if (!a.length) return null;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (a[m] < t) lo = m; else hi = m; }
    return Math.abs(a[lo] - t) <= Math.abs(a[hi] - t) ? a[lo] : a[hi];
  };

  TSChart.prototype.drawOverlay = function () {
    var ctx = this.overlay.getContext('2d'), d = DPR(), th = this.th || theme(), M = this.M, self = this;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.hoverT == null || !this.range) { this.tip.hidden = true; return; }
    var x = Math.round(this.x(this.hoverT)) + .5;
    if (x < M.l || x > this.W - M.r) { this.tip.hidden = true; return; }
    ctx.strokeStyle = th.axis; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(x, M.t - 4); ctx.lineTo(x, this.H - M.b); ctx.stroke(); ctx.setLineDash([]);
    if (this.hoverY != null) { ctx.beginPath(); ctx.moveTo(M.l, this.hoverY + .5); ctx.lineTo(this.W - M.r, this.hoverY + .5); ctx.strokeStyle = th.grid; ctx.stroke(); }
    // punten op de lijnen
    this.P.forEach(function (P) {
      self.series.forEach(function (s) {
        var p = C.PARAM[s.param];
        if (!belongs(s, P.key) || p.kind !== 'line' && p.kind !== 'dir') return;
        var i = s.t.indexOf(self.hoverT); if (i < 0) return;
        var v = self.conv(s.param, s.v[i]); if (!isFinite(v)) return;
        ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(x, yOf(P.sc, P, v), 3.2, 0, 7); ctx.fill();
      });
    });
    this.renderTip(x);
  };

  TSChart.prototype.renderTip = function (x) {
    var self = this, t = this.hoverT, html = [];
    var p = C.parts(t, this.tz);
    html.push('<div class="ts-tip-h">' + p.weekday + ' ' + p.day + '-' + p.month + ' ' + p.hour + ':' + p.minute + ' ' + C.tzLabel(t, this.tz) + '</div>');
    var byParam = {};
    this.series.forEach(function (s) { (byParam[s.param] = byParam[s.param] || []).push(s); });
    Object.keys(byParam).forEach(function (pid) {
      var P = C.PARAM[pid];
      html.push('<div class="ts-tip-param">' + P.label + (P.unit ? ' · ' + self.unitLabel(P.unit) : '') + '</div>');
      byParam[pid].forEach(function (s) {
        var i = s.t.indexOf(t), v = i >= 0 ? s.v[i] : NaN, txt;
        if (i < 0) txt = t < s.t[0] || t > s.t[s.t.length - 1] ? 'buiten voorspellingsperiode' : 'geen uitvoerstap';
        else if (P.kind === 'dir') txt = isFinite(v) ? Math.round(v) + '° ' + C.compass(v) : 'geen richting / waarde ontbreekt';
        else if (s.na && s.na[i]) txt = 'geen basis volgens modeldefinitie';
        else if (!isFinite(v)) txt = 'waarde ontbreekt';
        else txt = fmtNum(self.conv(pid, v), P.unit === 'wind' && self.units.wind === 'ms' ? 1 : P.unit === 'height' ? 0 : P.dec);
        var win = i >= 0 && s.window && s.window[i];
        var timing = function (tt) { var pp = C.parts(tt, self.tz); return pp.day + '-' + pp.month + ' ' + pp.hour + ':' + pp.minute + ' ' + C.tzLabel(tt, self.tz); };
        var detail = s.observation ? 'KNMI ' + esc(s.station) + ' · ' + fmtNum(s.stationKm,1) + ' km · gemeten ' + timing(t) : s.run ? 'run ' + timing(Date.parse(s.run)) : '';
        if (win) detail += ' · interval ' + timing(t - (win[1] - win[0]) * HOUR) + ' – ' + timing(t) + ' (' + (win[1] - win[0]) + ' uur)';
        if (s.derived) detail += ' · berekend';
        html.push('<div class="ts-tip-r"><span class="ts-tip-m" style="--c:' + s.color + '">' + (s.observation ? 'Waarneming' : C.MODELS[s.model].label) + '</span><b>' + txt + '</b></div><div class="ts-tip-detail">' + detail + '</div>');
      });
    });
    this.tip.innerHTML = html.join('');
    this.tip.hidden = false;
    var w = this.tip.offsetWidth, left = x + 14;
    if (left + w > this.W - 4) left = x - 14 - w;
    this.tip.style.left = Math.max(4, left) + 'px';
    this.tip.style.top = ((this.el.scrollTop || 0) + 8) + 'px';
  };

  TSChart.prototype.setHover = function (t, silent) {
    this.hoverT = t; this.hoverY = null; this.drawOverlay();
    if (!silent) this.emit('hover', t);
  };
  TSChart.prototype.setSelected = function (t) { this.selT = t; this.draw(); };

  TSChart.prototype._bind = function () {
    var self = this, el = this.overlay, drag = null;
    el.style.touchAction = 'pan-y';
    el.addEventListener('pointermove', function (e) {
      if (!self.range) return;
      var r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (drag) {
        var dt = (drag.x - x) / (self.W - self.M.l - self.M.r) * (drag.r[1] - drag.r[0]);
        if (Math.abs(drag.x - x) > 3) drag.moved = true;
        self.setRange(drag.r[0] + dt, drag.r[1] + dt);
        return;
      }
      var t = self.nearestTime(self.t(x));
      self.hoverY = y;
      if (t !== self.hoverT) { self.hoverT = t; self.emit('hover', t); }
      self.drawOverlay();
    });
    el.addEventListener('pointerleave', function () { if (!drag) { self.hoverT = null; self.drawOverlay(); self.emit('hover', null); } });
    el.addEventListener('pointerdown', function (e) {
      if (!self.range || e.button !== 0) return;
      var r = el.getBoundingClientRect();
      self.hoverT = self.nearestTime(self.t(e.clientX - r.left));
      self.hoverY = e.clientY - r.top;
      self.drawOverlay();
      drag = { x: e.clientX - r.left, r: self.range.slice(), moved: false };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var moved = drag.moved; drag = null;
      if (!moved && self.hoverT != null) self.emit('select', self.hoverT);
    });
    el.addEventListener('pointercancel', function () { drag = null; });
    el.addEventListener('dblclick', function () { if (self.full) self.setRange(self.full[0], self.full[1]); });
    el.addEventListener('wheel', function (e) {
      if (!self.range) return;
      // Verticaal scrollen laat de pagina met rust tenzij Ctrl/⌘ of horizontaal; Shift/trackpad-horizontaal = schuiven.
      var r = el.getBoundingClientRect(), x = e.clientX - r.left;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        var dt = e.deltaX / (self.W - self.M.l - self.M.r) * (self.range[1] - self.range[0]);
        self.setRange(self.range[0] + dt, self.range[1] + dt);
        return;
      }
      if (!(e.ctrlKey || e.metaKey || self.opts.wheelZoom)) return;
      e.preventDefault();
      self.zoomAt(self.t(x), Math.exp(e.deltaY * 0.0022));
    }, { passive: false });
  };
  TSChart.prototype.zoomAt = function (tc, factor) {
    var r = this.range, a = tc - (tc - r[0]) * factor, b = tc + (r[1] - tc) * factor;
    this.setRange(a, b);
  };
  TSChart.prototype.zoom = function (factor) { var r = this.range; if (r) this.zoomAt((r[0] + r[1]) / 2, factor); };

  // ------------------------------------------------------------------ export
  function headerRows(header, width) {
    if (!header) return [];
    var out = [], max = Math.max(28, Math.floor((width - 36) / 6));
    header.forEach(function (line) { var row = ''; String(line).split(/\s+/).forEach(function (word) { if (row && row.length + word.length > max) { out.push(row); row = ''; } row += (row ? ' ' : '') + word; }); if (row) out.push(row); });
    return out;
  }
  TSChart.prototype.exportCanvas = function (scale, header) {
    var s = scale || 2, th = theme(), rows = headerRows(header, this.W), hh = rows.length ? rows.length * 16 + 32 : 0;
    var cv = document.createElement('canvas');
    cv.width = Math.round(this.W * s); cv.height = Math.round((this.H + hh) * s);
    var ctx = cv.getContext('2d'); ctx.scale(s, s);
    ctx.fillStyle = th.bg; ctx.fillRect(0, 0, this.W, this.H + hh);
    if (header) {
      var g0 = new CanvasG(ctx);
      rows.forEach(function (row, i) { g0.text(18, 16 + i * 16, row, (i ? '500 10px ' : '700 13px ') + th.font, th.text, 'left', 'middle'); });
      C.MODEL_IDS.forEach(function (m, i) { g0.text(18 + i * 140, hh - 12, C.MODELS[m].label, '700 11px ' + th.font, C.MODELS[m].color, 'left', 'middle'); });
    }
    ctx.translate(0, hh);
    this.paint(new CanvasG(ctx), th, { selected: false });
    return cv;
  };
  TSChart.prototype.exportSVG = function (header) {
    var th = theme(), rows = headerRows(header, this.W), hh = rows.length ? rows.length * 16 + 32 : 0;
    var g = new SvgG(this.W, this.H + hh, th.bg);
    if (header) {
      rows.forEach(function (row, i) { g.text(18, 16 + i * 16, row, (i ? '500 10px ' : '700 13px ') + th.font, th.text, 'left', 'middle'); });
      C.MODEL_IDS.forEach(function (m, i) { g.text(18 + i * 140, hh - 12, C.MODELS[m].label, '700 11px ' + th.font, C.MODELS[m].color, 'left', 'middle'); });
    }
    g.o.push('<g transform="translate(0,' + hh + ')">');
    this.paint(g, th, { selected: false });
    g.o.push('</g>');
    return g.toString();
  };

  root.TSChart = TSChart;
  root.TSChartUtil = { fmtNum: fmtNum, niceStep: niceStep, SvgG: SvgG };
})(typeof self !== 'undefined' ? self : this);
