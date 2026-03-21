import os
os.chdir(os.path.expanduser("~/Desktop/KNMI_Project/weerkaarten 2"))

c = open('historisch.html').read()

# Zoek de PG knop en voeg nieuwe knoppen erna toe
old = 'wisselParam(\'PG\')">📊 PG Luchtdruk</button>\n  </div>'
new = '''wisselParam('PG')">📊 PG Luchtdruk</button>
    <button class="param-btn" id="btn-SP" onclick="wisselParam('SP')">🌤️ SP Zon %</button>
    <button class="param-btn" id="btn-DR" onclick="wisselParam('DR')">🌧️ DR Neerslagduur</button>
    <button class="param-btn" id="btn-NG" onclick="wisselParam('NG')">☁️ NG Bewolking</button>
    <button class="param-btn" id="btn-UG" onclick="wisselParam('UG')">💧 UG Vochtigheid</button>
    <button class="param-btn" id="btn-VVN" onclick="wisselParam('VVN')">👁️ VVN Min zicht</button>
  </div>'''

if old in c:
    c = c.replace(old, new)
    print("Knoppen toegevoegd via methode 1")
else:
    # Fallback: zoek PG knop anders
    import re
    c = re.sub(
        r"(wisselParam\('PG'\)\">📊 PG Luchtdruk</button>)",
        r"\1\n    <button class=\"param-btn\" id=\"btn-SP\" onclick=\"wisselParam('SP')\">🌤️ SP Zon %</button>\n    <button class=\"param-btn\" id=\"btn-DR\" onclick=\"wisselParam('DR')\">🌧️ DR Neerslagduur</button>\n    <button class=\"param-btn\" id=\"btn-NG\" onclick=\"wisselParam('NG')\">☁️ NG Bewolking</button>\n    <button class=\"param-btn\" id=\"btn-UG\" onclick=\"wisselParam('UG')\">💧 UG Vochtigheid</button>\n    <button class=\"param-btn\" id=\"btn-VVN\" onclick=\"wisselParam('VVN')\">👁️ VVN Min zicht</button>",
        c
    )
    print("Knoppen toegevoegd via methode 2")

# Voeg PARAM_COL entries toe als die er nog niet in zitten
if 'VVN' not in c:
    c = c.replace(
        "  FXX: {col:8,  div:10, eenheid:\"m/s\", label:\"Max windstoot\"},\n};",
        "  FXX: {col:8,  div:10, eenheid:\"m/s\", label:\"Max windstoot\"},\n  SP:  {div:1,  eenheid:\"%\",    label:\"Zon %\"},\n  DR:  {div:10, eenheid:\"u\",    label:\"Neerslagduur\"},\n  NG:  {div:1,  eenheid:\"oktas\",label:\"Bewolking\"},\n  UG:  {div:1,  eenheid:\"%\",    label:\"Luchtvochtigheid\"},\n  VVN: {div:1,  eenheid:\"m\",    label:\"Min zicht\"},\n};"
    )
    print("PARAM_COL uitgebreid")

open('historisch.html', 'w').write(c)
print("btn-SP:", "btn-SP" in c)
print("btn-VVN:", "btn-VVN" in c)
print("VVN in PARAM_COL:", "VVN" in c)
print("Klaar!")
