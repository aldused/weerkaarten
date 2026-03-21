import os
os.chdir(os.path.expanduser("~/Desktop/KNMI_Project/weerkaarten 2"))

c = open('index_be.html').read()

oud = '''function maakKaartItem(naam, lijst) {
  const div = document.createElement("div");
  div.className = "kaart-item";
  const img = document.createElement("img");
  img.src = naam;
  img.loading = "lazy";
  img.alt = naam;
  const lbl = document.createElement("div");
  lbl.className = "kaart-label";
  lbl.textContent = dagLabel(naam);
  div.appendChild(img);
  div.appendChild(lbl);
  div.addEventListener("click", () => openLightbox(naam, lijst));
  return div;
}'''

nieuw = '''function maakKaartItem(naam, lijst) {
  const label = dagLabel(naam);
  const item = document.createElement("div"); item.className = "kaart-item";
  const hint = document.createElement("span");
  hint.style.cssText = "font-size:0.72em;color:#666;background:#f0f4f8;padding:4px 10px;display:block;text-align:right;border-bottom:1px solid #e0e0e0;";
  hint.textContent = "🔍 klik voor vergroting";
  const img = document.createElement("img");
  img.src = naam; img.alt = label; img.loading = "lazy";
  img.onclick = function(){ openLightbox(naam, lijst); };
  img.onerror = function(){ item.style.display="none"; };
  const footer = document.createElement("div"); footer.className = "kaart-footer";
  const lbl = document.createElement("span"); lbl.className = "kaart-naam"; lbl.textContent = label;
  const btn = document.createElement("a"); btn.className = "btn-down"; btn.href = naam; btn.download = naam; btn.textContent = "⬇ Download";
  footer.appendChild(lbl); footer.appendChild(btn);
  item.appendChild(hint); item.appendChild(img); item.appendChild(footer);
  return item;
}'''

if oud in c:
    c = c.replace(oud, nieuw)
    open('index_be.html','w').write(c)
    print('Klaar!')
else:
    print('Niet gevonden')
    idx = c.find('function maakKaartItem')
    print(repr(c[idx:idx+200]))
