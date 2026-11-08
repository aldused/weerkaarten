/*
 * Weerlab Modeltijdseries — tijdserietabel.
 *
 * Tijd horizontaal, parameters verticaal (KNMI-luchtvaartstijl). Eerste kolom en de
 * datum/tijdkop blijven staan (position: sticky). De tabel wordt in één keer als
 * HTML-string opgebouwd; hover en selectie verplaatsen alleen twee overlay-balken,
 * dus muisbewegingen kosten geen herberekening van de tabel.
 */
(function (root) {
  'use strict';
  var C = root.TSCore;
  var HOUR = 3600000;

  function TSTable(el) {
    this.el = el;
    el.classList.add('ts-tablewrap');
    el.tabIndex = 0;
    this.listeners = {};
    this.cols = []; this.colX = []; this.sel = null; this.hover = null;
    this._bind();
  }
  TSTable.prototype.on = function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); };
  TSTable.prototype.emit = function (ev, a) { (this.listeners[ev] || []).forEach(function (fn) { fn(a); }); };

  /**
   * opts: { times: number[], tz, rows: [{kind:'group'|'data'|'model', label, sub, color, title, cells:[[txt, style, title]]}], empty }
   */
  TSTable.prototype.render = function (opts) {
    var times = opts.times || [], tz = opts.tz, h = [], i;
    this.cols = times;
    if (!times.length || !opts.rows.length) {
      this.el.innerHTML = '<div class="ts-empty">' + (opts.empty || 'Geen gegevens') + '</div>';
      this.colX = [];
      return;
    }
    // dagkop
    var days = [], cur = null;
    for (i = 0; i < times.length; i++) {
      var k = C.dayKey(times[i], tz);
      if (!cur || cur.k !== k) { cur = { k: k, n: 0, t: times[i] }; days.push(cur); }
      cur.n++;
    }
    var newDay = {};
    var acc = 0;
    days.forEach(function (d) { newDay[acc] = true; acc += d.n; });
    h.push('<table class="ts-table"><thead><tr class="ts-dayrow"><th class="ts-stick ts-corner" rowspan="2"><span>' +
      (tz === 'utc' ? 'UTC' : C.tzLabel(times[0], tz) + (C.tzLabel(times[0], tz) !== C.tzLabel(times[times.length - 1], tz) ? '/' + C.tzLabel(times[times.length - 1], tz) : '')) + '</span></th>');
    days.forEach(function (d) {
      var p = C.parts(d.t, tz);
      h.push('<th class="ts-day" colspan="' + d.n + '"><span>' + p.weekday + ' ' + (+p.day) + ' ' + C.fmt(tz, { month: 'short' }).format(new Date(d.t)) + '</span></th>');
    });
    h.push('</tr><tr class="ts-hourrow">');
    for (i = 0; i < times.length; i++) {
      var pp = C.parts(times[i], tz);
      h.push('<th data-c="' + i + '"' + (newDay[i] ? ' class="ts-nd"' : '') + '>' + pp.hour + '</th>');
    }
    h.push('</tr></thead><tbody>');
    opts.rows.forEach(function (r) {
      if (r.kind === 'group') {
        h.push('<tr class="ts-gr"><th class="ts-stick" colspan="1"' + (r.title ? ' title="' + attr(r.title) + '"' : '') + '>' + r.label +
          (r.sub ? ' <span class="ts-unit">' + r.sub + '</span>' : '') + '</th><td colspan="' + times.length + '"></td></tr>');
        return;
      }
      h.push('<tr class="ts-row' + (r.kind === 'model' ? ' ts-mrow' : '') + (r.cls ? ' ' + r.cls : '') + '"><th class="ts-stick"' + (r.title ? ' title="' + attr(r.title) + '"' : '') + '>' +
        (r.color ? '<i class="ts-mdot" style="background:' + r.color + '"></i>' : '') + '<span class="ts-lab">' + r.label + '</span>' +
        (r.sub ? '<span class="ts-unit">' + r.sub + '</span>' : '') + '</th>');
      var cells = r.cells;
      for (var j = 0; j < times.length; j++) {
        var c = cells[j];
        var k = (newDay[j] ? 'ts-nd ' : '') + (c && c[3] ? c[3] : '');
        var cls = k.trim() ? ' class="' + k.trim() + '"' : '';
        if (!c) { h.push('<td' + cls + '></td>'); continue; }
        h.push('<td' + cls + (c[1] ? ' style="' + c[1] + '"' : '') + (c[2] ? ' title="' + attr(c[2]) + '"' : '') + '>' + c[0] + '</td>');
      }
      h.push('</tr>');
    });
    h.push('</tbody></table><div class="ts-colhl" hidden></div><div class="ts-colsel" hidden></div>');
    this.el.innerHTML = h.join('');
    this.hl = this.el.querySelector('.ts-colhl');
    this.sl = this.el.querySelector('.ts-colsel');
    this.measure();
    this.paintSel();
  };
  function attr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  TSTable.prototype.measure = function () {
    var ths = this.el.querySelectorAll('.ts-hourrow th');
    this.colX = Array.prototype.map.call(ths, function (th) { return [th.offsetLeft, th.offsetWidth]; });
    var tbl = this.el.querySelector('.ts-table');
    this.tblH = tbl ? tbl.offsetHeight : 0;
    this.stickW = (this.el.querySelector('.ts-corner') || {}).offsetWidth || 0;
  };
  TSTable.prototype.idxOf = function (t) { return t == null ? -1 : this.cols.indexOf(t); };
  TSTable.prototype.place = function (bar, i) {
    if (!bar) return;
    if (i < 0 || !this.colX[i]) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.style.left = this.colX[i][0] + 'px';
    bar.style.width = this.colX[i][1] + 'px';
    bar.style.height = this.tblH + 'px';
  };
  TSTable.prototype.setHover = function (t) { this.hover = t; this.place(this.hl, this.idxOf(t)); };
  TSTable.prototype.setSelected = function (t, scroll) {
    this.sel = t; this.paintSel();
    if (scroll) this.scrollTo(t);
  };
  TSTable.prototype.paintSel = function () { this.place(this.sl, this.idxOf(this.sel)); };
  TSTable.prototype.scrollTo = function (t, center) {
    var i = this.idxOf(t); if (i < 0 || !this.colX[i]) return;
    var x = this.colX[i][0], w = this.colX[i][1], el = this.el, vis0 = el.scrollLeft + this.stickW, vis1 = el.scrollLeft + el.clientWidth;
    if (center) el.scrollLeft = x - this.stickW - (el.clientWidth - this.stickW) / 3;
    else if (x < vis0) el.scrollLeft = x - this.stickW - 8;
    else if (x + w > vis1) el.scrollLeft = x + w - el.clientWidth + 8;
  };
  TSTable.prototype.move = function (d) {
    if (!this.cols.length) return;
    var i = this.idxOf(this.sel);
    i = i < 0 ? 0 : Math.max(0, Math.min(this.cols.length - 1, i + d));
    this.emit('select', this.cols[i]);
  };
  TSTable.prototype.jumpDay = function (dir, tz) {
    if (!this.cols.length) return;
    var i = Math.max(0, this.idxOf(this.sel)), k = C.dayKey(this.cols[i], tz), j;
    if (dir > 0) { for (j = i; j < this.cols.length && C.dayKey(this.cols[j], tz) === k; j++); if (j >= this.cols.length) return; }
    else {
      for (j = i; j >= 0 && C.dayKey(this.cols[j], tz) === k; j--);
      if (j < 0) j = 0;
      var k2 = C.dayKey(this.cols[j], tz); while (j > 0 && C.dayKey(this.cols[j - 1], tz) === k2) j--;
    }
    this.emit('select', this.cols[j]);
  };

  TSTable.prototype._bind = function () {
    var self = this, raf = 0, lastX = null;
    function colFromEvent(e) {
      var cell = e.target.closest && e.target.closest('td,th');
      if (!cell || !self.el.contains(cell)) return null;
      if (cell.hasAttribute('data-c')) return +cell.getAttribute('data-c');
      if (cell.tagName === 'TD' && !cell.hasAttribute('colspan')) {
        var row = cell.parentNode, idx = Array.prototype.indexOf.call(row.children, cell) - 1;
        return idx >= 0 ? idx : null;
      }
      return null;
    }
    this.el.addEventListener('mousemove', function (e) {
      var c = colFromEvent(e);
      if (c === lastX) return;
      lastX = c;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        var t = c == null ? null : self.cols[c];
        self.setHover(t); self.emit('hover', t);
      });
    });
    this.el.addEventListener('mouseleave', function () { lastX = null; self.setHover(null); self.emit('hover', null); });
    this.el.addEventListener('click', function (e) {
      var c = colFromEvent(e);
      if (c != null) { self.el.focus({ preventScroll: true }); self.emit('select', self.cols[c]); }
    });
    this.el.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowRight') { self.move(e.shiftKey ? 6 : 1); e.preventDefault(); }
      else if (k === 'ArrowLeft') { self.move(e.shiftKey ? -6 : -1); e.preventDefault(); }
      else if (k === 'PageDown') { self.emit('jumpday', 1); e.preventDefault(); }
      else if (k === 'PageUp') { self.emit('jumpday', -1); e.preventDefault(); }
      else if (k === 'Home') { self.emit('now'); e.preventDefault(); }
      else if (k === 'End') { if (self.cols.length) self.emit('select', self.cols[self.cols.length - 1]); e.preventDefault(); }
    });
    if (root.ResizeObserver) new ResizeObserver(function () { if (self.cols.length) { self.measure(); self.paintSel(); self.setHover(self.hover); } }).observe(this.el);
  };

  root.TSTable = TSTable;
})(typeof self !== 'undefined' ? self : this);
