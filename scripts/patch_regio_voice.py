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
replace('symbolsOpen:showSymbolCatalog,actions:{back:', 'symbolsOpen:showSymbolCatalog,voicePlaces:Gw,actions:{voiceAdd:o=>{Ye.flushSync(()=>{s("select"),aA(null),x(null),ye(o.type,fA*(.35+.15*(e.length%3)),hA*(.3+.2*(Math.floor(e.length/3)%3)),{value:o.value})})},back:')
s = s.replace('landelijke-studio.js?v=20260913-rain1', 'landelijke-studio.js?v=20260929-voice1')
p.write_text(s)
