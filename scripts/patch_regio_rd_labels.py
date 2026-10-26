"""Regiokaart-editor: plaatsnamen (knop 'Plaatsen') op de juiste plek via RD.

De labels werden lineair in lon/lat op het kader 3,55–5,35°O × 51,58–52,08°N gezet,
terwijl de regio-ondergrond in RD (EPSG:28992) is getekend: x 44076–131995 m,
y 405838–455293 m, 45,7911 m per pixel (vastgesteld door de CBS-kustlijn op de
afbeelding te passen; zie accumulatie/regiokaart.py). Afwijking was tot ~6 km
(Hoek van Holland lag landinwaarts). Nu via de RD-omrekening Pi() uit de bundle;
de Nederland-modus gebruikt dezelfde RD-afbeelding Li() als de stations.

Idempotent; faalt veilig als de ankers in een nieuwe bundle ontbreken.
Gebruik: python3 scripts/patch_regio_rd_labels.py [pad/naar/bundle.js]
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
bundle = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'regio-editor-assets/weerbewaking_regio_kaart-DCFOt_3t.js'
s = bundle.read_text()


def replace(old, new):
    global s
    if s.count(new) == 1:
        return
    if s.count(old) != 1:
        raise ValueError(f'Verwacht precies één anker: {old[:100]}')
    s = s.replace(old, new, 1)


replace('bw=(e,A,t=hl.regio)=>(',
        'RegioRD={x0:44075.95,y1:455292.51,m:45.7911},RegioPlaatsPx=(e,A,t)=>{const p=Pi(e,A);'
        'return t==="nederland"?Li(p.x,p.y):{x:(p.x-RegioRD.x0)/RegioRD.m,y:(RegioRD.y1-p.y)/RegioRD.m}},'
        'bw=(e,A,t=hl.regio)=>(')
replace('Tg=z.useCallback(o=>{const c=bw(o.lon,o.lat,hl[y]||hl.regio);',
        'Tg=z.useCallback(o=>{const c=RegioPlaatsPx(o.lon,o.lat,y);')
bundle.write_text(s)
print('Plaatsnamen regiokaart via RD.')
