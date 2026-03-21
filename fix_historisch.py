import re, os
os.chdir(os.path.expanduser("~/Desktop/KNMI_Project/weerkaarten 2"))
c = open('historisch.html').read()

# Verwijder dubbele copyright divs
c = re.sub(r'\n\s*<div style="text-align:right[^>]*>[^<]*(Ed Aldus|copy)[^<]*</div>', '', c)

# Verwijder alle vergroot/slaOp functies (meerdere versies)
c = re.sub(r'function vergroot\s*\(\s*\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}', '', c)
c = re.sub(r'function slaOp\s*\(\s*\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}', '', c)

# Voeg schone versie toe
fn = """
function vergroot(){
  var lb=document.createElement("div");
  lb.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;padding:16px;";
  lb.onclick=function(){document.body.removeChild(lb);};
  var lbl=document.createElement("div");
  lbl.style.cssText="color:white;font-size:0.85em;margin-bottom:8px;";
  lbl.textContent=document.getElementById("kaart-titel").textContent+" - klik om te sluiten";
  var wrap=document.createElement("div");
  wrap.style.cssText="position:relative;max-width:95vw;max-height:88vh;";
  var bg=document.createElement("img");
  bg.src=document.getElementById("kaart-basis").src;
  bg.style.cssText="max-width:95vw;max-height:88vh;border-radius:6px;display:block;";
  var sv=document.getElementById("nl-kaart").cloneNode(true);
  sv.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;";
  wrap.appendChild(bg);wrap.appendChild(sv);
  lb.appendChild(lbl);lb.appendChild(wrap);
  document.body.appendChild(lb);
}
function slaOp(){
  var img=document.getElementById("kaart-basis");
  if(img==null)return;
  var t=document.getElementById("kaart-titel").textContent.replace(/[^a-zA-Z0-9]/g,"_");
  var a=document.createElement("a");
  a.href=img.src;a.download="historisch_"+t+".png";
  document.body.appendChild(a);a.click();document.body.removeChild(a);
}
"""
c = c.replace('function navigeer(', fn + 'function navigeer(')

open('historisch.html','w').write(c)
print('vergroot:', c.count('function vergroot'))
print('slaOp:', c.count('function slaOp'))
print('copyright svg:', 'Ed Aldus / KNMI' in c)
print('Klaar!')
