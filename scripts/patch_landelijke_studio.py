"""Attach the maintained studio presentation to the legacy production bundle.

The upstream JSX source is not in this repo. Exact replacements intentionally
fail on an upstream change, instead of silently attaching UI to the wrong node.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
bundle = ROOT / 'landelijke-editor-assets/weerbewaking_landelijke_kaart-pc6L27QC.js'
s = bundle.read_text()

def replace(old, new):
    global s
    if s.count(new) == 1:
        return
    count = s.count(old)
    if count != 1:
        raise ValueError(f'Expected one integration anchor, got {count}: {old[:100]}')
    s = s.replace(old, new, 1)

import_line = 'import {createLandelijkeStudio} from "../editor-src/landelijke-studio.js?v=20260909-studio1";\n'
if import_line not in s:
    s = import_line + s
icon_import = 'import {createWeatherIcon,WEATHER_ICON_LABELS} from "../editor-src/weather-icons.js?v=20260909-icons1";\n'
s = s.replace('import {createWeatherIcon} from "../editor-src/weather-icons.js?v=20260909-icons1";\n', icon_import)
if icon_import not in s:
    s = icon_import + s
replace('Lt=({type:e,s:A=250})=>', 'LegacyLt=({type:e,s:A=250})=>')
replace('function Ah(){', 'const LandelijkeStudio=createLandelijkeStudio(z);function Ah(){')
if 'const Lt=createWeatherIcon(z,LegacyLt);' not in s:
    s = s.replace('const LandelijkeStudio=', 'const Lt=createWeatherIcon(z,LegacyLt);const LandelijkeStudio=', 1)
if 'Object.assign(WA,WEATHER_ICON_LABELS);' not in s:
    s = s.replace('const LandelijkeStudio=', 'Object.assign(WA,WEATHER_ICON_LABELS);const LandelijkeStudio=', 1)
replace('return r.jsxs("div",{style:{fontFamily:Q,background:"#0F172A",height:"100vh",display:"grid"',
        'return r.jsxs(LandelijkeStudio,{enabled:location.pathname.endsWith("weerbewaking_landelijke_kaart.html"),selected:E,tool:i,pendingLabel:iA&&iA.value,count:e.length,dayLabel:pA&&pA.line1,source:hA==="weatherpro"?"WeatherPro":"MOSMIX",loading:Ne.loading,error:Ne.error,night:$,brightness:Hn,nightBrightness:cr,ratio:gA/xA,symbolsOpen:showSymbolCatalog,actions:{back:Yw,open:yc,save:Sc,download:zc,reset:Lg,background:pc,undo:To,redo:Uo,select:()=>{s("select"),dA(null)},deselect:()=>n(null),removeSelected:()=>t&&xi(t),chooseSymbol:o=>{s(o),x(null),dA(null)},data:()=>x("mosmixNl"),symbols:()=>setShowSymbolCatalog(o=>!o),appearance:o=>{d(o),y!=="custom"&&p(dt[y][o?"night":"day"])},brightness:o=>$?kn(o):li(o)},style:{fontFamily:Q,background:"#0F172A",height:"100vh",display:"grid"')
replace('r.jsxs("div",{style:{background:"#1E293B",borderBottom:', 'r.jsxs("div",{"data-studio-section":"header",style:{background:"#1E293B",borderBottom:')
replace('r.jsxs("div",{style:{background:"#1a2436",borderBottom:', 'r.jsxs("div",{"data-studio-section":"tools",style:{background:"#1a2436",borderBottom:')
replace('r.jsxs("div",{style:{display:"contents",flex:void 0', 'r.jsxs("div",{"data-studio-section":"workspace",style:{display:"contents",flex:void 0')
replace('r.jsx("div",{style:{flex:void 0,padding:8,overflow:"auto"', 'r.jsx("div",{"data-studio-section":"map",style:{flex:void 0,padding:8,overflow:"auto"')
replace('r.jsxs("div",{style:{width:"auto",background:"#1E293B",borderLeft:', 'r.jsxs("div",{"data-studio-section":"inspector",style:{width:"auto",background:"#1E293B",borderLeft:')
replace('g==="mosmixNl"&&r.jsxs("div",{style:{marginBottom:10,padding:"9px"', '(g==="mosmixNl"||Vg==="landelijk")&&r.jsxs("div",{"data-studio-section":"data-head",style:{marginBottom:10,padding:"9px"')
replace('TA==="single"&&r.jsx("div",{style:{padding:"7px 9px",marginBottom:10', 'TA==="single"&&r.jsx("div",{"data-studio-section":"map-tip",style:{padding:"7px 9px",marginBottom:10')
for source in ['mosmix', 'weatherpro']:
    replace(f'g==="mosmixNl"&&TA==="single"&&hA==="{source}"&&r.jsxs("div",{{style:', f'(g==="mosmixNl"||Vg==="landelijk")&&TA==="single"&&hA==="{source}"&&r.jsxs("div",{{"data-studio-section":"forecast",style:')
replace('E?r.jsxs("div",{children:[r.jsx($e,{children:"Element bewerken"})', 'E?r.jsxs("div",{"data-studio-section":"edit",children:[r.jsx($e,{children:"Element bewerken"})')
replace('r.jsxs("div",{style:{borderTop:"1px solid rgba(255,255,255,0.08)",marginTop:12,paddingTop:10}', 'r.jsxs("div",{"data-studio-section":"copyright",style:{borderTop:"1px solid rgba(255,255,255,0.08)",marginTop:12,paddingTop:10}')
replace('deselect:()=>n(null),data:', 'deselect:()=>n(null),removeSelected:()=>t&&xi(t),chooseSymbol:o=>{s(o),x(null),dA(null)},data:')
replace('function $e({children:e}){return r.jsx("div",{style:', 'function $e({children:e}){return r.jsx("div",{className:"studio-field-title",style:')
replace('function eA({children:e}){return r.jsx("div",{style:', 'function eA({children:e}){return r.jsx("div",{className:"studio-field-label",style:')
replace('He={stroke:"#60A5FA",strokeWidth:2.5,strokeDasharray:"6,3"}', 'He={"data-editor-selection":!0,stroke:"#60A5FA",strokeWidth:2.5,strokeDasharray:"6,3"}')
replace('c.querySelectorAll(\'[data-inline-editor="true"]\')', 'c.querySelectorAll(\'[data-inline-editor="true"], [data-editor-selection]\')')
replace('onDoubleClick:M=>{M.stopPropagation(),xi(o.id)}', 'onDoubleClick:M=>{M.stopPropagation(),n(o.id)}')
s = s.replace('Klik om dit station te bewerken · dubbelklik om het volledig te verwijderen · sleep om het te verplaatsen', 'Klik om dit station te bewerken · sleep om het te verplaatsen')
s = s.replace('Sleep om te verplaatsen · dubbelklik verwijdert', 'Sleep om te verplaatsen')
# The old const cache was reassigned on the first custom location, crashing the
# entire editor while computing the coastal wind buttons.
replace('wlWindKustRd=null,wlWindKustPunten=()=>(wlWindKustRd||(wlWindKustRd=wlWindKustLonLat.map(([e,A])=>Ni(e,A))),wlWindKustRd)',
        'wlWindKustRd=[],wlWindKustPunten=()=>{if(!wlWindKustRd.length)wlWindKustRd.push(...wlWindKustLonLat.map(([e,A])=>Ni(e,A)));return wlWindKustRd}')
replace('if(!Number.isFinite(c)){alert("Vul een geldige temperatuur in.");return}if(!Number.isFinite(f)||f<0||f>12)',
        'if(!String(customPoint.value).trim()||!Number.isFinite(c)||c<-50||c>60){alert("Vul een temperatuur van −50 tot en met 60 °C in.");return}if(!String(customPoint.bft).trim()||!Number.isFinite(f)||f<0||f>12)')
replace('I==="night"&&(R==="zon"||R==="sluierbewolking")&&(R="sterren")',
        'I==="night"&&(R=({zon:"sterren",sluierbewolking:"sterren",zon_achter_wolk:"maan_wolk",zon_achter_grijze_wolk:"maan_wolk",halfbewolkt_regen:"maan_regen",zon_wolk_regen:"maan_regen",zon_onweersbui:"maan_onweer",stapelwolk_bliksem:"maan_onweer",onweer:"maan_onweer"})[R]||R)')
# WeatherPro: night clouds must not be represented by clear-sky stars.
replace('if(I>=95)return H?"onweer":"zon_onweersbui";if(I>=90)return"stapelwolk_bliksem";if(I>=80)return H?"regen":"zon_wolk_regen";',
        'if(I>=95)return H?"maan_onweer":"zon_onweersbui";if(I>=90)return H?"maan_onweer":"stapelwolk_bliksem";if(I>=80)return H?"maan_regen":"zon_wolk_regen";')
replace('if(I>=60)return"regen";', 'if(I>=60)return H?"maan_regen":"regen";')
replace('if(I>=20&&D>.05)return H?"regen":"halfbewolkt_regen";', 'if(I>=20&&D>.05)return H?"maan_regen":"halfbewolkt_regen";')
replace('if(v>=5)return"zon_achter_grijze_wolk";if(v>=3)return H?"sterren":"zon_achter_wolk"',
        'if(v>=5)return H?"maan_wolk":"zon_achter_grijze_wolk";if(v>=3)return H?"maan_wolk":"zon_achter_wolk"')
replace('return I>=5?"bewolkt":I>=3?H?"sterren":"zon_achter_grijze_wolk":I>=2?H?"sterren":"zon_achter_wolk":H?"sterren":"zon"',
        'return I>=5?"bewolkt":I>=3?H?"maan_wolk":"zon_achter_grijze_wolk":I>=2?H?"maan_wolk":"zon_achter_wolk":H?"sterren":"zon"')
bundle.write_text(s)
print('Landelijke studio integration applied.')
