"""Apply counted, idempotent voice integration anchors to the regional bundle."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
p = root / 'regio-editor-assets/weerbewaking_regio_kaart-DCFOt_3t.js'
s = p.read_text()
def replace(old, new):
    global s
    if new in s: return
    if s.count(old) != 1: raise ValueError('Unexpected bundle anchor: ' + old)
    s = s.replace(old, new, 1)
replace('o==="temp"?v={...v,value:J,color:', 'o==="temp"?v={...v,value:h.value??J,color:')
if 'voicePlaces:Gw,actions:{voiceAdd:o=>{Ye.flushSync(()=>{s("select"),aA(null),x(null),ye(o.type,fA*(.35+.15*(e.length%3)),hA*(.3+.2*(Math.floor(e.length/3)%3)),{value:o.value})})},back:' in s: replace('voicePlaces:Gw,actions:{voiceAdd:o=>{Ye.flushSync(()=>{s("select"),aA(null),x(null),ye(o.type,fA*(.35+.15*(e.length%3)),hA*(.3+.2*(Math.floor(e.length/3)%3)),{value:o.value})})},back:', 'voicePlaces:Gw,actions:{voiceAdd:o=>{Ye.flushSync(()=>{s("select"),aA(null),x(null),(()=>{const c=o.place?(y==="nederland"?(()=>{const p=Pi(o.place.lon,o.place.lat);return Li(p.x,p.y)})():bw(o.place.lon,o.place.lat,hl[y]||hl.regio)):{x:fA*(.35+.15*(e.length%3)),y:hA*(.3+.2*(Math.floor(e.length/3)%3))};ye(o.type,c.x,c.y,o)})()})},back:')
replace('symbolsOpen:showSymbolCatalog,actions:{back:', 'symbolsOpen:showSymbolCatalog,voicePlaces:Gw,actions:{voiceAdd:o=>{Ye.flushSync(()=>{s("select"),aA(null),x(null),(()=>{const c=o.place?(y==="nederland"?(()=>{const p=Pi(o.place.lon,o.place.lat);return Li(p.x,p.y)})():bw(o.place.lon,o.place.lat,hl[y]||hl.regio)):{x:fA*(.35+.15*(e.length%3)),y:hA*(.3+.2*(Math.floor(e.length/3)%3))};ye(o.type,c.x,c.y,o)})()})},back:')
replace('dir:q,bft:EA,color:', 'dir:h.dir??q,bft:h.bft??EA,color:')
replace('value:"9",color:"#90CAF9"', 'value:h.value??"9",color:"#90CAF9"')
replace('value:nA,color:"#FFD54F"', 'value:h.value??nA,color:"#FFD54F"')
replace('z.useState({opkomst:"--:--",ondergang:"--:--",loading:!1})', 'z.useState(()=>regionalSunTimes())')
s = s.replace('landelijke-studio.js?v=20260913-rain1', 'landelijke-studio.js?v=20260929-voice1')
replace('T({opkomst:f(c.results.sunrise),ondergang:f(c.results.sunset),loading:!1})', '(()=>{const t={opkomst:f(c.results.sunrise),ondergang:f(c.results.sunset),loading:!1};T(t);A(e=>e.map(o=>o.type==="zontijden"&&o.opkomst===G.opkomst&&o.ondergang===G.ondergang?{...o,opkomst:t.opkomst,ondergang:t.ondergang}:o))})()')
if 'import {regionalSunTimes}' not in s: s='import {regionalSunTimes} from \"../editor-src/regio-sun.js?v=20261003-voice2\";\n'+s
s=s.replace('20260929-voice1','20261003-voice2')
p.write_text(s)
