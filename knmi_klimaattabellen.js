'use strict';
(() => {
const definitions=[
 ['Temperatuur','Temperatuur gemiddeld','°C'],['Temperatuur','Minimumtemperatuur gemiddeld','°C'],['Temperatuur','Maximumtemperatuur gemiddeld','°C'],
 ['Vochtigheid & luchtdruk','Relatieve vochtigheid gemiddeld','%'],['Vochtigheid & luchtdruk','Relatieve vochtigheid om 12.00 UT','%'],
 ['Neerslag & verdamping','Neerslagduur','uur'],['Neerslag & verdamping','Neerslagduur als deel van de tijd','%'],['Neerslag & verdamping','Neerslagsom','mm'],['Neerslag & verdamping','Verdamping','mm'],
 ['Zon & straling','Globale straling','kJ/cm²'],['Zon & straling','Zonneschijnduur','uur'],['Zon & straling','Zonneschijn / langst mogelijke duur','%'],['Vochtigheid & luchtdruk','Luchtdruk','hPa'],
 ['Wind','Potentiële windsnelheid','m/s'],['Wind','Gemiddelde windsnelheid','m/s'],['Wind','Hoogste uurgemiddelde windsnelheid','m/s'],['Wind','Hoogste windstoot','m/s'],
 ...['≥ 4 Bft','≥ 5 Bft','≥ 6 Bft','≥ 7 Bft','≥ 8 Bft'].map(x=>['Dagen met veel wind','Hoogste uurgemiddelde windkracht '+x,'dagen']),
 ...['≥ 21 m/s','≥ 28 m/s'].map(x=>['Dagen met veel wind','Hoogste windstoot '+x,'dagen']),
 ['Warme & koude dagen','Tropische dagen · maximum ≥ 30 °C','dagen'],['Warme & koude dagen','Zomerse dagen · maximum ≥ 25 °C','dagen'],['Warme & koude dagen','Warme dagen · maximum ≥ 20 °C','dagen'],['Warme & koude dagen','Maximum ≥ 15 °C','dagen'],['Warme & koude dagen','IJsdagen · maximum < 0 °C','dagen'],['Warme & koude dagen','Vorstdagen · minimum < 0 °C','dagen'],['Warme & koude dagen','Minimum < −5 °C','dagen'],['Warme & koude dagen','Minimum < −10 °C','dagen'],['Warme & koude dagen','Grondvorst · minimum op 10 cm < 0 °C','dagen'],
 ['Mist & sneeuw','Mist','dagen'],['Mist & sneeuw','Sneeuwval','dagen'],
 ['Dagen met neerslag','Droog','dagen'],...['≥ 0,1 mm','≥ 0,3 mm','≥ 1 mm','≥ 10 mm'].map(x=>['Dagen met neerslag','Neerslag '+x,'dagen']),
 ['Dagen met zon','Zonloos','dagen'],...['≤ 20 %','20–50 %','50–80 %','≥ 80 %'].map(x=>['Dagen met zon','Zonneschijn '+x+' van mogelijke duur','dagen'])
];
const groups=[...new Set(definitions.map(d=>d[0]))];
const periodNames=['Januari','Februari','Maart','April','Mei','Juni','Juli','Augustus','September','Oktober','November','December','Winter','Lente','Zomer','Herfst','Jaar'];
const $=id=>document.getElementById(id);let data,station,subject='Temperatuur';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=v=>v==='.'?'·':v==='-'?'—':v.replace('.',',');
function setUrl(){const u=new URL(location.href);u.searchParams.set('station',station.id);history.replaceState(null,'',u);}
function render(){
 const term=$('search').value.trim().toLocaleLowerCase('nl');
 const rowIndices=data.periods.map((_,i)=>i).filter(i=>$('period').value==='all'||i===16||($('period').value==='months'?i<12:i>=12));
 const selected=term?groups:subject==='Alles'?groups:[subject];let html='',matches=0;
 for(const group of selected){
  const cols=definitions.map((d,i)=>({d,i})).filter(({d})=>d[0]===group&&(!term||d.join(' ').toLocaleLowerCase('nl').includes(term)));if(!cols.length)continue;matches+=cols.length;
  html+=`<section class="table-section"><h3>${escape(group)}</h3><div class="table-scroll" tabindex="0" role="region" aria-label="${escape(group)}: horizontaal scrollbare tabel"><table><caption>${escape(station.name)} · 1991–2020 · waarden uit de KNMI-PDF</caption><thead><tr><th scope="col">Periode</th>${cols.map(({d})=>`<th scope="col">${escape(d[1])}<small>${escape(d[2])}</small></th>`).join('')}</tr></thead><tbody>${rowIndices.map(r=>`<tr class="${r===16?'year':''}"><th scope="row">${periodNames[r]}</th>${cols.map(({i})=>{const v=station.values[r][i];return `<td${['.','-','*'].includes(v)?' class="symbol"':''}${v==='.'?' title="Niet voorgekomen"':''}>${format(v)}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div></section>`;
 }
 $('tables').innerHTML=html||'<p>Geen cijfers gevonden. Probeer bijvoorbeeld temperatuur, grondvorst of neerslag.</p>';
 $('heading').textContent=term?'Zoekresultaten':subject==='Alles'?'Alle cijfers uit de PDF':subject;
 $('description').textContent=`${station.name} · ${matches} gegevenskolom${matches===1?'':'men'} · scroll brede tabellen zijwaarts`;
 document.querySelectorAll('#subjects button').forEach(b=>b.setAttribute('aria-pressed',String(b.textContent===subject&&!term)));
}
function selectStation(){
 station=data.stations.find(s=>s.id===$('station').value);setUrl();
 $('pdf').href=station.pdf;$('pdf').download=station.pdf;$('pdf').hidden=false;
 $('csv').disabled=false;$('status').textContent=`${station.name} (${station.id}) · 45 gegevenskolommen · 12 maanden, 4 seizoenen en het jaar`;
 $('notes').innerHTML=station.notes.map(n=>`<li>${escape(n)}</li>`).join('');
 $('overview').innerHTML=[[0,'Gemiddelde temperatuur','°C'],[7,'Neerslag','mm'],[10,'Zonneschijn','uur'],[26,'Warme dagen','dagen']].map(([i,label,unit])=>`<div class="stat"><span>${label}</span><strong>${format(station.values[16][i])} <small>${unit}</small></strong><small>Langjarig jaargemiddelde</small></div>`).join('');render();
}
$('station').addEventListener('change',selectStation);$('period').addEventListener('change',render);$('search').addEventListener('input',render);
$('csv').addEventListener('click',()=>{
 const quote=v=>'"'+String(v).replace(/"/g,'""')+'"';
 const rows=[['Bron',station.source],['Station',station.name,station.id],['Referentieperiode','1991–2020'],...station.notes.map(n=>['Voetnoot',n]),['Legenda','. = niet voorgekomen; * en - zijn oorspronkelijke bronsymbolen'],['Periode',...definitions.map(d=>d[1]+' ('+d[2]+')')],...station.values.map((vs,i)=>[periodNames[i],...vs.map(v=>v.replace('.',v==='.'?'.':','))])];
 const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(quote).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`knmi-klimaat-1991-2020-${station.id}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
fetch('knmi_klimaattabellen.json?v=20261015').then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).then(d=>{
 data=d;$('station').innerHTML=data.stations.map(s=>`<option value="${escape(s.id)}">${escape(s.name)} · ${escape(s.id)}</option>`).join('');
 const id=new URL(location.href).searchParams.get('station')||'344';$('station').value=data.stations.some(s=>s.id===id)?id:'344';$('station').disabled=false;
 $('subjects').innerHTML=['Alles',...groups].map(g=>`<button type="button" aria-pressed="false">${escape(g)}</button>`).join('');
 $('subjects').addEventListener('click',e=>{if(e.target.tagName!=='BUTTON')return;subject=e.target.textContent;$('search').value='';render();});
 $('directory').innerHTML=data.stations.map(s=>`<a href="${escape(s.pdf)}" download>↓ ${escape(s.name)} · ${escape(s.id)}</a>`).join('');selectStation();
}).catch(()=>{$('status').textContent='De tabellen konden niet worden geladen. Herlaad de pagina of bekijk de KNMI Klimaatviewer via de bronlink hieronder.';});
})();
