#!/usr/bin/env python3
"""Genereert p13_records.html. Zet dit script in de projectroot."""
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(ROOT, "p13_records.html")

HTML = """\
<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>P13 Landelijk Neerslaggemiddelde</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#f6f8fb;color:#0f172a;font-family:"DM Sans",ui-sans-serif,system-ui,sans-serif;font-size:14px;font-feature-settings:"ss01","cv11"}
header{background:#ffffff;border-bottom:1px solid #e3e8ef;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
header h1{font-size:15px;font-weight:700;color:#0f172a;letter-spacing:-0.01em}
header h1 span{color:#00205b}
.subtitle{font-size:11px;color:#64748b;margin-top:2px;font-family:"DM Mono",ui-monospace,monospace;font-weight:500}
.container{max-width:1200px;margin:0 auto;padding:20px 16px 60px}
.tab-bar{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:20px;border-bottom:1px solid #e3e8ef}
.tab-btn{padding:8px 16px;background:transparent;border:none;border-bottom:2px solid transparent;color:#64748b;cursor:pointer;font-size:13px;font-weight:600;margin-bottom:-1px;white-space:nowrap;font-family:"DM Sans",ui-sans-serif,system-ui,sans-serif}
.tab-btn:hover{color:#0f172a}
.tab-btn.active{color:#00205b;border-bottom-color:#00205b}
.tab-panel{display:none}
.tab-panel.active{display:block}
.st{font-size:14px;font-weight:700;color:#0f172a;margin:24px 0 12px;padding-bottom:6px;border-bottom:1px solid #e3e8ef;letter-spacing:-0.01em}
.st:first-child{margin-top:0}
.rg{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:8px}
.rc{background:#ffffff;border:1px solid #e3e8ef;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,0.04)}
.rh{background:#f6f8fb;padding:8px 14px;font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e3e8ef}
.rh.nat{border-left:3px solid #00205b}
.rh.droog{border-left:3px solid #d97706}
.rt{width:100%;border-collapse:collapse}
.rt tr:nth-child(even){background:#fafbfd}
.rt tr:hover{background:#eef2f7}
.rt td{padding:6px 12px;line-height:1.4;font-family:"DM Mono",ui-monospace,monospace;border-bottom:1px solid #eff3f8}
.rk{color:#94a3b8;font-size:11px;width:24px;text-align:right}
.rt tr:nth-child(1) .rk{color:#d4a843}
.rt tr:nth-child(2) .rk{color:#94a3b8}
.rt tr:nth-child(3) .rk{color:#cd7f32}
.lb{color:#0f172a;font-family:"DM Sans",ui-sans-serif,system-ui,sans-serif}
.vl{text-align:right;font-weight:700;color:#00205b;white-space:nowrap}
.vl.d{color:#d97706}
.rt tr:nth-child(1) .vl{font-size:15px}
.pg{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:640px){.pg{grid-template-columns:1fr}}
.pc{background:#ffffff;border:1px solid #e3e8ef;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,0.04)}
.ph{padding:10px 14px;font-size:12px;font-weight:700;background:#f6f8fb;border-bottom:1px solid #e3e8ef;text-transform:uppercase;letter-spacing:0.06em}
.ph.droog{border-left:3px solid #d97706;color:#92400e;background:#fef3c7}
.ph.nat{border-left:3px solid #00205b;color:#1e3a8a;background:#eff6ff}
.pr{display:flex;justify-content:space-between;align-items:center;padding:7px 14px;border-bottom:1px solid #eff3f8;gap:12px}
.pr:last-child{border-bottom:none}
.pr:nth-child(even){background:#fafbfd}
.pr:hover{background:#eef2f7}
.prk{color:#94a3b8;font-size:11px;min-width:18px;font-family:"DM Mono",ui-monospace,monospace}
.pr:nth-child(1) .prk{color:#d4a843}
.pr:nth-child(2) .prk{color:#94a3b8}
.pr:nth-child(3) .prk{color:#cd7f32}
.pd{color:#0f172a;font-size:12.5px;flex:1;font-family:"DM Sans",ui-sans-serif,system-ui,sans-serif}
.pv{font-weight:700;font-size:15px;white-space:nowrap;font-family:"DM Mono",ui-monospace,monospace}
.pv.droog{color:#d97706}
.pv.nat{color:#00205b}
.pv span{font-size:11px;font-weight:500;color:#94a3b8;margin-left:2px}
.jw{overflow-x:auto;border-radius:12px;border:1px solid #e3e8ef;background:#ffffff;box-shadow:0 1px 2px rgba(15,23,42,0.04)}
.jt{width:100%;border-collapse:collapse;min-width:500px}
.jt thead th{background:#f6f8fb;color:#64748b;padding:10px 12px;text-align:right;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;cursor:pointer;white-space:nowrap;border-bottom:1px solid #e3e8ef;font-family:"DM Sans",ui-sans-serif,system-ui,sans-serif}
.jt thead th:first-child{text-align:left}
.jt thead th:hover{color:#0f172a}
.jt thead th.asc::after{content:" \u2191";color:#00205b}
.jt thead th.desc::after{content:" \u2193";color:#00205b}
.jt tbody tr:nth-child(even){background:#fafbfd}
.jt tbody tr:hover{background:#eef2f7}
.jt td{padding:6px 12px;text-align:right;border-bottom:1px solid #eff3f8;font-family:"DM Mono",ui-monospace,monospace;color:#334155}
.jt td:first-child{text-align:left;font-weight:600;color:#0f172a;font-family:"DM Sans",ui-sans-serif,system-ui,sans-serif}
.jt td.js{font-weight:700}
.jt td.js.h{color:#00205b}
.jt td.js.l{color:#d97706}
.bw{display:flex;align-items:center;gap:6px;justify-content:flex-end}
.bk{height:10px;border-radius:3px;background:#00205b;min-width:2px;opacity:.6}
.bk.l{background:#d97706}
.cw{background:#ffffff;border:1px solid #e3e8ef;border-radius:12px;padding:20px;margin-bottom:20px;box-shadow:0 1px 2px rgba(15,23,42,0.04)}
.cw canvas{max-height:340px}
.info{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;margin-bottom:20px;font-size:13px;color:#78350f;line-height:1.7}
.info strong{color:#78350f}
.sl{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:8px}
.sb{background:#ffffff;border:1px solid #e3e8ef;border-radius:6px;padding:2px 8px;font-size:11px;color:#334155;font-family:"DM Mono",ui-monospace,monospace}
#loading{text-align:center;padding:60px;color:#94a3b8;font-size:14px;font-family:"DM Mono",ui-monospace,monospace}
footer{text-align:center;padding:20px;color:#94a3b8;font-size:11px;font-family:"DM Mono",ui-monospace,monospace}

/* Dark mode */
[data-theme="dark"] body{background:#0b1220;color:#f1f5f9}
[data-theme="dark"] header{background:#111a2e;border-color:rgba(255,255,255,0.08)}
[data-theme="dark"] header h1{color:#f1f5f9}
[data-theme="dark"] header h1 span{color:#2ec4e8}
[data-theme="dark"] .subtitle{color:#94a3b8}
[data-theme="dark"] .tab-bar{border-color:rgba(255,255,255,0.08)}
[data-theme="dark"] .tab-btn{color:#94a3b8}
[data-theme="dark"] .tab-btn:hover{color:#f1f5f9}
[data-theme="dark"] .tab-btn.active{color:#2ec4e8;border-bottom-color:#2ec4e8}
[data-theme="dark"] .st{color:#f1f5f9;border-color:rgba(255,255,255,0.08)}
[data-theme="dark"] .rc,[data-theme="dark"] .pc,[data-theme="dark"] .cw,[data-theme="dark"] .jw{background:#111a2e;border-color:rgba(255,255,255,0.08)}
[data-theme="dark"] .rh,[data-theme="dark"] .ph,[data-theme="dark"] .jt thead th{background:#0e1629;color:#94a3b8;border-color:rgba(255,255,255,0.08)}
[data-theme="dark"] .rh.nat,[data-theme="dark"] .ph.nat{border-left-color:#2ec4e8;background:rgba(46,196,232,0.1);color:#7dd3fc}
[data-theme="dark"] .rh.droog,[data-theme="dark"] .ph.droog{border-left-color:#f59e0b;background:rgba(245,158,11,0.12);color:#fbbf24}
[data-theme="dark"] .rt tr:nth-child(even),[data-theme="dark"] .pr:nth-child(even),[data-theme="dark"] .jt tbody tr:nth-child(even){background:rgba(255,255,255,0.02)}
[data-theme="dark"] .rt tr:hover,[data-theme="dark"] .pr:hover,[data-theme="dark"] .jt tbody tr:hover{background:rgba(255,255,255,0.04)}
[data-theme="dark"] .rt td,[data-theme="dark"] .jt td,[data-theme="dark"] .pr{border-color:rgba(255,255,255,0.05);color:#cbd5e1}
[data-theme="dark"] .lb,[data-theme="dark"] .pd,[data-theme="dark"] .jt td:first-child{color:#f1f5f9}
[data-theme="dark"] .vl,[data-theme="dark"] .pv.nat,[data-theme="dark"] .jt td.js.h{color:#2ec4e8}
[data-theme="dark"] .vl.d,[data-theme="dark"] .pv.droog,[data-theme="dark"] .jt td.js.l{color:#fbbf24}
[data-theme="dark"] .bk{background:#2ec4e8}
[data-theme="dark"] .bk.l{background:#fbbf24}
[data-theme="dark"] .info{background:rgba(245,158,11,0.10);border-color:rgba(245,158,11,0.3);color:#fde68a}
[data-theme="dark"] .info strong{color:#fde68a}
[data-theme="dark"] .sb{background:#0e1629;border-color:rgba(255,255,255,0.08);color:#cbd5e1}
[data-theme="dark"] #loading,[data-theme="dark"] footer{color:#64748b}
[data-theme="dark"] .rk{color:#64748b}
</style>
<script>
  (function(){
    function apply(t){ document.documentElement.setAttribute("data-theme", t === "dark" ? "dark" : "light"); }
    var saved = "light"; try { saved = localStorage.getItem("weerlab_theme") || "light"; } catch {}
    apply(saved);
    window.addEventListener("storage", function(e){ if (e.key === "weerlab_theme") apply(e.newValue); });
  })();
</script>
</head>
<body>
<header>
  <div>
    <h1>Landelijk Neerslaggemiddelde <span>P13</span></h1>
    <div class="subtitle">13 KNMI-neerslagstations &middot; Nederland &middot; 1900&ndash;heden</div>
  </div>
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <span id="hmeta" style="font-size:11px;color:#94a3b8;font-family:'DM Mono',ui-monospace,monospace"></span>
  </div>
</header>
<div class="container">
  <div id="loading">Gegevens laden...</div>
  <div id="content" style="display:none">
    <div class="info">
      <strong>P13 neerslaggemiddelde</strong> &mdash; Dagelijks gemiddelde van 13 representatieve KNMI-neerslagstations. Meting: 08:00 UTC vorige dag t/m 08:00 UTC vermelde datum. Minimum <strong>10</strong> stations vereist.
      <div class="sl" id="sl"></div>
    </div>
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="records">Records</button>
      <button class="tab-btn" data-tab="periodes">Periodes</button>
      <button class="tab-btn" data-tab="jaar">Jaaroverzicht</button>
      <button class="tab-btn" data-tab="grafiek">Grafiek</button>
    </div>
    <div class="tab-panel active" id="tab-records">
      <div class="st">Natste &amp; droogste jaren</div>
      <div class="rg" id="g-jaren"></div>
      <div class="st">Natste &amp; droogste maanden</div>
      <div class="rg" id="g-maanden"></div>
      <div class="st">Natste seizoenen</div>
      <div class="rg" id="g-sei-nat"></div>
      <div class="st">Droogste seizoenen</div>
      <div class="rg" id="g-sei-droog"></div>
      <div class="st">Natste decades</div>
      <div class="rg" id="g-dec"></div>
      <div class="st">Natste dagen</div>
      <div class="rg" id="g-dag"></div>
    </div>
    <div class="tab-panel" id="tab-periodes">
      <div class="st">Langste droge en natte periodes</div>
      <div class="pg" id="g-per"></div>
      <p style="margin-top:16px;font-size:.78rem;color:#3a5a78">Droog = alle dagen &lt; 0,1 mm &middot; Nat = alle dagen &ge; 1,0 mm</p>
    </div>
    <div class="tab-panel" id="tab-jaar">
      <div class="st">Jaaroverzicht 1900&ndash;heden</div>
      <div class="jw">
        <table class="jt" id="jt">
          <thead><tr>
            <th data-col="jaar">Jaar</th>
            <th data-col="jaarsom">Neerslag (mm)</th>
            <th data-col="neerslagdagen">Neerslagdagen</th>
            <th data-col="max_dag">Max dag (mm)</th>
            <th data-col="max_dag_datum">Datum max</th>
          </tr></thead>
          <tbody id="jtb"></tbody>
        </table>
      </div>
    </div>
    <div class="tab-panel" id="tab-grafiek">
      <div class="st">Jaarsom neerslag P13 &middot; 1900&ndash;heden</div>
      <div class="cw"><canvas id="c1"></canvas></div>
      <div class="st">10-jarig voortschrijdend gemiddelde</div>
      <div class="cw"><canvas id="c2"></canvas></div>
    </div>
  </div>
</div>
<footer>&copy; Ed Aldus WM Nederland &amp; Belgi&euml;</footer>
<script>
document.querySelectorAll(".tab-btn").forEach(function(btn) {
  btn.addEventListener("click", function() {
    document.querySelectorAll(".tab-btn").forEach(function(b) { b.classList.remove("active"); });
    document.querySelectorAll(".tab-panel").forEach(function(p) { p.classList.remove("active"); });
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "grafiek" && !window.chartsBuilt) { buildCharts(); }
  });
});

fetch("p13_records.json")
  .then(function(r) { return r.json(); })
  .then(function(D) { render(D); })
  .catch(function(e) {
    document.getElementById("loading").innerHTML = "<span style='color:#e05050'>Fout: " + e.message + "</span>";
  });

function render(D) {
  document.getElementById("loading").style.display = "none";
  document.getElementById("content").style.display = "block";
  var rec = D.records;
  var jaarData = D.jaaroverzicht;
  document.getElementById("hmeta").textContent = "Periode: " + D.meta.periode_start + " \u2013 " + D.meta.periode_eind + " \u00b7 " + D.meta.gegenereerd;
  var sl = document.getElementById("sl");
  Object.entries(D.meta.stations).sort(function(a, b) { return a[1].localeCompare(b[1]); }).forEach(function(e) {
    var s = document.createElement("span"); s.className = "sb"; s.textContent = e[1] + " (" + e[0] + ")"; sl.appendChild(s);
  });
  function mkCard(title, rows, type) {
    var card = document.createElement("div"); card.className = "rc";
    var hdr = document.createElement("div"); hdr.className = "rh " + type; hdr.textContent = title; card.appendChild(hdr);
    var tbl = document.createElement("table"); tbl.className = "rt";
    rows.forEach(function(r, i) {
      var tr = document.createElement("tr");
      var td1 = document.createElement("td"); td1.className = "rk"; td1.textContent = i + 1;
      var td2 = document.createElement("td"); td2.className = "lb"; td2.textContent = r.label;
      var td3 = document.createElement("td"); td3.className = "vl" + (type === "droog" ? " d" : ""); td3.textContent = r.waarde + " mm";
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tbl.appendChild(tr);
    });
    card.appendChild(tbl); return card;
  }
  function fillGrid(id, cards) {
    var g = document.getElementById(id);
    cards.forEach(function(c) { if (rec[c.key] && rec[c.key].length) { g.appendChild(mkCard(c.title, rec[c.key], c.type)); } });
  }
  fillGrid("g-jaren", [{title:"Natste jaren",key:"natste_jaar",type:"nat"},{title:"Droogste jaren",key:"droogste_jaar",type:"droog"}]);
  fillGrid("g-maanden", [{title:"Natste maanden",key:"natste_maand",type:"nat"},{title:"Droogste maanden",key:"droogste_maand",type:"droog"}]);
  fillGrid("g-sei-nat", [{title:"Natste winters",key:"natste_winter",type:"nat"},{title:"Natste lentes",key:"natste_lente",type:"nat"},{title:"Natste zomers",key:"natste_zomer",type:"nat"},{title:"Natste herfsten",key:"natste_herfst",type:"nat"}]);
  fillGrid("g-sei-droog", [{title:"Droogste winters",key:"droogste_winter",type:"droog"},{title:"Droogste lentes",key:"droogste_lente",type:"droog"},{title:"Droogste zomers",key:"droogste_zomer",type:"droog"},{title:"Droogste herfsten",key:"droogste_herfst",type:"droog"}]);
  fillGrid("g-dec", [{title:"Natste decades",key:"natste_decade",type:"nat"}]);
  fillGrid("g-dag", [{title:"Natste dagen",key:"natste_dag",type:"nat"}]);
  var pg = document.getElementById("g-per");
  [{key:"langste_droge_periode",title:"Langste droge periodes",type:"droog"},{key:"langste_natte_periode",title:"Langste natte periodes",type:"nat"}].forEach(function(s) {
    var card = document.createElement("div"); card.className = "pc";
    var hdr = document.createElement("div"); hdr.className = "ph " + s.type; hdr.textContent = s.title; card.appendChild(hdr);
    (rec[s.key] || []).forEach(function(r, i) {
      var row = document.createElement("div"); row.className = "pr";
      var r1 = document.createElement("span"); r1.className = "prk"; r1.textContent = i + 1;
      var r2 = document.createElement("span"); r2.className = "pd"; r2.textContent = r.start + " \u2013 " + r.eind;
      var r3 = document.createElement("span"); r3.className = "pv " + s.type; r3.textContent = r.dagen;
      var su = document.createElement("span"); su.textContent = " dgn"; r3.appendChild(su);
      row.appendChild(r1); row.appendChild(r2); row.appendChild(r3); card.appendChild(row);
    });
    pg.appendChild(card);
  });
  var natTop = (rec.natste_jaar || []).slice(0, 5).map(function(r) { return String(r.label); });
  var droogTop = (rec.droogste_jaar || []).slice(0, 5).map(function(r) { return String(r.label); });
  var maxMm = Math.max.apply(null, jaarData.map(function(d) { return d.jaarsom; }));
  var sortCol = "jaar", sortAsc = false;
  function renderJaar() {
    var sorted = jaarData.slice().sort(function(a, b) {
      var va = a[sortCol] || 0, vb = b[sortCol] || 0;
      if (typeof va === "string") { return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va); }
      return sortAsc ? va - vb : vb - va;
    });
    var tb = document.getElementById("jtb"); tb.innerHTML = "";
    sorted.forEach(function(r) {
      var pct = Math.round(r.jaarsom / maxMm * 120);
      var isN = natTop.indexOf(String(r.jaar)) >= 0, isD = droogTop.indexOf(String(r.jaar)) >= 0;
      var cls = isN ? "h" : (isD ? "l" : ""), bkl = isN ? "" : (isD ? "l" : "");
      var tr = document.createElement("tr");
      var c1 = document.createElement("td"); c1.textContent = r.jaar;
      var c2 = document.createElement("td"); c2.className = "js " + cls;
      var bw = document.createElement("div"); bw.className = "bw";
      var bk = document.createElement("div"); bk.className = "bk " + bkl; bk.style.width = pct + "px";
      bw.appendChild(bk); bw.appendChild(document.createTextNode(r.jaarsom)); c2.appendChild(bw);
      var c3 = document.createElement("td"); c3.textContent = r.neerslagdagen;
      var c4 = document.createElement("td"); c4.textContent = r.max_dag;
      var c5 = document.createElement("td"); c5.style.color = "#7aabcc"; c5.textContent = r.max_dag_datum;
      tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3); tr.appendChild(c4); tr.appendChild(c5);
      tb.appendChild(tr);
    });
  }
  renderJaar();
  document.querySelectorAll("#jt thead th").forEach(function(th) {
    th.addEventListener("click", function() {
      var col = th.dataset.col;
      if (sortCol === col) { sortAsc = !sortAsc; } else { sortCol = col; sortAsc = false; }
      document.querySelectorAll("#jt thead th").forEach(function(t) { t.classList.remove("asc", "desc"); });
      th.classList.add(sortAsc ? "asc" : "desc");
      renderJaar();
    });
  });
  document.querySelector("#jt thead th[data-col='jaar']").classList.add("desc");
  window._jaarData = jaarData; window._natTop = natTop; window._droogTop = droogTop;
}

window.chartsBuilt = false;
function buildCharts() {
  window.chartsBuilt = true;
  var jaarData = window._jaarData, natTop = window._natTop, droogTop = window._droogTop;
  var jaren = jaarData.map(function(d) { return d.jaar; });
  var sommen = jaarData.map(function(d) { return d.jaarsom; });
  var natL = natTop.map(Number), droogL = droogTop.map(Number);
  var kl = sommen.map(function(_, i) {
    if (natL.indexOf(jaren[i]) >= 0) { return "rgba(31,200,240,.85)"; }
    if (droogL.indexOf(jaren[i]) >= 0) { return "rgba(232,160,32,.85)"; }
    return "rgba(60,110,160,.6)";
  });
  new Chart(document.getElementById("c1"), {
    type: "bar",
    data: { labels: jaren, datasets: [{ label: "Jaarsom P13 (mm)", data: sommen, backgroundColor: kl, borderWidth: 0, barPercentage: 0.9 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#5a7a99", maxTicksLimit: 25, font: { size: 11 } }, grid: { color: "#1a2a3a" } }, y: { ticks: { color: "#5a7a99", font: { size: 11 } }, grid: { color: "#1a2a3a" }, title: { display: true, text: "mm", color: "#5a7a99" } } } }
  });
  var vm = sommen.map(function(_, i, a) {
    if (i < 9) { return null; }
    var s = a.slice(i - 9, i + 1);
    return Math.round(s.reduce(function(x, y) { return x + y; }, 0) / 10 * 10) / 10;
  });
  new Chart(document.getElementById("c2"), {
    type: "line",
    data: { labels: jaren, datasets: [
      { label: "Jaarsom (mm)", data: sommen, borderColor: "rgba(60,110,160,.4)", backgroundColor: "rgba(60,110,160,.08)", borderWidth: 1, pointRadius: 0, fill: true, tension: 0, order: 2 },
      { label: "10-jarig gemiddelde", data: vm, borderColor: "#1fc8f0", backgroundColor: "transparent", borderWidth: 2.5, pointRadius: 0, tension: 0.4, order: 1 }
    ]},
    options: { responsive: true, interaction: { mode: "index", intersect: false }, plugins: { legend: { labels: { color: "#8ab4cc", font: { size: 12 } } } }, scales: { x: { ticks: { color: "#5a7a99", maxTicksLimit: 25, font: { size: 11 } }, grid: { color: "#1a2a3a" } }, y: { ticks: { color: "#5a7a99", font: { size: 11 } }, grid: { color: "#1a2a3a" }, title: { display: true, text: "mm", color: "#5a7a99" } } } }
  });
}
</script>
</body>
</html>
"""

with open(OUT, "w", encoding="utf-8") as f:
    f.write(HTML)
print("ok:", OUT)
print("Grootte:", len(HTML), "chars")
