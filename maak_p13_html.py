#!/usr/bin/env python3
"""
maak_p13_html.py — Genereert p13_records.html vanuit p13_records.json.
Zet in dezelfde map als p13_records.json (projectroot).
"""
import json, os

ROOT = os.path.dirname(os.path.abspath(__file__))
JSON_PAD = os.path.join(ROOT, "p13_records.json")
HTML_PAD = os.path.join(ROOT, "p13_records.html")

data = json.load(open(JSON_PAD, encoding="utf-8"))
DATA_JS = "var D=" + json.dumps(data, ensure_ascii=True, separators=(',',':')).replace("</", "<\\/") + ";"

HTML = """<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>P13 Landelijk Neerslaggemiddelde</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#0f1117;color:#e0e6f0;font-family:'Segoe UI',system-ui,sans-serif;font-size:14px}
header{background:linear-gradient(135deg,#0d2137,#0a3d52);border-bottom:2px solid #1a9bbf;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
header h1{font-size:1.25rem;font-weight:700;color:#fff}
header h1 span{color:#1fc8f0}
.subtitle{font-size:.78rem;color:#8ab4cc;margin-top:2px}
.back-btn{display:inline-block;padding:6px 14px;background:rgba(31,200,240,.15);border:1px solid #1a9bbf;border-radius:6px;color:#1fc8f0;text-decoration:none;font-size:.78rem}
.back-btn:hover{background:rgba(31,200,240,.28)}
.container{max-width:1200px;margin:0 auto;padding:20px 16px 60px}
.tab-bar{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:20px;border-bottom:2px solid #1a3a50}
.tab-btn{padding:8px 16px;background:transparent;border:none;border-bottom:3px solid transparent;color:#7aabcc;cursor:pointer;font-size:.85rem;font-weight:500;margin-bottom:-2px;white-space:nowrap}
.tab-btn:hover{color:#c0dff0}
.tab-btn.active{color:#1fc8f0;border-bottom-color:#1fc8f0}
.tab-panel{display:none}
.tab-panel.active{display:block}
.section-title{font-size:1rem;font-weight:600;color:#1fc8f0;margin:24px 0 12px;padding-bottom:6px;border-bottom:1px solid #1a3a50}
.section-title:first-child{margin-top:0}
.records-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:8px}
.record-card{background:#141b26;border:1px solid #1e3248;border-radius:8px;overflow:hidden}
.rch{background:#0d2137;padding:8px 14px;font-size:.78rem;font-weight:600;color:#8ab4cc;text-transform:uppercase;letter-spacing:.05em}
.rch.nat{border-left:3px solid #1fc8f0}
.rch.droog{border-left:3px solid #e8a020}
.rt{width:100%;border-collapse:collapse}
.rt tr:nth-child(even){background:#10161f}
.rt tr:hover{background:#1a2840}
.rt td{padding:5px 12px;line-height:1.4}
.rt .rk{color:#3a5a78;font-size:.72rem;width:24px;text-align:right}
.rt tr:nth-child(1) .rk{color:#ffd700}
.rt tr:nth-child(2) .rk{color:#c0c0c0}
.rt tr:nth-child(3) .rk{color:#cd7f32}
.rt .lb{color:#c0dff0}
.rt .vl{text-align:right;font-weight:600;color:#1fc8f0;white-space:nowrap}
.rt .vl.d{color:#e8a020}
.rt tr:nth-child(1) .vl{font-size:1rem}
.periodes-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:640px){.periodes-grid{grid-template-columns:1fr}}
.pc{background:#141b26;border:1px solid #1e3248;border-radius:8px;overflow:hidden}
.pch{padding:10px 14px;font-size:.82rem;font-weight:600;background:#0d2137}
.pch.droog{border-left:3px solid #e8a020;color:#e8c060}
.pch.nat{border-left:3px solid #1fc8f0;color:#7ad4f0}
.pr{display:flex;justify-content:space-between;align-items:center;padding:7px 14px;border-bottom:1px solid #1a2a3a;gap:12px}
.pr:last-child{border-bottom:none}
.pr:nth-child(even){background:#10161f}
.pr:hover{background:#1a2840}
.prk{color:#3a5a78;font-size:.72rem;min-width:18px}
.pr:nth-child(1) .prk{color:#ffd700}
.pr:nth-child(2) .prk{color:#c0c0c0}
.pr:nth-child(3) .prk{color:#cd7f32}
.pd{color:#c0dff0;font-size:.82rem;flex:1}
.pv{font-weight:700;font-size:1rem;white-space:nowrap}
.pv.droog{color:#e8a020}
.pv.nat{color:#1fc8f0}
.pv span{font-size:.72rem;font-weight:400;color:#5a8099;margin-left:2px}
.jw{overflow-x:auto;border-radius:8px;border:1px solid #1e3248}
.jt{width:100%;border-collapse:collapse;min-width:500px}
.jt thead th{background:#0d2137;color:#8ab4cc;padding:8px 12px;text-align:right;font-size:.78rem;font-weight:600;text-transform:uppercase;cursor:pointer;white-space:nowrap}
.jt thead th:first-child{text-align:left}
.jt thead th:hover{color:#1fc8f0}
.jt thead th.asc::after{content:" \u2191";color:#1fc8f0}
.jt thead th.desc::after{content:" \u2193";color:#1fc8f0}
.jt tbody tr:nth-child(even){background:#10161f}
.jt tbody tr:hover{background:#1a2840}
.jt td{padding:6px 12px;text-align:right;border-bottom:1px solid #141e2c}
.jt td:first-child{text-align:left;font-weight:600;color:#c0dff0}
.jt td.js{font-weight:700}
.jt td.js.h{color:#1fc8f0}
.jt td.js.l{color:#e8a020}
.bw{display:flex;align-items:center;gap:6px;justify-content:flex-end}
.bk{height:10px;border-radius:3px;background:#1fc8f0;min-width:2px;opacity:.75}
.bk.l{background:#e8a020}
.cw{background:#141b26;border:1px solid #1e3248;border-radius:8px;padding:20px;margin-bottom:20px}
.cw canvas{max-height:340px}
.info{background:#0d1e30;border:1px solid #1a3a50;border-radius:8px;padding:14px 18px;margin-bottom:20px;font-size:.82rem;color:#7aabcc;line-height:1.7}
.info strong{color:#c0dff0}
.sl{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px}
.sb{background:#0a2035;border:1px solid #1a4060;border-radius:4px;padding:2px 8px;font-size:.75rem;color:#8ab4cc}
footer{text-align:center;padding:20px;color:#2a4a60;font-size:.72rem}
</style>
</head>
<body>
<header>
  <div>
    <h1>&#127783;&#65039; Landelijk Neerslaggemiddelde <span>P13</span></h1>
    <div class="subtitle">13 KNMI-neerslagstations &middot; Nederland &middot; 1900&ndash;heden</div>
  </div>
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <span id="hmeta" style="font-size:.75rem;color:#5a8099"></span>
    <a href="records_debilt.html" class="back-btn">&larr; Weerrecords</a>
    <a href="index.html" class="back-btn">&larr; Kaarten</a>
  </div>
</header>
<div class="container">
  <div class="info">
    <strong>P13 neerslaggemiddelde</strong> &mdash; Dagelijks gemiddelde van 13 representatieve KNMI-neerslagstations verspreid over Nederland. Meting: 08:00 UTC vorige dag t/m 08:00 UTC vermelde datum. Minimum <strong>10</strong> stations vereist voor een geldige dagwaarde.
    <div class="sl" id="sl"></div>
  </div>
  <div class="tab-bar">
    <button class="tab-btn active" data-tab="records">&#128202; Records</button>
    <button class="tab-btn" data-tab="periodes">&#128197; Periodes</button>
    <button class="tab-btn" data-tab="jaar">&#128203; Jaaroverzicht</button>
    <button class="tab-btn" data-tab="grafiek">&#128200; Grafiek</button>
  </div>
  <div class="tab-panel active" id="tab-records">
    <div class="section-title">Natste &amp; droogste jaren</div><div class="records-grid" id="g-jaren"></div>
    <div class="section-title">Natste &amp; droogste maanden</div><div class="records-grid" id="g-maanden"></div>
    <div class="section-title">Natste seizoenen</div><div class="records-grid" id="g-sei-nat"></div>
    <div class="section-title">Droogste seizoenen</div><div class="records-grid" id="g-sei-droog"></div>
    <div class="section-title">Natste decades</div><div class="records-grid" id="g-dec"></div>
    <div class="section-title">Natste dagen</div><div class="records-grid" id="g-dag"></div>
  </div>
  <div class="tab-panel" id="tab-periodes">
    <div class="section-title">Langste droge en natte periodes</div>
    <div class="periodes-grid" id="g-per"></div>
    <p style="margin-top:16px;font-size:.78rem;color:#3a5a78">Droog = alle dagen &lt; 0,1 mm &middot; Nat = alle dagen &ge; 1,0 mm</p>
  </div>
  <div class="tab-panel" id="tab-jaar">
    <div class="section-title">Jaaroverzicht 1900&ndash;heden</div>
    <div class="jw"><table class="jt" id="jt">
      <thead><tr>
        <th data-col="jaar">Jaar</th>
        <th data-col="jaarsom">Neerslag (mm)</th>
        <th data-col="neerslagdagen">Neerslagdagen</th>
        <th data-col="max_dag">Max dag (mm)</th>
        <th data-col="max_dag_datum">Datum max</th>
      </tr></thead>
      <tbody id="jtb"></tbody>
    </table></div>
  </div>
  <div class="tab-panel" id="tab-grafiek">
    <div class="section-title">Jaarsom neerslag P13 &middot; 1900&ndash;heden</div>
    <div class="cw"><canvas id="c1"></canvas></div>
    <div class="section-title">10-jarig voortschrijdend gemiddelde</div>
    <div class="cw"><canvas id="c2"></canvas></div>
  </div>
</div>
<footer>&copy; Ed Aldus WM Nederland &amp; Belgi&euml;</footer>
<script>
DATA_JS_PLACEHOLDER
var jaarData=D.jaaroverzicht,rec=D.records,sortCol='jaar',sortAsc=false;
document.querySelectorAll('.tab-btn').forEach(function(b){b.addEventListener('click',function(){document.querySelectorAll('.tab-btn').forEach(function(x){x.classList.remove('active')});document.querySelectorAll('.tab-panel').forEach(function(x){x.classList.remove('active')});b.classList.add('active');document.getElementById('tab-'+b.dataset.tab).classList.add('active');if(b.dataset.tab==='grafiek'&&!window.chartsBuilt)buildCharts();});});
document.getElementById('hmeta').textContent='Periode: '+D.meta.periode_start+' \u2013 '+D.meta.periode_eind+' \u00b7 '+D.meta.gegenereerd;
var sl=document.getElementById('sl');Object.entries(D.meta.stations).sort(function(a,b){return a[1].localeCompare(b[1])}).forEach(function(e){var s=document.createElement('span');s.className='sb';s.textContent=e[1]+' ('+e[0]+')';sl.appendChild(s);});
function mkCard(title,rows,type,unit){var c=document.createElement('div');c.className='record-card';var h=document.createElement('div');h.className='rch '+type;h.textContent=title;c.appendChild(h);var t=document.createElement('table');t.className='rt';rows.forEach(function(r,i){var tr=document.createElement('tr');tr.innerHTML='<td class="rk">'+(i+1)+'</td><td class="lb">'+r.label+'</td><td class="vl'+(type==='droog'?' d':'')+'">'+r.waarde+' '+unit+'</td>';t.appendChild(tr);});c.appendChild(t);return c;}
function fillGrid(id,cards){var g=document.getElementById(id);cards.forEach(function(c){if(rec[c.key]&&rec[c.key].length)g.appendChild(mkCard(c.title,rec[c.key],c.type,'mm'));});}
fillGrid('g-jaren',[{title:'Natste jaren',key:'natste_jaar',type:'nat'},{title:'Droogste jaren',key:'droogste_jaar',type:'droog'}]);
fillGrid('g-maanden',[{title:'Natste maanden',key:'natste_maand',type:'nat'},{title:'Droogste maanden',key:'droogste_maand',type:'droog'}]);
fillGrid('g-sei-nat',[{title:'Natste winters',key:'natste_winter',type:'nat'},{title:'Natste lentes',key:'natste_lente',type:'nat'},{title:'Natste zomers',key:'natste_zomer',type:'nat'},{title:'Natste herfsten',key:'natste_herfst',type:'nat'}]);
fillGrid('g-sei-droog',[{title:'Droogste winters',key:'droogste_winter',type:'droog'},{title:'Droogste lentes',key:'droogste_lente',type:'droog'},{title:'Droogste zomers',key:'droogste_zomer',type:'droog'},{title:'Droogste herfsten',key:'droogste_herfst',type:'droog'}]);
fillGrid('g-dec',[{title:'Natste decades',key:'natste_decade',type:'nat'}]);
fillGrid('g-dag',[{title:'Natste dagen',key:'natste_dag',type:'nat'}]);
var pg=document.getElementById('g-per');
[{key:'langste_droge_periode',title:'\u2600\ufe0f Langste droge periodes',type:'droog'},{key:'langste_natte_periode',title:'\ud83c\udf27\ufe0f Langste natte periodes',type:'nat'}].forEach(function(s){var c=document.createElement('div');c.className='pc';var h=document.createElement('div');h.className='pch '+s.type;h.textContent=s.title;c.appendChild(h);(rec[s.key]||[]).forEach(function(r,i){var row=document.createElement('div');row.className='pr';row.innerHTML='<span class="prk">'+(i+1)+'</span><span class="pd">'+r.start+' \u2013 '+r.eind+'</span><span class="pv '+s.type+'">'+r.dagen+'<span> dgn</span></span>';c.appendChild(row);});pg.appendChild(c);});
var natTop=(rec.natste_jaar||[]).slice(0,5).map(function(r){return r.label});
var droogTop=(rec.droogste_jaar||[]).slice(0,5).map(function(r){return r.label});
var maxMm=Math.max.apply(null,jaarData.map(function(d){return d.jaarsom}));
function renderJaar(){var sorted=jaarData.slice().sort(function(a,b){var va=a[sortCol]||0,vb=b[sortCol]||0;if(typeof va==='string')return sortAsc?va.localeCompare(vb):vb.localeCompare(va);return sortAsc?va-vb:vb-va;});var tb=document.getElementById('jtb');tb.innerHTML='';sorted.forEach(function(r){var pct=Math.round(r.jaarsom/maxMm*120);var isN=natTop.indexOf(String(r.jaar))>=0,isD=droogTop.indexOf(String(r.jaar))>=0;var cls=isN?'h':(isD?'l':''),bk=isN?'':(isD?'l':'');var tr=document.createElement('tr');tr.innerHTML='<td>'+r.jaar+'</td><td class="js '+cls+'"><div class="bw"><div class="bk '+bk+'" style="width:'+pct+'px"></div>'+r.jaarsom+'</div></td><td>'+r.neerslagdagen+'</td><td>'+r.max_dag+'</td><td style="color:#7aabcc">'+r.max_dag_datum+'</td>';tb.appendChild(tr);});}
renderJaar();
document.querySelectorAll('#jt thead th').forEach(function(th){th.addEventListener('click',function(){var col=th.dataset.col;if(sortCol===col)sortAsc=!sortAsc;else{sortCol=col;sortAsc=false;}document.querySelectorAll('#jt thead th').forEach(function(t){t.classList.remove('asc','desc')});th.classList.add(sortAsc?'asc':'desc');renderJaar();});});
document.querySelector('#jt thead th[data-col="jaar"]').classList.add('desc');
window.chartsBuilt=false;
function buildCharts(){window.chartsBuilt=true;var jaren=jaarData.map(function(d){return d.jaar});var sommen=jaarData.map(function(d){return d.jaarsom});var natL=natTop.map(Number),droogL=droogTop.map(Number);var kl=sommen.map(function(_,i){return natL.indexOf(jaren[i])>=0?'rgba(31,200,240,.85)':(droogL.indexOf(jaren[i])>=0?'rgba(232,160,32,.85)':'rgba(60,110,160,.6)');});new Chart(document.getElementById('c1'),{type:'bar',data:{labels:jaren,datasets:[{label:'Jaarsom P13 (mm)',data:sommen,backgroundColor:kl,borderWidth:0,barPercentage:.9}]},options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{title:function(c){return c[0].label},label:function(c){return ' '+c.parsed.y+' mm'}}}},scales:{x:{ticks:{color:'#5a7a99',maxTicksLimit:25,font:{size:11}},grid:{color:'#1a2a3a'}},y:{ticks:{color:'#5a7a99',font:{size:11}},grid:{color:'#1a2a3a'},title:{display:true,text:'mm',color:'#5a7a99',font:{size:11}}}}}});var vm=sommen.map(function(_,i,a){if(i<9)return null;var s=a.slice(i-9,i+1);return Math.round(s.reduce(function(x,y){return x+y},0)/10*10)/10});new Chart(document.getElementById('c2'),{type:'line',data:{labels:jaren,datasets:[{label:'Jaarsom (mm)',data:sommen,borderColor:'rgba(60,110,160,.4)',backgroundColor:'rgba(60,110,160,.08)',borderWidth:1,pointRadius:0,fill:true,tension:0,order:2},{label:'10-jarig gemiddelde',data:vm,borderColor:'#1fc8f0',backgroundColor:'transparent',borderWidth:2.5,pointRadius:0,tension:.4,order:1}]},options:{responsive:true,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#8ab4cc',font:{size:12}}},tooltip:{callbacks:{title:function(c){return c[0].label},label:function(c){return ' '+c.dataset.label+': '+(c.parsed.y!=null?c.parsed.y:'--')+' mm'}}}},scales:{x:{ticks:{color:'#5a7a99',maxTicksLimit:25,font:{size:11}},grid:{color:'#1a2a3a'}},y:{ticks:{color:'#5a7a99',font:{size:11}},grid:{color:'#1a2a3a'},title:{display:true,text:'mm',color:'#5a7a99',font:{size:11}}}}}}})}
</script>
</body>
</html>"""

HTML = HTML.replace("DATA_JS_PLACEHOLDER", DATA_JS)
with open(HTML_PAD, "w", encoding="utf-8", errors="replace") as f:
    f.write(HTML)
print("ok:", HTML_PAD)
