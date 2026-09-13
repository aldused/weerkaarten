"""Attach the shared studio and weather icons to the regional production editor.

The upstream JSX is absent. Counted anchors fail safely when that bundle changes.
Run this script again after replacing the bundle; it is idempotent.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
bundle = ROOT / 'regio-editor-assets/weerbewaking_regio_kaart-DCFOt_3t.js'
s = bundle.read_text()

def replace(old, new):
    global s
    if s.count(new) == 1:
        return
    if s.count(old) != 1:
        raise ValueError(f'Expected one integration anchor: {old[:100]}')
    s = s.replace(old, new, 1)

s = s.replace('weather-icons.js?v=20260909-icons1', 'weather-icons.js?v=20260913-rain1')
s = s.replace('landelijke-studio.js?v=20260909-regio1', 'landelijke-studio.js?v=20260913-rain1')
imports = 'import {createWeatherIcon,WEATHER_ICON_LABELS} from "../editor-src/weather-icons.js?v=20260913-rain1";\nimport {createLandelijkeStudio} from "../editor-src/landelijke-studio.js?v=20260913-rain1";\n'
if imports not in s:
    s = imports + s
replace('Lt=({type:e,s:A=250})=>', 'LegacyLt=({type:e,s:A=250})=>')
replace('function eh(){', 'const Lt=createWeatherIcon(z,LegacyLt);Object.assign(KA,WEATHER_ICON_LABELS);const RegioStudio=createLandelijkeStudio(z);function eh(){')
replace('const[e,A]=z.useState([])', 'const[showSymbolCatalog,setShowSymbolCatalog]=z.useState(!1);const[e,A]=z.useState([])')
replace('return r.jsxs("div",{style:{fontFamily:R,background:"#0F172A",height:"100vh",display:"grid"',
        'return r.jsxs(RegioStudio,{enabled:!0,regional:!0,selected:E,tool:i,pendingLabel:rA&&rA.value,count:e.length,dayLabel:nt&&nt.line1,night:_,brightness:Ft,nightBrightness:Y,ratio:fA/hA,symbolsOpen:showSymbolCatalog,actions:{back:Nw,open:kc,save:Hc,download:Fc,reset:zg,background:Bc,undo:Go,redo:Mo,select:()=>{s("select"),aA(null)},deselect:()=>n(null),removeSelected:()=>t&&fi(t),chooseSymbol:o=>{s(o),x(null),aA(null)},symbols:()=>setShowSymbolCatalog(o=>!o),appearance:o=>{d(o),y!=="custom"&&S(gt[y][o?"night":"day"])},brightness:o=>_?xA(o):An(o)},style:{fontFamily:R,background:"#0F172A",height:"100vh",display:"grid"')
for name, anchor in [
    ('header', 'r.jsxs("div",{style:{background:"#1E293B",borderBottom:'),
    ('tools', 'r.jsxs("div",{style:{background:"#1a2436",borderBottom:'),
    ('workspace', 'r.jsxs("div",{style:{display:"contents",flex:void 0'),
    ('map', 'r.jsx("div",{style:{flex:void 0,padding:8,overflow:"auto"'),
    ('inspector', 'r.jsxs("div",{style:{width:"auto",background:"#1E293B",borderLeft:'),
    ('copyright', 'r.jsxs("div",{style:{borderTop:"1px solid rgba(255,255,255,0.08)",marginTop:12,paddingTop:10}'),
]:
    replace(anchor, anchor.replace('{style:', '{"data-studio-section":"' + name + '",style:', 1))
replace('E?r.jsxs("div",{children:[r.jsx(Ve,{children:"Element bewerken"})', 'E?r.jsxs("div",{"data-studio-section":"edit",children:[r.jsx(Ve,{children:"Element bewerken"})')
replace('function Ve({children:e}){return r.jsx("div",{style:', 'function Ve({children:e}){return r.jsx("div",{className:"studio-field-title",style:')
replace('function AA({children:e}){return r.jsx("div",{style:', 'function AA({children:e}){return r.jsx("div",{className:"studio-field-label",style:')
replace('ke={stroke:"#60A5FA",strokeWidth:2.5,strokeDasharray:"6,3"}', 'ke={"data-editor-selection":!0,stroke:"#60A5FA",strokeWidth:2.5,strokeDasharray:"6,3"}')
replace('c.querySelectorAll(\'[data-inline-editor="true"]\')', 'c.querySelectorAll(\'[data-inline-editor="true"], [data-editor-selection]\')')
replace('onDoubleClick:M=>{M.stopPropagation(),fi(o.id)}', 'onDoubleClick:M=>{M.stopPropagation(),n(o.id)}')
s = s.replace('Klik om dit station te bewerken · dubbelklik om het volledig te verwijderen · sleep om het te verplaatsen', 'Klik om dit station te bewerken · sleep om het te verplaatsen')
s = s.replace('Sleep om te verplaatsen · dubbelklik verwijdert', 'Sleep om te verplaatsen')
# Give formerly icon-only operations readable names, including after emoji cleanup.
replace('r.jsxs("div",{style:{display:"flex",gap:4,marginTop:8},children:[r.jsx("button",{onClick:()=>A0(E.id)', 'r.jsxs("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginTop:8},children:[r.jsx("button",{onClick:()=>A0(E.id)')
replace('onClick:()=>A0(E.id),style:qA,children:"↓"', 'onClick:()=>A0(E.id),style:qA,title:"Eén laag naar achteren",children:"Naar achter"')
replace('onClick:()=>$g(E.id),style:qA,children:"↑"', 'onClick:()=>$g(E.id),style:qA,title:"Eén laag naar voren",children:"Naar voren"')
replace('onClick:()=>qg(E.id),style:qA,children:"📋"', 'onClick:()=>qg(E.id),style:qA,children:"Dupliceren"')
replace('children:"🗑️"', 'children:"Verwijderen"')
replace('children:"🖼 Symbool"', 'children:"Eigen afbeelding"')
replace('A(D=>[...D,v]),n(null)},[J,nA,q,EA,G,VA])', 'A(D=>[...D,v]),n(KA[o]?null:v.id)},[J,nA,q,EA,G,VA])')
# A day label is placed independently. Sunrise/sunset already has its own tool.
replace('ye(rA.type,c.x,c.y,{value:rA.value,color:rA.color});const h=rA.value.length*50*.62+24;ye("zontijden",c.x+h/2+80,c.y),aA(null);return', 'ye(rA.type,c.x,c.y,{value:rA.value,color:rA.color});aA(null);return')
bundle.write_text(s)
print('Regional studio integration applied.')
