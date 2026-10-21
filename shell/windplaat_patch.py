"""Voegt de Windplaat toe aan beta.html (tabblad), weerbewaking.html (menukaart) en
product-host.html (cache-bump). Idempotent: doet niets als het er al staat.
Gebruik: python3 windplaat_patch.py <map met de drie bestanden>"""
import re, sys
from pathlib import Path

D = Path(sys.argv[1]); V = '20261021-1'

def patch(name, fn):
    p = D / name; s = p.read_text(); n = fn(s)
    if n != s:
        p.write_text(n); print(f'   {name}: bijgewerkt')
    else:
        print(f'   {name}: ongewijzigd')

def beta(s):
    if 'data-tab="windplaat"' in s:
        return s
    s, k1 = re.subn(r'(\n(\s*)<div class="tabs">\n)', r'\1\2  <button class="tab" type="button" data-tab="windplaat">🪁 Windplaat</button>\n', s, count=1)
    s, k2 = re.subn(r'(\n(\s*)<div class="content">\n)', r'\1\2  <div class="tab-panel" id="tab-windplaat"><iframe id="iframe-windplaat" src="" title="Windplaat: wind en windstoten per plaats"></iframe></div>\n', s, count=1)
    s, k3 = re.subn(r'(const IFRAME_SRCS = \{\n)', r"\1  windplaat: 'windplaat.html?v=" + V + "',\n", s, count=1)
    if (k1, k2, k3) != (1, 1, 1):
        raise SystemExit(f'beta.html: ankerpunten niet gevonden {k1, k2, k3}')
    return s

CARD = '''    <a class="menu-kaart" href="https://weerlab.nl/windplaat.html?bron=wb&amp;v=''' + V + '''" data-route="windplaat">
      <div class="icoon">🪁</div>
      <div class="titel">Windplaat · 90 uur</div>
      <div class="omschrijving">Wind en windstoten per uur voor elke plaats in Nederland, met piekmomenten, windrichting en een vierkante versie voor social media. Typ zelf de plaats.</div>
      <span class="tag">HARMONIE 43 · ECMWF IFS · elk uur</span>
    </a>
'''

def wb(s):
    if 'data-route="windplaat"' in s:
        return s
    s, k = re.subn(r'(\n\s*<div class="menu-scheiding">Speciale producten</div>\n)', lambda m: m.group(1) + CARD, s, count=1)
    if k != 1:
        raise SystemExit('weerbewaking.html: "Speciale producten" niet gevonden')
    return s

def host(s):
    return re.sub(r'beta\.html\?v=[^"\']*', 'beta.html?v=' + V + '-windplaat', s, count=1)

patch('beta.html', beta); patch('weerbewaking.html', wb); patch('product-host.html', host)
